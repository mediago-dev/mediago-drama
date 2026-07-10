import { describe, expect, it } from "vitest";
import {
	applyComponentHealthy,
	chooseApplyFailureAction,
	chooseBundle,
	evaluateBundleManifest,
	isSafeZipEntryPath,
	isValidBundleManifestPayload,
	isValidBundleMeta,
	isValidBundleStoreState,
	maxBootAttempts,
	normalizeBundleStoreState,
	type BundleMeta,
	type BundleStoreState,
} from "./bundle-policy.js";

const digest = (character: string) => character.repeat(64).slice(0, 64);

const meta = (
	bundleRev: number,
	options: {
		minShellApi?: number;
		schemaVersion?: number;
		workspaceLayoutVersion?: number;
		channel?: string;
		edition?: string;
		renderer?: string;
		server?: string;
	} = {},
): BundleMeta => ({
	bundleRev,
	schemaVersion: options.schemaVersion ?? 1,
	workspaceLayoutVersion: options.workspaceLayoutVersion ?? 1,
	channel: options.channel ?? "beta",
	edition: options.edition ?? "community",
	minShellApi: options.minShellApi ?? 1,
	appBaseline: "0.1.0-test",
	components: {
		renderer: { contentSha256: options.renderer ?? digest("a") },
		server: { contentSha256: options.server ?? digest("b") },
	},
});

const store = (overrides: Partial<BundleStoreState> = {}): BundleStoreState => ({
	activeRev: 0,
	state: "healthy",
	bootAttempts: 0,
	blockedRevs: [],
	lastKnownGoodRev: 0,
	fallbackRev: 0,
	activeSchemaVersion: 1,
	lastKnownGoodSchemaVersion: 1,
	fallbackSchemaVersion: 1,
	bundleRevFloor: 0,
	schemaVersionFloor: 1,
	workspaceLayoutVersionFloor: 0,
	rendererHealthy: false,
	serverHealthy: false,
	migrationStarted: false,
	channelDisabled: false,
	channelDisabledAtRev: 0,
	manifestChannel: "",
	manifestEdition: "",
	...overrides,
});

describe("chooseApplyFailureAction", () => {
	const action = (overrides: Partial<Parameters<typeof chooseApplyFailureAction>[0]> = {}) =>
		chooseApplyFailureAction({
			committed: false,
			migrationRestoreForbidden: false,
			newStarted: false,
			rollbackPrepared: false,
			snapshotPrepared: false,
			oldStopped: true,
			...overrides,
		});

	it("never rolls back after commit or after a forward-schema process boundary", () => {
		expect(action({ committed: true, newStarted: true })).toBe("keep-committed");
		expect(action({ migrationRestoreForbidden: true, newStarted: true })).toBe(
			"keep-migrated-pending",
		);
	});

	it("rolls back every snapshot/marker partial transaction before restarting target", () => {
		expect(action({ snapshotPrepared: true })).toBe("rollback");
		expect(action({ rollbackPrepared: true })).toBe("rollback");
		expect(action({ newStarted: true })).toBe("rollback");
		expect(action()).toBe("restart-target");
		expect(action({ oldStopped: false })).toBe("none");
	});
});

