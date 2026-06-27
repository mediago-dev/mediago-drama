import type { FetchEventSourceInit } from "@microsoft/fetch-event-source";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ManagedEventSource,
	type ManagedFetchEventSource,
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

interface FetchEventSourceCall {
	readonly input: RequestInfo;
	readonly init: FetchEventSourceInit;
	aborted: boolean;
	reject: (error: unknown) => void;
	resolve: () => void;
}

const buildManagedSource = (capture: (source: FetchEventSourceCall) => void) => {
	const fetchEventSource = vi.fn<ManagedFetchEventSource>(
		(input: RequestInfo, init: FetchEventSourceInit) =>
			new Promise<void>((resolve, reject) => {
				const call: FetchEventSourceCall = {
					input,
					init,
					aborted: false,
					reject,
					resolve,
				};
				init.signal?.addEventListener(
					"abort",
					() => {
						call.aborted = true;
						resolve();
					},
					{ once: true },
				);
				capture(call);
			}),
	);

	return new ManagedEventSource({
		url: "/api/v1/projects/p1/agent/sessions/s1/events",
		heartbeatTimeoutMs: 0,
		fetchEventSource,
	});
};

const openSse = async (call: FetchEventSourceCall) => {
	await call.init.onopen?.(
		new Response(null, {
			headers: { "content-type": "text/event-stream" },
			status: 200,
		}),
	);
};

const emitMessage = (
	call: FetchEventSourceCall,
	type: string,
	payload: Record<string, unknown>,
) => {
	const lastEventId = typeof payload.sequence === "number" ? String(payload.sequence) : "";
	call.init.onmessage?.({
		data: JSON.stringify(payload),
		event: type,
		id: lastEventId,
		retry: undefined,
	});
};

describe("connectRemoteAgentRuntime handshake", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("resolves once connected and keeps the stream open through a long replay", async () => {
		let source: FetchEventSourceCall | undefined;
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
		await openSse(source!);
		emitMessage(source!, "agent.session.connected", {
			type: "agent.session.connected",
			sessionId: "s1",
		});
		const connection = await connectPromise;
		expect(connection.sessionId).toBe("s1");
		expect(managed.isClosed()).toBe(false);
		expect(managed.readyState).toBe(1);

		// Historical replay streams in afterwards, flagged replay:true until completion;
		// the new run's live events that follow are flagged replay:false.
		emitMessage(source!, "agent.activity", {
			type: "agent.activity",
			sessionId: "s1",
			sequence: 1,
		});
		emitMessage(source!, "agent.session.replay.completed", {
			type: "agent.session.replay.completed",
			sessionId: "s1",
		});
		emitMessage(source!, "agent.run.completed", {
			type: "agent.run.completed",
			sessionId: "s1",
			sequence: 2,
		});

		expect(seen.find((entry) => entry.type === "agent.activity")?.replay).toBe(true);
		expect(seen.find((entry) => entry.type === "agent.run.completed")?.replay).toBe(false);

		connection.close();
		expect(source?.aborted).toBe(true);
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
