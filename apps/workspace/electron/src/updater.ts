import { type BrowserWindow, app, ipcMain } from "electron";
import electronUpdater, { type UpdateInfo } from "electron-updater";
import {
	type DesktopUpdateAck,
	type DesktopUpdateCapability,
	type DesktopUpdateInfo,
	type DesktopUpdateStatus,
	desktopIpcChannel,
} from "./ipc-contract.js";

const { autoUpdater } = electronUpdater;

const releasePageUrl = "https://github.com/mediago-dev/mediago-drama/releases/latest";

// Flip to true after macOS code signing + notarization are set up in CI. Until then
// electron-updater cannot install updates on unsigned mac builds (Squirrel.Mac refuses),
// so mac falls back to opening the GitHub releases page in the browser.
const macAutoUpdateEnabled = false;

const resolveCapability = (): DesktopUpdateCapability => {
	if (!app.isPackaged) {
		return {
			supportsAutoUpdate: false,
			releasePageUrl,
			reason: "非打包运行环境不支持应用内更新。",
		};
	}
	if (process.platform === "darwin" && !macAutoUpdateEnabled) {
		return {
			supportsAutoUpdate: false,
			releasePageUrl,
			reason: "当前 macOS 版本未启用签名，请前往下载页更新。",
		};
	}
	return { supportsAutoUpdate: true, releasePageUrl };
};

const capability = resolveCapability();

let listenersAttached = false;

const extractReleaseNotes = (value: unknown): string | undefined => {
	if (!value) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "object" && "en" in (value as object)) {
		const notesByLang = (value as { en?: unknown }).en;
		if (typeof notesByLang === "string") return notesByLang;
	}
	return undefined;
};

const normalizeInfo = (info: UpdateInfo | null | undefined): DesktopUpdateInfo | undefined => {
	if (!info || typeof info.version !== "string" || !info.version) return undefined;
	return {
		version: info.version,
		releaseDate: info.releaseDate || undefined,
		releaseName: info.releaseName || undefined,
		releaseNotes: extractReleaseNotes(info.releaseNotes),
	};
};

const currentVersion = () => app.getVersion();

const buildStatus = (
	partial: Omit<DesktopUpdateStatus, "currentVersion">,
): DesktopUpdateStatus => ({
	currentVersion: currentVersion(),
	...partial,
});

const emit = (getWindow: () => BrowserWindow | null, status: DesktopUpdateStatus): void => {
	const window = getWindow();
	if (!window || window.isDestroyed()) return;
	window.webContents.send(desktopIpcChannel.updateStatus, status);
};

const attachListeners = (getWindow: () => BrowserWindow | null) => {
	if (listenersAttached) return;
	listenersAttached = true;
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;

	autoUpdater.on("checking-for-update", () => {
		emit(getWindow, buildStatus({ phase: "checking" }));
	});
	autoUpdater.on("update-available", (info) => {
		emit(getWindow, buildStatus({ phase: "available", info: normalizeInfo(info) }));
	});
	autoUpdater.on("update-not-available", () => {
		emit(getWindow, buildStatus({ phase: "up-to-date" }));
	});
	autoUpdater.on("error", (error) => {
		emit(
			getWindow,
			buildStatus({
				phase: "error",
				error: error instanceof Error ? error.message : String(error),
			}),
		);
	});
	autoUpdater.on("download-progress", (progress) => {
		emit(
			getWindow,
			buildStatus({
				phase: "downloading",
				progress: {
					percent: progress.percent,
					transferred: progress.transferred,
					total: progress.total,
					bytesPerSecond: progress.bytesPerSecond,
				},
			}),
		);
	});
	autoUpdater.on("update-downloaded", (info) => {
		emit(getWindow, buildStatus({ phase: "downloaded", info: normalizeInfo(info) }));
	});
};

const unsupportedAck = (message: string): DesktopUpdateAck => ({ ok: false, message });

export interface DesktopUpdaterDeps {
	getWindow: () => BrowserWindow | null;
}

export const registerDesktopUpdater = ({ getWindow }: DesktopUpdaterDeps): void => {
	if (capability.supportsAutoUpdate) attachListeners(getWindow);

	ipcMain.handle(desktopIpcChannel.getAppVersion, () => currentVersion());

	ipcMain.handle(desktopIpcChannel.getUpdateCapability, (): DesktopUpdateCapability => capability);

	ipcMain.handle(desktopIpcChannel.checkUpdate, async (): Promise<DesktopUpdateAck> => {
		if (!capability.supportsAutoUpdate)
			return unsupportedAck(capability.reason ?? "不支持自动更新。");
		try {
			await autoUpdater.checkForUpdates();
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : "检查更新失败。";
			emit(getWindow, buildStatus({ phase: "error", error: message }));
			return { ok: false, message };
		}
	});

	ipcMain.handle(desktopIpcChannel.downloadUpdate, async (): Promise<DesktopUpdateAck> => {
		if (!capability.supportsAutoUpdate)
			return unsupportedAck(capability.reason ?? "不支持自动更新。");
		try {
			await autoUpdater.downloadUpdate();
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : "下载更新失败。";
			return { ok: false, message };
		}
	});

	ipcMain.handle(desktopIpcChannel.installUpdate, async (): Promise<DesktopUpdateAck> => {
		if (!capability.supportsAutoUpdate)
			return unsupportedAck(capability.reason ?? "不支持自动更新。");
		try {
			autoUpdater.quitAndInstall(true, true);
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : "安装更新失败。";
			return { ok: false, message };
		}
	});
};
