import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { SHELL_API_VERSION, type RendererMeta } from "./ipc-contract.js";
import {
	chooseRenderer,
	initialStoreState,
	isValidRendererMeta,
	isValidStoreState,
	type RendererStoreState,
} from "./renderer-policy.js";

// Filesystem side of the renderer hot-update loader. Layout under <userData>/renderer:
//   active.json          — pointer + health state (atomic writes)
//   versions/<rev>/      — extracted renderer bundles (index.html + assets + renderer-meta.json)
//   tmp/                 — download / extraction scratch space

export const rendererMetaFilename = "renderer-meta.json";

export const rendererRootDir = (userDataDir: string) => join(userDataDir, "renderer");
export const versionsDir = (userDataDir: string) => join(rendererRootDir(userDataDir), "versions");
export const versionDir = (userDataDir: string, rev: number) =>
	join(versionsDir(userDataDir), String(rev));
export const tmpDir = (userDataDir: string) => join(rendererRootDir(userDataDir), "tmp");
const activeJsonPath = (userDataDir: string) => join(rendererRootDir(userDataDir), "active.json");

const readJsonFile = (path: string): unknown => {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
};

export const readStoreState = (userDataDir: string): RendererStoreState => {
	const parsed = readJsonFile(activeJsonPath(userDataDir));
	return isValidStoreState(parsed) ? parsed : { ...initialStoreState };
};

export const writeStoreState = (userDataDir: string, state: RendererStoreState): void => {
	const root = rendererRootDir(userDataDir);
	mkdirSync(root, { recursive: true });
	const target = activeJsonPath(userDataDir);
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
	renameSync(tmp, target);
};

export const readRendererMeta = (bundleDir: string): RendererMeta | null => {
	const parsed = readJsonFile(join(bundleDir, rendererMetaFilename));
	return isValidRendererMeta(parsed) ? parsed : null;
};

/** A bundle dir is usable when its meta parses, matches the expected rev, and index.html exists. */
export const isBundleUsable = (bundleDir: string, expectedRev: number): RendererMeta | null => {
	if (!existsSync(join(bundleDir, "index.html"))) return null;
	const meta = readRendererMeta(bundleDir);
	if (!meta || meta.rendererRev !== expectedRev) return null;
	return meta;
};

export interface ResolvedRenderer {
	dir: string;
	source: "builtin" | "downloaded";
	rev: number;
	reason: string;
}

const fallbackBuiltinMeta: RendererMeta = {
	rendererRev: 0,
	minShellApi: SHELL_API_VERSION,
	appBaseline: "unknown",
};

/**
 * Resolve which renderer directory to load at startup. Applies health-tracking side
 * effects: counts a boot attempt for pending bundles and blocks bundles that were
 * rejected (incompatible or repeatedly unhealthy), reverting the active pointer.
 */
export const resolveRendererDir = (userDataDir: string, builtinDir: string): ResolvedRenderer => {
	const builtinMeta = readRendererMeta(builtinDir) ?? fallbackBuiltinMeta;
	const builtin: ResolvedRenderer = {
		dir: builtinDir,
		source: "builtin",
		rev: builtinMeta.rendererRev,
		reason: "builtin renderer",
	};

	let store: RendererStoreState;
	try {
		store = readStoreState(userDataDir);
	} catch {
		return builtin;
	}
	if (store.activeRev <= 0) return builtin;

	const candidateDir = versionDir(userDataDir, store.activeRev);
	const candidateMeta = isBundleUsable(candidateDir, store.activeRev);
	const candidate = candidateMeta ? { rev: store.activeRev, meta: candidateMeta } : null;

	const choice = chooseRenderer(builtinMeta, candidate, store, SHELL_API_VERSION);

	try {
		if (choice.source === "builtin") {
			if (choice.blockRev !== undefined) {
				writeStoreState(userDataDir, {
					activeRev: store.previousRev ?? 0,
					state: "healthy",
					bootAttempts: 0,
					blockedRevs: [...new Set([...store.blockedRevs, choice.blockRev])],
				});
			}
			return { ...builtin, reason: choice.reason };
		}

		if (choice.countAttempt) {
			writeStoreState(userDataDir, { ...store, bootAttempts: store.bootAttempts + 1 });
		}
	} catch {
		return builtin;
	}

	return {
		dir: candidateDir,
		source: "downloaded",
		rev: store.activeRev,
		reason: choice.reason,
	};
};

/** Point active.json at a freshly extracted bundle; it stays pending until markHealthy. */
export const activateVersion = (userDataDir: string, rev: number): void => {
	const store = readStoreState(userDataDir);
	writeStoreState(userDataDir, {
		activeRev: rev,
		state: "pending",
		bootAttempts: 0,
		blockedRevs: store.blockedRevs,
		previousRev: store.activeRev > 0 ? store.activeRev : undefined,
	});
};

/** Called via IPC once the renderer has mounted successfully. */
export const markHealthy = (userDataDir: string): void => {
	const store = readStoreState(userDataDir);
	if (store.activeRev <= 0) return;
	if (store.state === "healthy" && store.bootAttempts === 0) return;
	writeStoreState(userDataDir, { ...store, state: "healthy", bootAttempts: 0 });
};

/** Remove version directories other than the ones we still need (active + previous). */
export const cleanupVersions = (userDataDir: string, keepRevs: number[]): void => {
	const dir = versionsDir(userDataDir);
	if (!existsSync(dir)) return;
	const keep = new Set(keepRevs.map(String));
	for (const entry of readdirSync(dir)) {
		if (keep.has(entry)) continue;
		try {
			rmSync(join(dir, entry), { recursive: true, force: true });
		} catch {
			// Best effort — a locked file must not break startup or activation.
		}
	}
	try {
		rmSync(tmpDir(userDataDir), { recursive: true, force: true });
	} catch {
		// Best effort.
	}
};
