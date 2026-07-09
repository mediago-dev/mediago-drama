import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHELL_API_VERSION } from "./ipc-contract.js";
import { maxBootAttempts, type BundleMeta } from "./bundle-policy.js";
import {
	activateVersion,
	cleanupVersions,
	dbSnapshotDir,
	isBundleUsable,
	markComponentHealthy,
	readStoreState,
	resolveBundleDir,
	restoreDatabases,
	serverBinaryFilename,
	snapshotDatabases,
	versionDir,
	writeStoreState,
} from "./bundle-store.js";

let userDataDir: string;
let builtinRendererDir: string;
let builtinServerBin: string;

const binName = serverBinaryFilename();

const meta = (bundleRev: number, minShellApi = SHELL_API_VERSION): BundleMeta => ({
	bundleRev,
	minShellApi,
	appBaseline: "0.1.0-test",
	components: { renderer: "", server: "" },
});

const writeBundle = (dir: string, bundleMeta: BundleMeta, { withServer = true } = {}) => {
	mkdirSync(join(dir, "bin"), { recursive: true });
	writeFileSync(join(dir, "index.html"), "<!doctype html>");
	writeFileSync(join(dir, "bundle-meta.json"), JSON.stringify(bundleMeta));
	if (withServer) writeFileSync(join(dir, "bin", binName), "#!binary");
};

beforeEach(() => {
	userDataDir = mkdtempSync(join(tmpdir(), "mediago-bundle-"));
	builtinRendererDir = join(userDataDir, "builtin-renderer");
	builtinServerBin = join(userDataDir, "builtin-bin", binName);
	mkdirSync(join(userDataDir, "builtin-bin"), { recursive: true });
	writeFileSync(builtinServerBin, "#!builtin");
	mkdirSync(builtinRendererDir, { recursive: true });
	writeFileSync(join(builtinRendererDir, "index.html"), "<!doctype html>");
	writeFileSync(join(builtinRendererDir, "bundle-meta.json"), JSON.stringify(meta(5)));
});

afterEach(() => {
	rmSync(userDataDir, { recursive: true, force: true });
});

const resolve = (opts?: { allowPending?: boolean }) =>
	resolveBundleDir(userDataDir, builtinRendererDir, builtinServerBin, opts);

describe("bundle-store resolve", () => {
	it("falls back to builtin (renderer dir + builtin server bin) when nothing downloaded", () => {
		const resolved = resolve();
		expect(resolved).toMatchObject({
			source: "builtin",
			rev: 5,
			rendererDir: builtinRendererDir,
			serverBinPath: builtinServerBin,
		});
	});

	it("loads an activated newer bundle with its own server binary", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);

		const resolved = resolve();
		expect(resolved).toMatchObject({ source: "downloaded", rev: 6 });
		expect(resolved.rendererDir).toBe(versionDir(userDataDir, 6));
		expect(resolved.serverBinPath).toBe(join(versionDir(userDataDir, 6), "bin", binName));
		expect(readStoreState(userDataDir)).toMatchObject({ state: "pending", bootAttempts: 1 });
	});

	it("refuses a pending bundle when allowPending is false, without side effects", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);

		const resolved = resolve({ allowPending: false });
		expect(resolved.source).toBe("builtin");
		expect(readStoreState(userDataDir)).toMatchObject({ bootAttempts: 0, state: "pending" });
	});

	it("treats a bundle without a server binary as unusable", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6), { withServer: false });
		activateVersion(userDataDir, 6);
		expect(resolve().source).toBe("builtin");
	});

	it("blocks a bundle that never reports full health and falls back", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);

		for (let attempt = 0; attempt < maxBootAttempts; attempt += 1) {
			expect(resolve().source).toBe("downloaded");
		}
		const rolledBack = resolve();
		expect(rolledBack).toMatchObject({ source: "builtin", rev: 5 });
		expect(readStoreState(userDataDir).blockedRevs).toContain(6);
	});

	it("dual health: one component signal keeps pending; both flip to healthy", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);
		resolve();

		markComponentHealthy(userDataDir, "renderer");
		expect(readStoreState(userDataDir)).toMatchObject({
			state: "pending",
			rendererHealthy: true,
			serverHealthy: false,
		});

		markComponentHealthy(userDataDir, "server");
		expect(readStoreState(userDataDir)).toMatchObject({ state: "healthy", bootAttempts: 0 });

		// Healthy bundle no longer counts attempts.
		resolve();
		expect(readStoreState(userDataDir).bootAttempts).toBe(0);
	});

	it("prefers a builtin bundle that a full update made newer", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);
		markComponentHealthy(userDataDir, "renderer");
		markComponentHealthy(userDataDir, "server");
		writeFileSync(join(builtinRendererDir, "bundle-meta.json"), JSON.stringify(meta(8)));

		expect(resolve()).toMatchObject({ source: "builtin", rev: 8 });
	});

	it("falls back to builtin when active.json is corrupt", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);
		writeFileSync(join(userDataDir, "bundle", "active.json"), "{not json");
		expect(resolve().source).toBe("builtin");
	});

	it("activateVersion resets health flags for re-activation", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);
		markComponentHealthy(userDataDir, "renderer");
		activateVersion(userDataDir, 7);
		expect(readStoreState(userDataDir)).toMatchObject({
			activeRev: 7,
			state: "pending",
			rendererHealthy: false,
			serverHealthy: false,
			previousRev: 6,
		});
	});

	it("cleanupVersions removes stale versions and tmp", () => {
		writeBundle(versionDir(userDataDir, 4), meta(4));
		writeBundle(versionDir(userDataDir, 6), meta(6));
		cleanupVersions(userDataDir, [6]);
		expect(existsSync(versionDir(userDataDir, 4))).toBe(false);
		expect(existsSync(versionDir(userDataDir, 6))).toBe(true);
	});
});

