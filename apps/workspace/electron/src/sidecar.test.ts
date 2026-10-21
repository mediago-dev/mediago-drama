import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	exists: true,
	isPackaged: false,
	spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	default: { spawn: mocks.spawn },
	spawn: mocks.spawn,
}));
vi.mock("node:fs", () => {
	const existsSync = () => mocks.exists;
	const readFileSync = () => {
		throw new Error("no packaged config in unit test");
	};
	return { default: { existsSync, readFileSync }, existsSync, readFileSync };
});
vi.mock("./paths.js", () => ({
	agentsDir: () => "/resources/agents",
	appDataPaths: () => ({
		workspace: mocks.isPackaged
			? "/data/mediago-drama-oss/workspace"
			: "/home/mediago-drama-oss-dev/workspace",
	}),
	isPackaged: () => mocks.isPackaged,
	resourceRoot: () => "/resources",
	serverBinaryPath: () => "/resources/bin/mediago-server",
	toolsDir: () => "/resources/tools",
}));

class FakeChildProcess extends EventEmitter {
	constructor(ready = true) {
		super();
		this.stdout.on("newListener", (event) => {
			if (ready && event === "data")
				queueMicrotask(() =>
					this.stdout.emit("data", "MEDIAGO_SIDECAR_READY http://127.0.0.1:49153\n"),
				);
		});
	}
	exitCode: number | null = null;
	pid: number | undefined;
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	stdin = { end: vi.fn() };
	kill = vi.fn(() => true);

	exit(code = 0) {
		this.exitCode = code;
		this.emit("exit", code, null);
	}
}

