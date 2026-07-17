import {
	BrowserWindow,
	app,
	dialog,
	ipcMain,
	nativeTheme,
	net,
	protocol,
	session,
	shell,
	type OpenDialogOptions,
	type SaveDialogOptions,
} from "electron";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type DesktopFileFilter,
	type DesktopNotificationOptions,
	type NativeThemeSource,
	type PromptPackEditorCloseResult,
	type PromptPackEditorOpenOptions,
	desktopIpcChannel,
} from "./ipc-contract.js";
import { assertTrustedIpcSender, normalizeDevelopmentRendererURL } from "./ipc-security.js";
import { showDesktopSystemNotification } from "./desktop-notifications.js";
import { preloadPath, rendererDistDir } from "./paths.js";
import { parsePromptPackSaveRequest } from "./prompt-pack-save.js";
import { normalizeExternalURL, resolveRendererNavigation } from "./navigation-security.js";
import {
	rendererContentSecurityPolicy,
	rendererProtocolScheme,
	resolveRendererAssetPath,
} from "./renderer-protocol.js";
import { type SidecarConnection, startServerSidecar, stopServerSidecar } from "./sidecar.js";
import { registerDesktopUpdater } from "./updater.js";

protocol.registerSchemesAsPrivileged([
	{
		scheme: rendererProtocolScheme,
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
		},
	},
]);

let mainWindow: BrowserWindow | null = null;
let promptPackEditorWindow: BrowserWindow | null = null;
let promptPackEditorCloseAllowed = false;
let pendingPromptPackEditorClose: { action: "close" | "quit"; requestId: string } | null = null;
let isQuitting = false;

const configuredRendererURL = process.env.ELECTRON_RENDERER_URL?.trim();
const rendererUrl = app.isPackaged
	? undefined
	: normalizeDevelopmentRendererURL(configuredRendererURL);
if (!app.isPackaged && configuredRendererURL && !rendererUrl) {
	console.warn("[mediago-electron] ignoring unsafe ELECTRON_RENDERER_URL");
}

const trustedRendererOptions = {
	developmentRendererRoot: rendererDistDir(),
	developmentRendererURL: rendererUrl,
	packaged: app.isPackaged,
};

const authorizeDesktopIpc = (event: Electron.IpcMainInvokeEvent) => {
	assertTrustedIpcSender(event, trustedRendererOptions);
};

const isNativeThemeSource = (value: unknown): value is NativeThemeSource =>
	value === "light" || value === "dark" || value === "system";

const requestPromptPackEditorClose = (action: "close" | "quit"): boolean => {
	const editorWindow = promptPackEditorWindow;
	if (!editorWindow || editorWindow.isDestroyed() || editorWindow.webContents.isDestroyed()) {
		return false;
	}
	if (pendingPromptPackEditorClose) {
		if (action === "quit") pendingPromptPackEditorClose.action = "quit";
		return true;
	}
	const requestId = randomUUID();
	pendingPromptPackEditorClose = { action, requestId };
	editorWindow.webContents.send(desktopIpcChannel.promptPackEditorCloseRequested, { requestId });
	return true;
};

const parsePromptPackEditorOpenOptions = (value: unknown): PromptPackEditorOpenOptions => {
	if (value === undefined) return {};
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid prompt pack editor options");
	}
	const options = value as Record<string, unknown>;
	if (options.mode !== undefined && options.mode !== "create") {
		throw new Error("invalid prompt pack editor mode");
	}
	if (options.packId !== undefined && typeof options.packId !== "string") {
		throw new Error("invalid prompt pack id");
	}
	return {
		...(options.mode === "create" ? { mode: options.mode } : {}),
		...(typeof options.packId === "string" ? { packId: options.packId } : {}),
	};
};

const openExternalURL = async (value: string) => {
	const url = normalizeExternalURL(value);
	if (!url) throw new Error("external URL must use HTTP or HTTPS");
	await shell.openExternal(url);
};

const sidecarTokenHeader = "X-MediaGo-Sidecar-Token";

