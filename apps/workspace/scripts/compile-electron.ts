import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

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
if (result.status !== 0) process.exit(result.status ?? 1);

buildSync({
	bundle: true,
	entryPoints: [join(workspaceDir, "electron", "src", "preload.ts")],
	external: ["electron"],
	format: "cjs",
	logLevel: "info",
	outfile: join(electronDistDir, "preload.cjs"),
	platform: "node",
	sourcemap: false,
	target: "node22",
});
rmSync(join(electronDistDir, "preload.js"), { force: true });
