import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	runDesktopDevelopment,
	startDesktopRenderer,
} from "../../apps/workspace/scripts/electron-dev.ts";

const fixture = (t: TestContext) => {
	const root = mkdtempSync(join(tmpdir(), "mediago-electron-dev-"));
	writeFileSync(join(root, "index.html"), "<title>owned desktop renderer</title>");
	t.after(() => rmSync(root, { force: true, recursive: true }));
	return root;
};

test("desktop uses its own Vite URL when the preferred port is occupied", async (t) => {
	const root = fixture(t);
	let unrelatedRequests = 0;
	const unrelated = createServer((_request, response) => {
		unrelatedRequests++;
		response.end("another project");
	});
	unrelated.listen(0, "127.0.0.1");
	await once(unrelated, "listening");
	t.after(() => new Promise<void>((resolve) => unrelated.close(() => resolve())));
	const address = unrelated.address();
	assert.ok(address && typeof address !== "string");
	let rendererURL = "";
	let compiled = false;
	const code = await runDesktopDevelopment({
		signal: new AbortController().signal,
		createRenderer: () =>
			startDesktopRenderer({
				root,
				configFile: false,
				optimizeDeps: { noDiscovery: true, include: [] },
				server: { port: address.port },
			}),
		compile: async () => {
			compiled = true;
		},
		launch: async (url) => {
			rendererURL = url;
			assert.ok(compiled);
			assert.notEqual(new URL(url).port, String(address.port));
			assert.match(await (await fetch(url)).text(), /owned desktop renderer/);
			return 0;
		},
	});
	assert.equal(code, 0);
	assert.equal(unrelatedRequests, 0);
	await assert.rejects(fetch(rendererURL));
	assert.equal(await (await fetch(`http://127.0.0.1:${address.port}`)).text(), "another project");
});

