export type {
	DesktopFileFilter,
	DesktopNotificationOptions,
	DesktopPromptPackSaveOptions,
	DesktopPromptPackSaveResult,
	DesktopDownloadResult,
	NativeThemeSource,
	PromptPackEditorCloseRequest,
	PromptPackEditorCloseResult,
	PromptPackEditorOpenOptions,
} from "../../../electron/src/ipc-contract";

import type {
	DesktopDownloadResult,
	DesktopFileFilter,
	DesktopNotificationOptions,
	DesktopPromptPackSaveOptions,
	DesktopPromptPackSaveResult,
	NativeThemeSource,
	PromptPackEditorCloseRequest,
	PromptPackEditorCloseResult,
	PromptPackEditorOpenOptions,
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
	savePromptPack(options: DesktopPromptPackSaveOptions): Promise<DesktopPromptPackSaveResult>;
	showNotification(options: DesktopNotificationOptions): Promise<boolean>;
	onNotificationClicked(callback: (id: string) => void): () => void;
	openPromptPackEditor(options?: PromptPackEditorOpenOptions): Promise<void>;
	onPromptPackEditorCloseRequested(
		callback: (request: PromptPackEditorCloseRequest) => void,
	): () => void;
	completePromptPackEditorClose(result: PromptPackEditorCloseResult): Promise<void>;
	startWindowDrag(): Promise<void>;
	setNativeThemeSource(source: NativeThemeSource): Promise<void>;
}