describe("server sidecar lifecycle", () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.exists = true;
		mocks.spawn.mockReset();
		mocks.isPackaged = false;
		delete process.env.ELECTRON_RENDERER_URL;
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("starts the builtin server without an integrity manifest", async () => {
		const processChild = new FakeChildProcess();
		mocks.spawn.mockReturnValue(processChild);
		const sidecar = await import("./sidecar.js");

		await sidecar.startServerSidecar();

		expect(mocks.spawn).toHaveBeenCalledOnce();
		expect(mocks.spawn.mock.calls[0]?.[0]).toBe("/resources/bin/mediago-server");
		const spawnOptions = mocks.spawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
		expect(spawnOptions.env).not.toHaveProperty("MEDIAGO_BUNDLE_REV");
		expect(spawnOptions.env).not.toHaveProperty("MEDIAGO_SCHEMA_VERSION");
		expect(spawnOptions.env).not.toHaveProperty("MEDIAGO_INSTANCE_TOKEN");
		expect(spawnOptions.env?.MEDIAGO_WORKSPACE_DIR).toBe("/home/mediago-drama-oss-dev/workspace");
	});

	it("refuses to start when the server sidecar is missing", async () => {
		mocks.exists = false;
		const sidecar = await import("./sidecar.js");

		await expect(sidecar.startServerSidecar()).rejects.toThrow(
			"missing server sidecar: /resources/bin/mediago-server",
		);
		expect(mocks.spawn).not.toHaveBeenCalled();
	});

	it("ignores process injection variables in a packaged application", async () => {
		mocks.isPackaged = true;
		vi.stubEnv("ELECTRON_RENDERER_URL", "https://attacker.invalid");
		vi.stubEnv("MEDIAGO_SERVER_PORT", "59999");
		vi.stubEnv("MEDIAGO_WORKSPACE_DIR", "/official/workspace");
		vi.stubEnv("MEDIAGO_SIDECAR_TOKEN", "attacker-token");
		vi.stubEnv("MEDIAGO_MODEL_PLATFORM_MEDIAGO_BASE_URL", "https://attacker.invalid");
		vi.stubEnv("MEDIAGO_PROMPT_PACK_SIGNING_PUBLIC_KEY", "attacker-key");
		vi.stubEnv("ONE_INTERNAL_API_TOKEN", "attacker-token");
		vi.stubEnv("DYLD_INSERT_LIBRARIES", "/tmp/inject.dylib");
		vi.stubEnv("NODE_OPTIONS", "--require=/tmp/inject.js");
		vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:8888");
		vi.stubEnv("SSL_CERT_FILE", "/tmp/attacker-ca.pem");
		vi.stubEnv("SSLKEYLOGFILE", "/tmp/tls.keys");
		const processChild = new FakeChildProcess();
		mocks.spawn.mockReturnValue(processChild);
		const sidecar = await import("./sidecar.js");

		const connection = await sidecar.startServerSidecar();

		const spawnOptions = mocks.spawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
		expect(spawnOptions.env).toMatchObject({
			MEDIAGO_SERVER_PORT: "0",
			MEDIAGO_WORKSPACE_DIR: "/data/mediago-drama-oss/workspace",
			MEDIAGO_SIDECAR_MODE: "1",
		});
		expect(connection?.origin).toBe("http://127.0.0.1:49153");
		expect(connection?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(spawnOptions.env?.MEDIAGO_SIDECAR_TOKEN).toBe(connection?.token);
		expect(spawnOptions.env?.MEDIAGO_SIDECAR_TOKEN).not.toBe("attacker-token");
		expect(spawnOptions.env).not.toHaveProperty("MEDIAGO_MODEL_PLATFORM_MEDIAGO_BASE_URL");
		expect(spawnOptions.env).not.toHaveProperty("MEDIAGO_PROMPT_PACK_SIGNING_PUBLIC_KEY");
		expect(spawnOptions.env).not.toHaveProperty("ONE_INTERNAL_API_TOKEN");
		expect(spawnOptions.env).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
		expect(spawnOptions.env).not.toHaveProperty("NODE_OPTIONS");
		expect(spawnOptions.env).not.toHaveProperty("HTTPS_PROXY");
		expect(spawnOptions.env).not.toHaveProperty("SSL_CERT_FILE");
		expect(spawnOptions.env).not.toHaveProperty("SSLKEYLOGFILE");
	});

	it("allows an explicit development workspace override", async () => {
		vi.stubEnv("MEDIAGO_WORKSPACE_DIR", "/custom/workspace");
		mocks.spawn.mockReturnValue(new FakeChildProcess());
		const sidecar = await import("./sidecar.js");
		await sidecar.startServerSidecar();
		expect(mocks.spawn.mock.calls[0]?.[2].env.MEDIAGO_WORKSPACE_DIR).toBe("/custom/workspace");
	});

	it("leaves the builtin sidecar to the development server only in development", async () => {
		vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:31420");
		const sidecar = await import("./sidecar.js");

		expect(await sidecar.startServerSidecar()).toBeNull();
		expect(mocks.spawn).not.toHaveBeenCalled();
	});

	it("owns the configured development server even with a Vite renderer", async () => {
		vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:31421");
		vi.stubEnv("MEDIAGO_DEV_SERVER_PATH", "/repo/bin/mediago-server");
		vi.stubEnv("MEDIAGO_DEV_SERVER_CONFIG", "/repo/services/server/configs/server.yaml");
		vi.stubEnv("MEDIAGO_SERVER_PORT", "0");
		vi.stubEnv("MEDIAGO_AGENT_BIN_DIR", "/repo/packages/vendor/dist");
		for (const tool of ["FFMPEG", "JIMENG", "LIBTV"]) {
			vi.stubEnv(`MEDIAGO_${tool}_BIN_DIR`, "/repo/packages/vendor/dist/tools");
		}
		const child = new FakeChildProcess(false);
		mocks.spawn.mockReturnValue(child);
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");
		const pending = sidecar.startServerSidecar();
		expect(mocks.spawn).toHaveBeenCalledWith(
			"/repo/bin/mediago-server",
			["--config", "/repo/services/server/configs/server.yaml"],
			expect.objectContaining({
				stdio: ["pipe", "pipe", "pipe"],
				env: expect.objectContaining({
					MEDIAGO_SERVER_PORT: "0",
					MEDIAGO_SIDECAR_MODE: "1",
					MEDIAGO_EXIT_ON_STDIN_CLOSE: "1",
					MEDIAGO_AGENT_BIN_DIR: "/repo/packages/vendor/dist",
					MEDIAGO_FFMPEG_BIN_DIR: "/repo/packages/vendor/dist/tools",
					MEDIAGO_JIMENG_BIN_DIR: "/repo/packages/vendor/dist/tools",
					MEDIAGO_LIBTV_BIN_DIR: "/repo/packages/vendor/dist/tools",
				}),
			}),
		);
		child.stdout.emit("data", "MEDIAGO_SIDECAR_READY http://127.0.0.1:49214\n");
		expect((await pending)?.origin).toBe("http://127.0.0.1:49214");
		expect(console.log).toHaveBeenCalledWith("[desktop] server: http://127.0.0.1:49214");
		sidecar.stopServerSidecar();
		expect(child.stdin.end).toHaveBeenCalledOnce();
	});

	it("ignores development binary and tool overrides in packaged builds", async () => {
		mocks.isPackaged = true;
		vi.stubEnv("MEDIAGO_DEV_SERVER_PATH", "/repo/bin/mediago-server");
		vi.stubEnv("MEDIAGO_DEV_SERVER_CONFIG", "/repo/server.yaml");
		vi.stubEnv("MEDIAGO_AGENT_BIN_DIR", "/unrelated/agents");
		vi.stubEnv("MEDIAGO_FFMPEG_BIN_DIR", "/unrelated/tools");
		mocks.spawn.mockReturnValue(new FakeChildProcess());
		const sidecar = await import("./sidecar.js");
		await sidecar.startServerSidecar();
		expect(mocks.spawn.mock.calls[0]?.slice(0, 2)).toEqual(["/resources/bin/mediago-server", []]);
		expect(mocks.spawn.mock.calls[0]?.[2].env).toMatchObject({
			MEDIAGO_AGENT_BIN_DIR: "/resources/agents",
			MEDIAGO_FFMPEG_BIN_DIR: "/resources/tools",
		});
	});

	it("clears a failed spawn and allows retry", async () => {
		const first = new FakeChildProcess();
		const second = new FakeChildProcess();
		mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");

		await sidecar.startServerSidecar();
		first.emit("error", new Error("spawn failed"));
		await sidecar.startServerSidecar();

		expect(mocks.spawn).toHaveBeenCalledTimes(2);
	});

	it("does not let a stale child exit clear its replacement", async () => {
		const first = new FakeChildProcess();
		const second = new FakeChildProcess();
		mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");

		await sidecar.startServerSidecar();
		first.emit("error", new Error("spawn failed"));
		await sidecar.startServerSidecar();
		first.exit();
		await sidecar.startServerSidecar();

		expect(mocks.spawn).toHaveBeenCalledTimes(2);
	});

	it("retains a live child when a post-spawn operation emits error", async () => {
		const processChild = new FakeChildProcess();
		processChild.pid = 4242;
		mocks.spawn.mockReturnValue(processChild);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");

		await sidecar.startServerSidecar();
		processChild.emit("error", new Error("kill EPERM"));
		await sidecar.startServerSidecar();

		expect(mocks.spawn).toHaveBeenCalledOnce();
	});

	it("requests graceful shutdown through stdin and SIGTERM", async () => {
		const processChild = new FakeChildProcess();
		mocks.spawn.mockReturnValue(processChild);
		const sidecar = await import("./sidecar.js");
		await sidecar.startServerSidecar();

		sidecar.stopServerSidecar();

		expect(processChild.stdin.end).toHaveBeenCalledOnce();
		expect(processChild.kill).toHaveBeenCalledWith("SIGTERM");
	});
	it("waits for a complete owned readiness line", async () => {
		const child = new FakeChildProcess(false);
		mocks.spawn.mockReturnValue(child);
		const sidecar = await import("./sidecar.js");
		let settled = false;
		const start = sidecar.startServerSidecar().then((result) => {
			settled = true;
			return result;
		});
		child.stdout.emit("data", "MEDIAGO_SIDECAR_READY http://127.0.0.1:492");
		await Promise.resolve();
		expect(settled).toBe(false);
		child.stdout.emit("data", "14\n");
		expect((await start)?.origin).toBe("http://127.0.0.1:49214");
	});
	it("rejects startup if the child exits before readiness", async () => {
		const child = new FakeChildProcess(false);
		mocks.spawn.mockReturnValue(child);
		const sidecar = await import("./sidecar.js");
		const start = sidecar.startServerSidecar();
		child.exit(1);
		await expect(start).rejects.toThrow("before it was ready");
	});
});