test(
	"Electron owns a native backend on a fresh port and stops it when its parent closes",
	{ skip: !process.env.MEDIAGO_TEST_DEV_SERVER_BIN, timeout: 30_000 },
	async (t) => {
		const root = fixture(t);
		const repo = fileURLToPath(new URL("../../", import.meta.url));
		const desktopDir = join(repo, "apps/workspace");
		const electron = createRequire(join(desktopDir, "package.json"))("electron") as string;
		const entry = join(root, "main.mjs");
		// Isolate Electron's development data and single-instance lock as well as the Go workspace.
		writeFileSync(
			join(root, "setup.mjs"),
			`import { app } from 'electron';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
os.homedir = () => ${JSON.stringify(root)};
syncBuiltinESMExports();
app.setName(${JSON.stringify(`mediago-dev-smoke-${basename(root)}`)});
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(
        "(async () => { const origin = window.mediagoDesktop.serverOrigin; const read = async (path) => (await (await fetch(origin + path)).json()).data; const [keys, models, platforms] = await Promise.all([read('/api/v1/settings/api-keys'), read('/api/v1/generation/models'), read('/api/v1/settings/model-platforms')]); return { origin, status: (await fetch(origin + '/api/v1/health')).status, apiProviders: keys.providers.map(p => p.id), routeProviders: [...new Set(models.routes.map(r => r.provider))], platformIDs: platforms.platforms.map(p => p.id) }; })()"
      );
      console.log('MEDIAGO_DEV_SMOKE ' + JSON.stringify(result));
    } catch (error) { console.error(error); app.exit(1); }
  });
});
`,
		);
		writeFileSync(
			entry,
			`import './setup.mjs';\nimport ${JSON.stringify(pathToFileURL(join(desktopDir, "electron/dist/main.js")).href)};\n`,
		);
		const renderer = await startDesktopRenderer({
			root,
			configFile: false,
			optimizeDeps: { noDiscovery: true, include: [] },
		});
		t.after(() => renderer.close());
		const env: NodeJS.ProcessEnv = {
			...process.env,
			ELECTRON_RENDERER_URL: renderer.url,
			MEDIAGO_DEV_PARENT_IPC: "1",
			MEDIAGO_DEV_SERVER_PATH: resolve(process.env.MEDIAGO_TEST_DEV_SERVER_BIN!),
			MEDIAGO_DEV_SERVER_CONFIG: join(repo, "services/server/configs/server.yaml"),
			MEDIAGO_WORKSPACE_DIR: join(root, "workspace"),
			MEDIAGO_AGENT_BIN_DIR: join(repo, "packages/vendor/dist"),
			MEDIAGO_GENERATION_CLIS: "none",
			MEDIAGO_SERVER_PORT: "0",
		};
		delete env.ELECTRON_RUN_AS_NODE;
		const child = spawn(
			electron,
			[`--user-data-dir=${join(root, "mediago-drama-oss-dev/electron")}`, entry],
			{
				env,
				stdio: ["ignore", "pipe", "pipe", "ipc"],
				windowsHide: true,
			},
		);
		const exited = once(child, "exit");
		t.after(async () => {
			if (child.exitCode === null) child.kill();
			await exited;
		});
		let errors = "";
		child.stderr.on("data", (chunk) => {
			errors = (errors + chunk).slice(-16_384);
		});
		const result = await new Promise<{
			origin: string;
			status: number;
			apiProviders: string[];
			routeProviders: string[];
			platformIDs: string[];
		}>((resolve, reject) => {
			let output = "";
			const timeout = setTimeout(
				() => reject(new Error(`Desktop startup timed out: ${errors}`)),
				20_000,
			);
			child.stdout.on("data", (chunk) => {
				output = (output + chunk).slice(-16_384);
				const match = /(?:^|\n)MEDIAGO_DEV_SMOKE (\{[^\n]+\})\r?\n/.exec(output);
				if (match) {
					clearTimeout(timeout);
					resolve(JSON.parse(match[1]!));
				}
			});
			child.once("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});
			child.once("exit", (code) => {
				clearTimeout(timeout);
				reject(new Error(`Desktop exited before readiness (${code}): ${output}\n${errors}`));
			});
		});
		assert.match(result.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
		assert.notEqual(new URL(result.origin).port, "8080");
		assert.equal(result.status, 200);
		for (const id of ["mediago", "dmx", "dmxapi", "xiaoyunque", "pippit"]) {
			assert.ok(!result.apiProviders.includes(id), `removed credential provider: ${id}`);
			assert.ok(!result.routeProviders.includes(id), `removed execution provider: ${id}`);
			assert.ok(!result.platformIDs.includes(id), `removed platform: ${id}`);
		}
		assert.ok(result.apiProviders.includes("openrouter"));
		// The desktop adds the private sidecar token; requests outside it must be rejected.
		assert.equal((await fetch(result.origin + "/api/v1/health")).status, 401);
		child.disconnect();
		assert.equal((await exited)[0], 0);
		await assert.rejects(fetch(result.origin + "/api/v1/health"));
	},
);

test("compilation failure closes the owned renderer and does not launch Electron", async (t) => {
	const root = fixture(t);
	const renderer = await startDesktopRenderer({ root, configFile: false, server: { port: 0 } });
	let launched = false;
	await assert.rejects(
		runDesktopDevelopment({
			signal: new AbortController().signal,
			createRenderer: async () => renderer,
			compile: async () => {
				throw new Error("compile failed");
			},
			launch: async () => {
				launched = true;
				return 0;
			},
		}),
		/compile failed/,
	);
	assert.equal(launched, false);
	await assert.rejects(fetch(renderer.url));
});

test("the workspace Vite configuration starts when port 31420 is occupied", async (t) => {
	const blocker = createServer((_request, response) => response.end("occupied"));
	try {
		blocker.listen(31420, "127.0.0.1");
		await once(blocker, "listening");
		t.after(() => new Promise<void>((resolve) => blocker.close(() => resolve())));
	} catch (error) {
		// An existing local development server already provides the occupied-port case.
		if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
	}
	const renderer = await startDesktopRenderer({
		optimizeDeps: { noDiscovery: true, include: [] },
	});
	try {
		assert.notEqual(new URL(renderer.url).port, "31420");
		const response = await fetch(renderer.url);
		assert.equal(response.status, 200);
		assert.match(await response.text(), /\/src\/main\.tsx/);
	} finally {
		await renderer.close();
	}
});
