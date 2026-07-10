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
	bundleManifestUrlFor,
	bundleUpdatePublicKey,
	downloadTimeoutMs,
	hotUpdateEnabled,
	manifestFetchTimeoutMs,
	serverHealthTimeoutMs,
	serverStopGraceMs,
} from "./hot-update-config.js";
import {
	chooseApplyFailureAction,
	evaluateBundleManifest,
	isSafeZipEntryPath,
	isValidBundleManifestPayload,
	maxBootAttempts,
} from "./bundle-policy.js";
import {
	activateVersion,
	assertBuiltinFloors,
	bundleMetaFilename,
	bundleServerBinPath,
	cleanupVersions,
	completeRollback,
	dbSnapshotDir,
	disableChannelAndRevert,
	isBundleUsable,
	markComponentHealthy,
	markMigrationStarted,
	markRollbackPending,
	readBuiltinMeta,
	readBundleMeta,
	readRuntimeInfo,
	readStoreState,
	recordBundleFloors,
	recordBootAttempt,
	resolveBundleDir,
	restoreDatabases,
	serverBinaryFilename,
	setChannelEnabled,
	snapshotDatabases,
	tmpDir,
	versionDir,
	writeBundleMeta,
	writeRuntimeInfo,
	writeStoreState,
	type BundleRuntimeInfo,
	type ResolvedBundle,
} from "./bundle-store.js";
import { rendererDistDir, serverBinaryPath } from "./paths.js";
import {
	isServerSidecarRunning,
	serverSidecarBaseUrl,
	startServerSidecar,
	stopServerSidecarGracefully,
	waitForServerSidecarPortFree,
	type SidecarIdentity,
} from "./sidecar.js";

// Local test mode — OFF unless BOTH env vars are set, so production is never affected.
// See scripts/hot-update-local-test.ts.
const testManifestUrl = process.env.MEDIAGO_HOT_UPDATE_TEST_URL?.trim() || "";
const testPublicKey = process.env.MEDIAGO_HOT_UPDATE_TEST_PUBKEY?.trim() || "";
const isTestMode = testManifestUrl.length > 0 && testPublicKey.length > 0;

const effectivePublicKey = isTestMode ? testPublicKey : bundleUpdatePublicKey;
const effectiveEnabled = isTestMode || hotUpdateEnabled;

const effectiveManifestUrl = (): string => {
	if (isTestMode) return testManifestUrl;
	const builtin = readBuiltinMeta(rendererDistDir());
	return bundleManifestUrlFor(builtin.channel, builtin.edition);
};

const isBundleLoaderAvailable = () => app.isPackaged && !process.env.ELECTRON_RENDERER_URL;

const isHotUpdateActive = () =>
	effectiveEnabled && isBundleLoaderAvailable() && effectivePublicKey.length > 0;

const platformKey = () => bundlePlatformKeyFor(process.platform, process.arch);

const escapeHtml = (value: string): string =>
	value.replace(/[&<>"']/g, (character) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		};
		return entities[character] ?? character;
	});

/** Delay before the silent background check after startup. */
const backgroundCheckDelayMs = 15_000;
const rendererHealthTimeoutMs = 10_000;

/**
 * Decide which bundle this launch should load and perform launch-time safety work:
 * restore the DB snapshot when a rev was just blocked WITHOUT its server ever having
 * been confirmed healthy (a server that ran healthy wrote valid data — restoring
 * would wipe real user sessions), and take a fresh snapshot before the first boot of
 * a pending bundle. Must be called after the single-instance lock is held and before
 * the sidecar is spawned — i.e. inside the no-server window where SQLite is quiescent.
 */
