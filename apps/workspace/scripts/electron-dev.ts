import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer, type InlineConfig } from "vite";
import { resolveAppDataPaths } from "../electron/src/data-paths.ts";

const workspaceDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export const startDesktopRenderer = async (config: InlineConfig = {}) => {
	const server = await createServer({
		root: workspaceDir,
		configFile: join(workspaceDir, "vite.config.ts"),
		...config,
		server: {
			port: 31420,
			...config.server,
			host: "127.0.0.1",
			strictPort: false,
			open: false,
		},
	});
	try {
		await server.listen();
		const address = server.httpServer?.address();
		if (!address || typeof address === "string") {
			throw new Error("Desktop renderer did not open a local TCP port");
		}
		return {
			url: `http://127.0.0.1:${address.port}`,
			close: () => server.close(),
		};
	} catch (error) {
		await server.close();
		throw error;
	}
};

const runChild = (
	executable: string,
	args: string[],
	signal: AbortSignal,
	env: NodeJS.ProcessEnv = process.env,
	owned = false,
) =>
	new Promise<number>((resolve, reject) => {
		const child = spawn(executable, args, {
			cwd: workspaceDir,
			env,
			signal,
			stdio: owned ? ["ignore", "inherit", "inherit", "ipc"] : "inherit",
			windowsHide: true,
		});
		child.once("error", reject);
		child.once("exit", (code) => resolve(code ?? 1));
	});

const compileElectron = async (signal: AbortSignal) => {
	const code = await runChild(process.execPath, ["scripts/compile-electron.ts"], signal);
	if (code !== 0) throw new Error(`Electron compilation failed (exit ${code})`);
};

const launchElectron = (url: string, signal: AbortSignal) => {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		ELECTRON_RENDERER_URL: url,
		MEDIAGO_DEV_PARENT_IPC: "1",
	};
	delete env.ELECTRON_RUN_AS_NODE;
	const userData = resolveAppDataPaths(false, "", homedir()).userData;
	return runChild(
		require("electron") as string,
		[`--user-data-dir=${userData}`, "electron/dist/main.js"],
		signal,
		env,
		true,
	);
};

type DesktopDevOptions = {
	signal: AbortSignal;
	createRenderer?: typeof startDesktopRenderer;
	compile?: typeof compileElectron;
	launch?: typeof launchElectron;
};

export const runDesktopDevelopment = async ({
	signal,
	createRenderer = startDesktopRenderer,
	compile = compileElectron,
	launch = launchElectron,
}: DesktopDevOptions) => {
	signal.throwIfAborted();
	const renderer = await createRenderer();
	try {
		console.log(`[desktop] renderer: ${renderer.url}`);
		await compile(signal);
		signal.throwIfAborted();
		return await launch(renderer.url, signal);
	} finally {
		await renderer.close();
	}
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		process.exitCode = await runDesktopDevelopment({ signal: controller.signal });
	} catch (error) {
		if (!controller.signal.aborted) {
			console.error("[desktop] startup failed:", error);
			process.exitCode = 1;
		}
	} finally {
		process.removeListener("SIGINT", stop);
		process.removeListener("SIGTERM", stop);
	}
}
