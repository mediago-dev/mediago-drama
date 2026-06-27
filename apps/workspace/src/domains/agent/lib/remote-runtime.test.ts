import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ManagedEventSource,
	type ManagedEventSourceConnection,
	type ManagedEventSourceListener,
} from "@/shared/lib/sse/managed-event-source";
import * as agentApi from "@/domains/agent/api/agent";
import { connectRemoteAgentRuntime } from "@/domains/agent/lib/remote-runtime";

vi.mock("@/domains/agent/api/agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/agent/api/agent")>();
	return {
		...actual,
		createAgentSession: vi.fn(),
		sendAgentMessage: vi.fn(),
		createAgentEventSource: vi.fn(),
	};
});

class FakeEventSource implements ManagedEventSourceConnection {
	readonly url: string;
	readyState = 1;
	onopen: ((event: Event) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	private readonly listeners = new Map<string, Set<ManagedEventSourceListener>>();

	constructor(url: string) {
		this.url = url;
	}

	addEventListener(type: string, listener: ManagedEventSourceListener) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: ManagedEventSourceListener) {
		this.listeners.get(type)?.delete(listener);
	}

	close() {
		this.readyState = 2;
	}

	emit(type: string, payload: Record<string, unknown>) {
		const lastEventId = typeof payload.sequence === "number" ? String(payload.sequence) : undefined;
		const event = new MessageEvent(type, { data: JSON.stringify(payload), lastEventId });
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

const buildManagedSource = (capture: (source: FakeEventSource) => void) =>
	new ManagedEventSource({
		url: "/api/v1/projects/p1/agent/sessions/s1/events",
		heartbeatTimeoutMs: 0,
		eventSourceFactory: (url) => {
			const source = new FakeEventSource(url);
			capture(source);
			return source;
		},
	});

describe("connectRemoteAgentRuntime handshake", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("resolves once connected and keeps the stream open through a long replay", async () => {
		let source: FakeEventSource | undefined;
		const managed = buildManagedSource((created) => {
			source = created;
		});
		vi.mocked(agentApi.createAgentEventSource).mockReturnValue(managed);

		const seen: Array<{ type: string; replay: boolean }> = [];
		const connectPromise = connectRemoteAgentRuntime(
			(event, meta) => seen.push({ type: event.type, replay: meta.replay }),
			"s1",
			"p1",
			null,
		);

		// connect resolves on `agent.session.connected`, before any replay.completed.
		source?.emit("agent.session.connected", { type: "agent.session.connected", sessionId: "s1" });
		const connection = await connectPromise;
		expect(connection.sessionId).toBe("s1");
		expect(managed.isClosed()).toBe(false);
		expect(source?.readyState).toBe(1);

		// Historical replay streams in afterwards, flagged replay:true until completion;
		// the new run's live events that follow are flagged replay:false.
		source?.emit("agent.activity", { type: "agent.activity", sessionId: "s1", sequence: 1 });
		source?.emit("agent.session.replay.completed", {
			type: "agent.session.replay.completed",
			sessionId: "s1",
		});
		source?.emit("agent.run.completed", {
			type: "agent.run.completed",
			sessionId: "s1",
			sequence: 2,
		});

		expect(seen.find((entry) => entry.type === "agent.activity")?.replay).toBe(true);
		expect(seen.find((entry) => entry.type === "agent.run.completed")?.replay).toBe(false);

		connection.close();
	});

	it("rejects only when the connection never establishes", async () => {
		vi.useFakeTimers();
		const managed = buildManagedSource(() => {});
		vi.mocked(agentApi.createAgentEventSource).mockReturnValue(managed);

		const connectPromise = connectRemoteAgentRuntime(() => {}, "s1", "p1", null);
		const expectation = expect(connectPromise).rejects.toThrow("连接本地智能体事件流超时。");

		// No `agent.session.connected` arrives; the 5s guard rejects and closes the stream.
		await vi.advanceTimersByTimeAsync(5000);
		await expectation;
		expect(managed.isClosed()).toBe(true);
	});
});
