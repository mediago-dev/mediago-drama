import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
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
	isValidBundleStoreState,
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
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(tmp, path);
};

export const readStoreState = (userDataDir: string): BundleStoreState => {
	const parsed = readJsonFile(activeJsonPath(userDataDir));
	return isValidBundleStoreState(parsed) ? parsed : { ...initialStoreState };
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
	if (!existsSync(bundleServerBinPath(bundleDir))) return null;
	const meta = readBundleMeta(bundleDir);
	if (!meta || meta.bundleRev !== expectedRev) return null;
	return meta;
};

export interface ResolvedBundle {
	rendererDir: string;
	/** Absolute path of the server binary to spawn. */
	serverBinPath: string;
	source: "builtin" | "downloaded";
	rev: number;
	reason: string;
	/** Set when this resolve blocked a rev (rollback happened). */
	blockedRev?: number;
	/** True when this is the first boot attempt of a pending bundle. */
	firstBootOfPending?: boolean;
}

const fallbackBuiltinMeta: BundleMeta = {
	bundleRev: 0,
	minShellApi: SHELL_API_VERSION,
	appBaseline: "unknown",
	components: { renderer: "", server: "" },
};

export const readBuiltinMeta = (builtinRendererDir: string): BundleMeta =>
	readBundleMeta(builtinRendererDir) ?? fallbackBuiltinMeta;

/**
 * Resolve which bundle to load at startup. Applies health-tracking side effects:
 * counts a boot attempt for pending bundles and blocks bundles that were rejected
 * (incompatible or repeatedly unhealthy), reverting the active pointer.
 *
 * Pass allowPending=false to refuse pending bundles without any side effects — used
 * as a safety net when prerequisites for first boot (e.g. DB snapshot info) are
 * missing.
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
		reason: "builtin bundle",
	};

	let store: BundleStoreState;
	try {
		store = readStoreState(userDataDir);
	} catch {
		return builtin;
	}
	if (store.activeRev <= 0) return builtin;

	const candidateDir = versionDir(userDataDir, store.activeRev);
	const candidateMeta = isBundleUsable(candidateDir, store.activeRev);
	const candidate = candidateMeta ? { rev: store.activeRev, meta: candidateMeta } : null;

	if (options?.allowPending === false && store.state === "pending") {
		return { ...builtin, reason: "pending bundle deferred (prerequisites missing)" };
	}

	const choice = chooseBundle(builtinMeta, candidate, store, SHELL_API_VERSION);

	try {
		if (choice.source === "builtin") {
			if (choice.blockRev !== undefined) {
				writeStoreState(userDataDir, {
					...initialStoreState,
					activeRev: store.previousRev ?? 0,
					blockedRevs: [...new Set([...store.blockedRevs, choice.blockRev])],
				});
				return { ...builtin, reason: choice.reason, blockedRev: choice.blockRev };
			}
			return { ...builtin, reason: choice.reason };
		}

		const firstBootOfPending = choice.countAttempt && store.bootAttempts === 0;
		if (choice.countAttempt) {
			writeStoreState(userDataDir, { ...store, bootAttempts: store.bootAttempts + 1 });
		}
		return {
			rendererDir: candidateDir,
			serverBinPath: bundleServerBinPath(candidateDir),
			source: "downloaded",
			rev: store.activeRev,
			reason: choice.reason,
			firstBootOfPending,
		};
	} catch {
		return builtin;
	}
};

/** Point active.json at a freshly staged bundle; it stays pending until both healthy. */
export const activateVersion = (userDataDir: string, rev: number): void => {
	const store = readStoreState(userDataDir);
	writeStoreState(userDataDir, {
		activeRev: rev,
		state: "pending",
		bootAttempts: 0,
		blockedRevs: store.blockedRevs,
		previousRev: store.activeRev > 0 ? store.activeRev : undefined,
		rendererHealthy: false,
		serverHealthy: false,
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
 * Count one boot/apply attempt against the active pending bundle. Single owner of the
 * bootAttempts invariant for both the launch path (resolveBundleDir) and apply-now.
 */
export const recordBootAttempt = (userDataDir: string): void => {
	const store = readStoreState(userDataDir);
	if (store.activeRev <= 0 || store.state !== "pending") return;
	writeStoreState(userDataDir, { ...store, bootAttempts: store.bootAttempts + 1 });
};

/** Block a rev and revert the active pointer (used by apply-now failure rollback). */
export const blockAndRevert = (userDataDir: string, rev: number, revertToRev: number): void => {
	const store = readStoreState(userDataDir);
	writeStoreState(userDataDir, {
		...initialStoreState,
		activeRev: revertToRev,
		blockedRevs: [...new Set([...store.blockedRevs, rev])],
	});
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

/**
 * Copy the given database files (plus any existing -wal/-shm siblings) into destDir.
 * Missing sources are skipped. Returns the list of original paths actually copied.
 */
export const snapshotDatabases = (dbFiles: string[], destDir: string): string[] => {
	rmSync(destDir, { recursive: true, force: true });
	mkdirSync(destDir, { recursive: true });

	const copied: string[] = [];
	const mapping: Record<string, string> = {};
	let index = 0;
	const copyOne = (sourcePath: string) => {
		if (!existsSync(sourcePath)) return;
		index += 1;
		const entryName = `${index}-${basename(sourcePath)}`;
		copyFileSync(sourcePath, join(destDir, entryName));
		mapping[entryName] = sourcePath;
		copied.push(sourcePath);
	};

	for (const dbFile of dbFiles) {
		copyOne(dbFile);
		for (const suffix of sqliteSiblingSuffixes) {
			copyOne(`${dbFile}${suffix}`);
		}
	}

	writeJsonAtomic(join(destDir, snapshotManifestFilename), mapping);
	return copied;
};

/**
 * Restore a snapshot taken by snapshotDatabases. For each snapshotted file the current
 * file is replaced; stale -wal/-shm siblings of restored databases that were NOT part
 * of the snapshot are removed so SQLite does not replay a mismatched journal.
 */
export const restoreDatabases = (snapshotDir: string): void => {
	const mapping = readJsonFile(join(snapshotDir, snapshotManifestFilename));
	if (typeof mapping !== "object" || mapping === null) return;

	const restoredTargets = new Set<string>();
	for (const [entryName, originalPath] of Object.entries(mapping as Record<string, unknown>)) {
		if (typeof originalPath !== "string") continue;
		const source = join(snapshotDir, entryName);
		if (!existsSync(source)) continue;
		mkdirSync(dirname(originalPath), { recursive: true });
		copyFileSync(source, originalPath);
		restoredTargets.add(originalPath);
	}

	// Remove journal siblings that exist now but were not in the snapshot.
	for (const target of restoredTargets) {
		for (const suffix of sqliteSiblingSuffixes) {
			const sibling = `${target}${suffix}`;
			if (!restoredTargets.has(sibling) && existsSync(sibling)) {
				try {
					rmSync(sibling, { force: true });
				} catch {
					// Best effort.
				}
			}
		}
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
