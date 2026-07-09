import { describe, expect, it } from "vitest";
import {
	applyComponentHealthy,
	chooseBundle,
	evaluateBundleManifest,
	isSafeZipEntryPath,
	isValidBundleManifestPayload,
	isValidBundleMeta,
	isValidBundleStoreState,
	maxBootAttempts,
	type BundleMeta,
	type BundleStoreState,
} from "./bundle-policy.js";

const meta = (
	bundleRev: number,
	minShellApi = 1,
	components: { renderer: string; server: string } = { renderer: "", server: "" },
): BundleMeta => ({
	bundleRev,
	minShellApi,
	appBaseline: "0.1.0-test",
	components,
});

const store = (overrides: Partial<BundleStoreState> = {}): BundleStoreState => ({
	activeRev: 0,
	state: "healthy",
	bootAttempts: 0,
	blockedRevs: [],
	rendererHealthy: false,
	serverHealthy: false,
	hasMigration: false,
	...overrides,
});

describe("chooseBundle", () => {
	it("falls back to builtin when nothing is downloaded", () => {
		expect(chooseBundle(meta(5), null, store(), 1).source).toBe("builtin");
	});

	it("loads a strictly newer healthy downloaded bundle without counting attempts", () => {
		const choice = chooseBundle(
			meta(5),
			{ rev: 6, meta: meta(6) },
			store({ activeRev: 6, state: "healthy" }),
			1,
		);
		expect(choice).toEqual({
			source: "downloaded",
			reason: expect.any(String),
			countAttempt: false,
		});
	});

	it("counts a boot attempt while the bundle is still pending", () => {
		const choice = chooseBundle(
			meta(5),
			{ rev: 6, meta: meta(6) },
			store({ activeRev: 6, state: "pending", bootAttempts: 1 }),
			1,
		);
		expect(choice).toEqual({
			source: "downloaded",
			reason: expect.any(String),
			countAttempt: true,
		});
	});

	it("prefers builtin when a full update shipped an equal or newer bundle", () => {
		const choice = chooseBundle(
			meta(8),
			{ rev: 6, meta: meta(6) },
			store({ activeRev: 6, state: "healthy" }),
			1,
		);
		expect(choice.source).toBe("builtin");
	});

	it("rejects blocked revisions", () => {
		const choice = chooseBundle(
			meta(5),
			{ rev: 6, meta: meta(6) },
			store({ activeRev: 6, blockedRevs: [6] }),
			1,
		);
		expect(choice.source).toBe("builtin");
	});

	it("blocks a bundle that requires a newer shell api", () => {
		const choice = chooseBundle(meta(5), { rev: 6, meta: meta(6, 9) }, store({ activeRev: 6 }), 1);
		expect(choice).toMatchObject({ source: "builtin", blockRev: 6 });
	});

	it("blocks a pending bundle after exhausting health-check attempts", () => {
		const choice = chooseBundle(
			meta(5),
			{ rev: 6, meta: meta(6) },
			store({ activeRev: 6, state: "pending", bootAttempts: maxBootAttempts }),
			1,
		);
		expect(choice).toMatchObject({ source: "builtin", blockRev: 6 });
	});

	it("ignores candidates that do not match the active pointer", () => {
		const choice = chooseBundle(meta(5), { rev: 7, meta: meta(7) }, store({ activeRev: 6 }), 1);
		expect(choice.source).toBe("builtin");
	});
});

describe("applyComponentHealthy", () => {
	it("keeps pending until both components report healthy, then resets attempts", () => {
		const start = store({ activeRev: 6, state: "pending", bootAttempts: 1 });

		const afterRenderer = applyComponentHealthy(start, "renderer");
		expect(afterRenderer).toMatchObject({
			state: "pending",
			rendererHealthy: true,
			serverHealthy: false,
			bootAttempts: 1,
		});

		const afterBoth = applyComponentHealthy(afterRenderer, "server");
		expect(afterBoth).toMatchObject({
			state: "healthy",
			rendererHealthy: true,
			serverHealthy: true,
			bootAttempts: 0,
		});
	});

	it("is idempotent for repeated signals", () => {
		const start = store({ activeRev: 6, state: "pending" });
		const once = applyComponentHealthy(start, "server");
		const twice = applyComponentHealthy(once, "server");
		expect(twice).toEqual(once);
	});
});