const registerRendererProtocol = () => {
	session.defaultSession.webRequest.onHeadersReceived(
		{ urls: ["app://localhost/*"] },
		(details, callback) => {
			callback({
				responseHeaders: {
					...details.responseHeaders,
					"Content-Security-Policy": [rendererContentSecurityPolicy],
					"Referrer-Policy": ["no-referrer"],
					"X-Content-Type-Options": ["nosniff"],
				},
			});
		},
	);
	protocol.handle(rendererProtocolScheme, (request) => {
		const assetPath = resolveRendererAssetPath(request.url, rendererDistDir());
		if (!assetPath) {
			return new Response("Not found", {
				status: 404,
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}
		return net.fetch(pathToFileURL(assetPath).toString());
	});
};

const authenticateSidecarRequests = (sidecar: SidecarConnection) => {
	session.defaultSession.webRequest.onBeforeSendHeaders(
		{ urls: [`${sidecar.origin}/*`] },
		(details, callback) => {
			callback({
				requestHeaders: {
					...details.requestHeaders,
					[sidecarTokenHeader]: sidecar.token,
				},
			});
		},
	);
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

const secureRendererWindow = (window: BrowserWindow) => {
	window.webContents.setWindowOpenHandler(({ url }) => {
		const navigation = resolveRendererNavigation(url, trustedRendererOptions);
		if (navigation.action === "open-external") void shell.openExternal(navigation.url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		const navigation = resolveRendererNavigation(url, trustedRendererOptions);
		if (navigation.action === "allow") return;
		event.preventDefault();
		if (navigation.action === "open-external") void shell.openExternal(navigation.url);
	});
	window.webContents.on("will-attach-webview", (event) => event.preventDefault());
};

const loadRendererRoute = async (window: BrowserWindow, route: string, search = "") => {
	if (rendererUrl) {
		const url = new URL(route, rendererUrl);
		url.search = search;
		await window.loadURL(url.toString());
		return;
	}
	if (app.isPackaged) {
		const url = new URL("app://localhost/index.html");
		url.searchParams.set("version", app.getVersion());
		url.hash = `${route}${search}`;
		await window.loadURL(url.toString());
		return;
	}
	await window.loadFile(join(rendererDistDir(), "index.html"), {
		hash: `${route}${search}`,
	});
};

const openPromptPackEditorWindow = async (options: PromptPackEditorOpenOptions = {}) => {
	const searchParams = new URLSearchParams();
	const normalizedPackId = options.packId?.trim();
	if (normalizedPackId) searchParams.set("packId", normalizedPackId);
	else if (options.mode === "create") searchParams.set("mode", "create");
	const search = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
	if (promptPackEditorWindow && !promptPackEditorWindow.isDestroyed()) {
		await loadRendererRoute(promptPackEditorWindow, "/prompt-pack-editor", search);
		promptPackEditorWindow.show();
		promptPackEditorWindow.focus();
		return;
	}

	promptPackEditorWindow = new BrowserWindow({
		title: "技能包编辑器",
		width: 1180,
		height: 820,
		minWidth: 900,
		minHeight: 640,
		center: true,
		show: false,
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		trafficLightPosition: { x: 16, y: 22 },
		webPreferences: {
			preload: preloadPath(),
			contextIsolation: true,
			devTools: Boolean(rendererUrl),
			nodeIntegration: false,
			sandbox: true,
		},
	});
	promptPackEditorCloseAllowed = false;
	pendingPromptPackEditorClose = null;
	secureRendererWindow(promptPackEditorWindow);
	promptPackEditorWindow.once("ready-to-show", () => promptPackEditorWindow?.show());
	promptPackEditorWindow.on("close", (event) => {
		if (promptPackEditorCloseAllowed) return;
		if (!requestPromptPackEditorClose("close")) return;
		event.preventDefault();
	});
	promptPackEditorWindow.on("closed", () => {
		promptPackEditorWindow = null;
		promptPackEditorCloseAllowed = false;
		pendingPromptPackEditorClose = null;
	});
	await loadRendererRoute(promptPackEditorWindow, "/prompt-pack-editor", search);
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
			devTools: Boolean(rendererUrl),
			nodeIntegration: false,
			sandbox: true,
		},
	});

	secureRendererWindow(mainWindow);

	mainWindow.once("ready-to-show", showMainWindow);
	mainWindow.webContents.once("did-finish-load", showMainWindow);
	setTimeout(showMainWindow, 2_000).unref();
	showMainWindow();
	mainWindow.on("close", (event) => {
		if (process.platform !== "darwin" || isQuitting) return;
		event.preventDefault();
		mainWindow?.hide();
	});

	if (app.isPackaged) await mainWindow.webContents.session.clearCache();
	await loadRendererRoute(mainWindow, "/");
};

app.on("before-quit", (event) => {
	if (!promptPackEditorCloseAllowed && requestPromptPackEditorClose("quit")) {
		event.preventDefault();
		return;
	}
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

ipcMain.handle(desktopIpcChannel.openExternal, async (event, url: string) => {
	authorizeDesktopIpc(event);
	await openExternalURL(url);
});

ipcMain.handle(desktopIpcChannel.openPath, async (event, path: string) => {
	authorizeDesktopIpc(event);
	const error = await shell.openPath(path);
	if (error) throw new Error(error);
});

ipcMain.handle(desktopIpcChannel.revealPath, (event, path: string) => {
	authorizeDesktopIpc(event);
	shell.showItemInFolder(path);
});

ipcMain.handle(
	desktopIpcChannel.copyFileToDirectory,
	async (event, options: { directory?: string; filename?: string; sourcePath?: string }) => {
		authorizeDesktopIpc(event);
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

ipcMain.handle(desktopIpcChannel.pickDirectory, async (event, options?: { title?: string }) => {
	authorizeDesktopIpc(event);
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
	async (event, options?: { title?: string; filters?: DesktopFileFilter[] }) => {
		authorizeDesktopIpc(event);
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

ipcMain.handle(desktopIpcChannel.savePromptPack, async (event, value: unknown) => {
	authorizeDesktopIpc(event);
	const request = parsePromptPackSaveRequest(value);
	const dialogOptions: SaveDialogOptions = {
		title: "导出技能包",
		defaultPath: request.filename,
		filters: [{ name: "MediaGo 技能包", extensions: ["mgpack"] }],
	};
	const owner = BrowserWindow.fromWebContents(event.sender);
	const result = owner
		? await dialog.showSaveDialog(owner, dialogOptions)
		: await dialog.showSaveDialog(dialogOptions);
	if (result.canceled || !result.filePath) return { canceled: true };

	const targetPath =
		extname(result.filePath).toLowerCase() === ".mgpack"
			? result.filePath
			: `${result.filePath}.mgpack`;
	await writeFile(targetPath, request.data);
	return { canceled: false, path: targetPath };
});

ipcMain.handle(desktopIpcChannel.showNotification, (event, options: DesktopNotificationOptions) => {
	authorizeDesktopIpc(event);
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

ipcMain.handle(desktopIpcChannel.openPromptPackEditor, async (event, value: unknown) => {
	authorizeDesktopIpc(event);
	await openPromptPackEditorWindow(parsePromptPackEditorOpenOptions(value));
});

ipcMain.handle(desktopIpcChannel.completePromptPackEditorClose, (event, value: unknown) => {
	authorizeDesktopIpc(event);
	const editorWindow = promptPackEditorWindow;
	if (!editorWindow || editorWindow.isDestroyed() || event.sender !== editorWindow.webContents) {
		throw new Error("prompt pack editor close response came from the wrong window");
	}
	if (!value || typeof value !== "object") {
		throw new Error("prompt pack editor close response is invalid");
	}
	const result = value as Partial<PromptPackEditorCloseResult>;
	const requestId = typeof result.requestId === "string" ? result.requestId.trim() : "";
	const pending = pendingPromptPackEditorClose;
	if (
		!pending ||
		!requestId ||
		requestId !== pending.requestId ||
		typeof result.allow !== "boolean"
	) {
		throw new Error("prompt pack editor close response does not match the pending request");
	}
	pendingPromptPackEditorClose = null;
	if (!result.allow) return;

	promptPackEditorCloseAllowed = true;
	if (pending.action === "quit") app.quit();
	else editorWindow.close();
});

ipcMain.handle(desktopIpcChannel.startWindowDrag, (event) => {
	authorizeDesktopIpc(event);
	// Electron uses CSS app-region for dragging; imperative renderer calls are no-ops.
});

ipcMain.handle(desktopIpcChannel.setNativeThemeSource, (event, source: unknown) => {
	authorizeDesktopIpc(event);
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
	registerRendererProtocol();
	registerDesktopUpdater({ authorizeIpcSender: authorizeDesktopIpc, getWindow: () => mainWindow });
	const sidecar = startServerSidecar();
	if (sidecar) authenticateSidecarRequests(sidecar);
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