describe("chooseBundle", () => {
	it("falls back to builtin when nothing is downloaded", () => {
		expect(chooseBundle(meta(5), null, store(), 1).source).toBe("builtin");
	});

	it("loads a strictly newer healthy downloaded bundle without counting attempts", () => {
		expect(
			chooseBundle(
				meta(5),
				{ rev: 6, meta: meta(6) },
				store({ activeRev: 6, state: "healthy" }),
				1,
			),
		).toEqual({ source: "downloaded", reason: expect.any(String), countAttempt: false });
	});

	it("counts pending attempts in the decision but leaves persistence to the caller", () => {
		expect(
			chooseBundle(
				meta(5),
				{ rev: 6, meta: meta(6) },
				store({ activeRev: 6, state: "pending", bootAttempts: 1 }),
				1,
			),
		).toEqual({ source: "downloaded", reason: expect.any(String), countAttempt: true });
	});

	it("prefers a same/newer builtin and rejects blocked or exhausted revisions", () => {
		expect(
			chooseBundle(meta(8), { rev: 6, meta: meta(6) }, store({ activeRev: 6 }), 1).source,
		).toBe("builtin");
		expect(
			chooseBundle(meta(5), { rev: 6, meta: meta(6) }, store({ activeRev: 6, blockedRevs: [6] }), 1)
				.source,
		).toBe("builtin");
		expect(
			chooseBundle(
				meta(5),
				{ rev: 6, meta: meta(6) },
				store({ activeRev: 6, state: "pending", bootAttempts: maxBootAttempts }),
				1,
			),
		).toMatchObject({ source: "builtin", blockRev: 6 });
	});

	it("blocks shell, cohort, edition, and workspace-layout mismatches", () => {
		for (const candidateMeta of [
			meta(6, { minShellApi: 9 }),
			meta(6, { channel: "latest" }),
			meta(6, { edition: "pro" }),
			meta(6, { workspaceLayoutVersion: 2 }),
		]) {
			expect(
				chooseBundle(meta(5), { rev: 6, meta: candidateMeta }, store({ activeRev: 6 }), 1),
			).toMatchObject({ source: "builtin", blockRev: 6 });
		}
	});
});

describe("applyComponentHealthy", () => {
	it("promotes only after both signals, shifts LKG to fallback, and clears recovery intent", () => {
		const start = store({
			activeRev: 7,
			activeSchemaVersion: 3,
			state: "pending",
			bootAttempts: 1,
			lastKnownGoodRev: 6,
			lastKnownGoodSchemaVersion: 2,
			fallbackRev: 5,
			fallbackSchemaVersion: 1,
			rollbackPending: {
				failedRev: 7,
				targetRev: 6,
				targetSchemaVersion: 2,
				snapshotRev: 7,
				restoreSnapshot: true,
			},
		});
		const afterRenderer = applyComponentHealthy(start, "renderer");
		expect(afterRenderer).toMatchObject({ state: "pending", lastKnownGoodRev: 6 });
		const afterBoth = applyComponentHealthy(afterRenderer, "server");
		expect(afterBoth).toMatchObject({
			state: "healthy",
			bootAttempts: 0,
			lastKnownGoodRev: 7,
			lastKnownGoodSchemaVersion: 3,
			fallbackRev: 6,
			fallbackSchemaVersion: 2,
		});
		expect(afterBoth.rollbackPending).toBeUndefined();
	});

	it("is idempotent for repeated signals", () => {
		const once = applyComponentHealthy(store({ activeRev: 6, state: "pending" }), "server");
		expect(applyComponentHealthy(once, "server")).toBe(once);
	});
});

