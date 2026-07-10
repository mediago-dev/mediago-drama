import {
	copyFileSync,
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import { hashBundleFile, hashRendererTree } from "./bundle-content.js";
import {
	SHELL_API_VERSION,
	bundlePlatformKeyFor,
	bundleServerBinaryName,
	type BundleComponentKind,
	type BundleMeta,
} from "./ipc-contract.js";
import {
	applyComponentHealthy,
	chooseBundle,
	initialStoreState,
	isValidBundleMeta,
	normalizeBundleStoreState,
	type BundleRollbackPending,
	type BundleStoreState,
} from "./bundle-policy.js";

// Filesystem side of the application-bundle hot-update loader. Layout under
// <userData>/bundle:
//   active.json                — pointer + dual-component health state (atomic writes)
//   versions/<rev>/            — self-contained bundles:
//        index.html + assets/…      (renderer)
//        bin/mediago-server[.exe]   (server binary for this platform)
//        bundle-meta.json           (identity incl. component sha256s)
//   tmp/                       — download / extraction scratch space
//   db-snapshots/<rev>/        — SQLite snapshots taken before first boot of <rev>
//   runtime-info.json          — cached server runtime facts (db paths, port)

export const bundleMetaFilename = "bundle-meta.json";

export const bundleRootDir = (userDataDir: string) => join(userDataDir, "bundle");
export const versionsDir = (userDataDir: string) => join(bundleRootDir(userDataDir), "versions");
export const versionDir = (userDataDir: string, rev: number) =>
	join(versionsDir(userDataDir), String(rev));
export const tmpDir = (userDataDir: string) => join(bundleRootDir(userDataDir), "tmp");
export const dbSnapshotsDir = (userDataDir: string) =>
	join(bundleRootDir(userDataDir), "db-snapshots");
export const dbSnapshotDir = (userDataDir: string, rev: number) =>
	join(dbSnapshotsDir(userDataDir), String(rev));
export const runtimeInfoPath = (userDataDir: string) =>
	join(bundleRootDir(userDataDir), "runtime-info.json");
const activeJsonPath = (userDataDir: string) => join(bundleRootDir(userDataDir), "active.json");

/** Server binary filename inside a bundle's bin/ dir, per platform. */
export const serverBinaryFilename = (platform: NodeJS.Platform = process.platform) =>
	bundleServerBinaryName(bundlePlatformKeyFor(platform, process.arch));

export const bundleServerBinPath = (bundleDir: string) =>
	join(bundleDir, "bin", serverBinaryFilename());

const readJsonFile = (path: string): unknown => {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
};

const writeJsonAtomic = (path: string, value: unknown): void => {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	const file = openSync(tmp, "w", 0o600);
	try {
		writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
		fsyncSync(file);
	} finally {
		closeSync(file);
	}
	renameSync(tmp, path);
	syncDirectory(dirname(path));
};

const syncFile = (path: string): void => {
	const file = openSync(path, "r");
	try {
		fsyncSync(file);
	} finally {
		closeSync(file);
	}
};

const syncDirectory = (path: string): void => {
	try {
		const directory = openSync(path, "r");
		try {
			fsyncSync(directory);
		} finally {
			closeSync(directory);
		}
	} catch (error) {
		// Windows does not allow opening directory handles through fs.open. File fsync
		// above still guarantees bytes; POSIX must also durably order the rename.
		if (process.platform !== "win32") throw error;
	}
};

export const readStoreState = (userDataDir: string): BundleStoreState => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(activeJsonPath(userDataDir), "utf8"));
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			if (!existsSync(bundleRootDir(userDataDir))) return { ...initialStoreState };
			throw new Error("bundle active.json is missing while bundle safety state exists", {
				cause: error,
			});
		}
		throw new Error("bundle active.json is unreadable or corrupt", { cause: error });
	}
	const normalized = normalizeBundleStoreState(parsed);
	if (!normalized) throw new Error("bundle active.json has an invalid state shape");
	return normalized;
};

export const writeStoreState = (userDataDir: string, state: BundleStoreState): void => {
	writeJsonAtomic(activeJsonPath(userDataDir), state);
};

export const readBundleMeta = (bundleDir: string): BundleMeta | null => {
	const parsed = readJsonFile(join(bundleDir, bundleMetaFilename));
	return isValidBundleMeta(parsed) ? parsed : null;
};

export const writeBundleMeta = (bundleDir: string, meta: BundleMeta): void => {
	writeJsonAtomic(join(bundleDir, bundleMetaFilename), meta);
};

/**
 * A bundle dir is usable when its meta parses and matches the expected rev, the
 * renderer entry exists, and the platform server binary is present.
 */
export const isBundleUsable = (bundleDir: string, expectedRev: number): BundleMeta | null => {
	if (!existsSync(join(bundleDir, "index.html"))) return null;
	const serverBinPath = bundleServerBinPath(bundleDir);
	if (!existsSync(serverBinPath)) return null;
	const meta = readBundleMeta(bundleDir);
	if (!meta || meta.bundleRev !== expectedRev) return null;
	try {
		if (hashRendererTree(bundleDir) !== meta.components.renderer.contentSha256) return null;
		if (hashBundleFile(serverBinPath) !== meta.components.server.contentSha256) return null;
		return meta;
	} catch {
		return null;
	}
};

