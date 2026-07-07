export type {
	DesktopFileFilter,
	DesktopNotificationOptions,
	DesktopDownloadResult,
	NativeThemeSource,
	DesktopUpdatePhase,
	DesktopUpdateInfo,
	DesktopUpdateProgress,
	DesktopUpdateStatus,
	DesktopUpdateCapability,
	DesktopUpdateAck,
	RendererUpdateCapability,
	RendererUpdatePhase,
	RendererUpdateSource,
	RendererUpdateStatus,
} from "../../../electron/src/ipc-contract";

import type {
	DesktopDownloadResult,
	DesktopFileFilter,
	DesktopNotificationOptions,
	DesktopUpdateAck,
	DesktopUpdateCapability,
	DesktopUpdateStatus,
	NativeThemeSource,
	RendererUpdateCapability,
	RendererUpdateStatus,
} from "../../../electron/src/ipc-contract";

export interface MediagoDesktopAPI {
	platform: NodeJS.Platform;
	isElectron: true;
	openExternal(url: string): Promise<void>;
	openPath(path: string): Promise<void>;
	revealPath(path: string): Promise<void>;
	copyFileToDirectory(options: {
		directory: string;
		filename?: string;
		sourcePath: string;
	}): Promise<DesktopDownloadResult>;
	pickDirectory(options?: { title?: string }): Promise<string | null>;
	pickFile(options?: { title?: string; filters?: DesktopFileFilter[] }): Promise<string | null>;
	showNotification(options: DesktopNotificationOptions): Promise<boolean>;
	onNotificationClicked(callback: (id: string) => void): () => void;
	getAppVersion(): Promise<string>;
	getUpdateCapability(): Promise<DesktopUpdateCapability>;
	checkForUpdate(): Promise<DesktopUpdateAck>;
	downloadUpdate(): Promise<DesktopUpdateAck>;
	installUpdate(): Promise<DesktopUpdateAck>;
	onUpdateStatus(listener: (status: DesktopUpdateStatus) => void): () => void;
	// Renderer hot-update surface. Optional: a hot-updated renderer may run against an
	// older shell whose preload predates these methods — callers must runtime-guard.
	getRendererUpdateCapability?(): Promise<RendererUpdateCapability>;
	checkRendererUpdate?(): Promise<DesktopUpdateAck>;
	applyRendererUpdate?(): Promise<DesktopUpdateAck>;
	markRendererHealthy?(): Promise<void>;
	onRendererUpdateStatus?(listener: (status: RendererUpdateStatus) => void): () => void;
	startWindowDrag(): Promise<void>;
	setNativeThemeSource(source: NativeThemeSource): Promise<void>;
}
