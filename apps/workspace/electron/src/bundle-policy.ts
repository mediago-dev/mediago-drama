import type {
	BundleComponentKind,
	BundleComponentRef,
	BundleManifestPayload,
	BundleMeta,
} from "./ipc-contract.js";

export type { BundleMeta } from "./ipc-contract.js";

// Pure decision logic for the application-bundle (renderer + server binary) hot-update
// loader. No electron/fs imports — everything here is unit-testable; bundle-store.ts
// owns the filesystem side and bundle-updater.ts the orchestration.

/** A pending bundle gets this many launches to report full health before it is blocked. */
export const maxBootAttempts = 2;

export interface BundleStoreState {
	activeRev: number;
	/** pending = activated but not yet confirmed healthy by BOTH components. */
	state: "pending" | "healthy";
	/** Consecutive launches of the active pending bundle without full health. */
	bootAttempts: number;
	blockedRevs: number[];
	previousRev?: number;
	/** Per-component health signals for the active pending bundle. */
	rendererHealthy: boolean;
	serverHealthy: boolean;
	/**
	 * Whether the active rev's server runs DB migrations. Only migration releases
	 * snapshot/restore the databases: rolling back to the previous (older) server binary
	 * over a forward-migrated schema is unsafe, so the snapshot is restored. A
	 * no-migration rev shares the schema with the previous binary, so its databases are
	 * never touched — restoring would only destroy the user data it legitimately wrote.
	 */
	hasMigration: boolean;
}

export const initialStoreState: BundleStoreState = {
	activeRev: 0,
	state: "healthy",
	bootAttempts: 0,
	blockedRevs: [],
	rendererHealthy: false,
	serverHealthy: false,
	hasMigration: false,
};

export interface BundleCandidate {
	rev: number;
	meta: BundleMeta;
}

export type BundleChoice =
	| { source: "builtin"; reason: string; blockRev?: number }
	| { source: "downloaded"; reason: string; countAttempt: boolean };

/**
 * Decide which bundle to load at startup. Returns "downloaded" only when the candidate
 * is strictly newer than the builtin, compatible with the installed shell, not blocked,
 * and has not exhausted its health-check attempts.
 */
export const chooseBundle = (
	builtin: BundleMeta,
	candidate: BundleCandidate | null,
	store: BundleStoreState,
	shellApiVersion: number,
): BundleChoice => {
	if (!candidate) {
		return { source: "builtin", reason: "no downloaded bundle" };
	}
	if (candidate.rev !== store.activeRev) {
		return { source: "builtin", reason: "candidate does not match active pointer" };
	}
	if (store.blockedRevs.includes(candidate.rev)) {
		return { source: "builtin", reason: `rev ${candidate.rev} is blocked` };
	}
	if (candidate.rev <= builtin.bundleRev) {
		// A full update shipped a builtin bundle at least as new — prefer it.
		return { source: "builtin", reason: "builtin bundle is same or newer" };
	}
	if (candidate.meta.minShellApi > shellApiVersion) {
		return {
			source: "builtin",
			reason: `rev ${candidate.rev} requires shell api ${candidate.meta.minShellApi} > ${shellApiVersion}`,
			blockRev: candidate.rev,
		};
	}
	if (store.state === "pending" && store.bootAttempts >= maxBootAttempts) {
		return {
			source: "builtin",
			reason: `rev ${candidate.rev} failed ${store.bootAttempts} health checks`,
			blockRev: candidate.rev,
		};
	}
	return {
		source: "downloaded",
		reason: `rev ${candidate.rev} active`,
		countAttempt: store.state === "pending",
	};
};

/**
 * Record one component's health signal. The bundle turns healthy (and its attempt
 * counter resets) only when both the renderer and the server have reported in.
 */
export const applyComponentHealthy = (
	store: BundleStoreState,
	component: BundleComponentKind,
): BundleStoreState => {
	const rendererHealthy = store.rendererHealthy || component === "renderer";
	const serverHealthy = store.serverHealthy || component === "server";
	if (rendererHealthy === store.rendererHealthy && serverHealthy === store.serverHealthy) {
		return store;
	}
	const fullyHealthy = rendererHealthy && serverHealthy;
	return {
		...store,
		rendererHealthy,
		serverHealthy,
		state: fullyHealthy ? "healthy" : store.state,
		bootAttempts: fullyHealthy ? 0 : store.bootAttempts,
	};
};

export type BundleManifestDecision =
	| { action: "download"; targetRev: number; components: BundleComponentKind[] }
	| { action: "up-to-date" }
	| { action: "disabled" }
	| { action: "requires-full-update"; targetRev: number; minShellApi: number }
	| { action: "unsupported-platform"; targetRev: number };

/**
 * Decide whether a fetched manifest warrants a download and which components actually
 * changed relative to the currently-running bundle's component identities. Unknown
 * identities (builtin bundles record "") force a download of that component.
 */