export interface ResolvedBundle {
	rendererDir: string;
	/** Absolute path of the server binary to spawn. */
	serverBinPath: string;
	source: "builtin" | "downloaded";
	rev: number;
	schemaVersion: number;
	workspaceLayoutVersion: number;
	channel: string;
	edition: string;
	reason: string;
	/** Set when this resolve blocked a rev (rollback happened). */
	blockedRev?: number;
	/** True when this is the first boot attempt of a pending bundle. */
	firstBootOfPending?: boolean;
	/** Durable rollback work that must complete before this bundle may start. */
	rollbackPending?: BundleRollbackPending;
}

const fallbackBuiltinMeta: BundleMeta = {
	bundleRev: 0,
	schemaVersion: 0,
	workspaceLayoutVersion: 0,
	channel: "beta",
	edition: "community",
	minShellApi: SHELL_API_VERSION,
	appBaseline: "unknown",
	components: {
		renderer: { contentSha256: "" },
		server: { contentSha256: "" },
	},
};

export const readBuiltinMeta = (
	builtinRendererDir: string,
	options?: { allowFallback?: boolean },
): BundleMeta => {
	const meta = readBundleMeta(builtinRendererDir);
	if (meta) return meta;
	if (options?.allowFallback) return fallbackBuiltinMeta;
	throw new Error(`builtin bundle metadata is missing or invalid: ${builtinRendererDir}`);
};

/** Reject a full-installer downgrade before resolve/rollback performs any side effect. */
export const assertBuiltinFloors = (userDataDir: string, builtinMeta: BundleMeta): void => {
	const store = readStoreState(userDataDir);
	const sameCohort =
		store.manifestChannel.length === 0 ||
		(store.manifestChannel === builtinMeta.channel &&
			store.manifestEdition === builtinMeta.edition);
	if (sameCohort && builtinMeta.bundleRev < store.bundleRevFloor) {
		throw new Error(
			`builtin rev ${builtinMeta.bundleRev} is below previously installed rev ${store.bundleRevFloor}`,
		);
	}
	if (builtinMeta.workspaceLayoutVersion < store.workspaceLayoutVersionFloor) {
		throw new Error(
			`builtin workspace layout ${builtinMeta.workspaceLayoutVersion} is below persisted floor ${store.workspaceLayoutVersionFloor}`,
		);
	}
};

/**
 * Persist monotonic floors for the user-data lineage. This runs even when network hot
 * updates are disabled, so manually installing an older full bundle cannot make an
 * older schema/layout open data already advanced by a newer install.
 */
export const recordBundleFloors = (
	userDataDir: string,
	builtinMeta: BundleMeta,
	resolved: ResolvedBundle,
): void => {
	const existing = readStoreState(userDataDir);
	const cohortChanged =
		existing.manifestChannel.length > 0 &&
		(existing.manifestChannel !== builtinMeta.channel ||
			existing.manifestEdition !== builtinMeta.edition);
	const store: BundleStoreState = cohortChanged
		? {
				...initialStoreState,
				activeSchemaVersion: resolved.schemaVersion,
				lastKnownGoodSchemaVersion: resolved.schemaVersion,
				bundleRevFloor: builtinMeta.bundleRev,
				schemaVersionFloor: existing.schemaVersionFloor,
				workspaceLayoutVersionFloor: existing.workspaceLayoutVersionFloor,
				manifestChannel: builtinMeta.channel,
				manifestEdition: builtinMeta.edition,
			}
		: existing;
	if (resolved.schemaVersion < store.schemaVersionFloor) {
		throw new Error(
			`resolved schema ${resolved.schemaVersion} is below persisted floor ${store.schemaVersionFloor}`,
		);
	}
	if (resolved.workspaceLayoutVersion < store.workspaceLayoutVersionFloor) {
		throw new Error(
			`resolved workspace layout ${resolved.workspaceLayoutVersion} is below persisted floor ${store.workspaceLayoutVersionFloor}`,
		);
	}
	const durableSchemaVersion =
		resolved.source === "builtin" || store.state === "healthy"
			? resolved.schemaVersion
			: store.lastKnownGoodSchemaVersion;
	writeStoreState(userDataDir, {
		...store,
		activeSchemaVersion: store.activeRev <= 0 ? resolved.schemaVersion : store.activeSchemaVersion,
		lastKnownGoodSchemaVersion:
			store.activeRev <= 0 ? resolved.schemaVersion : store.lastKnownGoodSchemaVersion,
		bundleRevFloor: cohortChanged
			? builtinMeta.bundleRev
			: Math.max(store.bundleRevFloor, builtinMeta.bundleRev),
		schemaVersionFloor: Math.max(store.schemaVersionFloor, durableSchemaVersion),
		workspaceLayoutVersionFloor: Math.max(
			store.workspaceLayoutVersionFloor,
			resolved.workspaceLayoutVersion,
		),
		manifestChannel: builtinMeta.channel,
		manifestEdition: builtinMeta.edition,
	});
};

const downloadedResolved = (
	userDataDir: string,
	rev: number,
	meta: BundleMeta,
	reason: string,
): ResolvedBundle => {
	const rendererDir = versionDir(userDataDir, rev);
	return {
		rendererDir,
		serverBinPath: bundleServerBinPath(rendererDir),
		source: "downloaded",
		rev,
		schemaVersion: meta.schemaVersion,
		workspaceLayoutVersion: meta.workspaceLayoutVersion,
		channel: meta.channel,
		edition: meta.edition,
		reason,
	};
};

