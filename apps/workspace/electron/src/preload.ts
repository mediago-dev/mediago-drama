import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
	type DesktopFileFilter,
	type DesktopNotificationOptions,
	type DesktopPromptPackSaveOptions,
	type DesktopPromptPackSaveResult,
	type NativeThemeSource,
	type PromptPackEditorCloseRequest,
	type PromptPackEditorCloseResult,
	type PromptPackEditorOpenOptions,
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
	savePromptPack: (options: DesktopPromptPackSaveOptions) =>
		ipcRenderer.invoke(
			desktopIpcChannel.savePromptPack,
			options,
		) as Promise<DesktopPromptPackSaveResult>,
	showNotification: (options: DesktopNotificationOptions) =>
		ipcRenderer.invoke(desktopIpcChannel.showNotification, options),
	onNotificationClicked: (callback: (id: string) => void) => {
		const listener = (_event: IpcRendererEvent, id: string) => callback(id);
		ipcRenderer.on(desktopIpcChannel.notificationClicked, listener);
		return () => ipcRenderer.removeListener(desktopIpcChannel.notificationClicked, listener);
	},
	openPromptPackEditor: (options?: PromptPackEditorOpenOptions) =>
		ipcRenderer.invoke(desktopIpcChannel.openPromptPackEditor, options),
	onPromptPackEditorCloseRequested: (callback: (request: PromptPackEditorCloseRequest) => void) => {
		const listener = (_event: IpcRendererEvent, value: unknown) => {
			if (!value || typeof value !== "object") return;
			const requestId = String((value as { requestId?: unknown }).requestId ?? "").trim();
			if (requestId) callback({ requestId });
		};
		ipcRenderer.on(desktopIpcChannel.promptPackEditorCloseRequested, listener);
		return () =>
			ipcRenderer.removeListener(desktopIpcChannel.promptPackEditorCloseRequested, listener);
	},
	completePromptPackEditorClose: (result: PromptPackEditorCloseResult) =>
		ipcRenderer.invoke(desktopIpcChannel.completePromptPackEditorClose, result),
	startWindowDrag: () => ipcRenderer.invoke(desktopIpcChannel.startWindowDrag),
	setNativeThemeSource: (source: NativeThemeSource) =>
		ipcRenderer.invoke(desktopIpcChannel.setNativeThemeSource, source),
};

contextBridge.exposeInMainWorld("mediagoDesktop", api);