export const evaluateBundleManifest = (
	payload: BundleManifestPayload,
	platformKey: string,
	currentMeta: BundleMeta,
	currentRev: number,
	blockedRevs: number[],
	shellApiVersion: number,
): BundleManifestDecision => {
	if (payload.disabled) return { action: "disabled" };
	if (payload.bundleRev <= currentRev) return { action: "up-to-date" };
	if (blockedRevs.includes(payload.bundleRev)) return { action: "up-to-date" };
	if (payload.minShellApi > shellApiVersion) {
		return {
			action: "requires-full-update",
			targetRev: payload.bundleRev,
			minShellApi: payload.minShellApi,
		};
	}
	const serverRef = payload.components.server[platformKey];
	if (!serverRef) {
		return { action: "unsupported-platform", targetRev: payload.bundleRev };
	}

	const components: BundleComponentKind[] = [];
	if (
		!currentMeta.components.renderer ||
		currentMeta.components.renderer !== payload.components.renderer.sha256
	) {
		components.push("renderer");
	}
	if (!currentMeta.components.server || currentMeta.components.server !== serverRef.sha256) {
		components.push("server");
	}
	return { action: "download", targetRev: payload.bundleRev, components };
};

/** Reject zip entries that could escape the extraction directory (zip-slip). */
export const isSafeZipEntryPath = (entryPath: string): boolean => {
	if (!entryPath || entryPath.length > 4096) return false;
	if (entryPath.startsWith("/") || entryPath.startsWith("\\")) return false;
	if (/^[a-zA-Z]:/.test(entryPath)) return false;
	if (entryPath.includes("\0")) return false;
	const segments = entryPath.split(/[/\\]/);
	return segments.every((segment) => segment !== "..");
};

/** Component URL must be https, except localhost http when explicitly allowed (test mode). */
const isAcceptableComponentUrl = (url: string, allowInsecureUrl: boolean): boolean => {
	if (url.startsWith("https://")) return true;
	if (!allowInsecureUrl) return false;
	return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
};

const isValidComponentRef = (
	value: unknown,
	allowInsecureUrl: boolean,
): value is BundleComponentRef => {
	if (typeof value !== "object" || value === null) return false;
	const ref = value as Record<string, unknown>;
	return (
		typeof ref.url === "string" &&
		isAcceptableComponentUrl(ref.url, allowInsecureUrl) &&
		typeof ref.sha256 === "string" &&
		/^[0-9a-f]{64}$/.test(ref.sha256) &&
		typeof ref.size === "number" &&
		ref.size > 0
	);
};

/**
 * Validate that a parsed manifest payload has the expected shape and sane values.
 * allowInsecureUrl loosens the https-only rule to localhost http and must only be
 * passed in local test mode.
 */
export const isValidBundleManifestPayload = (
	value: unknown,
	allowInsecureUrl = false,
): value is BundleManifestPayload => {
	if (typeof value !== "object" || value === null) return false;
	const payload = value as Record<string, unknown>;
	if (
		typeof payload.bundleRev !== "number" ||
		!Number.isInteger(payload.bundleRev) ||
		payload.bundleRev <= 0 ||
		typeof payload.appBaseline !== "string" ||
		typeof payload.minShellApi !== "number" ||
		!Number.isInteger(payload.minShellApi) ||
		payload.minShellApi <= 0 ||
		(payload.disabled !== undefined && typeof payload.disabled !== "boolean") ||
		(payload.hasMigration !== undefined && typeof payload.hasMigration !== "boolean") ||
		(payload.edition !== undefined && typeof payload.edition !== "string") ||
		(payload.notes !== undefined && typeof payload.notes !== "string")
	) {
		return false;
	}
	const components = payload.components as Record<string, unknown> | undefined;
	if (typeof components !== "object" || components === null) return false;
	if (!isValidComponentRef(components.renderer, allowInsecureUrl)) return false;
	const server = components.server as Record<string, unknown> | undefined;
	if (typeof server !== "object" || server === null) return false;
	const platforms = Object.values(server);
	if (platforms.length === 0) return false;
	return platforms.every((ref) => isValidComponentRef(ref, allowInsecureUrl));
};

/** Validate a parsed bundle-meta.json. */
export const isValidBundleMeta = (value: unknown): value is BundleMeta => {
	if (typeof value !== "object" || value === null) return false;
	const meta = value as Record<string, unknown>;
	if (
		typeof meta.bundleRev !== "number" ||
		!Number.isInteger(meta.bundleRev) ||
		meta.bundleRev < 0 ||
		typeof meta.minShellApi !== "number" ||
		!Number.isInteger(meta.minShellApi) ||
		typeof meta.appBaseline !== "string"
	) {
		return false;
	}
	const components = meta.components as Record<string, unknown> | undefined;
	return (
		typeof components === "object" &&
		components !== null &&
		typeof components.renderer === "string" &&
		typeof components.server === "string"
	);
};

/** Validate a parsed active.json store state. */
export const isValidBundleStoreState = (value: unknown): value is BundleStoreState => {
	if (typeof value !== "object" || value === null) return false;
	const state = value as Record<string, unknown>;
	return (
		typeof state.activeRev === "number" &&
		Number.isInteger(state.activeRev) &&
		(state.state === "pending" || state.state === "healthy") &&
		typeof state.bootAttempts === "number" &&
		Number.isInteger(state.bootAttempts) &&
		Array.isArray(state.blockedRevs) &&
		state.blockedRevs.every((rev) => typeof rev === "number") &&
		(state.previousRev === undefined || typeof state.previousRev === "number") &&
		typeof state.rendererHealthy === "boolean" &&
		typeof state.serverHealthy === "boolean" &&
		typeof state.hasMigration === "boolean"
	);
};