describe("evaluateBundleManifest", () => {
	const component = (sha: string) => ({
		url: `https://example.com/${sha}.zip`,
		sha256: sha.repeat(64).slice(0, 64),
		size: 1024,
	});

	const payload = (
		bundleRev: number,
		extra: Record<string, unknown> = {},
		serverPlatforms: Record<string, ReturnType<typeof component>> = {
			"darwin-arm64": component("b"),
			"windows-x64": component("c"),
		},
	) => ({
		bundleRev,
		appBaseline: "0.1.0-test",
		minShellApi: 1,
		components: {
			renderer: component("a"),
			server: serverPlatforms,
		},
		...extra,
	});

	const currentMeta = (renderer: string, server: string) => meta(6, 1, { renderer, server });

	it("downloads both components when identities are unknown (builtin)", () => {
		const decision = evaluateBundleManifest(payload(7), "darwin-arm64", meta(5), 5, [], 1);
		expect(decision).toEqual({
			action: "download",
			targetRev: 7,
			components: ["renderer", "server"],
		});
	});

	it("downloads only the changed component", () => {
		const rendererSha = "a".repeat(64);
		const serverShaOld = "x".repeat(64);
		const decision = evaluateBundleManifest(
			payload(7),
			"darwin-arm64",
			currentMeta(rendererSha, serverShaOld),
			6,
			[],
			1,
		);
		expect(decision).toEqual({
			action: "download",
			targetRev: 7,
			components: ["server"],
		});
	});

	it("returns an empty component list when nothing changed but rev advanced", () => {
		const decision = evaluateBundleManifest(
			payload(7),
			"darwin-arm64",
			currentMeta("a".repeat(64), "b".repeat(64)),
			6,
			[],
			1,
		);
		expect(decision).toEqual({ action: "download", targetRev: 7, components: [] });
	});

	it("reports up-to-date when the manifest rev is not newer", () => {
		expect(evaluateBundleManifest(payload(6), "darwin-arm64", meta(5), 6, [], 1).action).toBe(
			"up-to-date",
		);
	});

	it("skips blocked revisions", () => {
		expect(evaluateBundleManifest(payload(7), "darwin-arm64", meta(5), 6, [7], 1).action).toBe(
			"up-to-date",
		);
	});

	it("honours the kill-switch", () => {
		expect(
			evaluateBundleManifest(payload(7, { disabled: true }), "darwin-arm64", meta(5), 6, [], 1)
				.action,
		).toBe("disabled");
	});

	it("requires a full update when shell api is too old", () => {
		expect(
			evaluateBundleManifest(payload(7, { minShellApi: 3 }), "darwin-arm64", meta(5), 6, [], 1),
		).toEqual({
			action: "requires-full-update",
			targetRev: 7,
			minShellApi: 3,
		});
	});

	it("reports unsupported platform when the manifest lacks this platform's server", () => {
		const decision = evaluateBundleManifest(
			payload(7, {}, { "windows-x64": component("c") }),
			"darwin-arm64",
			meta(5),
			5,
			[],
			1,
		);
		expect(decision).toEqual({ action: "unsupported-platform", targetRev: 7 });
	});
});

