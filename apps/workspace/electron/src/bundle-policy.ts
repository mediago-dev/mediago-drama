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

export type BundleApplyFailureAction =
	| "keep-committed"
	| "keep-migrated-pending"
	| "rollback"
	| "restart-target"
	| "none";

/**
 * Choose the only data-safe recovery action after an apply failure. Kept pure so the
 * ordering boundary is fault-injection tested independently of Electron.
 */
export const chooseApplyFailureAction = (state: {
	committed: boolean;
	migrationRestoreForbidden: boolean;
	newStarted: boolean;
	rollbackPrepared: boolean;
	snapshotPrepared: boolean;
	oldStopped: boolean;
}): BundleApplyFailureAction => {
	if (state.committed) return "keep-committed";
	if (state.migrationRestoreForbidden) return "keep-migrated-pending";
	if (state.newStarted || state.rollbackPrepared || state.snapshotPrepared) return "rollback";
	if (state.oldStopped) return "restart-target";
	return "none";
};

export interface BundleRollbackPending {
	/** Revision whose attempted boot/apply must be rolled back. */
	failedRev: number;
	/** Known-good target revision. Zero means the current builtin bundle. */
	targetRev: number;
	/** Schema generation of targetRev, retained even when targetRev is builtin. */
	targetSchemaVersion: number;
	/** Snapshot directory revision to restore when restoreSnapshot is true. */
	snapshotRev: number;
	restoreSnapshot: boolean;
}

export interface BundleStoreState {
	activeRev: number;
	/** pending = activated but not yet confirmed healthy by BOTH components. */
	state: "pending" | "healthy";
	/** Consecutive launches of the active pending bundle without full health. */
	bootAttempts: number;
	blockedRevs: number[];
	/** Most recently confirmed healthy revision (zero means builtin). */
	lastKnownGoodRev: number;
	/** One older confirmed healthy revision, retained for remote revocation. */
	fallbackRev: number;
	activeSchemaVersion: number;
	lastKnownGoodSchemaVersion: number;
	fallbackSchemaVersion: number;
	/** Highest bundle/schema/layout generations ever confirmed on this user data. */
	bundleRevFloor: number;
	schemaVersionFloor: number;
	workspaceLayoutVersionFloor: number;
	/** Per-component health signals for the active pending bundle. */
	rendererHealthy: boolean;
	serverHealthy: boolean;
	/** A forward-schema server process may have started writers; snapshot restore is forbidden. */
	migrationStarted: boolean;
	/** Durable recovery intent. It is cleared only by full health or completed rollback. */
	rollbackPending?: BundleRollbackPending;
	/** Cached signed kill-switch state for this shell cohort. */
	channelDisabled: boolean;
	/** Highest signed manifest revision accepted for this cohort (enabled or disabled). */
	channelDisabledAtRev: number;
	/** Cohort to which the signed-manifest high-water mark belongs. */
	manifestChannel: string;
	manifestEdition: string;
}

