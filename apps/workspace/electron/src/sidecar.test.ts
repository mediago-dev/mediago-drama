import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	default: { spawn: mocks.spawn },
	spawn: mocks.spawn,
}));
vi.mock("node:fs", () => {
	const existsSync = () => true;
	const readFileSync = () => {
		throw new Error("no packaged config in unit test");
	};
	return { default: { existsSync, readFileSync }, existsSync, readFileSync };
});
vi.mock("./paths.js", () => ({
	agentsDir: () => "/resources/agents",
	resourceRoot: () => "/resources",
	serverBinaryPath: () => "/resources/bin/server",
	toolsDir: () => "/resources/tools",
}));

class FakeChildProcess extends EventEmitter {
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
		mocks.spawn.mockReset();
		delete process.env.ELECTRON_RENDERER_URL;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("starts the builtin server without bundle identity", async () => {
		const processChild = new FakeChildProcess();
		mocks.spawn.mockReturnValue(processChild);
		const sidecar = await import("./sidecar.js");

		sidecar.startServerSidecar();

		expect(mocks.spawn).toHaveBeenCalledOnce();
		expect(mocks.spawn.mock.calls[0]?.[0]).toBe("/resources/bin/server");
		const spawnOptions = mocks.spawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
		expect(spawnOptions.env).not.toHaveProperty("MEDIAGO_BUNDLE_REV");
		expect(spawnOptions.env).not.toHaveProperty("MEDIAGO_SCHEMA_VERSION");
		expect(spawnOptions.env).not.toHaveProperty("MEDIAGO_INSTANCE_TOKEN");
	});

	it("clears a failed spawn and allows retry", async () => {
		const first = new FakeChildProcess();
		const second = new FakeChildProcess();
		mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");

		sidecar.startServerSidecar();
		first.emit("error", new Error("spawn failed"));
		sidecar.startServerSidecar();

		expect(mocks.spawn).toHaveBeenCalledTimes(2);
	});

	it("does not let a stale child exit clear its replacement", async () => {
		const first = new FakeChildProcess();
		const second = new FakeChildProcess();
		mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");

		sidecar.startServerSidecar();
		first.emit("error", new Error("spawn failed"));
		sidecar.startServerSidecar();
		first.exit();
		sidecar.startServerSidecar();

		expect(mocks.spawn).toHaveBeenCalledTimes(2);
	});

	it("retains a live child when a post-spawn operation emits error", async () => {
		const processChild = new FakeChildProcess();
		processChild.pid = 4242;
		mocks.spawn.mockReturnValue(processChild);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");

		sidecar.startServerSidecar();
		processChild.emit("error", new Error("kill EPERM"));
		sidecar.startServerSidecar();

		expect(mocks.spawn).toHaveBeenCalledOnce();
	});

	it("requests graceful shutdown through stdin and SIGTERM", async () => {
		const processChild = new FakeChildProcess();
		mocks.spawn.mockReturnValue(processChild);
		const sidecar = await import("./sidecar.js");
		sidecar.startServerSidecar();

		sidecar.stopServerSidecar();

		expect(processChild.stdin.end).toHaveBeenCalledOnce();
		expect(processChild.kill).toHaveBeenCalledWith("SIGTERM");
	});
});
