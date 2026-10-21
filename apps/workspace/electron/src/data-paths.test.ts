import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppDataPaths } from "./data-paths.js";

describe("open-source application data isolation", () => {
	const appDataDir = join("system", "application data");
	const homeDir = join("users", "creator");

	it("keeps packaged data separate from the official application", () => {
		const paths = resolveAppDataPaths(true, appDataDir, homeDir);
		expect(paths.workspace).toBe(join(appDataDir, "mediago-drama-oss", "workspace"));
		expect(paths.userData).toBe(join(appDataDir, "mediago-drama-oss", "electron"));
		expect(paths.sessionData).toBe(join(paths.userData, "session"));
	});

	it("uses a separate development workspace and Electron profile", () => {
		const paths = resolveAppDataPaths(false, appDataDir, homeDir);
		expect(paths.workspace).toBe(join(homeDir, "mediago-drama-oss-dev", "workspace"));
		expect(paths.userData).toBe(join(homeDir, "mediago-drama-oss-dev", "electron"));
		expect(paths.workspace).not.toBe(resolveAppDataPaths(true, appDataDir, homeDir).workspace);
	});
});
