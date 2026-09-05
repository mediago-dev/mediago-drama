export const desktopIpcChannel = {
	openExternal: "desktop:open-external",
	openPath: "desktop:open-path",
	revealPath: "desktop:reveal-path",
	copyFileToDirectory: "desktop:copy-file-to-directory",
	pickDirectory: "desktop:pick-directory",
	pickFile: "desktop:pick-file",
	savePromptPack: "desktop:save-prompt-pack",
	showNotification: "desktop:show-notification",
	notificationClicked: "desktop:notification-clicked",
	openPromptPackEditor: "desktop:open-prompt-pack-editor",
	promptPackEditorCloseRequested: "desktop:prompt-pack-editor-close-requested",
	completePromptPackEditorClose: "desktop:complete-prompt-pack-editor-close",
	startWindowDrag: "desktop:start-window-drag",
	setNativeThemeSource: "desktop:set-native-theme-source",
} as const;

export type NativeThemeSource = "light" | "dark" | "system";

export interface PromptPackEditorOpenOptions {
	mode?: "create";
	packId?: string;
}

export interface PromptPackEditorCloseRequest {
	requestId: string;
}

export interface PromptPackEditorCloseResult {
	allow: boolean;
	requestId: string;
}

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

export interface DesktopPromptPackSaveOptions {
	data: Uint8Array;
	filename: string;
}

export interface DesktopPromptPackSaveResult {
	canceled: boolean;
	path?: string;
}
