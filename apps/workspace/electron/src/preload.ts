import { contextBridge, ipcRenderer } from "electron";

const desktopUpdateStatusChannel = "desktop:update-status";
const desktopUpdateStatusEvent = "mediago:desktop-update-status";

type DesktopNotificationOptions = {
	body?: string;
	title: string;
};
type DesktopUpdateProgress = {
	percent: number;
	transferred: number;
	total: number;
	bytesPerSecond: number;
};

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
	progress?: DesktopUpdateProgress;
};

type DesktopUpdateCheckResult = {
	supported: boolean;
	info?: DesktopUpdateInfo;
	status: DesktopUpdateStatus;
	message?: string;
};

type DesktopUpdateActionResult = {
	supported: boolean;
	ok: boolean;
	message?: string;
};

ipcRenderer.on(desktopUpdateStatusChannel, (_event, payload: DesktopUpdateStatus | undefined) => {
	if (!payload) return;
	window.dispatchEvent(
		new CustomEvent(desktopUpdateStatusEvent, {
			detail: payload,
		}),
	);
});

const api = {
	platform: process.platform,
	isElectron: true,
	openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
	openPath: (path: string) => ipcRenderer.invoke("desktop:open-path", path),
	revealPath: (path: string) => ipcRenderer.invoke("desktop:reveal-path", path),
	copyFileToDirectory: (options: { directory: string; filename?: string; sourcePath: string }) =>
		ipcRenderer.invoke("desktop:copy-file-to-directory", options),
	pickDirectory: (options?: { title?: string }) =>
		ipcRenderer.invoke("desktop:pick-directory", options),
	pickFile: (options?: {
		title?: string;
		filters?: Array<{ name: string; extensions: string[] }>;
	}) => ipcRenderer.invoke("desktop:pick-file", options),
	showNotification: (options: DesktopNotificationOptions) =>
		ipcRenderer.invoke("desktop:show-notification", options),
	checkForUpdate: () =>
		ipcRenderer.invoke("desktop:check-update") as Promise<DesktopUpdateCheckResult>,
	downloadUpdate: () =>
		ipcRenderer.invoke("desktop:download-update") as Promise<DesktopUpdateActionResult>,
	getAppVersion: () => ipcRenderer.invoke("desktop:get-app-version") as Promise<string>,
	installUpdate: () =>
		ipcRenderer.invoke("desktop:install-update") as Promise<DesktopUpdateActionResult>,
	startWindowDrag: () => ipcRenderer.invoke("desktop:start-window-drag"),
	setNativeThemeSource: (source: "light" | "dark" | "system") =>
		ipcRenderer.invoke("desktop:set-native-theme-source", source),
};

contextBridge.exposeInMainWorld("mediagoDesktop", api);