describe("evaluateBundleManifest", () => {
	const component = (archive: string, content = archive) => ({
		url: `https://example.com/${archive}.zip`,
		sha256: digest(archive),
		contentSha256: digest(content),
		size: 1024,
	});
	const payload = (
		bundleRev: number,
		extra: Record<string, unknown> = {},
		serverPlatforms = {
			"darwin-arm64": component("b"),
			"windows-x64": component("c"),
		},
	) => ({
		bundleRev,
		schemaVersion: 1,
		workspaceLayoutVersion: 1,
		channel: "beta",
		edition: "community",
		appBaseline: "0.1.0-test",
		minShellApi: 1,
		components: { renderer: component("a"), server: serverPlatforms },
		...extra,
	});

	it("uses extracted content identities, not archive digests", () => {
		const decision = evaluateBundleManifest(
			payload(7, {
				components: {
					renderer: component("z", "a"),
					server: { "darwin-arm64": component("y", "b") },
				},
			}),
			"darwin-arm64",
			meta(6),
			6,
			[],
			1,
		);
		expect(decision).toEqual({ action: "download", targetRev: 7, components: [] });
	});

	it("downloads only changed extracted components", () => {
		const decision = evaluateBundleManifest(
			payload(7),
			"darwin-arm64",
			meta(6, { server: digest("x") }),
			6,
			[],
			1,
		);
		expect(decision).toEqual({ action: "download", targetRev: 7, components: ["server"] });
	});

	it("rejects a different channel or edition before honoring its kill switch", () => {
		for (const mismatch of [{ channel: "latest" }, { edition: "pro" }]) {
			expect(
				evaluateBundleManifest(
					payload(7, { ...mismatch, disabled: true }),
					"darwin-arm64",
					meta(6),
					6,
					[],
					1,
				),
			).toEqual({ action: "cohort-mismatch", targetRev: 7 });
		}
	});

	it("honors a same-cohort kill switch", () => {
		expect(
			evaluateBundleManifest(payload(7, { disabled: true }), "darwin-arm64", meta(6), 6, [], 1),
		).toEqual({ action: "disabled" });
	});

	it("requires a full update for shell/layout incompatibility or schema downgrade", () => {
		expect(
			evaluateBundleManifest(payload(7, { minShellApi: 3 }), "darwin-arm64", meta(6), 6, [], 1),
		).toMatchObject({ action: "requires-full-update", reason: "shell-api" });
		expect(
			evaluateBundleManifest(
				payload(7, { workspaceLayoutVersion: 2 }),
				"darwin-arm64",
				meta(6),
				6,
				[],
				1,
			),
		).toMatchObject({ action: "requires-full-update", reason: "workspace-layout" });
		expect(
			evaluateBundleManifest(
				payload(7, { schemaVersion: 1 }),
				"darwin-arm64",
				meta(6, { schemaVersion: 2 }),
				6,
				[],
				1,
			),
		).toMatchObject({ action: "requires-full-update", reason: "schema-downgrade" });
	});

	it("reports unsupported platform", () => {
		expect(
			evaluateBundleManifest(
				payload(7, {}, { "windows-x64": component("c") }),
				"darwin-arm64",
				meta(6),
				6,
				[],
				1,
			),
		).toEqual({ action: "unsupported-platform", targetRev: 7 });
	});
});

