import { constants, accessSync, chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agent = process.argv[2]?.trim() || "codex";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const rootDir = resolve(workspaceDir, "../..");
const hostBinaryExt = process.platform === "win32" ? ".exe" : "";
const serverBin = join(rootDir, "bin", `mediago-server${hostBinaryExt}`);
const agentDist = join(rootDir, "packages", "vendor", "dist", agent);
const toolsDist = join(rootDir, "packages", "vendor", "dist", "tools");
const electronResourcesDir = join(workspaceDir, "electron", "resources");

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

	const binDir = join(electronResourcesDir, "bin");
	const agentsDir = join(electronResourcesDir, "agents");
	const toolsDir = join(electronResourcesDir, "tools");
	const stagedServer = join(binDir, `mediago-server${hostBinaryExt}`);

	rmSync(electronResourcesDir, { recursive: true, force: true });
	mkdirSync(binDir, { recursive: true });
	mkdirSync(agentsDir, { recursive: true });
	mkdirSync(toolsDir, { recursive: true });

	cpSync(serverBin, stagedServer);
	chmodSync(stagedServer, 0o755);
	cpSync(agentDist, join(agentsDir, agent), { recursive: true });
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
	if (!existsSync(path)) throw new Error(message);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
