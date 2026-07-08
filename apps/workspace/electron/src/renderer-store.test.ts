import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHELL_API_VERSION, type RendererMeta } from "./ipc-contract.js";
import { maxBootAttempts } from "./renderer-policy.js";
import {
	activateVersion,
	cleanupVersions,
	markHealthy,
	readStoreState,
	resolveRendererDir,
	versionDir,
	writeStoreState,
} from "./renderer-store.js";

let userDataDir: string;
let builtinDir: string;

const writeBundle = (dir: string, meta: RendererMeta) => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "index.html"), "<!doctype html>");
	writeFileSync(join(dir, "renderer-meta.json"), JSON.stringify(meta));
};

const meta = (rendererRev: number, minShellApi = SHELL_API_VERSION): RendererMeta => ({
	rendererRev,
	minShellApi,
	appBaseline: "0.1.0-test",
});

beforeEach(() => {
	userDataDir = mkdtempSync(join(tmpdir(), "mediago-hotupdate-"));
	builtinDir = join(userDataDir, "builtin");
	writeBundle(builtinDir, meta(5));
});

afterEach(() => {
	rmSync(userDataDir, { recursive: true, force: true });
});

describe("renderer-store", () => {
	it("falls back to builtin when no download was ever activated", () => {
		const resolved = resolveRendererDir(userDataDir, builtinDir);
		expect(resolved).toMatchObject({ source: "builtin", rev: 5, dir: builtinDir });
	});

	it("loads an activated newer bundle and counts boot attempts until healthy", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);

		const first = resolveRendererDir(userDataDir, builtinDir);
		expect(first).toMatchObject({ source: "downloaded", rev: 6 });
		expect(readStoreState(userDataDir)).toMatchObject({ state: "pending", bootAttempts: 1 });

		markHealthy(userDataDir);
		expect(readStoreState(userDataDir)).toMatchObject({ state: "healthy", bootAttempts: 0 });

		const later = resolveRendererDir(userDataDir, builtinDir);
		expect(later.source).toBe("downloaded");
		expect(readStoreState(userDataDir).bootAttempts).toBe(0);
	});

	it("blocks a bundle that never reports healthy and falls back to builtin", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);

		for (let attempt = 0; attempt < maxBootAttempts; attempt += 1) {
			expect(resolveRendererDir(userDataDir, builtinDir).source).toBe("downloaded");
		}

		const rolledBack = resolveRendererDir(userDataDir, builtinDir);
		expect(rolledBack).toMatchObject({ source: "builtin", rev: 5 });
		expect(readStoreState(userDataDir).blockedRevs).toContain(6);

		// Blocked stays blocked even if re-activated.
		activateVersion(userDataDir, 6);
		expect(resolveRendererDir(userDataDir, builtinDir).source).toBe("builtin");
	});

	it("prefers a builtin renderer that a full update made newer", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);
		markHealthy(userDataDir);
		writeBundle(builtinDir, meta(8));

		const resolved = resolveRendererDir(userDataDir, builtinDir);
		expect(resolved).toMatchObject({ source: "builtin", rev: 8 });
	});

	it("falls back to builtin when the active bundle dir is corrupted", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);
		rmSync(join(versionDir(userDataDir, 6), "index.html"));

		expect(resolveRendererDir(userDataDir, builtinDir).source).toBe("builtin");
	});

	it("falls back to builtin when active.json is corrupt", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);
		writeFileSync(join(userDataDir, "renderer", "active.json"), "{not json");

		expect(resolveRendererDir(userDataDir, builtinDir).source).toBe("builtin");
	});

	it("blocks bundles requiring a newer shell api", () => {
		writeBundle(versionDir(userDataDir, 6), meta(6, SHELL_API_VERSION + 1));
		activateVersion(userDataDir, 6);

		expect(resolveRendererDir(userDataDir, builtinDir).source).toBe("builtin");
		expect(readStoreState(userDataDir).blockedRevs).toContain(6);
	});

	it("cleans up versions not in the keep list", () => {
		writeBundle(versionDir(userDataDir, 4), meta(4));
		writeBundle(versionDir(userDataDir, 5), meta(5));
		writeBundle(versionDir(userDataDir, 6), meta(6));
		activateVersion(userDataDir, 6);

		cleanupVersions(userDataDir, [6, 5]);

		writeStoreState(userDataDir, { ...readStoreState(userDataDir), activeRev: 4 });
		expect(resolveRendererDir(userDataDir, builtinDir).source).toBe("builtin");
	});
});