const resolveStoredRevision = (
	userDataDir: string,
	builtin: ResolvedBundle,
	builtinMeta: BundleMeta,
	rev: number,
	excludeRev?: number,
): ResolvedBundle | null => {
	if (rev <= 0 || rev === excludeRev) return null;
	const meta = isBundleUsable(versionDir(userDataDir, rev), rev);
	if (
		!meta ||
		meta.minShellApi > SHELL_API_VERSION ||
		meta.channel !== builtinMeta.channel ||
		meta.edition !== builtinMeta.edition ||
		meta.workspaceLayoutVersion !== builtinMeta.workspaceLayoutVersion
	) {
		return null;
	}
	if (rev <= builtin.rev && meta.schemaVersion <= builtin.schemaVersion) return null;
	return downloadedResolved(userDataDir, rev, meta, `known-good rev ${rev}`);
};

const resolveKnownGood = (
	userDataDir: string,
	builtin: ResolvedBundle,
	builtinMeta: BundleMeta,
	store: BundleStoreState,
	excludeRev?: number,
): ResolvedBundle =>
	resolveStoredRevision(userDataDir, builtin, builtinMeta, store.lastKnownGoodRev, excludeRev) ??
	resolveStoredRevision(userDataDir, builtin, builtinMeta, store.fallbackRev, excludeRev) ??
	builtin;

const builtinNormalizedState = (
	store: BundleStoreState,
	builtin: ResolvedBundle,
): BundleStoreState => {
	const sameManifestCohort =
		store.manifestChannel.length === 0 ||
		(store.manifestChannel === builtin.channel && store.manifestEdition === builtin.edition);
	return {
		...initialStoreState,
		blockedRevs: sameManifestCohort ? store.blockedRevs : [],
		activeSchemaVersion: builtin.schemaVersion,
		lastKnownGoodSchemaVersion: builtin.schemaVersion,
		bundleRevFloor: sameManifestCohort ? store.bundleRevFloor : builtin.rev,
		schemaVersionFloor: store.schemaVersionFloor,
		workspaceLayoutVersionFloor: store.workspaceLayoutVersionFloor,
		channelDisabled: sameManifestCohort ? store.channelDisabled : false,
		channelDisabledAtRev: sameManifestCohort ? store.channelDisabledAtRev : 0,
		manifestChannel: builtin.channel,
		manifestEdition: builtin.edition,
	};
};

const rollbackFor = (
	failedRev: number,
	failedSchemaVersion: number,
	target: ResolvedBundle,
	hasRun: boolean,
): BundleRollbackPending => ({
	failedRev,
	targetRev: target.source === "downloaded" ? target.rev : 0,
	targetSchemaVersion: target.schemaVersion,
	snapshotRev: failedRev,
	restoreSnapshot: hasRun && failedSchemaVersion > target.schemaVersion,
});

/**
 * Resolve which bundle to load at startup without consuming a boot attempt. The
 * caller must first complete any returned rollback, take any required snapshot, and
 * only then call recordBootAttempt. This ordering prevents an unsafe bundle from
 * launching when recovery prerequisites fail.
 */
