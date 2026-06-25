import { constants, accessSync, chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agent = process.argv[2]?.trim() || "codex";
const platformArg = process.argv[3]?.trim() || "";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const rootDir = resolve(workspaceDir, "../..");
const targetPlatform = resolveTargetPlatform(platformArg);
const vendorDistRoot = platformArg
	? join(rootDir, "packages", "vendor", "dist", targetPlatform.key)
	: join(rootDir, "packages", "vendor", "dist");
const serverBin = platformArg
	? join(rootDir, "bin", targetPlatform.key, `mediago-server${targetPlatform.binaryExt}`)
	: join(rootDir, "bin", `mediago-server${targetPlatform.binaryExt}`);
const agentDist = join(vendorDistRoot, agent);
const toolsDist = join(vendorDistRoot, "tools");
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
	const stagedServer = join(binDir, `mediago-server${targetPlatform.binaryExt}`);

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

type TargetPlatform = {
	key: string;
	binaryExt: string;
};

function resolveTargetPlatform(value: string): TargetPlatform {
	if (!value) {
		const os = process.platform === "win32" ? "windows" : process.platform;
		const arch = process.arch === "x64" ? "x64" : process.arch;
		return {
			key: `${os}-${arch}`,
			binaryExt: process.platform === "win32" ? ".exe" : "",
		};
	}

	const [os, arch] = value.split("-", 2);
	if (!os || !arch) throw new Error(`invalid platform: ${value}`);
	if (!["darwin", "linux", "windows"].includes(os)) {
		throw new Error(`unsupported platform OS: ${os}`);
	}
	if (!["arm64", "x64"].includes(arch)) {
		throw new Error(`unsupported platform architecture: ${arch}`);
	}

	return {
		key: `${os}-${arch}`,
		binaryExt: os === "windows" ? ".exe" : "",
	};
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
