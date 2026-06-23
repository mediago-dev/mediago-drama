export interface DesktopFileFilter {
	name: string;
	extensions: string[];
}

export interface MediagoDesktopAPI {
	platform: NodeJS.Platform;
	isElectron: true;
	openExternal(url: string): Promise<void>;
	openPath(path: string): Promise<void>;
	revealPath(path: string): Promise<void>;
	pickDirectory(options?: { title?: string }): Promise<string | null>;
	pickFile(options?: { title?: string; filters?: DesktopFileFilter[] }): Promise<string | null>;
	showNotification(options: { title: string; body?: string }): Promise<boolean>;
	startWindowDrag(): Promise<void>;
}