export const prepareActiveBundle = async (): Promise<ResolvedBundle> => {
	const builtinRendererDir = rendererDistDir();
	const builtinServerBin = serverBinaryPath();
	const loaderAvailable = isBundleLoaderAvailable();
	const builtinMeta = readBuiltinMeta(builtinRendererDir, { allowFallback: !loaderAvailable });
	const builtin: ResolvedBundle = {
		rendererDir: builtinRendererDir,
		serverBinPath: builtinServerBin,
		source: "builtin",
		rev: builtinMeta.bundleRev,
		schemaVersion: builtinMeta.schemaVersion,
		workspaceLayoutVersion: builtinMeta.workspaceLayoutVersion,
		channel: builtinMeta.channel,
		edition: builtinMeta.edition,
		reason: "hot update disabled",
	};
	if (!loaderAvailable) {
		return builtin;
	}

	const userDataDir = app.getPath("userData");
	if (!(await waitForServerSidecarPortFree())) {
		throw new Error("本地服务端口仍被其他进程占用，已拒绝并发启动或迁移数据库。");
	}
	assertBuiltinFloors(userDataDir, builtinMeta);
	const launchState = readStoreState(userDataDir);
	if (
		launchState.state === "pending" &&
		launchState.rollbackPending &&
		launchState.migrationStarted
	) {
		const activeMeta = readBundleMeta(versionDir(userDataDir, launchState.activeRev));
		const sameCohort = activeMeta
			? builtinMeta.channel === activeMeta.channel && builtinMeta.edition === activeMeta.edition
			: launchState.manifestChannel.length === 0 ||
				(builtinMeta.channel === launchState.manifestChannel &&
					builtinMeta.edition === launchState.manifestEdition);
		const fullInstallerCanSupersede =
			(sameCohort ? builtinMeta.bundleRev >= launchState.activeRev : true) &&
			builtinMeta.schemaVersion >= launchState.activeSchemaVersion &&
			builtinMeta.workspaceLayoutVersion >= launchState.workspaceLayoutVersionFloor;
		if (launchState.bootAttempts >= maxBootAttempts && !fullInstallerCanSupersede) {
			throw new Error(
				"迁移后的服务已承载数据，但界面连续未能确认健康；为避免恢复旧快照造成数据丢失，请安装最新完整版本。",
			);
		}
		// Retry the same schema-compatible pending bundle, or let a newer compatible full
		// installer take ownership. Its pre-migration snapshot must not be restored after
		// server readiness because the migrated database may now contain real writes.
		writeStoreState(userDataDir, {
			...launchState,
			serverHealthy: false,
			rollbackPending: undefined,
		});
	}
	let resolved = resolveBundleDir(userDataDir, builtinRendererDir, builtinServerBin);

	// A rollback marker is a durable transaction record. Complete it while no sidecar
	// exists, and propagate every failure so an older binary never opens a database that
	// may already have been migrated by the failed revision.
	for (let pass = 0; pass < 2 && resolved.rollbackPending; pass += 1) {
		const rollback = resolved.rollbackPending;
		if (rollback.restoreSnapshot) {
			if (!(await waitForServerSidecarPortFree())) {
				throw new Error("本地服务端口仍被占用，无法安全恢复数据库。");
			}
			restoreDatabases(dbSnapshotDir(userDataDir, rollback.snapshotRev));
		}
		completeRollback(userDataDir, rollback.failedRev);
		resolved = resolveBundleDir(userDataDir, builtinRendererDir, builtinServerBin);
	}
	if (resolved.rollbackPending) {
		throw new Error(`无法完成 rev ${resolved.rollbackPending.failedRev} 的持久化回滚。`);
	}
	recordBundleFloors(userDataDir, builtinMeta, resolved);

	const store = readStoreState(userDataDir);
	if (resolved.source === "downloaded" && store.state === "pending") {
		const needsSnapshot = resolved.schemaVersion > store.lastKnownGoodSchemaVersion;
		if (needsSnapshot) {
			if (!(await waitForServerSidecarPortFree())) {
				throw new Error("本地服务端口仍被占用，无法安全创建数据库快照。");
			}
			const runtimeInfo = readRuntimeInfo(userDataDir);
			if (!runtimeInfo || runtimeInfo.databaseFiles.length === 0) {
				throw new Error("缺少数据库运行时信息，无法安全启动需要迁移的热更新。");
			}
			snapshotDatabases(runtimeInfo.databaseFiles, dbSnapshotDir(userDataDir, resolved.rev));
			markRollbackPending(userDataDir, {
				failedRev: resolved.rev,
				targetRev: store.lastKnownGoodRev,
				targetSchemaVersion: store.lastKnownGoodSchemaVersion,
				snapshotRev: resolved.rev,
				restoreSnapshot: true,
			});
		}
		// The attempt is consumed only after all migration safety prerequisites succeed.
		recordBootAttempt(userDataDir, resolved.rev);
	}

	try {
		// One-time cleanup of the pre-bundle renderer-only updater's store; nothing
		// reads <userData>/renderer anymore.
		rmSync(join(userDataDir, "renderer"), { recursive: true, force: true });
	} catch (error) {
		console.warn("[bundle-updater] legacy renderer cleanup failed", error);
	}
	return resolved;
};

