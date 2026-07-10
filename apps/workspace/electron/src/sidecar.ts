import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { agentsDir, resourceRoot, serverBinaryPath, toolsDir } from "./paths.js";

export interface SidecarIdentity {
	bundleRev: number;
	schemaVersion: number;
	instanceToken: string;
}

interface RunningSidecar {
	process: ChildProcessWithoutNullStreams;
	identity: SidecarIdentity;
}

let child: RunningSidecar | null = null;

/** Port the sidecar listens on; must stay in sync with the env passed at spawn. */
export const serverSidecarPort = () => Number(process.env.MEDIAGO_SERVER_PORT || "48273");

export const serverSidecarBaseUrl = () => `http://127.0.0.1:${serverSidecarPort()}`;

const isServerSidecarPortFree = (probeTimeoutMs = 250): Promise<boolean> =>
	new Promise((resolve) => {
		let settled = false;
		const socket = createConnection({ host: "127.0.0.1", port: serverSidecarPort() });
		const finish = (free: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			socket.destroy();
			resolve(free);
		};
		const timeout = setTimeout(() => finish(false), probeTimeoutMs);
		socket.once("connect", () => finish(false));
		socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED"));
	});

/** Wait until no process is listening on the sidecar port. */
export const waitForServerSidecarPortFree = async (timeoutMs = 5_000): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	do {
		if (await isServerSidecarPortFree()) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	} while (Date.now() < deadline);
	return false;
};

export interface StartServerSidecarOptions {
	/** Absolute server binary path; defaults to the builtin resources binary. */
	binaryPath?: string;
	/** Bundle revision expected from the readiness endpoint. */
	bundleRev: number;
	/** Persistence schema version expected from the readiness endpoint. */
	schemaVersion: number;
}

export const startServerSidecar = (options: StartServerSidecarOptions): SidecarIdentity => {
	if (child && child.process.exitCode === null) return child.identity;

	const identity: SidecarIdentity = {
		bundleRev: options.bundleRev,
		schemaVersion: options.schemaVersion,
		instanceToken: randomUUID(),
	};
	if (process.env.ELECTRON_RENDERER_URL) return identity;

	const serverPath = options.binaryPath || serverBinaryPath();
	if (!existsSync(serverPath)) {
		throw new Error(`missing server sidecar: ${serverPath}`);
	}
	const platformConfig = packagedModelPlatformConfig();
	const localCLIConfig = packagedLocalCLIConfig();

	const spawned = spawn(serverPath, [], {
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
			MEDIAGO_BUNDLE_REV: String(identity.bundleRev),
			MEDIAGO_SCHEMA_VERSION: String(identity.schemaVersion),
			MEDIAGO_INSTANCE_TOKEN: identity.instanceToken,
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
	child = { process: spawned, identity };

	spawned.stdout.on("data", (chunk) => {
		console.info(`[mediago-server] ${String(chunk).trimEnd()}`);
	});
	spawned.stderr.on("data", (chunk) => {
		console.error(`[mediago-server] ${String(chunk).trimEnd()}`);
	});
	spawned.on("error", (error) => {
		console.error(`[mediago-server] failed to start: ${error.message}`);
		// `error` is not limited to spawn failure: Node also emits it when a later
		// kill/send operation fails. Once a PID exists the process may still be alive,
		// so retaining the handle is mandatory until an actual exit is observed.
		if (spawned.pid === undefined) clearSidecar(spawned);
	});
	spawned.on("exit", () => clearSidecar(spawned));
	return identity;
};

const clearSidecar = (exited: ChildProcessWithoutNullStreams) => {
	if (child?.process === exited) child = null;
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
	const current = child?.process;
	if (!current || current.exitCode !== null) return;
	current.stdin.end();
	current.kill("SIGTERM");
};

/**
 * Stop the sidecar and wait for it to exit. Closes stdin first so the server can
 * drain in-flight requests (MEDIAGO_EXIT_ON_STDIN_CLOSE + http.Shutdown), escalates
 * to SIGKILL after the grace period. Resolves true when the process exited.
 */
export const stopServerSidecarGracefully = (graceMs = 8_000): Promise<boolean> => {
	const current = child?.process;
	if (!current) return Promise.resolve(true);
	if (current.exitCode !== null) {
		clearSidecar(current);
		return Promise.resolve(true);
	}

	return new Promise((resolve) => {
		let settled = false;
		const termTimer = setTimeout(() => {
			current.kill("SIGTERM");
		}, graceMs);
		const killTimer = setTimeout(() => {
			current.kill("SIGKILL");
		}, graceMs + 2_000);
		const failTimer = setTimeout(() => {
			settled = true;
			clearTimeout(termTimer);
			clearTimeout(killTimer);
			resolve(false);
		}, graceMs + 4_000);
		current.once("exit", () => {
			if (settled) return;
			settled = true;
			clearTimeout(termTimer);
			clearTimeout(killTimer);
			clearTimeout(failTimer);
			resolve(true);
		});
		current.stdin.end();
	});
};

/** True while a sidecar child process is running. */
export const isServerSidecarRunning = () => child !== null && child.process.exitCode === null;
