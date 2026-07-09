import { type BrowserWindow, app, ipcMain } from "electron";
import extractZip from "extract-zip";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import {
	chmodSync,
	cpSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
} from "node:fs";
import { join, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
	SHELL_API_VERSION,
	bundlePlatformKeyFor,
	desktopIpcChannel,
	type BundleComponentKind,
	type BundleComponentRef,
	type BundleManifestPayload,
	type BundleUpdateCapability,
	type BundleUpdateStatus,
	type DesktopUpdateAck,
} from "./ipc-contract.js";
import {
	bundleManifestUrl,
	bundleUpdatePublicKey,
	downloadTimeoutMs,
	hotUpdateEnabled,
	manifestFetchTimeoutMs,
	serverHealthTimeoutMs,
	serverStopGraceMs,
} from "./hot-update-config.js";
import {
	evaluateBundleManifest,
	isSafeZipEntryPath,
	isValidBundleManifestPayload,
} from "./bundle-policy.js";
import {
	activateVersion,
	blockAndRevert,
	bundleMetaFilename,
	bundleServerBinPath,
	cleanupVersions,
	dbSnapshotDir,
	isBundleUsable,
	markComponentHealthy,
	readBuiltinMeta,
	readBundleMeta,
	readRuntimeInfo,
	readStoreState,
	recordBootAttempt,
	resolveBundleDir,
	restoreDatabases,
	serverBinaryFilename,
	snapshotDatabases,
	tmpDir,
	versionDir,
	writeBundleMeta,
	writeRuntimeInfo,
	type BundleRuntimeInfo,
	type ResolvedBundle,
} from "./bundle-store.js";
import { rendererDistDir, serverBinaryPath } from "./paths.js";
import {
	isServerSidecarRunning,
	serverSidecarBaseUrl,
	startServerSidecar,
	stopServerSidecarGracefully,
} from "./sidecar.js";

// Local test mode — OFF unless BOTH env vars are set, so production is never affected.
// See scripts/hot-update-local-test.ts.
const testManifestUrl = process.env.MEDIAGO_HOT_UPDATE_TEST_URL?.trim() || "";
const testPublicKey = process.env.MEDIAGO_HOT_UPDATE_TEST_PUBKEY?.trim() || "";
const isTestMode = testManifestUrl.length > 0 && testPublicKey.length > 0;

const effectiveManifestUrl = isTestMode ? testManifestUrl : bundleManifestUrl;
const effectivePublicKey = isTestMode ? testPublicKey : bundleUpdatePublicKey;
const effectiveEnabled = isTestMode || hotUpdateEnabled;

const isHotUpdateActive = () =>
	effectiveEnabled &&
	app.isPackaged &&
	!process.env.ELECTRON_RENDERER_URL &&
	effectivePublicKey.length > 0;

const platformKey = () => bundlePlatformKeyFor(process.platform, process.arch);

/** Delay before the silent background check after startup. */
const backgroundCheckDelayMs = 15_000;

/**
 * Decide which bundle this launch should load and perform launch-time safety work:
 * restore the DB snapshot when a rev was just blocked WITHOUT its server ever having
 * been confirmed healthy (a server that ran healthy wrote valid data — restoring
 * would wipe real user sessions), and take a fresh snapshot before the first boot of
 * a pending bundle. Must be called after the single-instance lock is held and before
 * the sidecar is spawned — i.e. inside the no-server window where SQLite is quiescent.
 */
