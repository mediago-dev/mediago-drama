import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashBundleFile, hashRendererTree } from "./bundle-content.js";
import { SHELL_API_VERSION } from "./ipc-contract.js";
import { initialStoreState, maxBootAttempts, type BundleMeta } from "./bundle-policy.js";
import {
	activateVersion,
	assertBuiltinFloors,
	bundleRootDir,
	cleanupVersions,
	completeRollback,
	dbSnapshotDir,
	disableChannelAndRevert,
	isBundleUsable,
	markComponentHealthy,
	markMigrationStarted,
	markRollbackPending,
	readBuiltinMeta,
	readStoreState,
	recordBootAttempt,
	recordBundleFloors,
	resolveBundleDir,
	restoreDatabases,
	serverBinaryFilename,
	setChannelEnabled,
	snapshotDatabases,
	versionDir,
	writeStoreState,
} from "./bundle-store.js";

let userDataDir: string;
let builtinRendererDir: string;
let builtinServerBin: string;

const binName = serverBinaryFilename();

const meta = (
	bundleRev: number,
	options: Partial<
		Pick<
			BundleMeta,
			"schemaVersion" | "workspaceLayoutVersion" | "channel" | "edition" | "minShellApi"
		>
	> = {},
): BundleMeta => ({
	bundleRev,
	schemaVersion: options.schemaVersion ?? 1,
	workspaceLayoutVersion: options.workspaceLayoutVersion ?? 1,
	channel: options.channel ?? "beta",
	edition: options.edition ?? "community",
	minShellApi: options.minShellApi ?? SHELL_API_VERSION,
	appBaseline: "0.1.0-test",
	components: {
		renderer: { contentSha256: "0".repeat(64) },
		server: { contentSha256: "0".repeat(64) },
	},
});

const writeBundle = (
	dir: string,
	bundleMeta: BundleMeta,
	{ withServer = true }: { withServer?: boolean } = {},
): BundleMeta => {
	mkdirSync(join(dir, "bin"), { recursive: true });
	writeFileSync(join(dir, "index.html"), `<!doctype html><title>${bundleMeta.bundleRev}</title>`);
	writeFileSync(join(dir, "asset.js"), `rev=${bundleMeta.bundleRev}`);
	const serverPath = join(dir, "bin", binName);
	if (withServer) writeFileSync(serverPath, `#!binary-${bundleMeta.bundleRev}`);
	const finalMeta: BundleMeta = {
		...bundleMeta,
		components: {
			renderer: { contentSha256: hashRendererTree(dir) },
			server: {
				contentSha256: withServer ? hashBundleFile(serverPath) : "0".repeat(64),
			},
		},
	};
	writeFileSync(join(dir, "bundle-meta.json"), JSON.stringify(finalMeta));
	return finalMeta;
};

const activate = (
	rev: number,
	schemaVersion = 1,
	lastKnownGoodRev = 0,
	lastKnownGoodSchemaVersion = 1,
) =>
	activateVersion(userDataDir, {
		rev,
		schemaVersion,
		lastKnownGoodRev,
		lastKnownGoodSchemaVersion,
	});

const writeBuiltinMeta = (
	bundleRev: number,
	options: Parameters<typeof meta>[1] = {},
): BundleMeta => {
	const builtinMeta: BundleMeta = {
		...meta(bundleRev, options),
		components: {
			renderer: { contentSha256: hashRendererTree(builtinRendererDir) },
			server: { contentSha256: hashBundleFile(builtinServerBin) },
		},
	};
	writeFileSync(join(builtinRendererDir, "bundle-meta.json"), JSON.stringify(builtinMeta));
	return builtinMeta;
};

beforeEach(() => {
	userDataDir = mkdtempSync(join(tmpdir(), "mediago-bundle-"));
	writeStoreState(userDataDir, { ...initialStoreState });
	builtinRendererDir = join(userDataDir, "builtin-renderer");
	builtinServerBin = join(userDataDir, "builtin-bin", binName);
	mkdirSync(join(userDataDir, "builtin-bin"), { recursive: true });
	writeFileSync(builtinServerBin, "#!builtin");
	mkdirSync(builtinRendererDir, { recursive: true });
	writeFileSync(join(builtinRendererDir, "index.html"), "<!doctype html>");
	const builtinMeta = {
		...meta(5),
		components: {
			renderer: { contentSha256: hashRendererTree(builtinRendererDir) },
			server: { contentSha256: hashBundleFile(builtinServerBin) },
		},
	};
	writeFileSync(join(builtinRendererDir, "bundle-meta.json"), JSON.stringify(builtinMeta));
});

