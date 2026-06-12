import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ManagedEventSource,
	type ManagedEventSourceConnection,
	type ManagedEventSourceListener,
} from "./managed-event-source";

class FakeEventSource implements ManagedEventSourceConnection {
	static readonly closed = 2;

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
		this.readyState = FakeEventSource.closed;
	}

	emit(type: string, data: string, lastEventId?: string) {
		const event = new MessageEvent(type, { data, lastEventId });
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	failClosed() {
		this.readyState = FakeEventSource.closed;
		this.onerror?.(new Event("error"));
	}
}

describe("ManagedEventSource", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("reconnects with the latest SSE id and preserves event listeners", () => {
		vi.useFakeTimers();
		const sources: FakeEventSource[] = [];
		const managed = new ManagedEventSource({
			initialLastEventId: "5",
			reconnectDelayMs: 10,
			url: (lastEventId) => `/api/v1/agent/events?after=${lastEventId ?? ""}`,
			eventSourceFactory: (url) => {
				const source = new FakeEventSource(url);
				sources.push(source);
				return source;
			},
		});
		const listener = vi.fn();
		managed.addEventListener("agent.message.completed", listener);

		expect(sources[0]?.url).toBe("/api/v1/agent/events?after=5");
		sources[0]?.emit("agent.message.completed", `{"type":"agent.message.completed"}`, "6");
		expect(listener).toHaveBeenCalledTimes(1);

		sources[0]?.failClosed();
		vi.advanceTimersByTime(10);

		expect(sources).toHaveLength(2);
		expect(sources[1]?.url).toBe("/api/v1/agent/events?after=6");
		sources[1]?.emit("agent.message.completed", `{"type":"agent.message.completed"}`, "7");
		expect(listener).toHaveBeenCalledTimes(2);

		managed.removeEventListener("agent.message.completed", listener);
		sources[1]?.emit("agent.message.completed", `{"type":"agent.message.completed"}`, "8");
		expect(listener).toHaveBeenCalledTimes(2);
		managed.close();
	});

	it("reconnects when the stream stays silent past the heartbeat timeout", () => {
		vi.useFakeTimers();
		const sources: FakeEventSource[] = [];
		const managed = new ManagedEventSource({
			heartbeatTimeoutMs: 1000,
			initialLastEventId: "5",
			url: (lastEventId) => `/api/v1/agent/events?after=${lastEventId ?? ""}`,
			eventSourceFactory: (url) => {
				const source = new FakeEventSource(url);
				sources.push(source);
				return source;
			},
		});
		const listener = vi.fn();
		managed.addEventListener("agent.message.completed", listener);

		// Heartbeat pings and regular events both keep the connection alive.
		vi.advanceTimersByTime(900);
		sources[0]?.emit("stream.ping", "{}");
		vi.advanceTimersByTime(900);
		sources[0]?.emit("agent.message.completed", `{"type":"agent.message.completed"}`, "6");
		vi.advanceTimersByTime(900);
		expect(sources).toHaveLength(1);

		// Silence past the timeout cycles the connection without an error event.
		vi.advanceTimersByTime(1200);
		expect(sources).toHaveLength(2);
		expect(sources[0]?.readyState).toBe(FakeEventSource.closed);
		expect(sources[1]?.url).toBe("/api/v1/agent/events?after=6");

		sources[1]?.emit("agent.message.completed", `{"type":"agent.message.completed"}`, "7");
		expect(listener).toHaveBeenCalledTimes(2);

		managed.close();
		vi.advanceTimersByTime(10_000);
		expect(sources).toHaveLength(2);
	});

	it("does not monitor heartbeats when the timeout is disabled", () => {
		vi.useFakeTimers();
		const sources: FakeEventSource[] = [];
		const managed = new ManagedEventSource({
			heartbeatTimeoutMs: 0,
			url: () => "/api/v1/workspace/events",
			eventSourceFactory: (url) => {
				const source = new FakeEventSource(url);
				sources.push(source);
				return source;
			},
		});

		vi.advanceTimersByTime(600_000);
		expect(sources).toHaveLength(1);
		managed.close();
	});
});
