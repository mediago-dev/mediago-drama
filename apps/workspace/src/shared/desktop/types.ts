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
	BundleUpdateCapability,
	BundleUpdatePhase,
	BundleUpdateSource,
	BundleUpdateStatus,
} from "../../../electron/src/ipc-contract";

import type {
	DesktopDownloadResult,
	DesktopFileFilter,
	DesktopNotificationOptions,
	DesktopUpdateAck,
	DesktopUpdateCapability,
	DesktopUpdateStatus,
	NativeThemeSource,
	BundleUpdateCapability,
	BundleUpdateStatus,
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
	// Bundle (renderer + server) hot-update surface. Optional: a hot-updated renderer may run against an
	// older shell whose preload predates these methods — callers must runtime-guard.
	getBundleUpdateCapability?(): Promise<BundleUpdateCapability>;
	checkBundleUpdate?(): Promise<DesktopUpdateAck>;
	applyBundleUpdate?(): Promise<DesktopUpdateAck>;
	markRendererHealthy?(): Promise<void>;
	onBundleUpdateStatus?(listener: (status: BundleUpdateStatus) => void): () => void;
	startWindowDrag(): Promise<void>;
	setNativeThemeSource(source: NativeThemeSource): Promise<void>;
}