export const initialStoreState: BundleStoreState = {
	activeRev: 0,
	state: "healthy",
	bootAttempts: 0,
	blockedRevs: [],
	lastKnownGoodRev: 0,
	fallbackRev: 0,
	activeSchemaVersion: 0,
	lastKnownGoodSchemaVersion: 0,
	fallbackSchemaVersion: 0,
	bundleRevFloor: 0,
	schemaVersionFloor: 0,
	workspaceLayoutVersionFloor: 0,
	rendererHealthy: false,
	serverHealthy: false,
	migrationStarted: false,
	channelDisabled: false,
	channelDisabledAtRev: 0,
	manifestChannel: "",
	manifestEdition: "",
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
	if (store.channelDisabled) {
		return { source: "builtin", reason: "bundle update channel is disabled" };
	}
	if (candidate.rev !== store.activeRev) {
		return { source: "builtin", reason: "candidate does not match active pointer" };
	}
	if (store.blockedRevs.includes(candidate.rev)) {
		return { source: "builtin", reason: `rev ${candidate.rev} is blocked` };
	}
	if (candidate.meta.minShellApi > shellApiVersion) {
		return {
			source: "builtin",
			reason: `rev ${candidate.rev} requires shell api ${candidate.meta.minShellApi} > ${shellApiVersion}`,
			blockRev: candidate.rev,
		};
	}
	if (
		candidate.meta.channel !== builtin.channel ||
		candidate.meta.edition !== builtin.edition ||
		candidate.meta.workspaceLayoutVersion !== builtin.workspaceLayoutVersion
	) {
		return {
			source: "builtin",
			reason: `rev ${candidate.rev} does not match the installed shell cohort or workspace layout`,
			blockRev: candidate.rev,
		};
	}
	if (candidate.rev <= builtin.bundleRev) {
		if (candidate.meta.schemaVersion > builtin.schemaVersion) {
			// Revision ordering alone cannot make an older schema safe. Keep the verified
			// downloaded bundle until a full installer carrying at least this schema lands.
			return {
				source: "downloaded",
				reason: "builtin revision is newer but its schema is behind the active bundle",
				countAttempt: store.state === "pending",
			};
		}
		return { source: "builtin", reason: "builtin bundle is same or newer" };
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
	const promoted = fullyHealthy && store.state === "pending";
	return {
		...store,
		rendererHealthy,
		serverHealthy,
		state: fullyHealthy ? "healthy" : store.state,
		bootAttempts: fullyHealthy ? 0 : store.bootAttempts,
		lastKnownGoodRev: promoted ? store.activeRev : store.lastKnownGoodRev,
		lastKnownGoodSchemaVersion: promoted
			? store.activeSchemaVersion
			: store.lastKnownGoodSchemaVersion,
		fallbackRev: promoted ? store.lastKnownGoodRev : store.fallbackRev,
		fallbackSchemaVersion: promoted
			? store.lastKnownGoodSchemaVersion
			: store.fallbackSchemaVersion,
		bundleRevFloor: store.bundleRevFloor,
		schemaVersionFloor: promoted
			? Math.max(store.schemaVersionFloor, store.activeSchemaVersion)
			: store.schemaVersionFloor,
		rollbackPending: fullyHealthy ? undefined : store.rollbackPending,
		migrationStarted: fullyHealthy ? false : store.migrationStarted,
	};
};

export type BundleManifestDecision =
	| { action: "download"; targetRev: number; components: BundleComponentKind[] }
	| { action: "up-to-date" }
	| { action: "disabled" }
	| {
			action: "requires-full-update";
			targetRev: number;
			minShellApi: number;
			reason: "shell-api" | "workspace-layout" | "schema-downgrade";
	  }
	| { action: "cohort-mismatch"; targetRev: number }
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
	if (payload.channel !== currentMeta.channel || payload.edition !== currentMeta.edition) {
		return { action: "cohort-mismatch", targetRev: payload.bundleRev };
	}
	if (payload.disabled) return { action: "disabled" };
	if (payload.bundleRev <= currentRev) return { action: "up-to-date" };
	if (blockedRevs.includes(payload.bundleRev)) return { action: "up-to-date" };
	if (payload.minShellApi > shellApiVersion) {
		return {
			action: "requires-full-update",
			targetRev: payload.bundleRev,
			minShellApi: payload.minShellApi,
			reason: "shell-api",
		};
	}
	if (payload.workspaceLayoutVersion !== currentMeta.workspaceLayoutVersion) {
		return {
			action: "requires-full-update",
			targetRev: payload.bundleRev,
			minShellApi: payload.minShellApi,
			reason: "workspace-layout",
		};
	}
	if (payload.schemaVersion < currentMeta.schemaVersion) {
		return {
			action: "requires-full-update",
			targetRev: payload.bundleRev,
			minShellApi: payload.minShellApi,
			reason: "schema-downgrade",
		};
	}
	const serverRef = payload.components.server[platformKey];
	if (!serverRef) {
		return { action: "unsupported-platform", targetRev: payload.bundleRev };
	}

	const components: BundleComponentKind[] = [];
	if (
		!currentMeta.components.renderer.contentSha256 ||
		currentMeta.components.renderer.contentSha256 !== payload.components.renderer.contentSha256
	) {
		components.push("renderer");
	}
	if (
		!currentMeta.components.server.contentSha256 ||
		currentMeta.components.server.contentSha256 !== serverRef.contentSha256
	) {
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
		typeof ref.contentSha256 === "string" &&
		/^[0-9a-f]{64}$/.test(ref.contentSha256) &&
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
		typeof payload.schemaVersion !== "number" ||
		!Number.isInteger(payload.schemaVersion) ||
		payload.schemaVersion < 0 ||
		typeof payload.workspaceLayoutVersion !== "number" ||
		!Number.isInteger(payload.workspaceLayoutVersion) ||
		payload.workspaceLayoutVersion < 0 ||
		typeof payload.channel !== "string" ||
		payload.channel.length === 0 ||
		typeof payload.edition !== "string" ||
		payload.edition.length === 0 ||
		typeof payload.sourceCommit !== "string" ||
		!/^[0-9a-f]{40}$/.test(payload.sourceCommit) ||
		typeof payload.appBaseline !== "string" ||
		typeof payload.minShellApi !== "number" ||
		!Number.isInteger(payload.minShellApi) ||
		payload.minShellApi <= 0 ||
		(payload.disabled !== undefined && typeof payload.disabled !== "boolean") ||
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
		typeof meta.schemaVersion !== "number" ||
		!Number.isInteger(meta.schemaVersion) ||
		meta.schemaVersion < 0 ||
		typeof meta.workspaceLayoutVersion !== "number" ||
		!Number.isInteger(meta.workspaceLayoutVersion) ||
		meta.workspaceLayoutVersion < 0 ||
		typeof meta.channel !== "string" ||
		meta.channel.length === 0 ||
		typeof meta.edition !== "string" ||
		meta.edition.length === 0 ||
		typeof meta.minShellApi !== "number" ||
		!Number.isInteger(meta.minShellApi) ||
		meta.minShellApi <= 0 ||
		typeof meta.appBaseline !== "string"
	) {
		return false;
	}
	const components = meta.components as Record<string, unknown> | undefined;
	const renderer = components?.renderer as Record<string, unknown> | undefined;
	const server = components?.server as Record<string, unknown> | undefined;
	const validContentHash = (hash: unknown) =>
		typeof hash === "string" && (hash === "" || /^[0-9a-f]{64}$/.test(hash));
	return (
		typeof components === "object" &&
		components !== null &&
		typeof renderer === "object" &&
		renderer !== null &&
		validContentHash(renderer.contentSha256) &&
		typeof server === "object" &&
		server !== null &&
		validContentHash(server.contentSha256)
	);
};

