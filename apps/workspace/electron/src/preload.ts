import { contextBridge, ipcRenderer } from "electron";

const api = {
	platform: process.platform,
	isElectron: true,
	openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
	openPath: (path: string) => ipcRenderer.invoke("desktop:open-path", path),
	revealPath: (path: string) => ipcRenderer.invoke("desktop:reveal-path", path),
	pickDirectory: (options?: { title?: string }) =>
		ipcRenderer.invoke("desktop:pick-directory", options),
	pickFile: (options?: {
		title?: string;
		filters?: Array<{ name: string; extensions: string[] }>;
	}) => ipcRenderer.invoke("desktop:pick-file", options),
	showNotification: (options: { title: string; body?: string }) =>
		ipcRenderer.invoke("desktop:show-notification", options),
	startWindowDrag: () => ipcRenderer.invoke("desktop:start-window-drag"),
};

contextBridge.exposeInMainWorld("mediagoDesktop", api);
