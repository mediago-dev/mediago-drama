export interface DesktopFileFilter {
	name: string;
	extensions: string[];
}

export type NativeThemeSource = "light" | "dark" | "system";

export interface DesktopNotificationOptions {
	body?: string;
	title: string;
}

export const desktopUpdateStatusEvent = "mediago:desktop-update-status";

export type DesktopUpdatePhase =
	| "checking"
	| "available"
	| "not-available"
	| "up-to-date"
	| "download-progress"
	| "downloaded"
	| "error";

export interface DesktopUpdateInfo {
	version: string;
	releaseDate?: string;
	releaseName?: string;
	releaseNotes?: string;
}

export interface DesktopUpdateStatus {
	currentVersion: string;
	phase: DesktopUpdatePhase;
	error?: string;
	info?: DesktopUpdateInfo;
	progress?: {
		percent: number;
		transferred: number;
		total: number;
		bytesPerSecond: number;
	};
}

export interface DesktopUpdateCheckResult {
	supported: boolean;
	info?: DesktopUpdateInfo;
	status: DesktopUpdateStatus;
	message?: string;
}

export interface DesktopUpdateActionResult {
	supported: boolean;
	ok: boolean;
	message?: string;
}

export interface DesktopDownloadResult {
	filename: string;
	path: string;
}

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
	checkForUpdate(): Promise<DesktopUpdateCheckResult>;
	downloadUpdate(): Promise<DesktopUpdateActionResult>;
	getAppVersion(): Promise<string>;
	installUpdate(): Promise<DesktopUpdateActionResult>;
	startWindowDrag(): Promise<void>;
	setNativeThemeSource(source: NativeThemeSource): Promise<void>;
}

declare global {
	interface WindowEventMap {
		"mediago:desktop-update-status": CustomEvent<DesktopUpdateStatus>;
	}
}