export const resolveBundleDir = (
	userDataDir: string,
	builtinRendererDir: string,
	builtinServerBinPath: string,
	options?: { allowPending?: boolean },
): ResolvedBundle => {
	const builtinMeta = readBuiltinMeta(builtinRendererDir);
	const builtin: ResolvedBundle = {
		rendererDir: builtinRendererDir,
		serverBinPath: builtinServerBinPath,
		source: "builtin",
		rev: builtinMeta.bundleRev,
		schemaVersion: builtinMeta.schemaVersion,
		workspaceLayoutVersion: builtinMeta.workspaceLayoutVersion,
		channel: builtinMeta.channel,
		edition: builtinMeta.edition,
		reason: "builtin bundle",
	};

	const store = readStoreState(userDataDir);
	if (
		store.channelDisabled &&
		store.manifestChannel.length > 0 &&
		(store.manifestChannel !== builtin.channel || store.manifestEdition !== builtin.edition)
	) {
		if (
			builtin.schemaVersion < store.activeSchemaVersion ||
			builtin.schemaVersion < store.schemaVersionFloor
		) {
			throw new Error(
				`new cohort schema ${builtin.schemaVersion} is below persisted schema ${Math.max(store.activeSchemaVersion, store.schemaVersionFloor)}`,
			);
		}
		writeStoreState(userDataDir, builtinNormalizedState(store, builtin));
		return resolveBundleDir(userDataDir, builtinRendererDir, builtinServerBinPath, options);
	}
	if (store.rollbackPending) {
		const pending = store.rollbackPending;
		const requestedTarget = resolveStoredRevision(
			userDataDir,
			builtin,
			builtinMeta,
			pending.targetRev,
			pending.failedRev,
		);
		const target =
			requestedTarget ??
			resolveKnownGood(userDataDir, builtin, builtinMeta, store, pending.failedRev);
		if (target.schemaVersion < pending.targetSchemaVersion) {
			throw new Error(
				`rollback target schema ${target.schemaVersion} is older than the snapshot schema ${pending.targetSchemaVersion}`,
			);
		}
		const normalizedPending = {
			...pending,
			targetRev: target.source === "downloaded" ? target.rev : 0,
			targetSchemaVersion: target.schemaVersion,
		};
		if (JSON.stringify(normalizedPending) !== JSON.stringify(pending)) {
			writeStoreState(userDataDir, { ...store, rollbackPending: normalizedPending });
		}
		return {
			...target,
			reason: `rollback pending for rev ${pending.failedRev}`,
			blockedRev: pending.failedRev,
			rollbackPending: normalizedPending,
		};
	}

	if (store.activeRev <= 0) return builtin;

	const candidateDir = versionDir(userDataDir, store.activeRev);
	const candidateMeta = isBundleUsable(candidateDir, store.activeRev);
	const candidate = candidateMeta ? { rev: store.activeRev, meta: candidateMeta } : null;
	if (store.channelDisabled) {
		if (candidate && !store.blockedRevs.includes(candidate.rev)) {
			const compatibleWithShell =
				candidate.meta.minShellApi <= SHELL_API_VERSION &&
				candidate.meta.channel === builtinMeta.channel &&
				candidate.meta.edition === builtinMeta.edition &&
				candidate.meta.workspaceLayoutVersion === builtinMeta.workspaceLayoutVersion;
			const builtinSupersedes = candidate.rev <= builtin.rev || !compatibleWithShell;
			if (builtinSupersedes) {
				if (builtin.schemaVersion < store.activeSchemaVersion) {
					throw new Error(
						`builtin schema ${builtin.schemaVersion} cannot safely supersede disabled rev ${candidate.rev} schema ${store.activeSchemaVersion}`,
					);
				}
				writeStoreState(userDataDir, builtinNormalizedState(store, builtin));
				return { ...builtin, reason: "full installer superseded disabled fallback" };
			}
			return downloadedResolved(
				userDataDir,
				candidate.rev,
				candidate.meta,
				"cached channel kill switch; running fallback revision",
			);
		}
		const target = resolveKnownGood(userDataDir, builtin, builtinMeta, store, store.activeRev);
		if (
			(store.state === "healthy" || store.serverHealthy || store.migrationStarted) &&
			store.activeSchemaVersion > target.schemaVersion
		) {
			throw new Error(
				`rev ${store.activeRev} is disabled, but automatic rollback would regress schema ${store.activeSchemaVersion} to ${target.schemaVersion}; install a full update with a compatible schema`,
			);
		}
		if (
			target.source === "builtin" &&
			(store.state === "healthy" || store.serverHealthy || store.migrationStarted)
		) {
			writeStoreState(userDataDir, builtinNormalizedState(store, builtin));
		}
		return { ...target, reason: "cached channel kill switch" };
	}

	if (options?.allowPending === false && store.state === "pending") {
		return {
			...resolveKnownGood(userDataDir, builtin, builtinMeta, store, store.activeRev),
			reason: "pending bundle deferred (prerequisites missing)",
		};
	}

	const choice = chooseBundle(builtinMeta, candidate, store, SHELL_API_VERSION);

	if (choice.source === "builtin") {
		if (choice.blockRev !== undefined || !candidate) {
			const failedRev = choice.blockRev ?? store.activeRev;
			const target = resolveKnownGood(userDataDir, builtin, builtinMeta, store, failedRev);
			if (
				(store.state === "healthy" || store.serverHealthy || store.migrationStarted) &&
				store.activeSchemaVersion > target.schemaVersion
			) {
				throw new Error(
					`rev ${failedRev} is unusable, but automatic rollback would discard data by regressing schema ${store.activeSchemaVersion} to ${target.schemaVersion}`,
				);
			}
			const hasRun = store.state === "healthy" || store.bootAttempts > 0 || store.serverHealthy;
			const rollbackPending = rollbackFor(failedRev, store.activeSchemaVersion, target, hasRun);
			// This write is a safety boundary: propagate failure so startup stops rather
			// than launching an older binary against a possibly forward-migrated schema.
			markRollbackPending(userDataDir, rollbackPending);
			return {
				...target,
				reason: choice.reason,
				blockedRev: failedRev,
				rollbackPending,
			};
		}
		// A full installer superseded the downloaded pointer. Normalize the store so
		// a later check/apply cannot reinterpret the old rev as staged downgrade.
		writeStoreState(userDataDir, builtinNormalizedState(store, builtin));
		return { ...builtin, reason: choice.reason };
	}

	const firstBootOfPending = choice.countAttempt && store.bootAttempts === 0;
	return {
		...downloadedResolved(userDataDir, store.activeRev, candidateMeta!, choice.reason),
		firstBootOfPending,
	};
};

export interface ActivateVersionOptions {
	rev: number;
	schemaVersion: number;
	lastKnownGoodRev: number;
	lastKnownGoodSchemaVersion: number;
}

/** Point active.json at a freshly staged bundle; it stays pending until both healthy. */
export const activateVersion = (userDataDir: string, options: ActivateVersionOptions): void => {
	const store = readStoreState(userDataDir);
	if (store.rollbackPending) {
		throw new Error(
			`cannot activate rev ${options.rev} while rollback for rev ${store.rollbackPending.failedRev} is pending`,
		);
	}
	if (store.state === "pending" && store.activeRev !== options.rev) {
		throw new Error(
			`cannot activate rev ${options.rev} while rev ${store.activeRev} is still pending`,
		);
	}
	if (store.blockedRevs.includes(options.rev)) {
		throw new Error(`cannot activate blocked rev ${options.rev}`);
	}
	if (options.schemaVersion < options.lastKnownGoodSchemaVersion) {
		throw new Error(
			`cannot activate schema ${options.schemaVersion} over ${options.lastKnownGoodSchemaVersion}`,
		);
	}
	if (store.state === "pending" && store.activeRev === options.rev) return;
	writeStoreState(userDataDir, {
		...store,
		activeRev: options.rev,
		state: "pending",
		bootAttempts: 0,
		lastKnownGoodRev: options.lastKnownGoodRev,
		activeSchemaVersion: options.schemaVersion,
		lastKnownGoodSchemaVersion: options.lastKnownGoodSchemaVersion,
		rendererHealthy: false,
		serverHealthy: false,
		migrationStarted: false,
		rollbackPending: undefined,
	});
};

