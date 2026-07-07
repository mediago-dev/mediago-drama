import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

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
	showNotification: (options: { title: string; body?: string; id?: string }) =>
		ipcRenderer.invoke("desktop:show-notification", options),
	onNotificationClicked: (callback: (id: string) => void) => {
		const listener = (_event: IpcRendererEvent, id: string) => callback(id);
		ipcRenderer.on("desktop:notification-clicked", listener);
		return () => ipcRenderer.removeListener("desktop:notification-clicked", listener);
	},
	startWindowDrag: () => ipcRenderer.invoke("desktop:start-window-drag"),
	setNativeThemeSource: (source: "light" | "dark" | "system") =>
		ipcRenderer.invoke("desktop:set-native-theme-source", source),
};

contextBridge.exposeInMainWorld("mediagoDesktop", api);
