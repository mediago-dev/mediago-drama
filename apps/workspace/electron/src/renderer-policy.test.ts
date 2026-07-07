import { describe, expect, it } from "vitest";
import type { RendererMeta } from "./ipc-contract.js";
import {
	chooseRenderer,
	evaluateManifest,
	isSafeZipEntryPath,
	isValidManifestPayload,
	isValidStoreState,
	maxBootAttempts,
	type RendererStoreState,
} from "./renderer-policy.js";

const meta = (rendererRev: number, minShellApi = 1): RendererMeta => ({
	rendererRev,
	minShellApi,
	appBaseline: "0.1.0-test",
});

const store = (overrides: Partial<RendererStoreState> = {}): RendererStoreState => ({
	activeRev: 0,
	state: "healthy",
	bootAttempts: 0,
	blockedRevs: [],
	...overrides,
});

describe("chooseRenderer", () => {
	it("falls back to builtin when nothing is downloaded", () => {
		expect(chooseRenderer(meta(5), null, store(), 1).source).toBe("builtin");
	});

	it("loads a strictly newer healthy downloaded renderer", () => {
		const choice = chooseRenderer(
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
		const choice = chooseRenderer(
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

	it("prefers builtin when a full update shipped an equal or newer renderer", () => {
		const choice = chooseRenderer(
			meta(8),
			{ rev: 6, meta: meta(6) },
			store({ activeRev: 6, state: "healthy" }),
			1,
		);
		expect(choice.source).toBe("builtin");
	});

	it("rejects blocked revisions", () => {
		const choice = chooseRenderer(
			meta(5),
			{ rev: 6, meta: meta(6) },
			store({ activeRev: 6, blockedRevs: [6] }),
			1,
		);
		expect(choice.source).toBe("builtin");
	});

	it("blocks a bundle that requires a newer shell api", () => {
		const choice = chooseRenderer(
			meta(5),
			{ rev: 6, meta: meta(6, 9) },
			store({ activeRev: 6 }),
			1,
		);
		expect(choice).toMatchObject({ source: "builtin", blockRev: 6 });
	});

	it("blocks a pending bundle after exhausting health-check attempts", () => {
		const choice = chooseRenderer(
			meta(5),
			{ rev: 6, meta: meta(6) },
			store({ activeRev: 6, state: "pending", bootAttempts: maxBootAttempts }),
			1,
		);
		expect(choice).toMatchObject({ source: "builtin", blockRev: 6 });
	});

	it("ignores candidates that do not match the active pointer", () => {
		const choice = chooseRenderer(meta(5), { rev: 7, meta: meta(7) }, store({ activeRev: 6 }), 1);
		expect(choice.source).toBe("builtin");
	});
});

describe("evaluateManifest", () => {
	const payload = (rendererRev: number, extra: Record<string, unknown> = {}) => ({
		rendererRev,
		appBaseline: "0.1.0-test",
		minShellApi: 1,
		url: "https://example.com/renderer.zip",
		sha256: "a".repeat(64),
		size: 1024,
		...extra,
	});

	it("downloads when the manifest is newer than builtin and active", () => {
		expect(evaluateManifest(payload(7), 5, 6, [], 1)).toEqual({
			action: "download",
			targetRev: 7,
		});
	});

	it("reports up-to-date when manifest rev is not newer", () => {
		expect(evaluateManifest(payload(6), 5, 6, [], 1).action).toBe("up-to-date");
		expect(evaluateManifest(payload(4), 5, 0, [], 1).action).toBe("up-to-date");
	});

	it("skips blocked revisions", () => {
		expect(evaluateManifest(payload(7), 5, 6, [7], 1).action).toBe("up-to-date");
	});

	it("honours the kill-switch", () => {
		expect(evaluateManifest(payload(7, { disabled: true }), 5, 6, [], 1).action).toBe("disabled");
	});

	it("requires a full update when shell api is too old", () => {
		expect(evaluateManifest(payload(7, { minShellApi: 3 }), 5, 6, [], 1)).toEqual({
			action: "requires-full-update",
			targetRev: 7,
			minShellApi: 3,
		});
	});
});

describe("isSafeZipEntryPath", () => {
	it("accepts normal relative entries", () => {
		expect(isSafeZipEntryPath("index.html")).toBe(true);
		expect(isSafeZipEntryPath("assets/index-abc.js")).toBe(true);
		expect(isSafeZipEntryPath("renderer-meta.json")).toBe(true);
	});

	it("rejects traversal and absolute paths", () => {
		expect(isSafeZipEntryPath("../evil.txt")).toBe(false);
		expect(isSafeZipEntryPath("assets/../../evil.txt")).toBe(false);
		expect(isSafeZipEntryPath("/etc/passwd")).toBe(false);
		expect(isSafeZipEntryPath("\\\\server\\share")).toBe(false);
		expect(isSafeZipEntryPath("C:\\windows\\system32")).toBe(false);
		expect(isSafeZipEntryPath("a\0b")).toBe(false);
		expect(isSafeZipEntryPath("")).toBe(false);
	});
});

describe("payload validation", () => {
	it("accepts a well-formed manifest payload", () => {
		expect(
			isValidManifestPayload({
				rendererRev: 3,
				appBaseline: "0.1.0",
				minShellApi: 1,
				url: "https://github.com/x/y/releases/download/renderer-beta/renderer-3.zip",
				sha256: "f".repeat(64),
				size: 8_000_000,
			}),
		).toBe(true);
	});

	it("rejects http urls, bad hashes, and non-integer revs", () => {
		const base = {
			rendererRev: 3,
			appBaseline: "0.1.0",
			minShellApi: 1,
			url: "https://example.com/r.zip",
			sha256: "f".repeat(64),
			size: 1,
		};
		expect(isValidManifestPayload({ ...base, url: "http://example.com/r.zip" })).toBe(false);
		expect(isValidManifestPayload({ ...base, sha256: "xyz" })).toBe(false);
		expect(isValidManifestPayload({ ...base, rendererRev: 1.5 })).toBe(false);
		expect(isValidManifestPayload({ ...base, size: 0 })).toBe(false);
		expect(isValidManifestPayload(null)).toBe(false);
	});
});

describe("store state validation", () => {
	it("accepts valid state and rejects corrupt json shapes", () => {
		expect(
			isValidStoreState({ activeRev: 2, state: "pending", bootAttempts: 1, blockedRevs: [1] }),
		).toBe(true);
		expect(
			isValidStoreState({ activeRev: 2, state: "broken", bootAttempts: 0, blockedRevs: [] }),
		).toBe(false);
		expect(isValidStoreState("garbage")).toBe(false);
	});
});
