import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	agentsDir,
	appDataPaths,
	isPackaged,
	resourceRoot,
	serverBinaryPath,
	toolsDir,
} from "./paths.js";

let child: ChildProcessWithoutNullStreams | null = null;
let connection: SidecarConnection | null = null;
let starting: Promise<SidecarConnection> | null = null;

export type SidecarConnection = {
	origin: string;
	token: string;
};

export const startServerSidecar = async (): Promise<SidecarConnection | null> => {
	const developmentServer = !isPackaged() ? process.env.MEDIAGO_DEV_SERVER_PATH?.trim() : undefined;
	if (!isPackaged() && process.env.ELECTRON_RENDERER_URL && !developmentServer) return null;
	if (starting) return starting;
	if (child && child.exitCode === null && connection) return connection;

	const serverPath = developmentServer || serverBinaryPath();
	if (!existsSync(serverPath)) {
		throw new Error(`missing server sidecar: ${serverPath}`);
	}
	const platformConfig = packagedModelPlatformConfig();
	const localCLIConfig = packagedLocalCLIConfig();
	const token = randomBytes(32).toString("base64url");
	const serverPort = configuredServerPort();
	const environment = sidecarEnvironment(platformConfig, localCLIConfig, serverPort, token);

	const configPath = developmentServer ? process.env.MEDIAGO_DEV_SERVER_CONFIG?.trim() : undefined;
	const spawned = spawn(serverPath, configPath ? ["--config", configPath] : [], {
		env: environment,
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	child = spawned;
	const pending = new Promise<SidecarConnection>((resolve, reject) => {
		const timeout = setTimeout(() => {
			spawned.stdin.end();
			spawned.kill();
			reject(new Error("server sidecar startup timed out"));
		}, 60_000);
		let output = "";
		spawned.stdout.on("data", (chunk) => {
			output += String(chunk);
			if (output.length > 65_536) output = output.slice(-65_536);
			const match = /(?:^|\n)MEDIAGO_SIDECAR_READY (http:\/\/127\.0\.0\.1:(\d+))\r?\n/.exec(output);
			if (match && Number(match[2]) > 0 && Number(match[2]) <= 65535) {
				clearTimeout(timeout);
				connection = { origin: match[1]!, token };
				resolve(connection);
			}
		});
		spawned.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		spawned.once("exit", () => {
			clearTimeout(timeout);
			reject(new Error("server sidecar exited before it was ready"));
		});
	});
	starting = pending;
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
	try {
		const ready = await pending;
		if (developmentServer) console.log(`[desktop] server: ${ready.origin}`);
		return ready;
	} finally {
		if (starting === pending) starting = null;
	}
};

const clearSidecar = (exited: ChildProcessWithoutNullStreams) => {
	if (child === exited) {
		child = null;
		connection = null;
	}
};

const packagedModelPlatformConfig = () => {
	try {
		const raw = readFileSync(join(resourceRoot(), "model-platform.json"), "utf8");
		const parsed = JSON.parse(raw) as {
			agent?: unknown;
			modelPlatform?: unknown;
		};
		return {
			agent: typeof parsed.agent === "string" ? parsed.agent.trim() : "",
			modelPlatform: typeof parsed.modelPlatform === "string" ? parsed.modelPlatform.trim() : "",
		};
	} catch {
		return { agent: "", modelPlatform: "" };
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

const sidecarEnvironment = (
	platformConfig: ReturnType<typeof packagedModelPlatformConfig>,
	localCLIConfig: ReturnType<typeof packagedLocalCLIConfig>,
	serverPort: string,
	token: string,
): NodeJS.ProcessEnv => {
	const packaged = isPackaged();
	const inherited = packaged ? sanitizedPackagedEnvironment(process.env) : { ...process.env };
	const configuredValue = (name: string, fallback: string) => {
		if (!packaged) {
			const override = process.env[name]?.trim();
			if (override) return override;
		}
		return fallback;
	};

	return {
		...inherited,
		MEDIAGO_WORKSPACE_DIR: configuredValue("MEDIAGO_WORKSPACE_DIR", appDataPaths().workspace),
		MEDIAGO_AGENT_ID: "codex",
		MEDIAGO_MODEL_PLATFORM: configuredValue(
			"MEDIAGO_MODEL_PLATFORM",
			platformConfig.modelPlatform || "openrouter",
		),
		MEDIAGO_GENERATION_CLIS: configuredValue(
			"MEDIAGO_GENERATION_CLIS",
			localGenerationCLIsEnvValue(localCLIConfig.generationClis),
		),
		MEDIAGO_SERVER_PORT: serverPort,
		MEDIAGO_EXIT_ON_STDIN_CLOSE: "1",
		MEDIAGO_SIDECAR_MODE: "1",
		MEDIAGO_SIDECAR_TOKEN: token,
		MEDIAGO_AGENT_BIN_DIR: configuredValue("MEDIAGO_AGENT_BIN_DIR", agentsDir()),
		MEDIAGO_FFMPEG_BIN_DIR: configuredValue("MEDIAGO_FFMPEG_BIN_DIR", toolsDir()),
		MEDIAGO_JIMENG_BIN_DIR: configuredValue("MEDIAGO_JIMENG_BIN_DIR", toolsDir()),
		MEDIAGO_LIBTV_BIN_DIR: configuredValue("MEDIAGO_LIBTV_BIN_DIR", toolsDir()),
	};
};

const configuredServerPort = () => {
	if (!isPackaged()) {
		const override = process.env.MEDIAGO_SERVER_PORT?.trim();
		if (override) return override;
	}
	return "0";
};

const blockedPackagedEnvironmentNames = new Set([
	"BASH_ENV",
	"ELECTRON_RUN_AS_NODE",
	"ENV",
	"GODEBUG",
	"GOTRACEBACK",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"ALL_PROXY",
	"LD_LIBRARY_PATH",
	"LD_PRELOAD",
	"NO_PROXY",
	"NODE_OPTIONS",
	"NODE_PATH",
	"PERL5OPT",
	"PYTHONHOME",
	"PYTHONPATH",
	"RUBYOPT",
	"SSL_CERT_DIR",
	"SSL_CERT_FILE",
	"SSLKEYLOGFILE",
]);

const sanitizedPackagedEnvironment = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
	Object.fromEntries(
		Object.entries(environment).filter(([name]) => {
			const normalized = name.toUpperCase();
			return (
				!normalized.startsWith("MEDIAGO_") &&
				!normalized.startsWith("ONE_INTERNAL_") &&
				!normalized.startsWith("DYLD_") &&
				!blockedPackagedEnvironmentNames.has(normalized)
			);
		}),
	);

export const stopServerSidecar = () => {
	const current = child;
	if (!current || current.exitCode !== null) return;
	current.stdin.end();
	current.kill("SIGTERM");
};
