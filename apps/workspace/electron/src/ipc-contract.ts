export const desktopIpcChannel = {
	openExternal: "desktop:open-external",
	openPath: "desktop:open-path",
	revealPath: "desktop:reveal-path",
	copyFileToDirectory: "desktop:copy-file-to-directory",
	pickDirectory: "desktop:pick-directory",
	pickFile: "desktop:pick-file",
	showNotification: "desktop:show-notification",
	notificationClicked: "desktop:notification-clicked",
	startWindowDrag: "desktop:start-window-drag",
	setNativeThemeSource: "desktop:set-native-theme-source",
	getAppVersion: "desktop:get-app-version",
	getUpdateCapability: "desktop:get-update-capability",
	checkUpdate: "desktop:check-update",
	downloadUpdate: "desktop:download-update",
	installUpdate: "desktop:install-update",
	updateStatus: "desktop:update-status",
} as const;

export type NativeThemeSource = "light" | "dark" | "system";

export interface DesktopFileFilter {
	name: string;
	extensions: string[];
}

export interface DesktopNotificationOptions {
	title: string;
	body?: string;
	id?: string;
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
