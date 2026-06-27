import { contextBridge, ipcRenderer } from "electron";

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
	showNotification: (options: { title: string; body?: string }) =>
		ipcRenderer.invoke("desktop:show-notification", options),
	startWindowDrag: () => ipcRenderer.invoke("desktop:start-window-drag"),
	setNativeThemeSource: (source: "light" | "dark" | "system") =>
		ipcRenderer.invoke("desktop:set-native-theme-source", source),
};

contextBridge.exposeInMainWorld("mediagoDesktop", api);
