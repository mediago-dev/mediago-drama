import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const platform = process.argv[2]?.trim() ?? "";
const targets = {
	"darwin-arm64": { GOOS: "darwin", GOARCH: "arm64", exe: "" },
	"darwin-x64": { GOOS: "darwin", GOARCH: "amd64", exe: "" },
	"windows-x64": { GOOS: "windows", GOARCH: "amd64", exe: ".exe" },
};

const target = targets[platform];
if (!target) {
	console.error("PLATFORM must be one of: darwin-arm64, darwin-x64, windows-x64");
	process.exit(1);
}

const outDir = join("bin", platform);
mkdirSync(outDir, { recursive: true });

const promptPackPolicy = (process.env.MEDIAGO_PROMPT_PACK_POLICY ?? "marketplace")
	.trim()
	.toLowerCase();
if (!["marketplace", "partner"].includes(promptPackPolicy)) {
	console.error("MEDIAGO_PROMPT_PACK_POLICY must be marketplace or partner");
	process.exit(1);
}
const serverBuildArgs = [
	"build",
	"-tags",
	"workspace_dist",
];
const serverLDFlags = `-s -w -X main.defaultPromptPackPolicy=${promptPackPolicy}`;
serverBuildArgs.push("-ldflags", serverLDFlags);
serverBuildArgs.push(
	"-o",
	join(outDir, `mediago-server${target.exe}`),
	"./services/server/cmd/mediago-server",
);
run("go", serverBuildArgs);

function run(command, args) {
	const result = spawnSync(command, args, {
		env: { ...process.env, GOOS: target.GOOS, GOARCH: target.GOARCH },
		stdio: "inherit",
	});
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}
