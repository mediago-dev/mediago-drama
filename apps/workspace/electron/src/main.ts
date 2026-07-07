import {
	BrowserWindow,
	Notification,
	app,
	dialog,
	ipcMain,
	nativeTheme,
	shell,
	type OpenDialogOptions,
} from "electron";
import { autoUpdater } from "electron-updater";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { preloadPath, rendererDistDir } from "./paths.js";
import { startServerSidecar, stopServerSidecar } from "./sidecar.js";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let isAutoUpdateSupported = app.isPackaged;
let isAutoUpdaterInitialized = false;

// Retain shown notifications until they are dismissed. Without a live reference
// macOS may garbage-collect the Notification before it is displayed.
const liveNotifications = new Set<Notification>();

const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();

type NativeThemeSource = "light" | "dark" | "system";
type DesktopUpdateInfo = {
	version: string;
	releaseDate?: string;
	releaseName?: string;
	releaseNotes?: string;
};
type DesktopUpdateStatus = {
	currentVersion: string;
	phase:
		| "checking"
		| "available"
		| "not-available"
		| "up-to-date"
		| "download-progress"
		| "downloaded"
		| "error";
	error?: string;
	info?: DesktopUpdateInfo;
	progress?: {
		percent: number;
		transferred: number;
		total: number;
		bytesPerSecond: number;
	};
};
type DesktopUpdateCheckResult = {
	supported: boolean;
	info?: DesktopUpdateInfo;
	message?: string;
	status: DesktopUpdateStatus;
};

const isNativeThemeSource = (value: unknown): value is NativeThemeSource =>
	value === "light" || value === "dark" || value === "system";
const desktopUpdateStatusChannel = "desktop:update-status";
const isUpdateInfoObject = (value: unknown): value is { version?: string } =>
	typeof value === "object" && value !== null;

const normalizeDesktopUpdateInfo = (
	updateInfo:
		| {
				version?: string;
				releaseDate?: string | null;
				releaseName?: string | null;
				releaseNotes?: unknown;
		  }
		| null
		| undefined,
): DesktopUpdateInfo | undefined => {
	if (!isUpdateInfoObject(updateInfo) || !updateInfo.version) return undefined;

	return {
		version: updateInfo.version,
		releaseDate: updateInfo.releaseDate || undefined,
		releaseName: updateInfo.releaseName || undefined,
		releaseNotes: extractReleaseNotes(updateInfo.releaseNotes),
	};
};

const extractReleaseNotes = (value: unknown) => {
	if (!value) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "object") {
		const notesByLang = value && "en" in value ? (value as { en?: unknown }).en : undefined;
		if (typeof notesByLang === "string") return notesByLang;
	}
	return undefined;
};

const emitUpdateStatus = (status: DesktopUpdateStatus): void => {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send(desktopUpdateStatusChannel, status);
};

const setupAutoUpdater = () => {
	if (!isAutoUpdateSupported || isAutoUpdaterInitialized) return;
	isAutoUpdaterInitialized = true;
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;

	autoUpdater.on("checking-for-update", () => {
		emitUpdateStatus({
			currentVersion: app.getVersion(),
			phase: "checking",
		});
	});

	autoUpdater.on("update-available", (info) => {
		emitUpdateStatus({
			currentVersion: app.getVersion(),
			phase: "available",
			info: normalizeDesktopUpdateInfo(info),
		});
	});

	autoUpdater.on("update-not-available", () => {
		emitUpdateStatus({
			currentVersion: app.getVersion(),
			phase: "not-available",
		});
	});

	autoUpdater.on("error", (error) => {
		emitUpdateStatus({
			currentVersion: app.getVersion(),
			phase: "error",
			error: error instanceof Error ? error.message : String(error),
		});
	});

	autoUpdater.on("download-progress", (progress) => {
		emitUpdateStatus({
			currentVersion: app.getVersion(),
			phase: "download-progress",
			progress: {
				percent: progress.percent,
				transferred: progress.transferred,
				total: progress.total,
				bytesPerSecond: progress.bytesPerSecond,
			},
		});
	});

	autoUpdater.on("update-downloaded", (info) => {
		emitUpdateStatus({
			currentVersion: app.getVersion(),
			phase: "downloaded",
			info: normalizeDesktopUpdateInfo(info),
		});
	});
};