describe("isValidBundleManifestPayload", () => {
	const valid = {
		bundleRev: 3,
		appBaseline: "0.1.0",
		minShellApi: 1,
		components: {
			renderer: { url: "https://example.com/r.zip", sha256: "f".repeat(64), size: 100 },
			server: {
				"darwin-arm64": { url: "https://example.com/s.zip", sha256: "e".repeat(64), size: 100 },
			},
		},
	};

	it("accepts a well-formed payload", () => {
		expect(isValidBundleManifestPayload(valid)).toBe(true);
	});

	it("rejects missing components, bad urls, and bad hashes", () => {
		expect(isValidBundleManifestPayload({ ...valid, components: undefined })).toBe(false);
		expect(
			isValidBundleManifestPayload({
				...valid,
				components: { ...valid.components, renderer: undefined },
			}),
		).toBe(false);
		expect(
			isValidBundleManifestPayload({
				...valid,
				components: {
					...valid.components,
					renderer: { url: "http://evil.com/r.zip", sha256: "f".repeat(64), size: 100 },
				},
			}),
		).toBe(false);
		expect(
			isValidBundleManifestPayload({
				...valid,
				components: {
					...valid.components,
					server: {
						"darwin-arm64": { url: "https://example.com/s.zip", sha256: "zz", size: 100 },
					},
				},
			}),
		).toBe(false);
		expect(
			isValidBundleManifestPayload({ ...valid, components: { ...valid.components, server: {} } }),
		).toBe(false);
	});

	it("allows localhost http only in test mode, never other http hosts", () => {
		const localhost = {
			...valid,
			components: {
				renderer: { url: "http://127.0.0.1:8787/r.zip", sha256: "f".repeat(64), size: 100 },
				server: {
					"darwin-arm64": {
						url: "http://127.0.0.1:8787/s.zip",
						sha256: "e".repeat(64),
						size: 100,
					},
				},
			},
		};
		expect(isValidBundleManifestPayload(localhost)).toBe(false);
		expect(isValidBundleManifestPayload(localhost, true)).toBe(true);
		const evil = {
			...localhost,
			components: {
				...localhost.components,
				renderer: { url: "http://evil.com/r.zip", sha256: "f".repeat(64), size: 100 },
			},
		};
		expect(isValidBundleManifestPayload(evil, true)).toBe(false);
	});
});

describe("meta and store-state validation", () => {
	it("accepts valid bundle meta and rejects malformed shapes", () => {
		expect(
			isValidBundleMeta({
				bundleRev: 1,
				minShellApi: 1,
				appBaseline: "0.1.0",
				components: { renderer: "", server: "" },
			}),
		).toBe(true);
		expect(isValidBundleMeta({ bundleRev: 1, minShellApi: 1, appBaseline: "0.1.0" })).toBe(false);
		expect(isValidBundleMeta(null)).toBe(false);
	});

	it("accepts valid store state and rejects corrupt shapes", () => {
		expect(
			isValidBundleStoreState({
				activeRev: 2,
				state: "pending",
				bootAttempts: 1,
				blockedRevs: [1],
				rendererHealthy: false,
				serverHealthy: true,
				hasMigration: true,
			}),
		).toBe(true);
		// missing hasMigration is rejected (forces migration bundles to declare it)
		expect(
			isValidBundleStoreState({
				activeRev: 2,
				state: "pending",
				bootAttempts: 1,
				blockedRevs: [1],
				rendererHealthy: false,
				serverHealthy: true,
			}),
		).toBe(false);
		expect(
			isValidBundleStoreState({
				activeRev: 2,
				state: "pending",
				bootAttempts: 1,
				blockedRevs: [1],
			}),
		).toBe(false);
		expect(isValidBundleStoreState("garbage")).toBe(false);
	});
});

describe("isSafeZipEntryPath (regression from renderer hot update)", () => {
	it("accepts normal entries and rejects traversal", () => {
		expect(isSafeZipEntryPath("index.html")).toBe(true);
		expect(isSafeZipEntryPath("bin/mediago-server")).toBe(true);
		expect(isSafeZipEntryPath("../evil")).toBe(false);
		expect(isSafeZipEntryPath("/etc/passwd")).toBe(false);
	});
});