describe("isBundleUsable", () => {
	it("requires index.html, matching meta, and the server binary", () => {
		const dir = versionDir(userDataDir, 6);
		writeBundle(dir, meta(6));
		expect(isBundleUsable(dir, 6)).not.toBeNull();
		expect(isBundleUsable(dir, 7)).toBeNull();
		rmSync(join(dir, "bin", binName));
		expect(isBundleUsable(dir, 6)).toBeNull();
	});
});

describe("database snapshot / restore", () => {
	it("snapshots db files (including wal/shm siblings) and restores them", () => {
		const dbDir = join(userDataDir, "workspace-db");
		mkdirSync(dbDir, { recursive: true });
		const appDb = join(dbDir, "app.db");
		writeFileSync(appDb, "app-v1");
		writeFileSync(`${appDb}-wal`, "wal-v1");
		const settingsDb = join(dbDir, "settings.db");
		writeFileSync(settingsDb, "settings-v1");

		const snapDir = dbSnapshotDir(userDataDir, 7);
		const copied = snapshotDatabases([appDb, settingsDb], snapDir);
		expect(copied.sort()).toEqual([appDb, `${appDb}-wal`, settingsDb].sort());

		// Simulate the new server corrupting / migrating the databases.
		writeFileSync(appDb, "app-v2-migrated");
		rmSync(`${appDb}-wal`);
		writeFileSync(settingsDb, "settings-v2");

		restoreDatabases(snapDir);
		expect(readFileSync(appDb, "utf8")).toBe("app-v1");
		expect(readFileSync(`${appDb}-wal`, "utf8")).toBe("wal-v1");
		expect(readFileSync(settingsDb, "utf8")).toBe("settings-v1");
	});

	it("tolerates missing source files and restores nothing for them", () => {
		const dbDir = join(userDataDir, "workspace-db");
		mkdirSync(dbDir, { recursive: true });
		const onlyDb = join(dbDir, "app.db");
		writeFileSync(onlyDb, "app-v1");

		const snapDir = dbSnapshotDir(userDataDir, 8);
		const copied = snapshotDatabases([onlyDb, join(dbDir, "missing.db")], snapDir);
		expect(copied).toEqual([onlyDb]);
		expect(() => restoreDatabases(snapDir)).not.toThrow();
	});

	it("restore is a no-op when the snapshot dir does not exist", () => {
		expect(() => restoreDatabases(dbSnapshotDir(userDataDir, 99))).not.toThrow();
	});

	it("writeStoreState survives roundtrip with health flags", () => {
		writeStoreState(userDataDir, {
			activeRev: 3,
			state: "pending",
			bootAttempts: 1,
			blockedRevs: [2],
			previousRev: 1,
			rendererHealthy: true,
			serverHealthy: false,
		});
		expect(readStoreState(userDataDir)).toMatchObject({
			activeRev: 3,
			rendererHealthy: true,
			serverHealthy: false,
		});
	});
});