/** Validate a parsed active.json store state. */
export const isValidBundleStoreState = (value: unknown): value is BundleStoreState => {
	if (typeof value !== "object" || value === null) return false;
	const state = value as Record<string, unknown>;
	const rollback = state.rollbackPending as Record<string, unknown> | undefined;
	const validRollback =
		rollback === undefined ||
		(typeof rollback === "object" &&
			rollback !== null &&
			typeof rollback.failedRev === "number" &&
			Number.isInteger(rollback.failedRev) &&
			rollback.failedRev > 0 &&
			typeof rollback.targetRev === "number" &&
			Number.isInteger(rollback.targetRev) &&
			rollback.targetRev >= 0 &&
			typeof rollback.targetSchemaVersion === "number" &&
			Number.isInteger(rollback.targetSchemaVersion) &&
			rollback.targetSchemaVersion >= 0 &&
			typeof rollback.snapshotRev === "number" &&
			Number.isInteger(rollback.snapshotRev) &&
			rollback.snapshotRev > 0 &&
			typeof rollback.restoreSnapshot === "boolean");
	return (
		typeof state.activeRev === "number" &&
		Number.isInteger(state.activeRev) &&
		state.activeRev >= 0 &&
		(state.state === "pending" || state.state === "healthy") &&
		typeof state.bootAttempts === "number" &&
		Number.isInteger(state.bootAttempts) &&
		state.bootAttempts >= 0 &&
		Array.isArray(state.blockedRevs) &&
		state.blockedRevs.every((rev) => typeof rev === "number" && Number.isInteger(rev) && rev > 0) &&
		typeof state.lastKnownGoodRev === "number" &&
		Number.isInteger(state.lastKnownGoodRev) &&
		state.lastKnownGoodRev >= 0 &&
		typeof state.fallbackRev === "number" &&
		Number.isInteger(state.fallbackRev) &&
		state.fallbackRev >= 0 &&
		typeof state.activeSchemaVersion === "number" &&
		Number.isInteger(state.activeSchemaVersion) &&
		state.activeSchemaVersion >= 0 &&
		typeof state.lastKnownGoodSchemaVersion === "number" &&
		Number.isInteger(state.lastKnownGoodSchemaVersion) &&
		state.lastKnownGoodSchemaVersion >= 0 &&
		typeof state.fallbackSchemaVersion === "number" &&
		Number.isInteger(state.fallbackSchemaVersion) &&
		state.fallbackSchemaVersion >= 0 &&
		typeof state.bundleRevFloor === "number" &&
		Number.isInteger(state.bundleRevFloor) &&
		state.bundleRevFloor >= 0 &&
		typeof state.schemaVersionFloor === "number" &&
		Number.isInteger(state.schemaVersionFloor) &&
		state.schemaVersionFloor >= 0 &&
		typeof state.workspaceLayoutVersionFloor === "number" &&
		Number.isInteger(state.workspaceLayoutVersionFloor) &&
		state.workspaceLayoutVersionFloor >= 0 &&
		typeof state.rendererHealthy === "boolean" &&
		typeof state.serverHealthy === "boolean" &&
		typeof state.migrationStarted === "boolean" &&
		typeof state.channelDisabled === "boolean" &&
		typeof state.channelDisabledAtRev === "number" &&
		Number.isInteger(state.channelDisabledAtRev) &&
		state.channelDisabledAtRev >= 0 &&
		typeof state.manifestChannel === "string" &&
		typeof state.manifestEdition === "string" &&
		((state.manifestChannel.length === 0 && state.manifestEdition.length === 0) ||
			(state.manifestChannel.length > 0 && state.manifestEdition.length > 0)) &&
		validRollback
	);
};