const checkAutoUpdate = async (): Promise<DesktopUpdateCheckResult> => {
	if (!isAutoUpdateSupported) {
		return {
			supported: false as const,
			message: "当前环境不支持自动更新。",
			status: {
				currentVersion: app.getVersion(),
				phase: "not-available" as const,
			},
		};
	}

	try {
		const checkResult = await autoUpdater.checkForUpdates();
		if (!checkResult) {
			return {
				supported: false as const,
				message: "当前环境未启用自动更新。",
				status: {
					currentVersion: app.getVersion(),
					phase: "not-available" as const,
				},
			};
		}

		const info = checkResult.isUpdateAvailable
			? normalizeDesktopUpdateInfo(checkResult.updateInfo)
			: undefined;
		return {
			supported: true as const,
			info,
			status: {
				currentVersion: app.getVersion(),
				phase: checkResult.isUpdateAvailable ? "available" : ("up-to-date" as const),
			},
		};
	} catch (error) {
		return {
			supported: true as const,
			message: error instanceof Error ? error.message : "检查更新失败。",
			status: {
				currentVersion: app.getVersion(),
				phase: "error" as const,
				error: error instanceof Error ? error.message : "检查更新失败。",
			},
		};
	}
};

const showMainWindow = () => {
	const window = mainWindow;
	if (!window || window.isDestroyed()) return;

	if (window.isMinimized()) {
		window.restore();
	}
	if (!window.isVisible()) {
		window.show();
	}
	window.moveTop();
	window.focus();
	if (process.platform === "darwin") {
		window.setAlwaysOnTop(true, "floating");
		app.focus({ steal: true });
		setTimeout(() => {
			if (!window.isDestroyed()) {
				window.setAlwaysOnTop(false);
			}
		}, 500).unref();
	}
};

