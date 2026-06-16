import { execFileSync } from "node:child_process";
import { constants, accessSync, chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agent = process.argv[2]?.trim() || "codex";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const rootDir = resolve(workspaceDir, "../..");
const serverBin = join(rootDir, "bin", "mediago-server");
const agentDist = join(rootDir, "packages", "vendor", "dist", agent);
const toolsDist = join(rootDir, "packages", "vendor", "dist", "tools");
const tauriDir = join(workspaceDir, "src-tauri");

function main(): void {
	ensureExecutable(serverBin);
	ensureFile(
		join(agentDist, "agent.json"),
		`missing prepared agent: ${join(agentDist, "agent.json")}`,
	);
	ensureFile(
		join(toolsDist, "ffmpeg", "tool.json"),
		`missing prepared ffmpeg: ${join(toolsDist, "ffmpeg", "tool.json")}`,
	);
	ensureFile(
		join(toolsDist, "ffprobe", "tool.json"),
		`missing prepared ffprobe: ${join(toolsDist, "ffprobe", "tool.json")}`,
	);
	ensureFile(
		join(toolsDist, "dreamina", "tool.json"),
		`missing prepared dreamina: ${join(toolsDist, "dreamina", "tool.json")}`,
	);

	const triple = rustTargetTriple();
	const binariesDir = join(tauriDir, "binaries");
	const agentsDir = join(tauriDir, "resources", "agents");
	const toolsDir = join(tauriDir, "resources", "tools");
	const binaryExt = triple.includes("windows") ? ".exe" : "";
	const stagedServer = join(binariesDir, `mediago-server-${triple}${binaryExt}`);

	mkdirSync(binariesDir, { recursive: true });
	mkdirSync(agentsDir, { recursive: true });
	mkdirSync(toolsDir, { recursive: true });
	cpSync(serverBin, stagedServer);
	chmodSync(stagedServer, 0o755);

	rmSync(agentsDir, { recursive: true, force: true });
	mkdirSync(agentsDir, { recursive: true });
	cpSync(agentDist, join(agentsDir, agent), { recursive: true });

	rmSync(toolsDir, { recursive: true, force: true });
	mkdirSync(toolsDir, { recursive: true });
	cpSync(toolsDist, toolsDir, { recursive: true });
}

function ensureExecutable(path: string): void {
	try {
		accessSync(path, constants.X_OK);
	} catch {
		throw new Error(`missing server binary: ${path}`);
	}
}

function ensureFile(path: string, message: string): void {
	if (!existsSync(path)) {
		throw new Error(message);
	}
}

function rustTargetTriple(): string {
	const output = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
	const triple =
		output
			.split("\n")
			.find((line) => line.startsWith("host: "))
			?.slice("host: ".length)
			.trim() || "";

	if (!triple) {
		throw new Error("failed to detect Rust host target triple");
	}
	return triple;
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exit(1);
}
