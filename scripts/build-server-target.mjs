import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
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

const extraBuildTags = (process.env.MEDIAGO_GO_BUILD_TAGS ?? "")
	.split(/[\s,]+/u)
	.map((tag) => tag.trim())
	.filter(Boolean);
const obfuscateServer = process.env.MEDIAGO_GO_OBFUSCATE === "1";
const serverBuildCommand = obfuscateServer ? "garble" : "go";
const serverBuildArgs = [
	...(obfuscateServer ? ["-literals"] : []),
	"build",
	"-tags",
	["workspace_dist", ...extraBuildTags].join(","),
];
const serverLDFlags = process.env.MEDIAGO_GO_LDFLAGS?.trim();
if (serverLDFlags) serverBuildArgs.push("-ldflags", serverLDFlags);
serverBuildArgs.push(
	"-o",
	join(outDir, `mediago-server${target.exe}`),
	"./services/server/cmd/mediago-server",
);
run(serverBuildCommand, serverBuildArgs);
run("go", [
	"build",
	"-o",
	join(outDir, `mediago-document-mcp${target.exe}`),
	"./services/server/cmd/mediago-document-mcp",
]);
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