const createWindow = async () => {
	mainWindow = new BrowserWindow({
		title: "MediaGo Drama",
		width: 1280,
		height: 905,
		minWidth: 960,
		minHeight: 680,
		center: true,
		show: true,
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		trafficLightPosition: { x: 16, y: 25 },
		webPreferences: {
			preload: preloadPath(),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	mainWindow.once("ready-to-show", showMainWindow);
	mainWindow.webContents.once("did-finish-load", showMainWindow);
	setTimeout(showMainWindow, 2_000).unref();
	showMainWindow();
	mainWindow.on("close", (event) => {
		if (process.platform !== "darwin" || isQuitting) return;
		event.preventDefault();
		mainWindow?.hide();
	});

	if (rendererUrl) {
		await mainWindow.loadURL(rendererUrl);
	} else {
		if (app.isPackaged) {
			await mainWindow.webContents.session.clearCache();
		}
		await mainWindow.loadFile(join(rendererDistDir(), "index.html"), {
			hash: app.isPackaged ? "/" : undefined,
			query: app.isPackaged ? { version: app.getVersion() } : undefined,
		});
	}

	setupAutoUpdater();
};

app.on("before-quit", () => {
	isQuitting = true;
	stopServerSidecar();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) void createWindow();
	else mainWindow?.show();
});

ipcMain.handle("desktop:open-external", async (_event, url: string) => {
	await shell.openExternal(url);
});

ipcMain.handle("desktop:open-path", async (_event, path: string) => {
	const error = await shell.openPath(path);
	if (error) throw new Error(error);
});

ipcMain.handle("desktop:reveal-path", (_event, path: string) => {
	shell.showItemInFolder(path);
});

ipcMain.handle(
	"desktop:copy-file-to-directory",
	async (_event, options: { directory?: string; filename?: string; sourcePath?: string }) => {
		const sourcePath = String(options?.sourcePath ?? "").trim();
		if (!sourcePath) throw new Error("sourcePath is required");

		const sourceInfo = await stat(sourcePath);
		if (!sourceInfo.isFile()) throw new Error("sourcePath is not a file");

		const directory = String(options?.directory ?? "").trim();
		if (!directory) throw new Error("directory is required");
		const directoryInfo = await stat(directory);
		if (!directoryInfo.isDirectory()) throw new Error("directory is not a folder");

		await mkdir(directory, { recursive: true });
		const filename = safeDownloadFilename(options?.filename || basename(sourcePath));
		const targetPath = await availableDownloadPath(directory, filename);
		await copyFile(sourcePath, targetPath);

		return {
			filename: basename(targetPath),
			path: targetPath,
		};
	},
);

ipcMain.handle("desktop:pick-directory", async (_event, options?: { title?: string }) => {
	const dialogOptions: OpenDialogOptions = {
		title: options?.title,
		properties: ["openDirectory"],
	};
	const result = mainWindow
		? await dialog.showOpenDialog(mainWindow, dialogOptions)
		: await dialog.showOpenDialog(dialogOptions);
	return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle(
	"desktop:pick-file",
	async (
		_event,
		options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> },
	) => {
		const dialogOptions: OpenDialogOptions = {
			title: options?.title,
			filters: options?.filters,
			properties: ["openFile"],
		};
		const result = mainWindow
			? await dialog.showOpenDialog(mainWindow, dialogOptions)
			: await dialog.showOpenDialog(dialogOptions);
		return result.canceled ? null : (result.filePaths[0] ?? null);
	},
);

ipcMain.handle(
	"desktop:show-notification",
	(event, options: { title: string; body?: string; id?: string }) => {
		if (!Notification.isSupported()) {
			console.warn("[mediago-electron] system notifications are not supported on this platform");
			return false;
		}
		const notification = new Notification({ title: options.title, body: options.body });
		liveNotifications.add(notification);
		const release = () => liveNotifications.delete(notification);
		const id = typeof options.id === "string" ? options.id.trim() : "";
		// Clicking the OS notification brings the window forward and tells the
		// renderer which action to run so it can route to the right page.
		notification.on("click", () => {
			if (id) {
				showMainWindow();
				event.sender.send("desktop:notification-clicked", id);
			}
			release();
		});
		notification.on("close", release);
		notification.show();
		// Backstop cleanup so the retained reference cannot leak if no event fires.
		setTimeout(release, 60_000).unref();
		console.log(`[mediago-electron] system notification shown: ${options.title}`);
		return true;
	},
);

ipcMain.handle("desktop:start-window-drag", () => {
	// Electron uses CSS app-region for dragging; imperative renderer calls are no-ops.
});

ipcMain.handle("desktop:get-app-version", () => {
	return app.getVersion();
});

ipcMain.handle("desktop:check-update", async () => {
	return checkAutoUpdate();
});

ipcMain.handle("desktop:download-update", async () => {
	if (!isAutoUpdateSupported) {
		return {
			supported: false as const,
			ok: false as const,
			message: "当前环境不支持自动下载更新。",
		};
	}

	try {
		await autoUpdater.downloadUpdate();
		return { supported: true as const, ok: true as const };
	} catch (error) {
		return {
			supported: true as const,
			ok: false as const,
			message: error instanceof Error ? error.message : "下载更新失败。",
		};
	}
});

ipcMain.handle("desktop:install-update", async () => {
	if (!isAutoUpdateSupported) {
		return {
			supported: false as const,
			ok: false as const,
			message: "当前环境不支持安装更新。",
		};
	}

	try {
		autoUpdater.quitAndInstall(true, true);
		return { supported: true as const, ok: true as const };
	} catch (error) {
		return {
			supported: true as const,
			ok: false as const,
			message: error instanceof Error ? error.message : "安装更新失败。",
		};
	}
});

ipcMain.handle("desktop:set-native-theme-source", (_event, source: unknown) => {
	if (!isNativeThemeSource(source)) throw new Error("invalid native theme source");
	nativeTheme.themeSource = source;
});

const safeDownloadFilename = (value: string) => {
	const cleaned = basename(String(value || "download"))
		.replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned || "download";
};

const availableDownloadPath = async (directory: string, filename: string) => {
	const extension = extname(filename);
	const stem = filename.slice(0, filename.length - extension.length) || "download";

	for (let index = 1; index < 10_000; index += 1) {
		const candidate = index === 1 ? filename : `${stem}-${index}${extension}`;
		const candidatePath = join(directory, candidate);
		if (await pathIsAvailable(candidatePath)) return candidatePath;
	}

	return join(directory, `${stem}-${Date.now()}${extension}`);
};

const pathIsAvailable = async (path: string) => {
	try {
		await stat(path);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT";
	}
};

const startApp = async () => {
	startServerSidecar();
	await createWindow();
};

// Enforce a single running instance: activating the app again (Dock, `open`,
// or clicking a notification from a previous run) focuses the existing window
// instead of spawning a duplicate app + sidecar.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", showMainWindow);
	app
		.whenReady()
		.then(startApp)
		.catch((error: unknown) => {
			console.error("[mediago-electron] failed to start", error);
			app.quit();
		});
}
