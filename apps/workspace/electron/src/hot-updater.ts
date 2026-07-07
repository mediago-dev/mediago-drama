import { type BrowserWindow, app, ipcMain } from "electron";
import extractZip from "extract-zip";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
	SHELL_API_VERSION,
	desktopIpcChannel,
	type DesktopUpdateAck,
	type RendererUpdateCapability,
	type RendererUpdateManifestPayload,
	type RendererUpdateStatus,
} from "./ipc-contract.js";
import {
	downloadTimeoutMs,
	hotUpdateEnabled,
	manifestFetchTimeoutMs,
	rendererManifestUrl,
	rendererUpdatePublicKey,
} from "./hot-update-config.js";
import { evaluateManifest, isSafeZipEntryPath, isValidManifestPayload } from "./renderer-policy.js";
import {
	activateVersion,
	cleanupVersions,
	isBundleUsable,
	markHealthy,
	readStoreState,
	resolveRendererDir,
	tmpDir,
	versionDir,
	type ResolvedRenderer,
} from "./renderer-store.js";
import { rendererDistDir } from "./paths.js";

const isHotUpdateActive = () =>
	hotUpdateEnabled &&
	app.isPackaged &&
	!process.env.ELECTRON_RENDERER_URL &&
	rendererUpdatePublicKey.length > 0;

/**
 * Decide which renderer bundle this launch should load. Called once at startup by
 * main.ts before creating the window. With the feature switch off this is a pure
 * passthrough to the builtin renderer.
 */
export const resolveActiveRenderer = (): ResolvedRenderer => {
	const builtinDir = rendererDistDir();
	if (!isHotUpdateActive()) {
		return { dir: builtinDir, source: "builtin", rev: 0, reason: "hot update disabled" };
	}
	return resolveRendererDir(app.getPath("userData"), builtinDir);
};

interface HotUpdaterDeps {
	getWindow: () => BrowserWindow | null;
	active: ResolvedRenderer;
}

export const registerRendererHotUpdater = ({ getWindow, active }: HotUpdaterDeps): void => {
	let inFlight = false;
	let lastStatus: RendererUpdateStatus = { phase: "idle", currentRev: active.rev };

	const emit = (status: Omit<RendererUpdateStatus, "currentRev">): void => {
		lastStatus = { currentRev: active.rev, ...status };
		const window = getWindow();
		if (!window || window.isDestroyed()) return;
		window.webContents.send(desktopIpcChannel.rendererUpdateStatus, lastStatus);
	};

	const capability = (): RendererUpdateCapability => {
		if (!isHotUpdateActive()) {
			return {
				enabled: false,
				currentRev: active.rev,
				source: active.source,
				reason: hotUpdateEnabled ? "当前运行环境不支持界面更新。" : "界面热更新尚未启用。",
			};
		}
		return { enabled: true, currentRev: active.rev, source: active.source };
	};

	const check = async (): Promise<DesktopUpdateAck> => {
		if (!isHotUpdateActive()) return { ok: false, message: "界面热更新尚未启用。" };
		if (inFlight) return { ok: false, message: "已有一次界面更新正在进行。" };
		inFlight = true;
		try {
			await runCheck();
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : "检查界面更新失败。";
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
		const decision = evaluateManifest(
			payload,
			active.source === "builtin" ? active.rev : 0,
			store.activeRev,
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
					notes: "新界面需要更新桌面端主程序，请通过应用更新升级完整版本。",
				});
				return;
			case "download":
				break;
		}

		await downloadAndActivate(userDataDir, payload);
		emit({
			phase: "ready",
			targetRev: payload.rendererRev,
			notes: payload.notes,
		});
	};

	const downloadAndActivate = async (
		userDataDir: string,
		payload: RendererUpdateManifestPayload,
	): Promise<void> => {
		const scratch = tmpDir(userDataDir);
		rmSync(scratch, { recursive: true, force: true });
		mkdirSync(scratch, { recursive: true });
		const zipPath = join(scratch, `renderer-${payload.rendererRev}.zip`);
		const extractDir = join(scratch, `renderer-${payload.rendererRev}`);

		try {
			await downloadWithHash(payload, zipPath, (transferred, total) => {
				emit({
					phase: "downloading",
					targetRev: payload.rendererRev,
					progress: {
						transferred,
						total,
						percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
					},
				});
			});

			await extractZip(zipPath, {
				dir: extractDir,
				onEntry: (entry) => {
					if (!isSafeZipEntryPath(entry.fileName)) {
						throw new Error(`更新包包含非法路径: ${entry.fileName}`);
					}
				},
			});

			if (!isBundleUsable(extractDir, payload.rendererRev)) {
				throw new Error("更新包内容不完整或版本不匹配。");
			}

			const target = versionDir(userDataDir, payload.rendererRev);
			rmSync(target, { recursive: true, force: true });
			mkdirSync(join(target, ".."), { recursive: true });
			renameSync(extractDir, target);

			const previousActive = readStoreState(userDataDir).activeRev;
			activateVersion(userDataDir, payload.rendererRev);
			cleanupVersions(userDataDir, [payload.rendererRev, previousActive]);
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	};

	ipcMain.handle(desktopIpcChannel.getRendererUpdateCapability, capability);

	ipcMain.handle(desktopIpcChannel.checkRendererUpdate, () => check());

	ipcMain.handle(desktopIpcChannel.markRendererHealthy, () => {
		if (!isHotUpdateActive() || active.source !== "downloaded") return;
		markHealthy(app.getPath("userData"));
	});
};

const fetchSignedManifest = async (): Promise<RendererUpdateManifestPayload> => {
	const response = await fetch(rendererManifestUrl, {
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
		key: Buffer.from(rendererUpdatePublicKey, "base64"),
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
	if (!isValidManifestPayload(payload)) {
		throw new Error("更新清单内容无效。");
	}
	return payload;
};

const downloadWithHash = async (
	payload: RendererUpdateManifestPayload,
	zipPath: string,
	onProgress: (transferred: number, total: number) => void,
): Promise<void> => {
	const response = await fetch(payload.url, {
		signal: AbortSignal.timeout(downloadTimeoutMs),
		cache: "no-store",
	});
	if (!response.ok || !response.body) {
		throw new Error(`下载更新包失败 (HTTP ${response.status})。`);
	}

	const total = Number(response.headers.get("content-length")) || payload.size;
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

	await pipeline(body, createWriteStream(zipPath));

	const digest = hash.digest("hex");
	if (digest !== payload.sha256) {
		rmSync(zipPath, { force: true });
		throw new Error("更新包校验失败（sha256 不匹配）。");
	}
};