/**
 * Parse current state and migrate the pre-schema-version active.json shape. Legacy
 * migration booleans cannot identify the actual schema generation. A legacy pending
 * migration is conservatively normalized above its LKG so rollback still restores a
 * snapshot; the next signed manifest establishes the exact generation.
 */
export const normalizeBundleStoreState = (value: unknown): BundleStoreState | null => {
	if (isValidBundleStoreState(value)) return value;
	if (typeof value !== "object" || value === null) return null;
	const state = value as Record<string, unknown>;
	const isNonNegativeInteger = (candidate: unknown): candidate is number =>
		typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0;
	const modernFields = [
		"lastKnownGoodRev",
		"fallbackRev",
		"activeSchemaVersion",
		"lastKnownGoodSchemaVersion",
		"fallbackSchemaVersion",
		"rollbackPending",
		"channelDisabled",
		"channelDisabledAtRev",
		"bundleRevFloor",
		"schemaVersionFloor",
		"workspaceLayoutVersionFloor",
		"manifestChannel",
		"manifestEdition",
		"migrationStarted",
	] as const;
	const hasModernShape = modernFields.some((field) =>
		Object.prototype.hasOwnProperty.call(state, field),
	);
	if (hasModernShape) {
		for (const field of [
			"channelDisabledAtRev",
			"bundleRevFloor",
			"schemaVersionFloor",
			"workspaceLayoutVersionFloor",
		] as const) {
			if (state[field] !== undefined && !isNonNegativeInteger(state[field])) return null;
		}
		if (
			(state.manifestChannel !== undefined && typeof state.manifestChannel !== "string") ||
			(state.manifestEdition !== undefined && typeof state.manifestEdition !== "string") ||
			(state.manifestChannel === undefined) !== (state.manifestEdition === undefined)
		) {
			return null;
		}
		if (state.migrationStarted !== undefined && typeof state.migrationStarted !== "boolean") {
			return null;
		}
		const blockedRevs = Array.isArray(state.blockedRevs)
			? state.blockedRevs.filter(
					(rev): rev is number => typeof rev === "number" && Number.isInteger(rev) && rev > 0,
				)
			: [];
		const disabledAtRev =
			state.channelDisabledAtRev !== undefined
				? state.channelDisabledAtRev
				: state.channelDisabled === true
					? Math.max(0, ...blockedRevs)
					: 0;
		const durableSchemaVersion =
			state.state === "healthy" ? state.activeSchemaVersion : state.lastKnownGoodSchemaVersion;
		const inferredMigrationStarted =
			state.state === "pending" &&
			isNonNegativeInteger(state.activeSchemaVersion) &&
			isNonNegativeInteger(state.lastKnownGoodSchemaVersion) &&
			state.activeSchemaVersion > state.lastKnownGoodSchemaVersion &&
			((typeof state.bootAttempts === "number" && state.bootAttempts > 0) ||
				state.serverHealthy === true);
		const upgraded = {
			...state,
			channelDisabledAtRev: disabledAtRev,
			bundleRevFloor: state.bundleRevFloor ?? 0,
			schemaVersionFloor: state.schemaVersionFloor ?? durableSchemaVersion,
			workspaceLayoutVersionFloor: state.workspaceLayoutVersionFloor ?? 0,
			manifestChannel: state.manifestChannel ?? "",
			manifestEdition: state.manifestEdition ?? "",
			migrationStarted: state.migrationStarted ?? inferredMigrationStarted,
		};
		return isValidBundleStoreState(upgraded) ? upgraded : null;
	}
	if (
		typeof state.activeRev !== "number" ||
		!Number.isInteger(state.activeRev) ||
		state.activeRev < 0 ||
		(state.state !== "pending" && state.state !== "healthy") ||
		typeof state.bootAttempts !== "number" ||
		!Number.isInteger(state.bootAttempts) ||
		state.bootAttempts < 0 ||
		!Array.isArray(state.blockedRevs) ||
		!state.blockedRevs.every(
			(rev) => typeof rev === "number" && Number.isInteger(rev) && rev > 0,
		) ||
		typeof state.rendererHealthy !== "boolean" ||
		typeof state.serverHealthy !== "boolean" ||
		typeof state.hasMigration !== "boolean" ||
		(state.previousRev !== undefined &&
			(typeof state.previousRev !== "number" ||
				!Number.isInteger(state.previousRev) ||
				state.previousRev < 0))
	) {
		return null;
	}
	const previousRev =
		typeof state.previousRev === "number" && Number.isInteger(state.previousRev)
			? Math.max(0, state.previousRev)
			: 0;
	const activeRev = state.activeRev;
	const healthy = state.state === "healthy";
	const legacySchemaVersion = state.hasMigration === true ? 1 : 0;
	return {
		...initialStoreState,
		activeRev,
		state: state.state,
		bootAttempts: state.bootAttempts,
		blockedRevs: [...new Set(state.blockedRevs as number[])],
		lastKnownGoodRev: healthy ? activeRev : previousRev,
		fallbackRev: healthy ? previousRev : 0,
		activeSchemaVersion: legacySchemaVersion,
		lastKnownGoodSchemaVersion: healthy ? legacySchemaVersion : 0,
		fallbackSchemaVersion: 0,
		bundleRevFloor: 0,
		schemaVersionFloor: healthy ? legacySchemaVersion : 0,
		rendererHealthy: state.rendererHealthy,
		serverHealthy: state.serverHealthy,
		migrationStarted:
			state.hasMigration === true &&
			!healthy &&
			(state.bootAttempts > 0 || state.serverHealthy === true),
	};
};
