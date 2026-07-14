import {
	BrowserWindow,
	app,
	dialog,
	ipcMain,
	nativeTheme,
	shell,
	type OpenDialogOptions,
} from "electron";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
	type DesktopFileFilter,
	type DesktopNotificationOptions,
	type NativeThemeSource,
	desktopIpcChannel,
} from "./ipc-contract.js";
import {
	markActiveBundleServerStarting,
	prepareActiveBundle,
	registerBundleUpdater,
} from "./bundle-updater.js";
import { showDesktopSystemNotification } from "./desktop-notifications.js";
import { preloadPath } from "./paths.js";
import { startServerSidecar, stopServerSidecar } from "./sidecar.js";
import { registerDesktopUpdater } from "./updater.js";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
// Resolved inside startApp — after the single-instance lock is held (a doomed second
// instance must not count boot attempts or touch DB snapshots) and after app-ready,
// but before the sidecar spawns, while SQLite is quiescent.
let activeBundle: Awaited<ReturnType<typeof prepareActiveBundle>> | null = null;

const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();

const isNativeThemeSource = (value: unknown): value is NativeThemeSource =>
	value === "light" || value === "dark" || value === "system";

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
		// startApp resolves activeBundle (and spawns the matching sidecar) before ever
		// calling createWindow. Re-resolving here would re-run launch-safety DB
		// snapshot/restore while the sidecar is live and could load a renderer from a
		// different rev than the running server — so require it, never re-resolve.
		if (!activeBundle) throw new Error("active bundle not resolved before window creation");
		await mainWindow.loadFile(join(activeBundle.rendererDir, "index.html"), {
			hash: app.isPackaged ? "/" : undefined,
			query: app.isPackaged ? { version: app.getVersion() } : undefined,
		});
	}
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

ipcMain.handle(desktopIpcChannel.openExternal, async (_event, url: string) => {
	await shell.openExternal(url);
});

ipcMain.handle(desktopIpcChannel.openPath, async (_event, path: string) => {
	const error = await shell.openPath(path);
	if (error) throw new Error(error);
});

ipcMain.handle(desktopIpcChannel.revealPath, (_event, path: string) => {
	shell.showItemInFolder(path);
});

ipcMain.handle(
	desktopIpcChannel.copyFileToDirectory,
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

ipcMain.handle(desktopIpcChannel.pickDirectory, async (_event, options?: { title?: string }) => {
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
	desktopIpcChannel.pickFile,
	async (_event, options?: { title?: string; filters?: DesktopFileFilter[] }) => {
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

ipcMain.handle(desktopIpcChannel.showNotification, (event, options: DesktopNotificationOptions) => {
	const id = typeof options.id === "string" ? options.id.trim() : "";
	return showDesktopSystemNotification({
		notification: options,
		onClick: id
			? () => {
					showMainWindow();
					event.sender.send(desktopIpcChannel.notificationClicked, id);
				}
			: undefined,
	});
});

ipcMain.handle(desktopIpcChannel.startWindowDrag, () => {
	// Electron uses CSS app-region for dragging; imperative renderer calls are no-ops.
});

ipcMain.handle(desktopIpcChannel.setNativeThemeSource, (_event, source: unknown) => {
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
	activeBundle = await prepareActiveBundle();
	// Register only after packaged bundle metadata has passed the strict startup
	// validation, so a corrupt cohort feed fails through the visible startup error path.
	registerDesktopUpdater({ getWindow: () => mainWindow });
	markActiveBundleServerStarting(activeBundle);
	const sidecarIdentity = startServerSidecar({
		binaryPath: activeBundle.serverBinPath,
		bundleRev: activeBundle.rev,
		schemaVersion: activeBundle.schemaVersion,
	});
	const bundleUpdater = registerBundleUpdater({
		getWindow: () => mainWindow,
		active: activeBundle,
		onActiveBundleChanged: (bundle) => {
			activeBundle = bundle;
		},
	});
	// Health confirmation + background check start counting from actual server spawn.
	await bundleUpdater.notifyServerStarted(sidecarIdentity);
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
			dialog.showErrorBox(
				"MediaGo Drama 无法安全启动",
				error instanceof Error ? error.message : "本地数据或服务状态无法安全恢复。",
			);
			app.quit();
		});
}
