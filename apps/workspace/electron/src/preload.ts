import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
	type DesktopFileFilter,
	type DesktopNotificationOptions,
	type DesktopUpdateAck,
	type DesktopUpdateCapability,
	type DesktopUpdateStatus,
	type NativeThemeSource,
	type RendererUpdateCapability,
	type RendererUpdateStatus,
	desktopIpcChannel,
} from "./ipc-contract.js";

const api = {
	platform: process.platform,
	isElectron: true,
	openExternal: (url: string) => ipcRenderer.invoke(desktopIpcChannel.openExternal, url),
	openPath: (path: string) => ipcRenderer.invoke(desktopIpcChannel.openPath, path),
	revealPath: (path: string) => ipcRenderer.invoke(desktopIpcChannel.revealPath, path),
	copyFileToDirectory: (options: { directory: string; filename?: string; sourcePath: string }) =>
		ipcRenderer.invoke(desktopIpcChannel.copyFileToDirectory, options),
	pickDirectory: (options?: { title?: string }) =>
		ipcRenderer.invoke(desktopIpcChannel.pickDirectory, options),
	pickFile: (options?: { title?: string; filters?: DesktopFileFilter[] }) =>
		ipcRenderer.invoke(desktopIpcChannel.pickFile, options),
	showNotification: (options: DesktopNotificationOptions) =>
		ipcRenderer.invoke(desktopIpcChannel.showNotification, options),
	onNotificationClicked: (callback: (id: string) => void) => {
		const listener = (_event: IpcRendererEvent, id: string) => callback(id);
		ipcRenderer.on(desktopIpcChannel.notificationClicked, listener);
		return () => ipcRenderer.removeListener(desktopIpcChannel.notificationClicked, listener);
	},
	getAppVersion: () => ipcRenderer.invoke(desktopIpcChannel.getAppVersion) as Promise<string>,
	getUpdateCapability: () =>
		ipcRenderer.invoke(desktopIpcChannel.getUpdateCapability) as Promise<DesktopUpdateCapability>,
	checkForUpdate: () =>
		ipcRenderer.invoke(desktopIpcChannel.checkUpdate) as Promise<DesktopUpdateAck>,
	downloadUpdate: () =>
		ipcRenderer.invoke(desktopIpcChannel.downloadUpdate) as Promise<DesktopUpdateAck>,
	installUpdate: () =>
		ipcRenderer.invoke(desktopIpcChannel.installUpdate) as Promise<DesktopUpdateAck>,
	onUpdateStatus: (listener: (status: DesktopUpdateStatus) => void) => {
		const handler = (_event: unknown, payload: DesktopUpdateStatus | undefined) => {
			if (!payload) return;
			listener(payload);
		};
		ipcRenderer.on(desktopIpcChannel.updateStatus, handler);
		return () => {
			ipcRenderer.removeListener(desktopIpcChannel.updateStatus, handler);
		};
	},
	getRendererUpdateCapability: () =>
		ipcRenderer.invoke(
			desktopIpcChannel.getRendererUpdateCapability,
		) as Promise<RendererUpdateCapability>,
	checkRendererUpdate: () =>
		ipcRenderer.invoke(desktopIpcChannel.checkRendererUpdate) as Promise<DesktopUpdateAck>,
	markRendererHealthy: () => ipcRenderer.invoke(desktopIpcChannel.markRendererHealthy),
	onRendererUpdateStatus: (listener: (status: RendererUpdateStatus) => void) => {
		const handler = (_event: unknown, payload: RendererUpdateStatus | undefined) => {
			if (!payload) return;
			listener(payload);
		};
		ipcRenderer.on(desktopIpcChannel.rendererUpdateStatus, handler);
		return () => {
			ipcRenderer.removeListener(desktopIpcChannel.rendererUpdateStatus, handler);
		};
	},
	startWindowDrag: () => ipcRenderer.invoke(desktopIpcChannel.startWindowDrag),
	setNativeThemeSource: (source: NativeThemeSource) =>
		ipcRenderer.invoke(desktopIpcChannel.setNativeThemeSource, source),
};

contextBridge.exposeInMainWorld("mediagoDesktop", api);