afterEach(() => {
	rmSync(userDataDir, { recursive: true, force: true });
});

const resolve = (opts?: { allowPending?: boolean }) =>
	resolveBundleDir(userDataDir, builtinRendererDir, builtinServerBin, opts);

describe("bundle-store resolve and state transitions", () => {
	it("uses the builtin renderer/server pair when nothing is active", () => {
		expect(resolve()).toMatchObject({
			source: "builtin",
			rev: 5,
			schemaVersion: 1,
			workspaceLayoutVersion: 1,
			channel: "beta",
			edition: "community",
			rendererDir: builtinRendererDir,
			serverBinPath: builtinServerBin,
		});
	});

	it("does not count a pending boot until the caller records it after safety preparation", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activate(6);
		const resolved = resolve();
		expect(resolved).toMatchObject({ source: "downloaded", rev: 6, firstBootOfPending: true });
		expect(readStoreState(userDataDir).bootAttempts).toBe(0);
		recordBootAttempt(userDataDir, 6);
		expect(readStoreState(userDataDir).bootAttempts).toBe(1);
		recordBootAttempt(userDataDir, 7);
		expect(readStoreState(userDataDir).bootAttempts).toBe(1);
	});

	it("refuses pending without side effects when prerequisites are unavailable", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activate(6);
		expect(resolve({ allowPending: false }).source).toBe("builtin");
		expect(readStoreState(userDataDir)).toMatchObject({ state: "pending", bootAttempts: 0 });
	});

	it("persists recovery intent after exhausted attempts and completes rollback explicitly", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6, { schemaVersion: 2 }));
		activate(6, 2, 0, 1);
		for (let attempt = 0; attempt < maxBootAttempts; attempt += 1) {
			expect(resolve().source).toBe("downloaded");
			recordBootAttempt(userDataDir, 6);
		}
		const rolledBack = resolve();
		expect(rolledBack).toMatchObject({
			source: "builtin",
			blockedRev: 6,
			rollbackPending: { failedRev: 6, targetRev: 0, restoreSnapshot: true },
		});
		expect(readStoreState(userDataDir).blockedRevs).not.toContain(6);
		completeRollback(userDataDir, 6);
		expect(readStoreState(userDataDir).activeRev).toBe(0);
		expect(readStoreState(userDataDir).rollbackPending).toBeUndefined();
		expect(readStoreState(userDataDir).blockedRevs).toContain(6);
	});

	it("marks an invalid never-booted pending bundle without restoring its snapshot", () => {
		const dir = versionDir(userDataDir, 6);
		writeBundle(dir, meta(6, { schemaVersion: 2 }));
		activate(6, 2, 0, 1);
		writeFileSync(join(dir, "asset.js"), "corrupt-before-first-boot");
		expect(resolve()).toMatchObject({
			source: "builtin",
			rollbackPending: { failedRev: 6, targetRev: 0, restoreSnapshot: false },
		});
	});

	it("fails closed instead of rolling a healthy advanced schema back", () => {
		const dir = versionDir(userDataDir, 6);
		writeBundle(dir, meta(6, { schemaVersion: 2 }));
		activate(6, 2, 0, 1);
		markComponentHealthy(userDataDir, "renderer", 6);
		markComponentHealthy(userDataDir, "server", 6);
		writeFileSync(join(dir, "asset.js"), "corrupt-after-healthy");
		expect(() => resolve()).toThrow(/regressing schema|discard data/);
		expect(readStoreState(userDataDir)).toMatchObject({
			activeRev: 6,
			state: "healthy",
		});
		expect(readStoreState(userDataDir).rollbackPending).toBeUndefined();
	});

	it("keeps a schema-compatible downloaded bundle over a newer but older-schema installer", () => {
		const dir = versionDir(userDataDir, 7);
		writeBundle(dir, meta(7, { schemaVersion: 2 }));
		activate(7, 2, 0, 1);
		markComponentHealthy(userDataDir, "renderer", 7);
		markComponentHealthy(userDataDir, "server", 7);
		writeBuiltinMeta(8, { schemaVersion: 1 });
		expect(resolve()).toMatchObject({ source: "downloaded", rev: 7, schemaVersion: 2 });
		writeFileSync(join(dir, "asset.js"), "corrupt");
		expect(() => resolve()).toThrow(/regressing schema|discard data/);
	});

	it("rejects a rollback marker when its verified target disappeared", () => {
		const lkgDir = versionDir(userDataDir, 6);
		writeBundle(lkgDir, meta(6, { schemaVersion: 2 }));
		activate(6, 2, 0, 1);
		markComponentHealthy(userDataDir, "renderer", 6);
		markComponentHealthy(userDataDir, "server", 6);
		writeBundle(versionDir(userDataDir, 7), meta(7, { schemaVersion: 3 }));
		activate(7, 3, 6, 2);
		markRollbackPending(userDataDir, {
			failedRev: 7,
			targetRev: 6,
			targetSchemaVersion: 2,
			snapshotRev: 7,
			restoreSnapshot: true,
		});
		writeFileSync(join(lkgDir, "asset.js"), "corrupt-target");
		expect(() => resolve()).toThrow(/older than the snapshot schema/);
		expect(readStoreState(userDataDir).rollbackPending).toBeDefined();
	});

	it("returns the actual downloaded LKG while a newer pending rev rolls back", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activate(6);
		markComponentHealthy(userDataDir, "renderer", 6);
		markComponentHealthy(userDataDir, "server", 6);
		writeBundle(versionDir(userDataDir, 7), meta(7));
		activate(7, 1, 6, 1);
		markRollbackPending(userDataDir, {
			failedRev: 7,
			targetRev: 6,
			targetSchemaVersion: 1,
			snapshotRev: 7,
			restoreSnapshot: true,
		});
		expect(resolve()).toMatchObject({ source: "downloaded", rev: 6, blockedRev: 7 });
	});

	it("promotes dual health and retains the prior LKG as a revocation fallback", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activate(6);
		markComponentHealthy(userDataDir, "renderer", 6);
		expect(readStoreState(userDataDir).state).toBe("pending");
		markComponentHealthy(userDataDir, "server", 6);
		expect(readStoreState(userDataDir)).toMatchObject({
			state: "healthy",
			lastKnownGoodRev: 6,
			fallbackRev: 0,
		});

		writeBundle(versionDir(userDataDir, 7), meta(7));
		activate(7, 1, 6, 1);
		markComponentHealthy(userDataDir, "renderer", 7);
		markComponentHealthy(userDataDir, "server", 7);
		expect(readStoreState(userDataDir)).toMatchObject({
			lastKnownGoodRev: 7,
			fallbackRev: 6,
		});
	});

	it("prevents a second pending revision from replacing the first", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		writeBundle(versionDir(userDataDir, 7), meta(7));
		activate(6);
		expect(() => activate(7)).toThrow(/still pending/);
		expect(readStoreState(userDataDir).activeRev).toBe(6);
	});

	it("prevents activation while durable rollback work is pending", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		writeBundle(versionDir(userDataDir, 7), meta(7));
		activate(6);
		markRollbackPending(userDataDir, {
			failedRev: 6,
			targetRev: 0,
			targetSchemaVersion: 1,
			snapshotRev: 6,
			restoreSnapshot: false,
		});
		expect(() => activate(7)).toThrow(/rollback.*pending/);
	});

	it("normalizes a stale downloaded pointer when a full installer ships a newer builtin", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activate(6);
		markComponentHealthy(userDataDir, "renderer", 6);
		markComponentHealthy(userDataDir, "server", 6);
		const upgraded = {
			...meta(8, { schemaVersion: 2 }),
			components: {
				renderer: { contentSha256: hashRendererTree(builtinRendererDir) },
				server: { contentSha256: hashBundleFile(builtinServerBin) },
			},
		};
		writeFileSync(join(builtinRendererDir, "bundle-meta.json"), JSON.stringify(upgraded));
		expect(resolve()).toMatchObject({ source: "builtin", rev: 8 });
		expect(readStoreState(userDataDir)).toMatchObject({
			activeRev: 0,
			lastKnownGoodRev: 0,
			activeSchemaVersion: 2,
		});
	});

	it("revokes an already healthy revision to its retained fallback", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activate(6);
		markComponentHealthy(userDataDir, "renderer", 6);
		markComponentHealthy(userDataDir, "server", 6);
		writeBundle(versionDir(userDataDir, 7), meta(7));
		activate(7, 1, 6, 1);
		markComponentHealthy(userDataDir, "renderer", 7);
		markComponentHealthy(userDataDir, "server", 7);

		expect(disableChannelAndRevert(userDataDir, 7, 7, "beta", "community")).toBe(
			"rollback-pending",
		);
		expect(readStoreState(userDataDir)).toMatchObject({
			activeRev: 6,
			lastKnownGoodRev: 6,
			channelDisabled: true,
			rollbackPending: { failedRev: 7, targetRev: 6, restoreSnapshot: false },
		});
		completeRollback(userDataDir, 7);
		expect(resolve()).toMatchObject({ source: "downloaded", rev: 6 });
		expect(setChannelEnabled(userDataDir, 7, "beta", "community")).toBe(false);
		expect(setChannelEnabled(userDataDir, 8, "beta", "community")).toBe(true);
		expect(readStoreState(userDataDir).channelDisabled).toBe(false);
		expect(disableChannelAndRevert(userDataDir, 7, 7, "beta", "community")).toBe("stale-manifest");
		expect(readStoreState(userDataDir)).toMatchObject({
			channelDisabled: false,
			channelDisabledAtRev: 8,
		});
	});

	it("quarantines a healthy schema advance until a compatible full installer lands", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activate(6);
		markComponentHealthy(userDataDir, "renderer", 6);
		markComponentHealthy(userDataDir, "server", 6);
		writeBundle(versionDir(userDataDir, 7), meta(7, { schemaVersion: 2 }));
		activate(7, 2, 6, 1);
		markComponentHealthy(userDataDir, "renderer", 7);
		markComponentHealthy(userDataDir, "server", 7);

		expect(disableChannelAndRevert(userDataDir, 7, 8, "beta", "community")).toBe(
			"requires-full-update",
		);
		expect(() => resolve()).toThrow(/install a full update|regress schema/);

		writeBuiltinMeta(9, { schemaVersion: 2 });
		expect(resolve()).toMatchObject({ source: "builtin", rev: 9, schemaVersion: 2 });
		expect(readStoreState(userDataDir)).toMatchObject({
			activeRev: 0,
			lastKnownGoodRev: 0,
			channelDisabled: true,
			schemaVersionFloor: 2,
		});
	});

	it("lets a compatible full installer recover a server-ready pending migration", () => {
		writeBundle(versionDir(userDataDir, 7), meta(7, { schemaVersion: 2 }));
		activate(7, 2, 0, 1);
		markRollbackPending(userDataDir, {
			failedRev: 7,
			targetRev: 0,
			targetSchemaVersion: 1,
			snapshotRev: 7,
			restoreSnapshot: true,
		});
		markMigrationStarted(userDataDir, 7);
		markComponentHealthy(userDataDir, "server", 7);
		expect(disableChannelAndRevert(userDataDir, 7, 8, "beta", "community")).toBe(
			"requires-full-update",
		);
		writeBuiltinMeta(9, { schemaVersion: 2 });
		expect(resolve()).toMatchObject({ source: "builtin", rev: 9, schemaVersion: 2 });
		expect(readStoreState(userDataDir)).toMatchObject({
			activeRev: 0,
			state: "healthy",
			channelDisabled: true,
			serverHealthy: false,
			migrationStarted: false,
		});
		expect(setChannelEnabled(userDataDir, 10, "beta", "community")).toBe(true);
		expect(readStoreState(userDataDir)).toMatchObject({
			activeRev: 0,
			state: "healthy",
			channelDisabled: false,
		});
	});

	it("resets cohort-local revision safety state when a full installer changes cohort", () => {
		writeStoreState(userDataDir, {
			...initialStoreState,
			blockedRevs: [7],
			bundleRevFloor: 100,
			schemaVersionFloor: 2,
			workspaceLayoutVersionFloor: 1,
			channelDisabled: true,
			channelDisabledAtRev: 101,
			manifestChannel: "beta",
			manifestEdition: "community",
		});
		const stable = writeBuiltinMeta(1, { channel: "latest", edition: "pro", schemaVersion: 2 });
		assertBuiltinFloors(userDataDir, stable);
		const resolved = resolve();
		recordBundleFloors(userDataDir, stable, resolved);
		expect(readStoreState(userDataDir)).toMatchObject({
			blockedRevs: [],
			bundleRevFloor: 1,
			schemaVersionFloor: 2,
			channelDisabled: false,
			channelDisabledAtRev: 0,
			manifestChannel: "latest",
			manifestEdition: "pro",
		});
		expect(() => assertBuiltinFloors(userDataDir, stable)).not.toThrow();
	});

	it("persists full-installer floors and rejects same-cohort downgrades", () => {
		const builtin = readBuiltinMeta(builtinRendererDir);
		const resolved = resolve();
		recordBundleFloors(userDataDir, builtin, resolved);
		expect(readStoreState(userDataDir)).toMatchObject({
			bundleRevFloor: 5,
			schemaVersionFloor: 1,
			workspaceLayoutVersionFloor: 1,
		});
		expect(() => assertBuiltinFloors(userDataDir, meta(4))).toThrow(/below previously installed/);
		expect(() => assertBuiltinFloors(userDataDir, meta(6, { workspaceLayoutVersion: 0 }))).toThrow(
			/below persisted floor/,
		);
	});

	it("cleanupVersions removes stale versions and snapshots", () => {
		writeBundle(versionDir(userDataDir, 4), meta(4));
		writeBundle(versionDir(userDataDir, 6), meta(6));
		cleanupVersions(userDataDir, [6]);
		expect(existsSync(versionDir(userDataDir, 4))).toBe(false);
		expect(existsSync(versionDir(userDataDir, 6))).toBe(true);
	});
});

