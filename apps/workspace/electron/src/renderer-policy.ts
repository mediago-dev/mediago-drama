import type { RendererMeta, RendererUpdateManifestPayload } from "./ipc-contract.js";

// Pure decision logic for the renderer hot-update loader. No electron/fs imports —
// everything here is unit-testable; renderer-store.ts owns the filesystem side.

/** A pending bundle gets this many launches to report healthy before it is blocked. */
export const maxBootAttempts = 2;

export interface RendererStoreState {
	activeRev: number;
	/** pending = activated but not yet confirmed healthy by the renderer. */
	state: "pending" | "healthy";
	/** Consecutive launches of the active pending bundle without a healthy report. */
	bootAttempts: number;
	blockedRevs: number[];
	previousRev?: number;
}

export const initialStoreState: RendererStoreState = {
	activeRev: 0,
	state: "healthy",
	bootAttempts: 0,
	blockedRevs: [],
};

export interface RendererCandidate {
	rev: number;
	meta: RendererMeta;
}

export type RendererChoice =
	| { source: "builtin"; reason: string; blockRev?: number }
	| { source: "downloaded"; reason: string; countAttempt: boolean };

/**
 * Decide which renderer bundle to load at startup. Returns "downloaded" only when the
 * candidate is strictly newer than the builtin, compatible with the installed shell,
 * not blocked, and has not exhausted its health-check attempts.
 */
export const chooseRenderer = (
	builtin: RendererMeta,
	candidate: RendererCandidate | null,
	store: RendererStoreState,
	shellApiVersion: number,
): RendererChoice => {
	if (!candidate) {
		return { source: "builtin", reason: "no downloaded renderer" };
	}
	if (candidate.rev !== store.activeRev) {
		return { source: "builtin", reason: "candidate does not match active pointer" };
	}
	if (store.blockedRevs.includes(candidate.rev)) {
		return { source: "builtin", reason: `rev ${candidate.rev} is blocked` };
	}
	if (candidate.rev <= builtin.rendererRev) {
		// A full update shipped a builtin renderer at least as new — prefer it.
		return { source: "builtin", reason: "builtin renderer is same or newer" };
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

export type ManifestDecision =
	| { action: "download"; targetRev: number }
	| { action: "up-to-date" }
	| { action: "disabled" }
	| { action: "requires-full-update"; targetRev: number; minShellApi: number };

/** Decide whether a fetched manifest warrants a download. */
export const evaluateManifest = (
	payload: RendererUpdateManifestPayload,
	builtinRev: number,
	activeRev: number,
	blockedRevs: number[],
	shellApiVersion: number,
): ManifestDecision => {
	if (payload.disabled) return { action: "disabled" };
	const currentBest = Math.max(builtinRev, activeRev);
	if (payload.rendererRev <= currentBest) return { action: "up-to-date" };
	if (blockedRevs.includes(payload.rendererRev)) return { action: "up-to-date" };
	if (payload.minShellApi > shellApiVersion) {
		return {
			action: "requires-full-update",
			targetRev: payload.rendererRev,
			minShellApi: payload.minShellApi,
		};
	}
	return { action: "download", targetRev: payload.rendererRev };
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

/** Validate that a parsed manifest payload has the expected shape and sane values. */
export const isValidManifestPayload = (value: unknown): value is RendererUpdateManifestPayload => {
	if (typeof value !== "object" || value === null) return false;
	const payload = value as Record<string, unknown>;
	return (
		typeof payload.rendererRev === "number" &&
		Number.isInteger(payload.rendererRev) &&
		payload.rendererRev > 0 &&
		typeof payload.appBaseline === "string" &&
		typeof payload.minShellApi === "number" &&
		Number.isInteger(payload.minShellApi) &&
		payload.minShellApi > 0 &&
		typeof payload.url === "string" &&
		payload.url.startsWith("https://") &&
		typeof payload.sha256 === "string" &&
		/^[0-9a-f]{64}$/.test(payload.sha256) &&
		typeof payload.size === "number" &&
		payload.size > 0 &&
		(payload.disabled === undefined || typeof payload.disabled === "boolean") &&
		(payload.notes === undefined || typeof payload.notes === "string")
	);
};

/** Validate a parsed renderer-meta.json. */
export const isValidRendererMeta = (value: unknown): value is RendererMeta => {
	if (typeof value !== "object" || value === null) return false;
	const meta = value as Record<string, unknown>;
	return (
		typeof meta.rendererRev === "number" &&
		Number.isInteger(meta.rendererRev) &&
		meta.rendererRev >= 0 &&
		typeof meta.minShellApi === "number" &&
		Number.isInteger(meta.minShellApi) &&
		typeof meta.appBaseline === "string"
	);
};

/** Validate a parsed active.json store state. */
export const isValidStoreState = (value: unknown): value is RendererStoreState => {
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
		(state.previousRev === undefined || typeof state.previousRev === "number")
	);
};
