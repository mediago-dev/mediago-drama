import type { FetchEventSourceInit } from "@microsoft/fetch-event-source";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedEventSource, type ManagedFetchEventSource } from "./managed-event-source";

interface FetchEventSourceCall {
	readonly input: RequestInfo;
	readonly init: FetchEventSourceInit;
	aborted: boolean;
	reject: (error: unknown) => void;
	resolve: () => void;
}

const createFetchEventSourceHarness = () => {
	const calls: FetchEventSourceCall[] = [];
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
				calls.push(call);
			}),
	);

	return { calls, fetchEventSource };
};

const openSse = async (call: FetchEventSourceCall) => {
	await call.init.onopen?.(
		new Response(null, {
			headers: { "content-type": "text/event-stream" },
			status: 200,
		}),
	);
};

const emitMessage = (call: FetchEventSourceCall, event: string, data: string, id = "") => {
	call.init.onmessage?.({ data, event, id, retry: undefined });
};

describe("ManagedEventSource", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("reconnects with the latest SSE id and preserves event listeners", async () => {
		vi.useFakeTimers();
		const { calls, fetchEventSource } = createFetchEventSourceHarness();
		const managed = new ManagedEventSource({
			initialLastEventId: "5",
			reconnectDelayMs: 10,
			url: (lastEventId) => `/api/v1/agent/events?after=${lastEventId ?? ""}`,
			fetchEventSource,
		});
		const listener = vi.fn();
		managed.addEventListener("agent.message.completed", listener);

		expect(calls[0]?.input).toBe("/api/v1/agent/events?after=5");
		await openSse(calls[0]!);
		emitMessage(calls[0]!, "agent.message.completed", `{"type":"agent.message.completed"}`, "6");
		expect(listener).toHaveBeenCalledTimes(1);

		calls[0]?.reject(new Error("network closed"));
		await vi.advanceTimersByTimeAsync(10);

		expect(calls).toHaveLength(2);
		expect(calls[1]?.input).toBe("/api/v1/agent/events?after=6");
		emitMessage(calls[1]!, "agent.message.completed", `{"type":"agent.message.completed"}`, "7");
		expect(listener).toHaveBeenCalledTimes(2);

		managed.removeEventListener("agent.message.completed", listener);
		emitMessage(calls[1]!, "agent.message.completed", `{"type":"agent.message.completed"}`, "8");
		expect(listener).toHaveBeenCalledTimes(2);
		managed.close();
	});

	it("reconnects when the stream stays silent past the heartbeat timeout", () => {
		vi.useFakeTimers();
		const { calls, fetchEventSource } = createFetchEventSourceHarness();
		const managed = new ManagedEventSource({
			heartbeatTimeoutMs: 1000,
			initialLastEventId: "5",
			url: (lastEventId) => `/api/v1/agent/events?after=${lastEventId ?? ""}`,
			fetchEventSource,
		});
		const listener = vi.fn();
		managed.addEventListener("agent.message.completed", listener);

		// Heartbeat pings and regular events both keep the connection alive.
		vi.advanceTimersByTime(900);
		emitMessage(calls[0]!, "stream.ping", "{}");
		vi.advanceTimersByTime(900);
		emitMessage(calls[0]!, "agent.message.completed", `{"type":"agent.message.completed"}`, "6");
		vi.advanceTimersByTime(900);
		expect(calls).toHaveLength(1);

		// Silence past the timeout cycles the connection without an error event.
		vi.advanceTimersByTime(1200);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.aborted).toBe(true);
		expect(calls[1]?.input).toBe("/api/v1/agent/events?after=6");

		emitMessage(calls[1]!, "agent.message.completed", `{"type":"agent.message.completed"}`, "7");
		expect(listener).toHaveBeenCalledTimes(2);

		managed.close();
		vi.advanceTimersByTime(10_000);
		expect(calls).toHaveLength(2);
	});

	it("does not monitor heartbeats when the timeout is disabled", () => {
		vi.useFakeTimers();
		const { calls, fetchEventSource } = createFetchEventSourceHarness();
		const managed = new ManagedEventSource({
			heartbeatTimeoutMs: 0,
			url: () => "/api/v1/workspace/events",
			fetchEventSource,
		});

		vi.advanceTimersByTime(600_000);
		expect(calls).toHaveLength(1);
		managed.close();
	});
});