describe("isBundleUsable", () => {
	it("revalidates renderer and server content on every load", () => {
		const dir = versionDir(userDataDir, 6);
		writeBundle(dir, meta(6));
		expect(isBundleUsable(dir, 6)).not.toBeNull();
		writeFileSync(join(dir, "asset.js"), "tampered");
		expect(isBundleUsable(dir, 6)).toBeNull();
		writeBundle(dir, meta(6));
		writeFileSync(join(dir, "bin", binName), "tampered-server");
		expect(isBundleUsable(dir, 6)).toBeNull();
	});

	it("rejects a missing binary or mismatched revision", () => {
		const dir = versionDir(userDataDir, 6);
		writeBundle(dir, meta(6));
		expect(isBundleUsable(dir, 7)).toBeNull();
		rmSync(join(dir, "bin", binName));
		expect(isBundleUsable(dir, 6)).toBeNull();
	});
});

describe("database snapshot / restore", () => {
	it("snapshots required DBs and optional journals, then restores them", () => {
		const dbDir = join(userDataDir, "workspace-db");
		mkdirSync(dbDir, { recursive: true });
		const appDb = join(dbDir, "app.db");
		const settingsDb = join(dbDir, "settings.db");
		writeFileSync(appDb, "app-v1");
		writeFileSync(`${appDb}-wal`, "wal-v1");
		writeFileSync(settingsDb, "settings-v1");
		const snapDir = dbSnapshotDir(userDataDir, 7);
		expect(snapshotDatabases([appDb, settingsDb], snapDir).sort()).toEqual(
			[appDb, `${appDb}-wal`, settingsDb].sort(),
		);

		writeFileSync(appDb, "app-v2-migrated");
		rmSync(`${appDb}-wal`);
		writeFileSync(settingsDb, "settings-v2");
		restoreDatabases(snapDir);
		expect(readFileSync(appDb, "utf8")).toBe("app-v1");
		expect(readFileSync(`${appDb}-wal`, "utf8")).toBe("wal-v1");
		expect(readFileSync(settingsDb, "utf8")).toBe("settings-v1");
	});

	it("fails closed for a missing base DB and keeps an earlier complete snapshot", () => {
		const dbDir = join(userDataDir, "workspace-db");
		mkdirSync(dbDir, { recursive: true });
		const appDb = join(dbDir, "app.db");
		writeFileSync(appDb, "app-v1");
		const snapDir = dbSnapshotDir(userDataDir, 8);
		snapshotDatabases([appDb], snapDir);
		expect(() => snapshotDatabases([appDb, join(dbDir, "missing.db")], snapDir)).toThrow(
			/missing|does not match/,
		);
		writeFileSync(appDb, "app-v2");
		restoreDatabases(snapDir);
		expect(readFileSync(appDb, "utf8")).toBe("app-v1");
	});

	it("rejects missing or corrupt snapshot content before mutating live DBs", () => {
		const dbDir = join(userDataDir, "workspace-db");
		mkdirSync(dbDir, { recursive: true });
		const appDb = join(dbDir, "app.db");
		writeFileSync(appDb, "app-v1");
		const snapDir = dbSnapshotDir(userDataDir, 9);
		snapshotDatabases([appDb], snapDir);
		const snapshotFile = readFileSync(join(snapDir, "snapshot-manifest.json"), "utf8");
		const parsed = JSON.parse(snapshotFile) as {
			databases: Array<{ base: { entryName: string } }>;
		};
		writeFileSync(join(snapDir, parsed.databases[0]!.base.entryName), "corrupt");
		writeFileSync(appDb, "live-v2");
		expect(() => restoreDatabases(snapDir)).toThrow(/corrupt/);
		expect(readFileSync(appDb, "utf8")).toBe("live-v2");
		expect(() => restoreDatabases(dbSnapshotDir(userDataDir, 99))).toThrow(/manifest/);
	});

	it("removes live journals that were absent from the snapshot", () => {
		const dbDir = join(userDataDir, "workspace-db");
		mkdirSync(dbDir, { recursive: true });
		const appDb = join(dbDir, "app.db");
		writeFileSync(appDb, "app-v1");
		const snapDir = dbSnapshotDir(userDataDir, 12);
		snapshotDatabases([appDb], snapDir);
		writeFileSync(appDb, "app-v2");
		writeFileSync(`${appDb}-wal`, "stale-frames");
		writeFileSync(`${appDb}-shm`, "stale-shm");
		restoreDatabases(snapDir);
		expect(readFileSync(appDb, "utf8")).toBe("app-v1");
		expect(existsSync(`${appDb}-wal`)).toBe(false);
		expect(existsSync(`${appDb}-shm`)).toBe(false);
	});
});

