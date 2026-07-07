export interface DesktopFileFilter {
	name: string;
	extensions: string[];
}

export type NativeThemeSource = "light" | "dark" | "system";

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
	showNotification(options: { title: string; body?: string; id?: string }): Promise<boolean>;
	onNotificationClicked(callback: (id: string) => void): () => void;
	startWindowDrag(): Promise<void>;
	setNativeThemeSource(source: NativeThemeSource): Promise<void>;
}
