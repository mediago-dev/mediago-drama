import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(),
	randomUUID: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	default: { spawn: mocks.spawn },
	spawn: mocks.spawn,
}));
vi.mock("node:crypto", () => ({
	default: { randomUUID: mocks.randomUUID },
	randomUUID: mocks.randomUUID,
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
		vi.useRealTimers();
		mocks.spawn.mockReset();
		mocks.randomUUID.mockReset();
		delete process.env.ELECTRON_RENDERER_URL;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("injects the expected identity and consumes spawn errors", async () => {
		const processChild = new FakeChildProcess();
		mocks.spawn.mockReturnValue(processChild);
		mocks.randomUUID.mockReturnValue("instance-a");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");

		const identity = sidecar.startServerSidecar({
			binaryPath: "/bundle/server",
			bundleRev: 12,
			schemaVersion: 4,
		});

		expect(identity).toEqual({ bundleRev: 12, schemaVersion: 4, instanceToken: "instance-a" });
		const spawnOptions = mocks.spawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
		expect(spawnOptions.env).toMatchObject({
			MEDIAGO_BUNDLE_REV: "12",
			MEDIAGO_SCHEMA_VERSION: "4",
			MEDIAGO_INSTANCE_TOKEN: "instance-a",
		});
		expect(sidecar.isServerSidecarRunning()).toBe(true);

		processChild.emit("error", new Error("spawn failed"));
		expect(sidecar.isServerSidecarRunning()).toBe(false);
	});

	it("does not let a stale child exit clear a replacement", async () => {
		const first = new FakeChildProcess();
		const second = new FakeChildProcess();
		mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
		mocks.randomUUID.mockReturnValueOnce("instance-a").mockReturnValueOnce("instance-b");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");

		sidecar.startServerSidecar({ bundleRev: 1, schemaVersion: 1 });
		first.emit("error", new Error("spawn failed"));
		sidecar.startServerSidecar({ bundleRev: 2, schemaVersion: 1 });
		first.exit();

		expect(sidecar.isServerSidecarRunning()).toBe(true);
		second.exit();
		expect(sidecar.isServerSidecarRunning()).toBe(false);
	});

	it("retains a live child when a post-spawn operation emits error", async () => {
		const processChild = new FakeChildProcess();
		processChild.pid = 4242;
		mocks.spawn.mockReturnValue(processChild);
		mocks.randomUUID.mockReturnValue("instance-a");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const sidecar = await import("./sidecar.js");
		sidecar.startServerSidecar({ bundleRev: 1, schemaVersion: 1 });

		processChild.emit("error", new Error("kill EPERM"));

		expect(sidecar.isServerSidecarRunning()).toBe(true);
		processChild.exit();
		expect(sidecar.isServerSidecarRunning()).toBe(false);
	});

	it("keeps the child handle when graceful and forced stops do not exit", async () => {
		vi.useFakeTimers();
		const processChild = new FakeChildProcess();
		mocks.spawn.mockReturnValue(processChild);
		mocks.randomUUID.mockReturnValue("instance-a");
		const sidecar = await import("./sidecar.js");
		sidecar.startServerSidecar({ bundleRev: 1, schemaVersion: 1 });

		const stopped = sidecar.stopServerSidecarGracefully(10);
		expect(processChild.stdin.end).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(4_010);

		await expect(stopped).resolves.toBe(false);
		expect(processChild.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
		expect(processChild.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
		expect(sidecar.isServerSidecarRunning()).toBe(true);
		processChild.exit();
		expect(sidecar.isServerSidecarRunning()).toBe(false);
	});
});