/**
 * Record one component's health signal (renderer beacon / server /health probe).
 * forRev binds the signal to the bundle revision that produced it: if a newer rev was
 * staged in the meantime (activeRev moved on), the signal is dropped instead of
 * crediting a bundle that never ran.
 */
export const markComponentHealthy = (
	userDataDir: string,
	component: BundleComponentKind,
	forRev?: number,
): void => {
	const store = readStoreState(userDataDir);
	if (store.activeRev <= 0) return;
	if (forRev !== undefined && forRev !== store.activeRev) return;
	const next = applyComponentHealthy(store, component);
	if (next === store) return;
	writeStoreState(userDataDir, next);
};

/**
 * Count one boot/apply attempt against the active pending bundle. Used by apply-now; the
 * launch path increments equivalently inside resolveBundleDir (which already holds the
 * resolved store), guarded by the same pending precondition, so each boot/apply counts
 * exactly once across the two entry points.
 */
export const recordBootAttempt = (userDataDir: string, rev: number): void => {
	const store = readStoreState(userDataDir);
	if (store.activeRev !== rev || store.state !== "pending") return;
	writeStoreState(userDataDir, { ...store, bootAttempts: store.bootAttempts + 1 });
};

/**
 * Persist the point after which a forward-schema child may have started migrations,
 * watchers, or workers. From this point the pre-start snapshot is archival only and
 * must never be restored automatically.
 */
export const markMigrationStarted = (userDataDir: string, rev: number): void => {
	const store = readStoreState(userDataDir);
	if (
		store.activeRev !== rev ||
		store.state !== "pending" ||
		store.activeSchemaVersion <= store.lastKnownGoodSchemaVersion ||
		store.migrationStarted
	) {
		return;
	}
	writeStoreState(userDataDir, { ...store, migrationStarted: true });
};

/** Persist recovery intent before restoring data or changing the active pointer. */
export const markRollbackPending = (
	userDataDir: string,
	rollbackPending: BundleRollbackPending,
): void => {
	const store = readStoreState(userDataDir);
	const sameRollback = (left: BundleRollbackPending, right: BundleRollbackPending) =>
		left.failedRev === right.failedRev &&
		left.targetRev === right.targetRev &&
		left.targetSchemaVersion === right.targetSchemaVersion &&
		left.snapshotRev === right.snapshotRev &&
		left.restoreSnapshot === right.restoreSnapshot;
	if (store.rollbackPending && !sameRollback(store.rollbackPending, rollbackPending)) {
		throw new Error(`rollback for rev ${store.rollbackPending.failedRev} is already pending`);
	}
	writeStoreState(userDataDir, { ...store, rollbackPending });
};

/**
 * Finish a durable rollback after any required snapshot restore succeeds. The failed
 * revision is blocked and the pointer is moved to the marker's known-good target.
 */
export const completeRollback = (userDataDir: string, failedRev: number): void => {
	const store = readStoreState(userDataDir);
	const pending = store.rollbackPending;
	if (!pending || pending.failedRev !== failedRev) {
		throw new Error(`no rollback pending for rev ${failedRev}`);
	}
	const revokedKnownGood = store.lastKnownGoodRev === failedRev;
	writeStoreState(userDataDir, {
		...store,
		activeRev: pending.targetRev,
		activeSchemaVersion: pending.targetSchemaVersion,
		state: "healthy",
		bootAttempts: 0,
		blockedRevs: [...new Set([...store.blockedRevs, failedRev])],
		lastKnownGoodRev: pending.targetRev,
		lastKnownGoodSchemaVersion: pending.targetSchemaVersion,
		fallbackRev: revokedKnownGood ? 0 : store.fallbackRev,
		fallbackSchemaVersion: revokedKnownGood ? 0 : store.fallbackSchemaVersion,
		rendererHealthy: pending.targetRev > 0,
		serverHealthy: pending.targetRev > 0,
		migrationStarted: false,
		rollbackPending: undefined,
	});
};

