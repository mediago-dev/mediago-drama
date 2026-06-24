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
import { join } from "node:path";
import { preloadPath, rendererDistDir } from "./paths.js";
import { startServerSidecar, stopServerSidecar } from "./sidecar.js";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();

type NativeThemeSource = "light" | "dark" | "system";

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
		await mainWindow.loadFile(join(rendererDistDir(), "index.html"), {
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

ipcMain.handle("desktop:show-notification", (_event, options: { title: string; body?: string }) => {
	if (!Notification.isSupported()) return false;
	new Notification({ title: options.title, body: options.body }).show();
	return true;
});

ipcMain.handle("desktop:start-window-drag", () => {
	// Electron uses CSS app-region for dragging; imperative renderer calls are no-ops.
});

ipcMain.handle("desktop:set-native-theme-source", (_event, source: unknown) => {
	if (!isNativeThemeSource(source)) throw new Error("invalid native theme source");
	nativeTheme.themeSource = source;
});

const startApp = async () => {
	startServerSidecar();
	await createWindow();
};

app
	.whenReady()
	.then(startApp)
	.catch((error: unknown) => {
		console.error("[mediago-electron] failed to start", error);
		app.quit();
	});
