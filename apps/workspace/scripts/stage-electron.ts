import {
	constants,
	accessSync,
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agent = process.argv[2]?.trim() || "opencode";
const platformArg = process.argv[3]?.trim() || "";
const modelPlatform = process.argv[4]?.trim() || "mediago";
const mediagoBaseURL =
	process.argv[5]?.trim() || process.env.MEDIAGO_MODEL_PLATFORM_MEDIAGO_BASE_URL?.trim() || "";
const generationClis =
	process.argv[6]?.trim() || process.env.MEDIAGO_GENERATION_CLIS?.trim() || "dreamina";
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
const baseToolIDs = ["ffmpeg", "ffprobe"];
const generationCliIDs = parseToolIDs(generationClis);
const selectedToolIDs = unique([...baseToolIDs, ...generationCliIDs]);

function main(): void {
	ensureExecutable(serverBin);
	ensureFile(
		join(agentDist, "agent.json"),
		`missing prepared agent: ${join(agentDist, "agent.json")}`,
	);
	for (const toolID of selectedToolIDs) {
		ensureFile(
			join(toolsDist, toolID, "tool.json"),
			`missing prepared ${toolID}: ${join(toolsDist, toolID, "tool.json")}`,
		);
	}

	const binDir = join(electronResourcesDir, "bin");
	const agentsDir = join(electronResourcesDir, "agents");
	const stagedToolsDir = join(electronResourcesDir, "tools");
	const stagedServer = join(binDir, `mediago-server${targetPlatform.binaryExt}`);

	rmSync(electronResourcesDir, { recursive: true, force: true });
	mkdirSync(binDir, { recursive: true });
	mkdirSync(agentsDir, { recursive: true });
	mkdirSync(stagedToolsDir, { recursive: true });

	cpSync(serverBin, stagedServer);
	chmodSync(stagedServer, 0o755);
	cpSync(agentDist, join(agentsDir, agent), { recursive: true });
	for (const toolID of selectedToolIDs) {
		cpSync(join(toolsDist, toolID), join(stagedToolsDir, toolID), { recursive: true });
	}
	writeFileSync(
		join(electronResourcesDir, "model-platform.json"),
		JSON.stringify({ agent, mediagoBaseURL, modelPlatform }, null, 2) + "\n",
	);
	writeFileSync(
		join(electronResourcesDir, "local-cli.json"),
		JSON.stringify({ generationClis: generationCliIDs }, null, 2) + "\n",
	);
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

function parseToolIDs(value: string): string[] {
	const normalized = value.trim().toLowerCase();
	if (!normalized || normalized === "none") return [];
	return unique(
		normalized
			.split(",")
			.map((item) => canonicalToolID(item))
			.filter((item) => item && item !== "none"),
	);
}

function canonicalToolID(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (normalized === "xiaoyunque" || normalized === "pippit-tool-cli") return "pippit";
	return normalized;
}

function unique(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
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
