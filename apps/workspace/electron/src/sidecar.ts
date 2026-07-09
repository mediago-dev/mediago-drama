import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentsDir, resourceRoot, serverBinaryPath, toolsDir } from "./paths.js";

let child: ChildProcessWithoutNullStreams | null = null;

/** Port the sidecar listens on; must stay in sync with the env passed at spawn. */
export const serverSidecarPort = () => Number(process.env.MEDIAGO_SERVER_PORT || "48273");

export const serverSidecarBaseUrl = () => `http://127.0.0.1:${serverSidecarPort()}`;

export interface StartServerSidecarOptions {
	/** Absolute server binary path; defaults to the builtin resources binary. */
	binaryPath?: string;
}

export const startServerSidecar = (options?: StartServerSidecarOptions) => {
	if (process.env.ELECTRON_RENDERER_URL) return;
	if (child) return;

	const serverPath = options?.binaryPath || serverBinaryPath();
	if (!existsSync(serverPath)) {
		throw new Error(`missing server sidecar: ${serverPath}`);
	}
	const platformConfig = packagedModelPlatformConfig();
	const localCLIConfig = packagedLocalCLIConfig();

	child = spawn(serverPath, [], {
		env: {
			...process.env,
			MEDIAGO_AGENT_ID: process.env.MEDIAGO_AGENT_ID || platformConfig.agent || "opencode",
			MEDIAGO_MODEL_PLATFORM:
				process.env.MEDIAGO_MODEL_PLATFORM || platformConfig.modelPlatform || "mediago",
			MEDIAGO_MODEL_PLATFORM_MEDIAGO_BASE_URL:
				process.env.MEDIAGO_MODEL_PLATFORM_MEDIAGO_BASE_URL || platformConfig.mediagoBaseURL || "",
			MEDIAGO_GENERATION_CLIS:
				process.env.MEDIAGO_GENERATION_CLIS ||
				localGenerationCLIsEnvValue(localCLIConfig.generationClis),
			MEDIAGO_SERVER_PORT: process.env.MEDIAGO_SERVER_PORT || "48273",
			MEDIAGO_EXIT_ON_STDIN_CLOSE: "1",
			MEDIAGO_AGENT_BIN_DIR: agentsDir(),
			MEDIAGO_FFMPEG_BIN_DIR: toolsDir(),
			MEDIAGO_JIMENG_BIN_DIR: toolsDir(),
			MEDIAGO_LIBTV_BIN_DIR: toolsDir(),
			MEDIAGO_PIPPIT_BIN_DIR: toolsDir(),
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

const packagedModelPlatformConfig = () => {
	try {
		const raw = readFileSync(join(resourceRoot(), "model-platform.json"), "utf8");
		const parsed = JSON.parse(raw) as {
			agent?: unknown;
			mediagoBaseURL?: unknown;
			modelPlatform?: unknown;
		};
		return {
			agent: typeof parsed.agent === "string" ? parsed.agent.trim() : "",
			mediagoBaseURL: typeof parsed.mediagoBaseURL === "string" ? parsed.mediagoBaseURL.trim() : "",
			modelPlatform: typeof parsed.modelPlatform === "string" ? parsed.modelPlatform.trim() : "",
		};
	} catch {
		return { agent: "", mediagoBaseURL: "", modelPlatform: "" };
	}
};

const packagedLocalCLIConfig = () => {
	try {
		const raw = readFileSync(join(resourceRoot(), "local-cli.json"), "utf8");
		const parsed = JSON.parse(raw) as { generationClis?: unknown };
		const values = Array.isArray(parsed.generationClis)
			? parsed.generationClis.filter((value): value is string => typeof value === "string")
			: [];
		return { generationClis: values.map((value) => value.trim()).filter(Boolean) };
	} catch {
		return { generationClis: ["dreamina"] };
	}
};

const localGenerationCLIsEnvValue = (values: string[]) =>
	values.length > 0 ? values.join(",") : "none";

export const stopServerSidecar = () => {
	const current = child;
	child = null;
	current?.stdin.end();
	current?.kill();
};

/**
 * Stop the sidecar and wait for it to exit. Closes stdin first so the server can
 * drain in-flight requests (MEDIAGO_EXIT_ON_STDIN_CLOSE + http.Shutdown), escalates
 * to SIGKILL after the grace period. Resolves true when the process exited.
 */
export const stopServerSidecarGracefully = (graceMs = 8_000): Promise<boolean> => {
	const current = child;
	child = null;
	if (!current || current.exitCode !== null) return Promise.resolve(true);

	return new Promise((resolve) => {
		const killTimer = setTimeout(() => {
			current.kill("SIGKILL");
		}, graceMs);
		const failTimer = setTimeout(() => {
			clearTimeout(killTimer);
			resolve(false);
		}, graceMs + 4_000);
		current.once("exit", () => {
			clearTimeout(killTimer);
			clearTimeout(failTimer);
			resolve(true);
		});
		current.stdin.end();
	});
};

/** True while a sidecar child process is running. */
export const isServerSidecarRunning = () => child !== null;
