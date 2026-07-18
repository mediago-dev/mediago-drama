import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentsDir, isPackaged, resourceRoot, serverBinaryPath, toolsDir } from "./paths.js";

let child: ChildProcessWithoutNullStreams | null = null;
let connection: SidecarConnection | null = null;

export type SidecarConnection = {
	origin: string;
	token: string;
};

export const startServerSidecar = (): SidecarConnection | null => {
	if (!isPackaged() && process.env.ELECTRON_RENDERER_URL) return null;
	if (child && child.exitCode === null && connection) return connection;

	const serverPath = serverBinaryPath();
	if (!existsSync(serverPath)) {
		throw new Error(`missing server sidecar: ${serverPath}`);
	}
	const platformConfig = packagedModelPlatformConfig();
	const localCLIConfig = packagedLocalCLIConfig();
	const token = randomBytes(32).toString("base64url");
	const serverPort = configuredServerPort();
	const environment = sidecarEnvironment(platformConfig, localCLIConfig, serverPort, token);

	const spawned = spawn(serverPath, [], {
		env: environment,
		stdio: ["pipe", "pipe", "pipe"],
	});
	child = spawned;
	connection = { origin: `http://127.0.0.1:${serverPort}`, token };

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
	return connection;
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
		MEDIAGO_AGENT_ID: configuredValue("MEDIAGO_AGENT_ID", platformConfig.agent || "opencode"),
		MEDIAGO_MODEL_PLATFORM: configuredValue(
			"MEDIAGO_MODEL_PLATFORM",
			platformConfig.modelPlatform || "mediago",
		),
		MEDIAGO_MODEL_PLATFORM_MEDIAGO_BASE_URL: configuredValue(
			"MEDIAGO_MODEL_PLATFORM_MEDIAGO_BASE_URL",
			platformConfig.mediagoBaseURL || "",
		),
		MEDIAGO_GENERATION_CLIS: configuredValue(
			"MEDIAGO_GENERATION_CLIS",
			localGenerationCLIsEnvValue(localCLIConfig.generationClis),
		),
		MEDIAGO_SERVER_PORT: serverPort,
		MEDIAGO_EXIT_ON_STDIN_CLOSE: "1",
		MEDIAGO_SIDECAR_MODE: "1",
		MEDIAGO_SIDECAR_TOKEN: token,
		MEDIAGO_AGENT_BIN_DIR: agentsDir(),
		MEDIAGO_FFMPEG_BIN_DIR: toolsDir(),
		MEDIAGO_JIMENG_BIN_DIR: toolsDir(),
		MEDIAGO_LIBTV_BIN_DIR: toolsDir(),
		MEDIAGO_PIPPIT_BIN_DIR: toolsDir(),
	};
};

const configuredServerPort = () => {
	if (!isPackaged()) {
		const override = process.env.MEDIAGO_SERVER_PORT?.trim();
		if (override) return override;
	}
	return "48273";
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
