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
	getBundleUpdateCapability: "desktop:get-bundle-update-capability",
	checkBundleUpdate: "desktop:check-bundle-update",
	applyBundleUpdate: "desktop:apply-bundle-update",
	markRendererHealthy: "desktop:mark-renderer-healthy",
	bundleUpdateStatus: "desktop:bundle-update-status",
} as const;

// Version of the shell-side IPC surface (main + preload). Bump on every breaking
// change to this contract. Hot bundles declare the minimum shell API they require;
// the loader refuses bundles that need a newer shell than the installed one.
// v2: renderer-only hot updates replaced by application bundles (renderer + server).
export const SHELL_API_VERSION = 2;

/** Target platforms the bundle pipeline builds server binaries for. */
export const bundleTargetPlatforms = ["darwin-arm64", "windows-x64"] as const;

export type BundleTargetPlatform = (typeof bundleTargetPlatforms)[number];

/** Server binary filename inside a bundle for a given target platform key. */
export const bundleServerBinaryName = (platformKey: string): string =>
	platformKey.startsWith("windows") ? "mediago-server.exe" : "mediago-server";

/**
 * Manifest platform key for a Node/Electron process, e.g. "darwin-arm64" /
 * "windows-x64". Single source of truth shared by the runtime loader, the packaging
 * script, and the local test harness — the CI workflow mirrors these literals.
 */
export const bundlePlatformKeyFor = (platform: string, arch: string): string =>
	platform === "win32" ? `windows-${arch}` : `${platform}-${arch}`;

/** Env var carrying the server binary path for a platform in the packaging pipeline. */
export const bundleServerBinaryEnvName = (platformKey: string): string =>
	`MEDIAGO_SERVER_BINARY_${platformKey.toUpperCase().replace(/-/g, "_")}`;

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

/**
 * Identity of an application bundle (renderer + server binary pair). Written as
 * bundle-meta.json into the builtin renderer dir at stage time and into each
 * downloaded version dir on activation.
 */
export interface BundleMeta {
	/** Monotonically increasing revision across all bundle releases. */
	bundleRev: number;
	/** Monotonic SQLite schema generation used to decide whether rollback needs a snapshot. */
	schemaVersion: number;
	/** Persistent workspace layout generation. Changes require a full shell update. */
	workspaceLayoutVersion: number;
	/** Update cohort compiled into the shell (for example "beta" or "latest"). */
	channel: string;
	/** Product edition compiled into the shell (for example "community" or "pro"). */
	edition: string;
	/** Minimum SHELL_API_VERSION this bundle requires. */
	minShellApi: number;
	/** Full app version this bundle was built from (display only). */
	appBaseline: string;
	/**
	 * Content identities of the extracted components. Archive SHA-256 values are not
	 * component identities because ZIP metadata can change without content changing.
	 */
	components: {
		renderer: { contentSha256: string };
		server: { contentSha256: string };
	};
}

export type BundleUpdateSource = "builtin" | "downloaded";

export type BundleComponentKind = "renderer" | "server";

export interface BundleUpdateCapability {
	enabled: boolean;
	currentRev: number;
	source: BundleUpdateSource;
	reason?: string;
}

export type BundleUpdatePhase =
	| "idle"
	| "checking"
	| "downloading"
	| "staged"
	| "applying"
	| "up-to-date"
	| "requires-full-update"
	| "error";

export interface BundleUpdateStatus {
	phase: BundleUpdatePhase;
	currentRev: number;
	targetRev?: number;
	components?: BundleComponentKind[];
	notes?: string;
	error?: string;
	progress?: {
		percent: number;
		transferred: number;
		total: number;
	};
}

/** One downloadable component artifact referenced by the bundle manifest. */
export interface BundleComponentRef {
	url: string;
	/** Digest of the downloadable archive. */
	sha256: string;
	/** Digest of extracted component content, used for pairing and at-rest verification. */
	contentSha256: string;
	size: number;
}

/** Signed payload of bundle-manifest.json (see bundle-updater). */
export interface BundleManifestPayload {
	bundleRev: number;
	schemaVersion: number;
	workspaceLayoutVersion: number;
	channel: string;
	edition: string;
	/** Source commit used by release guards to bind migration-sensitive diffs to bumps. */
	sourceCommit: string;
	appBaseline: string;
	minShellApi: number;
	components: {
		renderer: BundleComponentRef;
		/** Keyed by target platform, e.g. "darwin-arm64" / "windows-x64". */
		server: Record<string, BundleComponentRef>;
	};
	disabled?: boolean;
	notes?: string;
}