export const prepareActiveBundle = (): ResolvedBundle => {
	const builtinRendererDir = rendererDistDir();
	const builtinServerBin = serverBinaryPath();
	if (!isHotUpdateActive()) {
		return {
			rendererDir: builtinRendererDir,
			serverBinPath: builtinServerBin,
			source: "builtin",
			rev: 0,
			reason: "hot update disabled",
		};
	}

	const userDataDir = app.getPath("userData");
	const runtimeInfo = readRuntimeInfo(userDataDir);
	const preState = readStoreState(userDataDir);
	const resolved = resolveBundleDir(userDataDir, builtinRendererDir, builtinServerBin, {
		// Without cached DB locations we cannot snapshot → never first-boot a pending
		// bundle. The cache is written before any bundle is staged, so this only
		// guards against manual tampering / corruption.
		allowPending: runtimeInfo !== null,
	});

	try {
		if (resolved.blockedRev !== undefined && !preState.serverHealthy) {
			restoreDatabases(dbSnapshotDir(userDataDir, resolved.blockedRev));
		}
		if (resolved.firstBootOfPending && runtimeInfo) {
			snapshotDatabases(runtimeInfo.databaseFiles, dbSnapshotDir(userDataDir, resolved.rev));
		}
		// One-time cleanup of the pre-bundle renderer-only updater's store; nothing
		// reads <userData>/renderer anymore.
		rmSync(join(userDataDir, "renderer"), { recursive: true, force: true });
	} catch (error) {
		console.error("[bundle-updater] launch safety work failed", error);
	}
	return resolved;
};

interface BundleUpdaterDeps {
	getWindow: () => BrowserWindow | null;
	active: ResolvedBundle;
}

export interface BundleUpdaterHandle {
	/**
	 * Call right after the sidecar has been spawned for this launch: confirms server
	 * health for pending bundles (full timeout budget measured from actual server
	 * start) and schedules the silent background check.
	 */
	notifyServerStarted: () => void;
}