describe("payload/meta/store validation", () => {
	const ref = {
		url: "https://example.com/r.zip",
		sha256: digest("f"),
		contentSha256: digest("e"),
		size: 100,
	};
	const validPayload = {
		bundleRev: 3,
		schemaVersion: 2,
		workspaceLayoutVersion: 1,
		channel: "beta",
		edition: "community",
		sourceCommit: "a".repeat(40),
		appBaseline: "0.1.0",
		minShellApi: 1,
		components: { renderer: ref, server: { "darwin-arm64": ref } },
	};

	it("requires explicit cohort, generations, and content hashes", () => {
		expect(isValidBundleManifestPayload(validPayload)).toBe(true);
		for (const invalid of [
			{ ...validPayload, channel: undefined },
			{ ...validPayload, edition: undefined },
			{ ...validPayload, schemaVersion: undefined },
			{ ...validPayload, sourceCommit: "not-a-commit" },
			{
				...validPayload,
				components: { ...validPayload.components, renderer: { ...ref, contentSha256: "" } },
			},
		]) {
			expect(isValidBundleManifestPayload(invalid)).toBe(false);
		}
	});

	it("allows localhost HTTP only in test mode", () => {
		const local = {
			...validPayload,
			components: {
				renderer: { ...ref, url: "http://127.0.0.1:8787/r.zip" },
				server: { "darwin-arm64": { ...ref, url: "http://localhost:8787/s.zip" } },
			},
		};
		expect(isValidBundleManifestPayload(local)).toBe(false);
		expect(isValidBundleManifestPayload(local, true)).toBe(true);
	});

	it("validates the expanded bundle metadata", () => {
		expect(isValidBundleMeta(meta(1))).toBe(true);
		expect(isValidBundleMeta({ ...meta(1), edition: undefined })).toBe(false);
		expect(
			isValidBundleMeta({
				...meta(1),
				components: { ...meta(1).components, server: { contentSha256: "bad" } },
			}),
		).toBe(false);
	});

	it("validates current state and normalizes the legacy previousRev shape", () => {
		expect(isValidBundleStoreState(store({ activeRev: 2, state: "pending" }))).toBe(true);
		const migrated = normalizeBundleStoreState({
			activeRev: 7,
			state: "pending",
			bootAttempts: 1,
			blockedRevs: [3],
			previousRev: 6,
			rendererHealthy: false,
			serverHealthy: true,
			hasMigration: true,
		});
		expect(migrated).toMatchObject({
			activeRev: 7,
			lastKnownGoodRev: 6,
			activeSchemaVersion: 1,
			lastKnownGoodSchemaVersion: 0,
			channelDisabled: false,
			migrationStarted: true,
		});
		for (const corruptLegacy of [
			{
				activeRev: 7,
				state: "pending",
				bootAttempts: 1,
				blockedRevs: [3],
				previousRev: 6,
				rendererHealthy: false,
				serverHealthy: true,
			},
			{
				activeRev: 7,
				state: "pending",
				bootAttempts: 1,
				blockedRevs: [3],
				previousRev: "6",
				rendererHealthy: false,
				serverHealthy: true,
				hasMigration: true,
			},
		]) {
			expect(normalizeBundleStoreState(corruptLegacy)).toBeNull();
		}
		expect(normalizeBundleStoreState("garbage")).toBeNull();
	});

	it("migrates only missing safety fields and fails closed on corrupt modern state", () => {
		const pendingWithoutFloors = {
			...store({
				activeRev: 7,
				state: "pending" as const,
				activeSchemaVersion: 3,
				lastKnownGoodSchemaVersion: 2,
			}),
		};
		delete (pendingWithoutFloors as Partial<BundleStoreState>).bundleRevFloor;
		delete (pendingWithoutFloors as Partial<BundleStoreState>).schemaVersionFloor;
		delete (pendingWithoutFloors as Partial<BundleStoreState>).workspaceLayoutVersionFloor;
		delete (pendingWithoutFloors as Partial<BundleStoreState>).channelDisabledAtRev;
		delete (pendingWithoutFloors as Partial<BundleStoreState>).manifestChannel;
		delete (pendingWithoutFloors as Partial<BundleStoreState>).manifestEdition;
		delete (pendingWithoutFloors as Partial<BundleStoreState>).migrationStarted;
		expect(normalizeBundleStoreState(pendingWithoutFloors)).toMatchObject({
			bundleRevFloor: 0,
			schemaVersionFloor: 2,
			workspaceLayoutVersionFloor: 0,
			channelDisabledAtRev: 0,
			manifestChannel: "",
			manifestEdition: "",
			migrationStarted: false,
		});

		expect(normalizeBundleStoreState({ ...store(), bundleRevFloor: "10" })).toBeNull();
		expect(normalizeBundleStoreState({ ...store(), activeSchemaVersion: "3" })).toBeNull();
		expect(normalizeBundleStoreState({ ...store(), migrationStarted: "yes" })).toBeNull();
		const modernPendingWithoutMigrationFlag = {
			...store({
				activeRev: 7,
				state: "pending",
				bootAttempts: 1,
				activeSchemaVersion: 3,
				lastKnownGoodSchemaVersion: 2,
			}),
		};
		delete (modernPendingWithoutMigrationFlag as Partial<BundleStoreState>).migrationStarted;
		expect(normalizeBundleStoreState(modernPendingWithoutMigrationFlag)).toMatchObject({
			migrationStarted: true,
		});
	});
});

describe("isSafeZipEntryPath", () => {
	it("accepts normal entries and rejects traversal", () => {
		expect(isSafeZipEntryPath("index.html")).toBe(true);
		expect(isSafeZipEntryPath("bin/mediago-server")).toBe(true);
		expect(isSafeZipEntryPath("../evil")).toBe(false);
		expect(isSafeZipEntryPath("/etc/passwd")).toBe(false);
	});
});