describe("active.json compatibility", () => {
	it("allows only a truly empty first-run store and rejects missing or corrupt safety state", () => {
		rmSync(bundleRootDir(userDataDir), { recursive: true, force: true });
		expect(readStoreState(userDataDir)).toEqual(initialStoreState);
		mkdirSync(bundleRootDir(userDataDir), { recursive: true });
		expect(() => readStoreState(userDataDir)).toThrow(/missing/);
		writeFileSync(join(bundleRootDir(userDataDir), "active.json"), "{not-json");
		expect(() => readStoreState(userDataDir)).toThrow(/corrupt/);
	});

	it("requires valid builtin metadata outside the explicit development fallback", () => {
		const missing = join(userDataDir, "missing-builtin");
		expect(() => readBuiltinMeta(missing)).toThrow(/missing or invalid/);
		expect(readBuiltinMeta(missing, { allowFallback: true })).toMatchObject({ bundleRev: 0 });
	});

	it("round-trips durable LKG and rollback context", () => {
		writeStoreState(userDataDir, {
			activeRev: 7,
			state: "pending",
			bootAttempts: 1,
			blockedRevs: [2],
			lastKnownGoodRev: 6,
			fallbackRev: 5,
			activeSchemaVersion: 3,
			lastKnownGoodSchemaVersion: 2,
			fallbackSchemaVersion: 1,
			bundleRevFloor: 5,
			schemaVersionFloor: 2,
			workspaceLayoutVersionFloor: 1,
			rendererHealthy: true,
			serverHealthy: false,
			rollbackPending: {
				failedRev: 7,
				targetRev: 6,
				targetSchemaVersion: 2,
				snapshotRev: 7,
				restoreSnapshot: true,
			},
			channelDisabled: false,
			channelDisabledAtRev: 0,
			manifestChannel: "beta",
			manifestEdition: "community",
		});
		expect(readStoreState(userDataDir)).toMatchObject({
			activeRev: 7,
			lastKnownGoodRev: 6,
			fallbackRev: 5,
			rollbackPending: { failedRev: 7, targetRev: 6 },
		});
	});
});