/** Persist the no-auto-restore boundary immediately before spawning a bundle server. */
export const markActiveBundleServerStarting = (bundle: ResolvedBundle): void => {
	if (!isBundleLoaderAvailable() || bundle.source !== "downloaded") return;
	markMigrationStarted(app.getPath("userData"), bundle.rev);
};

interface BundleUpdaterDeps {
	getWindow: () => BrowserWindow | null;
	active: ResolvedBundle;
	onActiveBundleChanged?: (bundle: ResolvedBundle) => void;
}

export interface BundleUpdaterHandle {
	/**
	 * Call right after the sidecar has been spawned for this launch: confirms server
	 * health for pending bundles (full timeout budget measured from actual server
	 * start) and schedules the silent background check.
	 */
	notifyServerStarted: (identity: SidecarIdentity) => Promise<void>;
}

export const registerBundleUpdater = ({
	getWindow,
	active,
	onActiveBundleChanged,
}: BundleUpdaterDeps): BundleUpdaterHandle => {
	// Mutable: apply-now swaps the running bundle without an app restart.
	let current = active;
	let operation: "checking" | "applying" | null = null;
	let quitting = false;
	let currentSidecarIdentity: SidecarIdentity | null = null;
	const setCurrent = (bundle: ResolvedBundle): void => {
		current = bundle;
		onActiveBundleChanged?.(bundle);
	};
	const rendererHealthWaiters = new Map<number, () => void>();

	const waitForRendererHealth = (rev: number): Promise<boolean> =>
		new Promise((resolve) => {
			const timeout = setTimeout(() => {
				rendererHealthWaiters.delete(rev);
				resolve(false);
			}, rendererHealthTimeoutMs);
			timeout.unref();
			rendererHealthWaiters.set(rev, () => {
				clearTimeout(timeout);
				rendererHealthWaiters.delete(rev);
				resolve(true);
			});
		});

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
		if (operation === "checking") {
			return { ok: false, message: "已有一次更新检查正在进行。" };
		}
		if (operation === "applying") return { ok: false, message: "更新正在应用中。" };
		// Acquire before the first await. This is the single mutex shared by check/apply.
		operation = "checking";
		try {
			await runCheck();
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : "检查更新失败。";
			emit({ phase: "error", error: message });
			return { ok: false, message };
		} finally {
			operation = null;
		}
	};

	const runCheck = async (): Promise<void> => {
		const userDataDir = app.getPath("userData");
		emit({ phase: "checking" });

		const payload = await fetchSignedManifest();
		const builtinMeta = readBuiltinMeta(rendererDistDir());
		const currentMeta =
			current.source === "downloaded"
				? (readBundleMeta(current.rendererDir) ?? builtinMeta)
				: builtinMeta;
		const store = readStoreState(userDataDir);
		const decision = evaluateBundleManifest(
			payload,
			platformKey(),
			currentMeta,
			Math.max(currentMeta.bundleRev, current.rev),
			store.blockedRevs,
			SHELL_API_VERSION,
		);
		if (decision.action !== "disabled" && decision.action !== "cohort-mismatch") {
			if (!setChannelEnabled(userDataDir, payload.bundleRev, payload.channel, payload.edition)) {
				emit({
					phase: "error",
					targetRev: payload.bundleRev,
					error: `已忽略低于本地签名清单高水位 rev ${store.channelDisabledAtRev} 的旧清单。`,
				});
				return;
			}
		}
		if (decision.action !== "disabled" && store.rollbackPending) {
			emit({
				phase: "error",
				targetRev: store.rollbackPending.failedRev,
				error: "本地仍有未完成的回滚；请重启应用完成恢复后再检查更新。",
			});
			return;
		}
		if (
			decision.action !== "disabled" &&
			store.channelDisabled &&
			current.source === "downloaded" &&
			store.blockedRevs.includes(current.rev) &&
			store.activeSchemaVersion > Math.max(store.fallbackSchemaVersion, builtinMeta.schemaVersion)
		) {
			emit({
				phase: "requires-full-update",
				targetRev: payload.bundleRev,
				notes: "已撤回版本升级过数据库，自动降级会丢失数据；请安装 schema 兼容的完整版本。",
			});
			return;
		}

		switch (decision.action) {
			case "disabled": {
				const revokedRev =
					current.source === "downloaded"
						? current.rev
						: store.activeRev > 0
							? store.activeRev
							: store.lastKnownGoodRev;
				const disabled = disableChannelAndRevert(
					userDataDir,
					revokedRev,
					payload.bundleRev,
					payload.channel,
					payload.edition,
				);
				if (disabled === "stale-manifest") {
					emit({ phase: "up-to-date" });
					return;
				}
				if (disabled === "requires-full-update") {
					emit({
						phase: "requires-full-update",
						targetRev: payload.bundleRev,
						notes:
							"该版本已撤回，但数据库已承载新数据；为避免数据丢失，请安装 schema 兼容的完整版本。",
					});
					return;
				}
				emit({
					phase: "error",
					targetRev: payload.bundleRev,
					error:
						disabled === "rollback-pending"
							? "当前热更新已被发布方停用；重启应用后将恢复到上一已知可用版本。"
							: "当前 cohort 的热更新已被发布方停用。",
				});
				return;
			}
			case "up-to-date":
				emit({ phase: "up-to-date" });
				return;
			case "requires-full-update": {
				const notes =
					decision.reason === "workspace-layout"
						? "该版本会改变持久化文件布局，必须通过完整安装包更新。"
						: decision.reason === "schema-downgrade"
							? "该版本的数据库 schema 低于当前版本，不能通过热更新降级。"
							: "新版本需要更新桌面端主程序，请通过应用更新升级完整版本。";
				emit({
					phase: "requires-full-update",
					targetRev: decision.targetRev,
					notes,
				});
				return;
			}
			case "cohort-mismatch":
				throw new Error(
					`更新清单 cohort (${payload.channel}/${payload.edition}) 与安装包 (${builtinMeta.channel}/${builtinMeta.edition}) 不匹配。`,
				);
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

		const latestStore = readStoreState(userDataDir);
		if (latestStore.state === "pending") {
			if (
				latestStore.activeRev === payload.bundleRev &&
				payload.bundleRev > current.rev &&
				isBundleUsable(versionDir(userDataDir, payload.bundleRev), payload.bundleRev)
			) {
				emit({ phase: "staged", targetRev: payload.bundleRev, notes: payload.notes });
				return;
			}
			emit({
				phase: "staged",
				targetRev: latestStore.activeRev,
				notes: "已有一个待确认的更新；请先应用或重启完成该版本。",
			});
			return;
		}

		// A forward schema generation needs authoritative database paths before staging,
		// because the next launch may have to snapshot without a running server.
		if (payload.schemaVersion > current.schemaVersion) {
			const runtimeInfo = await refreshRuntimeInfo(userDataDir, currentSidecarIdentity);
			if (!runtimeInfo || runtimeInfo.databaseFiles.length === 0) {
				throw new Error("无法获取数据库位置，已跳过需要迁移的更新。");
			}
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
				schemaVersion: payload.schemaVersion,
				workspaceLayoutVersion: payload.workspaceLayoutVersion,
				channel: payload.channel,
				edition: payload.edition,
				minShellApi: payload.minShellApi,
				appBaseline: payload.appBaseline,
				components: {
					renderer: { contentSha256: payload.components.renderer.contentSha256 },
					server: { contentSha256: serverRef.contentSha256 },
				},
			});

			if (!isBundleUsable(stageDir, rev)) {
				throw new Error("更新包组装后校验失败。");
			}

			const target = versionDir(userDataDir, rev);
			rmSync(target, { recursive: true, force: true });
			mkdirSync(join(target, ".."), { recursive: true });
			renameSync(stageDir, target);

			const beforeActivation = readStoreState(userDataDir);
			activateVersion(userDataDir, {
				rev,
				schemaVersion: payload.schemaVersion,
				lastKnownGoodRev: current.source === "downloaded" ? current.rev : 0,
				lastKnownGoodSchemaVersion: current.schemaVersion,
			});
			cleanupVersions(userDataDir, [
				rev,
				current.rev,
				beforeActivation.lastKnownGoodRev,
				beforeActivation.fallbackRev,
			]);
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	};

	// Apply the staged bundle without restarting the app: swap the server child
	// process and reload the window. Refuses while the server reports active work.
	const applyNow = async (): Promise<DesktopUpdateAck> => {
		if (!isHotUpdateActive()) return { ok: false, message: "热更新尚未启用。" };
		if (quitting) return { ok: false, message: "应用正在退出。" };
		if (operation === "checking") {
			return { ok: false, message: "更新检查正在进行，请稍候。" };
		}
		if (operation === "applying") return { ok: false, message: "更新正在应用中。" };
		const window = getWindow();
		if (!window || window.isDestroyed()) return { ok: false, message: "窗口不可用。" };
		// Acquire synchronously before activity probing; concurrent apply/check calls can
		// no longer pass the preflight together and mutate a different active revision.
		operation = "applying";

		const userDataDir = app.getPath("userData");
		let stagedRev = 0;
		let oldStopped = false;
		let newStarted = false;
		let rendererQuiesced = false;
		let windowWasVisible = false;
		let committed = false;
		let migrationRestoreForbidden = false;
		let snapshotPrepared = false;
		let rollbackPrepared = false;
		let rollbackTarget = current;
		try {
			const store = readStoreState(userDataDir);
			stagedRev = store.activeRev;
			if (store.state !== "pending" || stagedRev <= current.rev || stagedRev <= 0) {
				return { ok: false, message: "没有待生效的更新。" };
			}
			const stagedDir = versionDir(userDataDir, stagedRev);
			const stagedMeta = isBundleUsable(stagedDir, stagedRev);
			if (!stagedMeta) {
				return { ok: false, message: "更新包不完整或已损坏，请重新检查更新。" };
			}
			const builtinMeta = readBuiltinMeta(rendererDistDir());
			if (
				stagedMeta.channel !== builtinMeta.channel ||
				stagedMeta.edition !== builtinMeta.edition ||
				stagedMeta.workspaceLayoutVersion !== builtinMeta.workspaceLayoutVersion
			) {
				return { ok: false, message: "待应用更新与当前安装包 cohort 或文件布局不匹配。" };
			}
			const needsSnapshot = stagedMeta.schemaVersion > current.schemaVersion;

			if (
				!currentSidecarIdentity ||
				!isServerSidecarRunning() ||
				!(await probeServerHealth(currentSidecarIdentity))
			) {
				return { ok: false, message: "无法确认当前服务进程身份，请重启应用后再试。" };
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
			const databaseFiles =
				activity.databaseFiles.length > 0
					? activity.databaseFiles
					: (readRuntimeInfo(userDataDir)?.databaseFiles ?? []);
			if (needsSnapshot && databaseFiles.length === 0) {
				return { ok: false, message: "缺少数据库位置，无法安全应用该更新。" };
			}

			emit({ phase: "applying", targetRev: stagedRev });
			const stopped = await stopServerSidecarGracefully(serverStopGraceMs);
			if (!stopped) {
				// The old server refused to die: its port is still owned and any snapshot
				// would be torn. Change nothing — the staged bundle stays pending and a
				// normal restart applies it cleanly.
				emit({ phase: "staged", targetRev: stagedRev });
				return { ok: false, message: "旧服务未能及时退出，已取消本次应用；重启应用即可完成更新。" };
			}
			oldStopped = true;
			currentSidecarIdentity = null;
			if (!(await waitForServerSidecarPortFree())) {
				throw new Error("旧服务退出后端口仍被占用，已中止数据库操作。");
			}
			rollbackTarget = current;
			// Unload the old renderer before the migrated server starts. Otherwise its
			// timers/SWR requests can write through the new server during the tiny
			// readiness-to-load window and a snapshot rollback would erase real user data.
			windowWasVisible = window.isVisible();
			window.hide();
			rendererQuiesced = true;
			await window.loadURL("about:blank");
			if (needsSnapshot) {
				const snapshotDir = dbSnapshotDir(userDataDir, stagedRev);
				const preSnapshotState = readStoreState(userDataDir);
				if (!preSnapshotState.rollbackPending && !preSnapshotState.migrationStarted) {
					// An earlier pre-marker failure may have left an immutable but now stale
					// snapshot. Recreate it from the quiescent live DB before this attempt.
					rmSync(snapshotDir, { recursive: true, force: true });
				}
				snapshotDatabases(databaseFiles, snapshotDir);
				snapshotPrepared = true;
				markRollbackPending(userDataDir, {
					failedRev: stagedRev,
					targetRev: rollbackTarget.source === "downloaded" ? rollbackTarget.rev : 0,
					targetSchemaVersion: rollbackTarget.schemaVersion,
					snapshotRev: stagedRev,
					restoreSnapshot: true,
				});
				rollbackPrepared = true;
			}
			recordBootAttempt(userDataDir, stagedRev);
			markMigrationStarted(userDataDir, stagedRev);
			migrationRestoreForbidden = needsSnapshot;

			const stagedBundle: ResolvedBundle = {
				rendererDir: stagedDir,
				serverBinPath: bundleServerBinPath(stagedDir),
				source: "downloaded",
				rev: stagedRev,
				schemaVersion: stagedMeta.schemaVersion,
				workspaceLayoutVersion: stagedMeta.workspaceLayoutVersion,
				channel: stagedMeta.channel,
				edition: stagedMeta.edition,
				reason: "applied without restart",
			};
			const stagedIdentity = startServerSidecar({
				binaryPath: bundleServerBinPath(stagedDir),
				bundleRev: stagedRev,
				schemaVersion: stagedMeta.schemaVersion,
			});
			currentSidecarIdentity = stagedIdentity;
			newStarted = true;
			// Keep window reconstruction bound to the exact sidecar revision while the
			// new renderer is loading. A failed apply resets this only after rollback.
			setCurrent(stagedBundle);
			const healthy = await waitForServerHealth(stagedIdentity, serverHealthTimeoutMs);
			if (!healthy) {
				throw new Error("新版本服务未通过身份与就绪检查。");
			}

			markComponentHealthy(userDataDir, "server", stagedRev);
			const rendererHealthy = waitForRendererHealth(stagedRev);
			await window.loadFile(join(stagedDir, "index.html"), {
				hash: "/",
				query: { version: app.getVersion() },
			});
			if (!(await rendererHealthy)) {
				throw new Error("新版本界面未在超时时间内报告健康状态。");
			}
			// Commit renderer health only after both the navigation promise and the
			// renderer beacon have succeeded. Mark rollback forbidden before the atomic
			// store write: rename may succeed even if the following directory fsync throws.
			committed = true;
			markComponentHealthy(userDataDir, "renderer", stagedRev);
			if (windowWasVisible) window.show();
			void refreshRuntimeInfo(userDataDir, stagedIdentity).catch((error) => {
				console.warn("[bundle-updater] post-commit runtime info refresh failed", error);
			});
			emit({ phase: "idle" });
			return { ok: true };
		} catch (error) {
			let message = error instanceof Error ? error.message : "应用更新失败。";
			const failureAction = chooseApplyFailureAction({
				committed,
				migrationRestoreForbidden,
				newStarted,
				rollbackPrepared,
				snapshotPrepared,
				oldStopped,
			});
			if (failureAction === "keep-committed") {
				console.warn("[bundle-updater] post-commit UI notification failed", error);
				return { ok: true };
			}
			if (quitting) {
				return { ok: false, message: "应用正在退出，更新状态将在下次启动时恢复。" };
			}
			if (failureAction === "keep-migrated-pending") {
				// Once a forward-schema process starts, migrations, watchers, or workers may
				// already have produced legitimate writes. Never restore its pre-start snapshot.
				// Keep the pending bundle and marker so startup can retry the same schema,
				// or a compatible full installer can take ownership.
				try {
					if (isServerSidecarRunning()) {
						const stopped = await stopServerSidecarGracefully(serverStopGraceMs);
						if (!stopped) message = `${message}；新版本服务仍在退出中`;
					}
					currentSidecarIdentity = null;
					const recoveryHtml = `<!doctype html><meta charset="utf-8"><title>需要重启</title><style>body{font-family:system-ui;margin:48px;line-height:1.6;color:#222}main{max-width:640px;margin:auto}</style><main><h2>界面更新未完成</h2><p>新版本服务已完成数据库升级。为保护升级后的数据，应用不会自动恢复旧快照；请完全退出后重启以重试同一版本，或安装兼容的最新完整版本。</p><pre>${escapeHtml(message)}</pre></main>`;
					if (!window.isDestroyed()) {
						await window.loadURL(
							`data:text/html;charset=utf-8,${encodeURIComponent(recoveryHtml)}`,
						);
						window.show();
					}
				} catch (recoveryError) {
					console.error("[bundle-updater] failed to show migration recovery page", recoveryError);
				}
				emit({ phase: "error", targetRev: stagedRev, error: message });
				return { ok: false, message };
			}
			if (oldStopped) {
				try {
					if (failureAction === "rollback") {
						await rollbackApply(userDataDir, stagedRev, rollbackTarget);
						message = `${message}（已自动回滚）`;
					} else {
						await restartBundleServer(rollbackTarget);
					}
					setCurrent(rollbackTarget);
					if (rendererQuiesced || newStarted) {
						await window.loadFile(join(rollbackTarget.rendererDir, "index.html"), {
							hash: "/",
							query: { version: app.getVersion() },
						});
					}
					if (windowWasVisible) window.show();
				} catch (rollbackError) {
					console.error("[bundle-updater] rollback failed", rollbackError);
					const rollbackMessage =
						rollbackError instanceof Error ? rollbackError.message : "回滚失败";
					message = `${message}；${rollbackMessage}`;
					const recoveryHtml = `<!doctype html><meta charset="utf-8"><title>需要重启</title><style>body{font-family:system-ui;margin:48px;line-height:1.6;color:#222}main{max-width:640px;margin:auto}</style><main><h2>更新未能安全回滚</h2><p>为保护本地数据，应用已停止加载任何业务界面。请完全退出后重新启动；若仍失败，请安装最新完整版本。</p><pre>${escapeHtml(message)}</pre></main>`;
					await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(recoveryHtml)}`);
					window.show();
				}
			}
			emit({ phase: "error", targetRev: stagedRev, error: message });
			return { ok: false, message };
		} finally {
			operation = null;
		}
	};

	const rollbackApply = async (
		userDataDir: string,
		failedRev: number,
		target: ResolvedBundle,
	): Promise<void> => {
		const store = readStoreState(userDataDir);
		const restoreSnapshot = store.activeSchemaVersion > target.schemaVersion;
		if (restoreSnapshot && store.migrationStarted) {
			throw new Error(
				"新 schema 服务进程已启动过，不能自动恢复旧快照；请重试同一版本或安装兼容完整版本。",
			);
		}
		markRollbackPending(userDataDir, {
			failedRev,
			targetRev: target.source === "downloaded" ? target.rev : 0,
			targetSchemaVersion: target.schemaVersion,
			snapshotRev: failedRev,
			restoreSnapshot,
		});
		// The failed server must be confirmed stopped before restoring: overwriting the
		// SQLite files under a process that still holds them open would tear the database.
		if (isServerSidecarRunning()) {
			const stopped = await stopServerSidecarGracefully(serverStopGraceMs);
			if (!stopped) {
				// Keep rollbackPending intact. The next no-server launch retries the restore;
				// no second rollback path may infer safety from a cleared child handle.
				throw new Error("新版本服务无法停止，请重启应用以完成回滚。");
			}
		}
		currentSidecarIdentity = null;
		if (!(await waitForServerSidecarPortFree())) {
			throw new Error("失败服务的端口仍被占用，无法安全恢复数据库。");
		}
		assertBundleStillUsable(target);
		if (restoreSnapshot) {
			restoreDatabases(dbSnapshotDir(userDataDir, failedRev));
		}
		// The DB now belongs to target. Switch reconstruction before the state write,
		// whose rename can commit even when the trailing directory fsync reports error.
		setCurrent(target);
		completeRollback(userDataDir, failedRev);
		await restartBundleServer(target);
	};

	const assertBundleStillUsable = (bundle: ResolvedBundle): void => {
		if (bundle.source !== "downloaded") return;
		const meta = isBundleUsable(bundle.rendererDir, bundle.rev);
		if (
			!meta ||
			meta.schemaVersion !== bundle.schemaVersion ||
			meta.workspaceLayoutVersion !== bundle.workspaceLayoutVersion ||
			meta.channel !== bundle.channel ||
			meta.edition !== bundle.edition
		) {
			throw new Error(`回滚目标 rev ${bundle.rev} 已损坏或身份不匹配。`);
		}
	};

	const restartBundleServer = async (bundle: ResolvedBundle): Promise<void> => {
		assertBundleStillUsable(bundle);
		const identity = startServerSidecar({
			binaryPath: bundle.serverBinPath,
			bundleRev: bundle.rev,
			schemaVersion: bundle.schemaVersion,
		});
		currentSidecarIdentity = identity;
		if (!(await waitForServerHealth(identity, serverHealthTimeoutMs))) {
			throw new Error("回滚目标服务未能重新就绪，请重启应用。");
		}
	};

	ipcMain.handle(desktopIpcChannel.getBundleUpdateCapability, capability);

	ipcMain.handle(desktopIpcChannel.checkBundleUpdate, () => check());

	ipcMain.handle(desktopIpcChannel.applyBundleUpdate, () => applyNow());

	ipcMain.handle(desktopIpcChannel.markRendererHealthy, () => {
		if (!isBundleLoaderAvailable() || current.source !== "downloaded") return;
		const rev = current.rev;
		const waiter = rendererHealthWaiters.get(rev);
		if (operation === "applying" && waiter) {
			// During apply, the beacon acknowledges only the in-memory navigation waiter.
			// Persistence happens after loadFile itself succeeds, so a late navigation
			// rejection cannot promote the bundle and then roll its database back.
			waiter();
			return;
		}
		markComponentHealthy(app.getPath("userData"), "renderer", rev);
		waiter?.();
	});

	const notifyServerStarted = async (identity: SidecarIdentity): Promise<void> => {
		if (!isBundleLoaderAvailable()) return;
		currentSidecarIdentity = identity;
		const healthy = await waitForServerHealth(identity, serverHealthTimeoutMs);
		if (!healthy) throw new Error("本地服务未通过身份与就绪检查。");
		if (current.source === "downloaded") {
			markComponentHealthy(app.getPath("userData"), "server", current.rev);
		}
		await refreshRuntimeInfo(app.getPath("userData"), identity);
		if (isHotUpdateActive()) {
			setTimeout(() => {
				void check();
			}, backgroundCheckDelayMs).unref();
		}
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

const refreshRuntimeInfo = async (
	userDataDir: string,
	expected: SidecarIdentity | null,
): Promise<BundleRuntimeInfo | null> => {
	if (!expected || !isServerSidecarRunning() || !(await probeServerHealth(expected))) return null;
	const activity = await fetchServerActivity();
	if (!activity || activity.databaseFiles.length === 0) return null;
	const info: BundleRuntimeInfo = {
		serverBaseUrl: serverSidecarBaseUrl(),
		databaseFiles: activity.databaseFiles,
		updatedAt: new Date().toISOString(),
	};
	writeRuntimeInfo(userDataDir, info);
	return info;
};

const probeServerHealth = async (expected: SidecarIdentity): Promise<boolean> => {
	try {
		const response = await fetch(`${serverSidecarBaseUrl()}/api/v1/health`, {
			signal: AbortSignal.timeout(2_000),
			cache: "no-store",
		});
		if (!response.ok) return false;
		const payload = parseApiPayload(await response.json());
		return (
			payload?.ready === true &&
			payload.status === "ok" &&
			payload.bundleRev === expected.bundleRev &&
			payload.schemaVersion === expected.schemaVersion &&
			payload.instanceToken === expected.instanceToken
		);
	} catch {
		return false;
	}
};

const waitForServerHealth = async (
	expected: SidecarIdentity,
	timeoutMs: number,
): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await probeServerHealth(expected)) return true;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
};

// --- manifest + download -------------------------------------------------------------

const fetchSignedManifest = async (): Promise<BundleManifestPayload> => {
	const response = await fetch(effectiveManifestUrl(), {
		signal: AbortSignal.timeout(manifestFetchTimeoutMs),
		cache: "no-store",
	});
	if (!response.ok) {
		throw new Error(`获取更新清单失败 (HTTP ${response.status})。`);
	}
	const finalManifestUrl = new URL(response.url);
	const allowedLoopbackRedirect =
		isTestMode &&
		finalManifestUrl.protocol === "http:" &&
		(finalManifestUrl.hostname === "127.0.0.1" || finalManifestUrl.hostname === "localhost");
	if (finalManifestUrl.protocol !== "https:" && !allowedLoopbackRedirect) {
		throw new Error("更新清单重定向到了不安全的 URL。");
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
	const finalUrl = new URL(response.url);
	const allowedLoopbackRedirect =
		isTestMode &&
		finalUrl.protocol === "http:" &&
		(finalUrl.hostname === "127.0.0.1" || finalUrl.hostname === "localhost");
	if (finalUrl.protocol !== "https:" && !allowedLoopbackRedirect) {
		throw new Error("更新组件重定向到了不安全的 URL。");
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

	if (transferred !== ref.size) {
		rmSync(destPath, { force: true });
		throw new Error(`更新组件校验失败（size ${transferred} != ${ref.size}）。`);
	}
	const digest = hash.digest("hex");
	if (digest !== ref.sha256) {
		rmSync(destPath, { force: true });
		throw new Error("更新组件校验失败（sha256 不匹配）。");
	}
};
