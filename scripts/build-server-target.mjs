import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const platform = process.argv[2]?.trim() ?? "";
const targets = {
	"darwin-arm64": { GOOS: "darwin", GOARCH: "arm64", exe: "" },
	"windows-x64": { GOOS: "windows", GOARCH: "amd64", exe: ".exe" },
};

const target = targets[platform];
if (!target) {
	console.error("PLATFORM must be one of: darwin-arm64, windows-x64");
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
const serverLDFlags = [
	`-X main.defaultPromptPackPolicy=${promptPackPolicy}`,
	protectedPackRuntimeLDFlag(),
]
	.filter(Boolean)
	.join(" ");
serverBuildArgs.push("-ldflags", serverLDFlags);
serverBuildArgs.push(
	"-o",
	join(outDir, `mediago-server${target.exe}`),
	"./services/server/cmd/mediago-server",
);
run("go", serverBuildArgs);
run("go", [
	"build",
	"-o",
	join(outDir, `mediago-document-mcp${target.exe}`),
	"./services/server/cmd/mediago-document-mcp",
]);

function protectedPackRuntimeLDFlag() {
	if (process.env.MEDIAGO_INCLUDE_PROTECTED_PACK_RUNTIME !== "1") return "";
	const runtimePath = join(
		"packages",
		"vendor",
		"dist",
		platform,
		"tools",
		"mediago-rights",
		`mediago-rights${target.exe}`,
	);
	const digest = createHash("sha256").update(readFileSync(runtimePath)).digest("hex");
	return `-X main.defaultProtectedPackImporterSHA256=${digest}`;
}
run("go", [
	"build",
	"-o",
	join(outDir, `mediago-generation-mcp${target.exe}`),
	"./services/server/cmd/mediago-generation-mcp",
]);

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
