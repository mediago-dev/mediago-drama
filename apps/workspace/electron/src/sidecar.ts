import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { agentsDir, serverBinaryPath, toolsDir } from "./paths.js";

let child: ChildProcessWithoutNullStreams | null = null;

export const startServerSidecar = () => {
	if (process.env.ELECTRON_RENDERER_URL) return;
	if (child) return;

	const serverPath = serverBinaryPath();
	if (!existsSync(serverPath)) {
		throw new Error(`missing server sidecar: ${serverPath}`);
	}

	child = spawn(serverPath, [], {
		env: {
			...process.env,
			MEDIAGO_AGENT_ID: process.env.MEDIAGO_AGENT_ID || "opencode",
			MEDIAGO_SERVER_PORT: process.env.MEDIAGO_SERVER_PORT || "48273",
			MEDIAGO_EXIT_ON_STDIN_CLOSE: "1",
			MEDIAGO_AGENT_BIN_DIR: agentsDir(),
			MEDIAGO_FFMPEG_BIN_DIR: toolsDir(),
			MEDIAGO_JIMENG_BIN_DIR: toolsDir(),
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	child.stdout.on("data", (chunk) => {
		console.info(`[mediago-server] ${String(chunk).trimEnd()}`);
	});
	child.stderr.on("data", (chunk) => {
		console.error(`[mediago-server] ${String(chunk).trimEnd()}`);
	});
	child.on("exit", () => {
		child = null;
	});
};

export const stopServerSidecar = () => {
	const current = child;
	child = null;
	current?.stdin.end();
	current?.kill();
};