/** Cache a signed kill switch and revert a revoked active/known-good revision. */
export const disableChannelAndRevert = (
	userDataDir: string,
	revokedRev: number,
	disabledAtRev = revokedRev,
	channel = "",
	edition = "",
): "disabled" | "rollback-pending" | "requires-full-update" | "stale-manifest" => {
	const existing = readStoreState(userDataDir);
	const hasCohort = channel.length > 0 && edition.length > 0;
	const cohortChanged =
		hasCohort &&
		existing.manifestChannel.length > 0 &&
		(existing.manifestChannel !== channel || existing.manifestEdition !== edition);
	const store: BundleStoreState = {
		...existing,
		channelDisabled: cohortChanged ? false : existing.channelDisabled,
		channelDisabledAtRev: cohortChanged ? 0 : existing.channelDisabledAtRev,
		manifestChannel: hasCohort ? channel : existing.manifestChannel,
		manifestEdition: hasCohort ? edition : existing.manifestEdition,
	};
	if (
		disabledAtRev < store.channelDisabledAtRev ||
		(disabledAtRev === store.channelDisabledAtRev && !store.channelDisabled)
	) {
		return "stale-manifest";
	}
	const channelDisabledAtRev = Math.max(store.channelDisabledAtRev, disabledAtRev);
	if (
		revokedRev <= 0 ||
		(store.activeRev !== revokedRev && store.lastKnownGoodRev !== revokedRev)
	) {
		writeStoreState(userDataDir, { ...store, channelDisabled: true, channelDisabledAtRev });
		return "disabled";
	}
	const revokedKnownGood = store.lastKnownGoodRev === revokedRev;
	const targetRev = revokedKnownGood ? store.fallbackRev : store.lastKnownGoodRev;
	const targetSchemaVersion = revokedKnownGood
		? store.fallbackSchemaVersion
		: store.lastKnownGoodSchemaVersion;
	const hasRun =
		store.state === "healthy" ||
		store.bootAttempts > 0 ||
		store.serverHealthy ||
		store.migrationStarted;
	if (
		(store.state === "healthy" || store.serverHealthy || store.migrationStarted) &&
		store.activeSchemaVersion > targetSchemaVersion
	) {
		// A snapshot belongs to the pre-activation point. Restoring it after a healthy
		// revision has carried real writes would silently delete user data. Quarantine the
		// binary and fail closed on the next launch until a schema-compatible full update.
		writeStoreState(userDataDir, {
			...store,
			blockedRevs: [...new Set([...store.blockedRevs, revokedRev])],
			rollbackPending: undefined,
			channelDisabled: true,
			channelDisabledAtRev,
		});
		return "requires-full-update";
	}
	const rollbackPending =
		store.rollbackPending ??
		({
			failedRev: revokedRev,
			targetRev,
			targetSchemaVersion,
			snapshotRev: revokedRev,
			restoreSnapshot: hasRun && store.activeSchemaVersion > targetSchemaVersion,
		} satisfies BundleRollbackPending);
	writeStoreState(userDataDir, {
		...store,
		activeRev: targetRev,
		activeSchemaVersion: targetSchemaVersion,
		state: "healthy",
		bootAttempts: 0,
		blockedRevs: [...new Set([...store.blockedRevs, revokedRev])],
		lastKnownGoodRev: targetRev,
		lastKnownGoodSchemaVersion: targetSchemaVersion,
		fallbackRev: revokedKnownGood ? 0 : store.fallbackRev,
		fallbackSchemaVersion: revokedKnownGood ? 0 : store.fallbackSchemaVersion,
		rendererHealthy: targetRev > 0,
		serverHealthy: targetRev > 0,
		rollbackPending,
		channelDisabled: true,
		channelDisabledAtRev,
	});
	return "rollback-pending";
};

/** Clear a cached kill switch after a valid enabled manifest for this cohort is verified. */
export const setChannelEnabled = (
	userDataDir: string,
	manifestRev: number,
	channel = "",
	edition = "",
): boolean => {
	const existing = readStoreState(userDataDir);
	const hasCohort = channel.length > 0 && edition.length > 0;
	const cohortChanged =
		hasCohort &&
		existing.manifestChannel.length > 0 &&
		(existing.manifestChannel !== channel || existing.manifestEdition !== edition);
	const store: BundleStoreState = {
		...existing,
		channelDisabled: cohortChanged ? false : existing.channelDisabled,
		channelDisabledAtRev: cohortChanged ? 0 : existing.channelDisabledAtRev,
		manifestChannel: hasCohort ? channel : existing.manifestChannel,
		manifestEdition: hasCohort ? edition : existing.manifestEdition,
	};
	if (manifestRev < store.channelDisabledAtRev) return false;
	if (manifestRev === store.channelDisabledAtRev) return !store.channelDisabled;
	writeStoreState(userDataDir, {
		...store,
		channelDisabled: false,
		channelDisabledAtRev: manifestRev,
	});
	return true;
};

/** @deprecated Use markRollbackPending + completeRollback around the restore operation. */
export const blockAndRevert = (userDataDir: string, rev: number, revertToRev: number): void => {
	const store = readStoreState(userDataDir);
	const targetSchemaVersion =
		revertToRev === store.lastKnownGoodRev
			? store.lastKnownGoodSchemaVersion
			: revertToRev === store.fallbackRev
				? store.fallbackSchemaVersion
				: 0;
	markRollbackPending(userDataDir, {
		failedRev: rev,
		targetRev: revertToRev,
		targetSchemaVersion,
		snapshotRev: rev,
		restoreSnapshot: false,
	});
	completeRollback(userDataDir, rev);
};

/** Remove version directories other than the ones we still need (active + previous). */
export const cleanupVersions = (userDataDir: string, keepRevs: number[]): void => {
	const keep = new Set(keepRevs.map(String));
	pruneDirExcept(versionsDir(userDataDir), keep);
	pruneDirExcept(dbSnapshotsDir(userDataDir), keep);
	try {
		rmSync(tmpDir(userDataDir), { recursive: true, force: true });
	} catch {
		// Best effort.
	}
};

