import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const electronDistDir = join(workspaceDir, "electron", "dist");
const typescriptEntry = createRequire(import.meta.url).resolve("typescript");
const tscPath = resolve(dirname(typescriptEntry), "..", "bin", "tsc");

rmSync(electronDistDir, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tscPath, "-p", "electron/tsconfig.json"], {
	cwd: workspaceDir,
	stdio: "inherit",
});

if (result.error) {
	console.error(`failed to start Electron TypeScript compiler: ${result.error.message}`);
	process.exit(1);
}
process.exit(result.status ?? 1);