export const registerBundleUpdater = ({
	getWindow,
	active,
}: BundleUpdaterDeps): BundleUpdaterHandle => {
	// Mutable: apply-now swaps the running bundle without an app restart.
	let current = active;
	let inFlight = false;
	let applying = false;
	let quitting = false;

	// Never fight the quit sequence: an apply raced by Cmd+Q must not block a healthy
	// rev or restore databases mid-quit; the next launch re-runs the pending flow with
	// a fresh health budget.
	app.once("before-quit", () => {
		quitting = true;
	});

	const emit = (status: Omit<BundleUpdateStatus, "currentRev">): void => {
		const window = getWindow();
		if (!window || window.isDestroyed()) return;
		window.webContents.send(desktopIpcChannel.bundleUpdateStatus, {
			currentRev: current.rev,
			...status,
		});
	};

	const capability = (): BundleUpdateCapability => {
		if (!isHotUpdateActive()) {
			return {
				enabled: false,
				currentRev: current.rev,
				source: current.source,
				reason: hotUpdateEnabled ? "当前运行环境不支持热更新。" : "热更新尚未启用。",
			};
		}
		return { enabled: true, currentRev: current.rev, source: current.source };
	};

	const check = async (): Promise<DesktopUpdateAck> => {
		if (!isHotUpdateActive()) return { ok: false, message: "热更新尚未启用。" };
		if (inFlight) return { ok: false, message: "已有一次更新检查正在进行。" };
		if (applying) return { ok: false, message: "更新正在应用中。" };
		inFlight = true;
		try {
			await runCheck();
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : "检查更新失败。";
			emit({ phase: "error", error: message });
			return { ok: false, message };
		} finally {
			inFlight = false;
		}
	};

	const runCheck = async (): Promise<void> => {
		const userDataDir = app.getPath("userData");
		emit({ phase: "checking" });

		const payload = await fetchSignedManifest();

		const store = readStoreState(userDataDir);
		const stagedRev = store.activeRev;
		if (
			payload.bundleRev === stagedRev &&
			stagedRev !== current.rev &&
			isBundleUsable(versionDir(userDataDir, stagedRev), stagedRev)
		) {
			emit({ phase: "staged", targetRev: stagedRev, notes: payload.notes });
			return;
		}

		const currentMeta =
			current.source === "downloaded"
				? (readBundleMeta(current.rendererDir) ?? readBuiltinMeta(rendererDistDir()))
				: readBuiltinMeta(rendererDistDir());
		const decision = evaluateBundleManifest(
			payload,
			platformKey(),
			currentMeta,
			Math.max(currentMeta.bundleRev, current.rev),
			store.blockedRevs,
			SHELL_API_VERSION,
		);

		switch (decision.action) {
			case "disabled":
			case "up-to-date":
				emit({ phase: "up-to-date" });
				return;
			case "requires-full-update":
				emit({
					phase: "requires-full-update",
					targetRev: decision.targetRev,
					notes: "新版本需要更新桌面端主程序，请通过应用更新升级完整版本。",
				});
				return;
			case "unsupported-platform":
				emit({
					phase: "error",
					targetRev: decision.targetRev,
					error: "该更新不支持当前平台。",
				});
				return;
			case "download":
				break;
		}

		// Refresh runtime facts (DB paths for snapshots) from the live server before
		// staging — staging is refused without them, so first-boot snapshots always
		// have the information they need. Deliberately only on the download path: the
		// common up-to-date check stays a single manifest fetch.
		const runtimeInfo = await refreshRuntimeInfo(userDataDir);
		if (!runtimeInfo) {
			throw new Error("无法获取运行时信息（数据库位置），已跳过本次更新。");
		}

		await downloadAndStage(userDataDir, payload, decision.components);
		emit({
			phase: "staged",
			targetRev: payload.bundleRev,
			components: decision.components,
			notes: payload.notes,
		});
	};

	const downloadAndExtract = async (
		ref: BundleComponentRef,
		zipPath: string,
		extractDir: string,
		label: string,
		rev: number,
		components: BundleComponentKind[],
	): Promise<void> => {
		await downloadWithHash(ref, zipPath, (transferred, total) =>
			emit({
				phase: "downloading",
				targetRev: rev,
				components,
				notes: label,
				progress: progressOf(transferred, total),
			}),
		);
		await extractZip(zipPath, {
			dir: extractDir,
			onEntry: (entry) => {
				if (!isSafeZipEntryPath(entry.fileName)) {
					throw new Error(`更新包包含非法路径: ${entry.fileName}`);
				}
			},
		});
	};

	const downloadAndStage = async (
		userDataDir: string,
		payload: BundleManifestPayload,
		components: BundleComponentKind[],
	): Promise<void> => {
		const rev = payload.bundleRev;
		const serverRef = payload.components.server[platformKey()];
		if (!serverRef) throw new Error("该更新不支持当前平台。");

		const scratch = tmpDir(userDataDir);
		rmSync(scratch, { recursive: true, force: true });
		mkdirSync(scratch, { recursive: true });
		const stageDir = join(scratch, `bundle-${rev}`);
		mkdirSync(join(stageDir, "bin"), { recursive: true });

		try {
			// Renderer component: download+extract, or copy the currently running one.
			if (components.includes("renderer")) {
				await downloadAndExtract(
					payload.components.renderer,
					join(scratch, `renderer-${rev}.zip`),
					stageDir,
					"界面资源",
					rev,
					components,
				);
			} else {
				// Exact-segment exclusion: only the bundle's own bin/ dir and its root
				// bundle-meta.json — never legitimate dist files that merely share the
				// prefix or suffix (bin.svg, assets/foo.bundle-meta.json, …).
				const currentBinDir = join(current.rendererDir, "bin");
				const currentMetaFile = join(current.rendererDir, bundleMetaFilename);
				cpSync(current.rendererDir, stageDir, {
					recursive: true,
					filter: (source) =>
						source !== currentBinDir &&
						!source.startsWith(currentBinDir + sep) &&
						source !== currentMetaFile,
				});
			}

			// Server component: download+extract the platform binary, or copy current.
			const stagedServerBin = join(stageDir, "bin", serverBinaryFilename());
			if (components.includes("server")) {
				const serverExtractDir = join(scratch, `server-${rev}`);
				await downloadAndExtract(
					serverRef,
					join(scratch, `server-${rev}.zip`),
					serverExtractDir,
					"服务组件",
					rev,
					components,
				);
				const extractedBin = join(serverExtractDir, serverBinaryFilename());
				if (!existsSync(extractedBin)) {
					throw new Error("服务组件更新包内容不完整。");
				}
				renameSync(extractedBin, stagedServerBin);
			} else {
				cpSync(current.serverBinPath, stagedServerBin);
			}
			if (process.platform !== "win32") {
				chmodSync(stagedServerBin, 0o755);
			}

			writeBundleMeta(stageDir, {
				bundleRev: rev,
				minShellApi: payload.minShellApi,
				appBaseline: payload.appBaseline,
				components: {
					renderer: payload.components.renderer.sha256,
					server: serverRef.sha256,
				},
			});

			if (!isBundleUsable(stageDir, rev)) {
				throw new Error("更新包组装后校验失败。");
			}

			const target = versionDir(userDataDir, rev);
			rmSync(target, { recursive: true, force: true });
			mkdirSync(join(target, ".."), { recursive: true });
			renameSync(stageDir, target);

			const previousActive = readStoreState(userDataDir).activeRev;
			activateVersion(userDataDir, rev);
			cleanupVersions(userDataDir, [rev, previousActive, current.rev]);
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	};

	// Apply the staged bundle without restarting the app: swap the server child
	// process and reload the window. Refuses while the server reports active work.
	const applyNow = async (): Promise<DesktopUpdateAck> => {
		if (!isHotUpdateActive()) return { ok: false, message: "热更新尚未启用。" };
		if (quitting) return { ok: false, message: "应用正在退出。" };
		if (inFlight) return { ok: false, message: "更新检查正在进行，请稍候。" };
		if (applying) return { ok: false, message: "更新正在应用中。" };
		const window = getWindow();
		if (!window || window.isDestroyed()) return { ok: false, message: "窗口不可用。" };

		const userDataDir = app.getPath("userData");
		const store = readStoreState(userDataDir);
		const stagedRev = store.activeRev;
		if (stagedRev <= 0 || stagedRev === current.rev) {
			return { ok: false, message: "没有待生效的更新。" };
		}
		const stagedDir = versionDir(userDataDir, stagedRev);
		if (!isBundleUsable(stagedDir, stagedRev)) {
			return { ok: false, message: "更新包不完整，请重新检查更新。" };
		}

		const activity = await fetchServerActivity();
		if (activity === null) {
			return { ok: false, message: "无法确认服务状态，请稍后重试。" };
		}
		if (activity.busy) {
			return {
				ok: false,
				message: "当前有任务正在执行，任务完成后再应用更新，或重启应用生效。",
			};
		}
		// Prefer the live server's own database list over the cache: it is authoritative
		// at this exact moment. The cache remains the fallback for the no-server launch path.
		const databaseFiles =
			activity.databaseFiles.length > 0
				? activity.databaseFiles
				: (readRuntimeInfo(userDataDir)?.databaseFiles ?? []);
		if (databaseFiles.length === 0) {
			return { ok: false, message: "缺少运行时信息，请重新检查更新。" };
		}

		applying = true;
		emit({ phase: "applying", targetRev: stagedRev });
		try {
			const stopped = await stopServerSidecarGracefully(serverStopGraceMs);
			if (!stopped) {
				// The old server refused to die: its port is still owned and any snapshot
				// would be torn. Change nothing — the staged bundle stays pending and a
				// normal restart applies it cleanly.
				emit({ phase: "staged", targetRev: stagedRev });
				return { ok: false, message: "旧服务未能及时退出，已取消本次应用；重启应用即可完成更新。" };
			}
			snapshotDatabases(databaseFiles, dbSnapshotDir(userDataDir, stagedRev));
			// The apply counts as a boot attempt for the pending bundle.
			recordBootAttempt(userDataDir);

			startServerSidecar({ binaryPath: bundleServerBinPath(stagedDir) });
			const healthy = await waitForServerHealth(serverHealthTimeoutMs);
			if (!healthy) {
				if (quitting) {
					return { ok: false, message: "应用正在退出，更新将于下次启动继续。" };
				}
				await rollbackApply(userDataDir, stagedRev);
				emit({
					phase: "error",
					targetRev: stagedRev,
					error: "新版本服务启动失败，已自动回滚。",
				});
				return { ok: false, message: "新版本服务启动失败，已自动回滚。" };
			}

			markComponentHealthy(userDataDir, "server", stagedRev);
			// Switch `current` BEFORE loading the new renderer: its health beacon can
			// fire the markRendererHealthy IPC before loadFile resolves, and the handler
			// gates on current — switching late would drop the signal and let the
			// health check roll back a working bundle. Restored on failure below.
			const previous = current;
			current = {
				rendererDir: stagedDir,
				serverBinPath: bundleServerBinPath(stagedDir),
				source: "downloaded",
				rev: stagedRev,
				reason: "applied without restart",
			};
			try {
				await window.loadFile(join(stagedDir, "index.html"), {
					hash: "/",
					query: { version: app.getVersion() },
				});
			} catch (error) {
				current = previous;
				throw error;
			}
			void refreshRuntimeInfo(userDataDir);
			emit({ phase: "idle" });
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : "应用更新失败。";
			if (!quitting) {
				try {
					await rollbackApply(userDataDir, stagedRev);
				} catch (rollbackError) {
					console.error("[bundle-updater] rollback failed", rollbackError);
				}
			}
			emit({ phase: "error", targetRev: stagedRev, error: message });
			return { ok: false, message: `${message}（已尝试回滚）` };
		} finally {
			applying = false;
		}
	};

	const rollbackApply = async (userDataDir: string, failedRev: number): Promise<void> => {
		if (isServerSidecarRunning()) {
			await stopServerSidecarGracefully(2_000);
		}
		restoreDatabases(dbSnapshotDir(userDataDir, failedRev));
		blockAndRevert(userDataDir, failedRev, current.source === "downloaded" ? current.rev : 0);
		startServerSidecar({ binaryPath: current.serverBinPath });
		await waitForServerHealth(serverHealthTimeoutMs);
	};

	ipcMain.handle(desktopIpcChannel.getBundleUpdateCapability, capability);

	ipcMain.handle(desktopIpcChannel.checkBundleUpdate, () => check());

	ipcMain.handle(desktopIpcChannel.applyBundleUpdate, () => applyNow());

	ipcMain.handle(desktopIpcChannel.markRendererHealthy, () => {
		if (!isHotUpdateActive() || current.source !== "downloaded") return;
		markComponentHealthy(app.getPath("userData"), "renderer", current.rev);
	});

	const notifyServerStarted = () => {
		if (!isHotUpdateActive()) return;
		void (async () => {
			const healthy = await waitForServerHealth(serverHealthTimeoutMs);
			if (!healthy) return;
			if (current.source === "downloaded") {
				markComponentHealthy(app.getPath("userData"), "server", current.rev);
			}
			void refreshRuntimeInfo(app.getPath("userData"));
		})();
		setTimeout(() => {
			void check();
		}, backgroundCheckDelayMs).unref();
	};

	return { notifyServerStarted };
};

// --- server probes -------------------------------------------------------------------

interface ServerActivity {
	busy: boolean;
	databaseFiles: string[];
}

const parseApiPayload = (raw: unknown): Record<string, unknown> | null => {
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw as Record<string, unknown>;
	// Unwrap the standard { data: … } response envelope when present.
	if (typeof record.data === "object" && record.data !== null) {
		return record.data as Record<string, unknown>;
	}
	return record;
};

const fetchServerActivity = async (): Promise<ServerActivity | null> => {
	try {
		const response = await fetch(`${serverSidecarBaseUrl()}/api/v1/runtime/activity`, {
			signal: AbortSignal.timeout(5_000),
			cache: "no-store",
		});
		if (!response.ok) return null;
		const payload = parseApiPayload(await response.json());
		if (!payload || typeof payload.busy !== "boolean") return null;
		const databaseFiles = Array.isArray(payload.databaseFiles)
			? payload.databaseFiles.filter((item): item is string => typeof item === "string")
			: [];
		return { busy: payload.busy, databaseFiles };
	} catch {
		return null;
	}
};

const refreshRuntimeInfo = async (userDataDir: string): Promise<BundleRuntimeInfo | null> => {
	const activity = await fetchServerActivity();
	if (!activity || activity.databaseFiles.length === 0) return readRuntimeInfo(userDataDir);
	const info: BundleRuntimeInfo = {
		serverBaseUrl: serverSidecarBaseUrl(),
		databaseFiles: activity.databaseFiles,
		updatedAt: new Date().toISOString(),
	};
	writeRuntimeInfo(userDataDir, info);
	return info;
};

const waitForServerHealth = async (timeoutMs: number): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${serverSidecarBaseUrl()}/api/v1/health`, {
				signal: AbortSignal.timeout(2_000),
				cache: "no-store",
			});
			if (response.ok) return true;
		} catch {
			// Server not up yet — keep polling.
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
};

// --- manifest + download -------------------------------------------------------------

const fetchSignedManifest = async (): Promise<BundleManifestPayload> => {
	const response = await fetch(effectiveManifestUrl, {
		signal: AbortSignal.timeout(manifestFetchTimeoutMs),
		cache: "no-store",
	});
	if (!response.ok) {
		throw new Error(`获取更新清单失败 (HTTP ${response.status})。`);
	}
	const envelope = (await response.json()) as { payloadB64?: unknown; signature?: unknown };
	if (typeof envelope.payloadB64 !== "string" || typeof envelope.signature !== "string") {
		throw new Error("更新清单格式无效。");
	}

	const payloadBytes = Buffer.from(envelope.payloadB64, "base64");
	const publicKey = createPublicKey({
		key: Buffer.from(effectivePublicKey, "base64"),
		format: "der",
		type: "spki",
	});
	const signatureValid = verifySignature(
		null,
		payloadBytes,
		publicKey,
		Buffer.from(envelope.signature, "base64"),
	);
	if (!signatureValid) {
		throw new Error("更新清单签名校验失败。");
	}

	const payload: unknown = JSON.parse(payloadBytes.toString("utf8"));
	// Only test mode (localhost) may relax the https-only rule on component URLs.
	if (!isValidBundleManifestPayload(payload, isTestMode)) {
		throw new Error("更新清单内容无效。");
	}
	return payload;
};

const progressOf = (transferred: number, total: number) => ({
	transferred,
	total,
	percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
});

const downloadWithHash = async (
	ref: BundleComponentRef,
	destPath: string,
	onProgress: (transferred: number, total: number) => void,
): Promise<void> => {
	const response = await fetch(ref.url, {
		signal: AbortSignal.timeout(downloadTimeoutMs),
		cache: "no-store",
	});
	if (!response.ok || !response.body) {
		throw new Error(`下载更新组件失败 (HTTP ${response.status})。`);
	}

	const total = Number(response.headers.get("content-length")) || ref.size;
	const hash = createHash("sha256");
	let transferred = 0;
	let lastEmit = 0;

	const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
	body.on("data", (chunk: Buffer) => {
		hash.update(chunk);
		transferred += chunk.length;
		const now = Date.now();
		if (now - lastEmit > 200 || transferred >= total) {
			lastEmit = now;
			onProgress(transferred, total);
		}
	});

	await pipeline(body, createWriteStream(destPath));

	const digest = hash.digest("hex");
	if (digest !== ref.sha256) {
		rmSync(destPath, { force: true });
		throw new Error("更新组件校验失败（sha256 不匹配）。");
	}
};