const pruneDirExcept = (dir: string, keep: Set<string>): void => {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		if (keep.has(entry)) continue;
		try {
			rmSync(join(dir, entry), { recursive: true, force: true });
		} catch {
			// Best effort — a locked file must not break startup or activation.
		}
	}
};

// --- SQLite snapshot / restore -------------------------------------------------------
//
// Taken in the window where no server process runs (old stopped / new not yet spawned),
// so WAL files are quiescent. The snapshot dir carries a manifest mapping copied file
// names back to their original absolute paths so restore needs no external knowledge.

const snapshotManifestFilename = "snapshot-manifest.json";
const sqliteSiblingSuffixes = ["-wal", "-shm"];

interface SnapshotFileEntry {
	entryName: string;
	sha256: string;
}

interface SnapshotDatabaseEntry {
	originalPath: string;
	base: SnapshotFileEntry;
	wal?: SnapshotFileEntry;
	shm?: SnapshotFileEntry;
}

interface SnapshotManifest {
	version: 1;
	databases: SnapshotDatabaseEntry[];
}

const snapshotEntryIsValid = (value: unknown): value is SnapshotFileEntry => {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.entryName === "string" &&
		entry.entryName.length > 0 &&
		basename(entry.entryName) === entry.entryName &&
		typeof entry.sha256 === "string" &&
		/^[0-9a-f]{64}$/.test(entry.sha256)
	);
};

const readSnapshotManifest = (snapshotDir: string): SnapshotManifest => {
	const value = readJsonFile(join(snapshotDir, snapshotManifestFilename));
	if (typeof value !== "object" || value === null) {
		throw new Error(`snapshot manifest is missing or invalid: ${snapshotDir}`);
	}
	const manifest = value as Record<string, unknown>;
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.databases) ||
		manifest.databases.length === 0
	) {
		throw new Error(`snapshot manifest has an unsupported shape: ${snapshotDir}`);
	}
	const databases: SnapshotDatabaseEntry[] = [];
	const originalPaths = new Set<string>();
	const entryNames = new Set<string>();
	for (const valueEntry of manifest.databases) {
		if (typeof valueEntry !== "object" || valueEntry === null) {
			throw new Error(`snapshot manifest contains an invalid database entry: ${snapshotDir}`);
		}
		const entry = valueEntry as Record<string, unknown>;
		if (
			typeof entry.originalPath !== "string" ||
			!isAbsolute(entry.originalPath) ||
			originalPaths.has(entry.originalPath) ||
			!snapshotEntryIsValid(entry.base) ||
			(entry.wal !== undefined && !snapshotEntryIsValid(entry.wal)) ||
			(entry.shm !== undefined && !snapshotEntryIsValid(entry.shm))
		) {
			throw new Error(`snapshot manifest contains an invalid database entry: ${snapshotDir}`);
		}
		const snapshotEntries = [
			entry.base as SnapshotFileEntry,
			...(entry.wal ? [entry.wal as SnapshotFileEntry] : []),
			...(entry.shm ? [entry.shm as SnapshotFileEntry] : []),
		];
		if (snapshotEntries.some((snapshotEntry) => entryNames.has(snapshotEntry.entryName))) {
			throw new Error(`snapshot manifest reuses a file entry: ${snapshotDir}`);
		}
		for (const snapshotEntry of snapshotEntries) entryNames.add(snapshotEntry.entryName);
		originalPaths.add(entry.originalPath);
		databases.push(entry as unknown as SnapshotDatabaseEntry);
	}
	return { version: 1, databases };
};

const validateSnapshotFiles = (snapshotDir: string, manifest: SnapshotManifest): void => {
	for (const database of manifest.databases) {
		for (const entry of [database.base, database.wal, database.shm]) {
			if (!entry) continue;
			const path = join(snapshotDir, entry.entryName);
			if (!existsSync(path) || hashBundleFile(path) !== entry.sha256) {
				throw new Error(`snapshot file is missing or corrupt: ${entry.entryName}`);
			}
		}
	}
};

/**
 * Copy the given database files (plus any existing -wal/-shm siblings) into a complete
 * temporary snapshot and atomically rename it into place. Every base DB is required;
 * a missing source aborts without replacing an earlier valid snapshot.
 */
