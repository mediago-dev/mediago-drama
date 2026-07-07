export const desktopIpcChannel = {
	openExternal: "desktop:open-external",
	openPath: "desktop:open-path",
	revealPath: "desktop:reveal-path",
	copyFileToDirectory: "desktop:copy-file-to-directory",
	pickDirectory: "desktop:pick-directory",
	pickFile: "desktop:pick-file",
	showNotification: "desktop:show-notification",
	startWindowDrag: "desktop:start-window-drag",
	setNativeThemeSource: "desktop:set-native-theme-source",
	getAppVersion: "desktop:get-app-version",
	getUpdateCapability: "desktop:get-update-capability",
	checkUpdate: "desktop:check-update",
	downloadUpdate: "desktop:download-update",
	installUpdate: "desktop:install-update",
	updateStatus: "desktop:update-status",
	getRendererUpdateCapability: "desktop:get-renderer-update-capability",
	checkRendererUpdate: "desktop:check-renderer-update",
	markRendererHealthy: "desktop:mark-renderer-healthy",
	rendererUpdateStatus: "desktop:renderer-update-status",
} as const;

// Version of the shell-side IPC surface (main + preload). Bump on every breaking
// change to this contract. Hot renderer updates declare the minimum shell API they
// require; the loader refuses bundles that need a newer shell than the installed one.
export const SHELL_API_VERSION = 1;

export type NativeThemeSource = "light" | "dark" | "system";

export interface DesktopFileFilter {
	name: string;
	extensions: string[];
}

export interface DesktopNotificationOptions {
	title: string;
	body?: string;
}

export interface DesktopDownloadResult {
	filename: string;
	path: string;
}

export type DesktopUpdatePhase =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "downloaded"
	| "up-to-date"
	| "error";

export interface DesktopUpdateInfo {
	version: string;
	releaseDate?: string;
	releaseName?: string;
	releaseNotes?: string;
}

export interface DesktopUpdateProgress {
	percent: number;
	transferred: number;
	total: number;
	bytesPerSecond: number;
}

export interface DesktopUpdateStatus {
	currentVersion: string;
	phase: DesktopUpdatePhase;
	error?: string;
	info?: DesktopUpdateInfo;
	progress?: DesktopUpdateProgress;
}

export interface DesktopUpdateCapability {
	supportsAutoUpdate: boolean;
	releasePageUrl: string;
	reason?: string;
}

export interface DesktopUpdateAckOk {
	ok: true;
}

export interface DesktopUpdateAckError {
	ok: false;
	message: string;
}

export type DesktopUpdateAck = DesktopUpdateAckOk | DesktopUpdateAckError;

/** Identity of a renderer bundle. Written into dist as renderer-meta.json at build time. */
export interface RendererMeta {
	/** Monotonically increasing revision across all renderer releases. */
	rendererRev: number;
	/** Minimum SHELL_API_VERSION this bundle requires. */
	minShellApi: number;
	/** Full app version this bundle was built from (display only). */
	appBaseline: string;
}

export type RendererUpdateSource = "builtin" | "downloaded";

export interface RendererUpdateCapability {
	enabled: boolean;
	currentRev: number;
	source: RendererUpdateSource;
	reason?: string;
}

export type RendererUpdatePhase =
	| "idle"
	| "checking"
	| "downloading"
	| "ready"
	| "up-to-date"
	| "requires-full-update"
	| "error";

export interface RendererUpdateStatus {
	phase: RendererUpdatePhase;
	currentRev: number;
	targetRev?: number;
	notes?: string;
	error?: string;
	progress?: {
		percent: number;
		transferred: number;
		total: number;
	};
}

/** Signed payload of renderer-manifest.json (see hot-updater). */
export interface RendererUpdateManifestPayload {
	rendererRev: number;
	appBaseline: string;
	minShellApi: number;
	url: string;
	sha256: string;
	size: number;
	disabled?: boolean;
	notes?: string;
}