export const snapshotDatabases = (dbFiles: string[], destDir: string): string[] => {
	const uniqueDbFiles = [...new Set(dbFiles)];
	if (uniqueDbFiles.length === 0) throw new Error("cannot snapshot an empty database list");
	for (const dbFile of uniqueDbFiles) {
		if (!isAbsolute(dbFile)) throw new Error(`database path is not absolute: ${dbFile}`);
		if (!existsSync(dbFile)) throw new Error(`database file is missing: ${dbFile}`);
	}
	if (existsSync(destDir)) {
		const existing = readSnapshotManifest(destDir);
		validateSnapshotFiles(destDir, existing);
		const existingPaths = new Set(existing.databases.map((database) => database.originalPath));
		if (
			existingPaths.size !== uniqueDbFiles.length ||
			uniqueDbFiles.some((dbFile) => !existingPaths.has(dbFile))
		) {
			throw new Error("existing snapshot database set does not match requested sources");
		}
		return existing.databases.flatMap((database) => [
			database.originalPath,
			...(database.wal ? [`${database.originalPath}-wal`] : []),
			...(database.shm ? [`${database.originalPath}-shm`] : []),
		]);
	}

	const stagingDir = `${destDir}.tmp-${randomUUID()}`;
	mkdirSync(stagingDir, { recursive: true });
	const copied: string[] = [];
	const databases: SnapshotDatabaseEntry[] = [];
	const copyOne = (sourcePath: string, entryName: string): SnapshotFileEntry => {
		const destination = join(stagingDir, entryName);
		copyFileSync(sourcePath, destination);
		syncFile(destination);
		copied.push(sourcePath);
		return { entryName, sha256: hashBundleFile(destination) };
	};

	try {
		for (const [index, dbFile] of uniqueDbFiles.entries()) {
			const prefix = `${index + 1}-${basename(dbFile)}`;
			const database: SnapshotDatabaseEntry = {
				originalPath: dbFile,
				base: copyOne(dbFile, `${prefix}.db-image`),
			};
			if (existsSync(`${dbFile}-wal`)) {
				database.wal = copyOne(`${dbFile}-wal`, `${prefix}.wal-image`);
			}
			if (existsSync(`${dbFile}-shm`)) {
				database.shm = copyOne(`${dbFile}-shm`, `${prefix}.shm-image`);
			}
			databases.push(database);
		}
		writeJsonAtomic(join(stagingDir, snapshotManifestFilename), {
			version: 1,
			databases,
		} satisfies SnapshotManifest);
		// Validate everything before replacing a previous snapshot.
		readSnapshotManifest(stagingDir);
		renameSync(stagingDir, destDir);
		syncDirectory(dirname(destDir));
		return copied;
	} catch (error) {
		rmSync(stagingDir, { recursive: true, force: true });
		throw error;
	}
};

/**
 * Restore a snapshot taken by snapshotDatabases. Restore is only invoked when no server
 * process runs (SQLite quiescent), so there is no concurrent writer. To stay crash-safe
 * even so, the live -wal/-shm journals of every restored database are removed BEFORE the
 * database file is overwritten: an interrupted restore can then never leave a fresh db
 * beside a stale journal that SQLite would replay onto a mismatched image. The snapshot's
 * own -wal/-shm (if any) are copied after the db, so the restored set is self-consistent.
 */
export const restoreDatabases = (snapshotDir: string): void => {
	const manifest = readSnapshotManifest(snapshotDir);
	validateSnapshotFiles(snapshotDir, manifest);
	const stagedFiles: Array<{ temporaryPath: string; destinationPath: string }> = [];
	const stageRestoreFile = (entry: SnapshotFileEntry, destinationPath: string): void => {
		const source = join(snapshotDir, entry.entryName);
		mkdirSync(dirname(destinationPath), { recursive: true });
		const temporaryPath = `${destinationPath}.restore-${randomUUID()}`;
		copyFileSync(source, temporaryPath);
		syncFile(temporaryPath);
		if (hashBundleFile(temporaryPath) !== entry.sha256) {
			rmSync(temporaryPath, { force: true });
			throw new Error(`staged restore file failed verification: ${entry.entryName}`);
		}
		stagedFiles.push({ temporaryPath, destinationPath });
	};

	try {
		// Preflight and stage every snapshot file before mutating live databases.
		for (const database of manifest.databases) {
			stageRestoreFile(database.base, database.originalPath);
			if (database.wal) stageRestoreFile(database.wal, `${database.originalPath}-wal`);
			if (database.shm) stageRestoreFile(database.shm, `${database.originalPath}-shm`);
		}

		// Drop live journals first. Any failure aborts before a base database is swapped.
		for (const database of manifest.databases) {
			for (const suffix of sqliteSiblingSuffixes) {
				try {
					rmSync(`${database.originalPath}${suffix}`, { force: true });
				} catch (error) {
					throw new Error(
						`failed to remove SQLite journal ${database.originalPath}${suffix}: ${String(error)}`,
					);
				}
			}
		}

		const isJournal = (path: string) =>
			sqliteSiblingSuffixes.some((suffix) => path.endsWith(suffix));
		stagedFiles.sort(
			(a, b) => Number(isJournal(a.destinationPath)) - Number(isJournal(b.destinationPath)),
		);
		for (const staged of stagedFiles) {
			renameSync(staged.temporaryPath, staged.destinationPath);
		}
		for (const directory of new Set(stagedFiles.map((staged) => dirname(staged.destinationPath)))) {
			syncDirectory(directory);
		}
	} catch (error) {
		for (const staged of stagedFiles) {
			try {
				rmSync(staged.temporaryPath, { force: true });
			} catch {
				// The durable rollback marker makes a later retry safe.
			}
		}
		throw error;
	}
};

export interface BundleRuntimeInfo {
	serverBaseUrl: string;
	databaseFiles: string[];
	updatedAt: string;
}

export const readRuntimeInfo = (userDataDir: string): BundleRuntimeInfo | null => {
	const parsed = readJsonFile(runtimeInfoPath(userDataDir));
	if (typeof parsed !== "object" || parsed === null) return null;
	const info = parsed as Record<string, unknown>;
	if (
		typeof info.serverBaseUrl !== "string" ||
		!Array.isArray(info.databaseFiles) ||
		!info.databaseFiles.every((item) => typeof item === "string") ||
		typeof info.updatedAt !== "string"
	) {
		return null;
	}
	return parsed as unknown as BundleRuntimeInfo;
};

export const writeRuntimeInfo = (userDataDir: string, info: BundleRuntimeInfo): void => {
	writeJsonAtomic(runtimeInfoPath(userDataDir), info);
};
