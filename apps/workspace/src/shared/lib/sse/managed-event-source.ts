export type ManagedEventSourceListener = (event: MessageEvent) => void;

export interface ManagedEventSourceConnection {
	readonly readyState: number;
	onopen: ((event: Event) => void) | null;
	onerror: ((event: Event) => void) | null;
	addEventListener: (type: string, listener: ManagedEventSourceListener) => void;
	removeEventListener: (type: string, listener: ManagedEventSourceListener) => void;
	close: () => void;
}

export interface ManagedEventSourceOptions {
	url: string | ((lastEventId: string | null) => string);
	initialLastEventId?: string | null;
	reconnectDelayMs?: number;
	maxReconnectDelayMs?: number;
	/** Reconnect after this long without any event; 0 disables the check. */
	heartbeatTimeoutMs?: number;
	eventSourceFactory?: (url: string) => ManagedEventSourceConnection;
}

const defaultReconnectDelayMs = 500;
const defaultMaxReconnectDelayMs = 5000;
const defaultHeartbeatTimeoutMs = 45_000;
// Server-side SSE handlers emit this keepalive event every 15s of idleness.
const heartbeatEventType = "stream.ping";
const closedReadyState = 2;

export class ManagedEventSource {
	private readonly options: Required<
		Pick<
			ManagedEventSourceOptions,
			"heartbeatTimeoutMs" | "maxReconnectDelayMs" | "reconnectDelayMs"
		>
	> &
		Omit<
			ManagedEventSourceOptions,
			"heartbeatTimeoutMs" | "maxReconnectDelayMs" | "reconnectDelayMs"
		>;
	private readonly listeners = new Map<
		string,
		Map<ManagedEventSourceListener, ManagedEventSourceListener>
	>();
	private source: ManagedEventSourceConnection | null = null;
	private reconnectTimer: number | null = null;
	private heartbeatTimer: number | null = null;
	private reconnectAttempts = 0;
	private lastEventId: string | null;
	private lastActivityAt = Date.now();
	private closed = false;
	private readonly recordActivity: ManagedEventSourceListener = () => {
		this.lastActivityAt = Date.now();
	};

	constructor(options: ManagedEventSourceOptions) {
		this.options = {
			...options,
			heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? defaultHeartbeatTimeoutMs,
			maxReconnectDelayMs: options.maxReconnectDelayMs ?? defaultMaxReconnectDelayMs,
			reconnectDelayMs: options.reconnectDelayMs ?? defaultReconnectDelayMs,
		};
		this.lastEventId = options.initialLastEventId?.trim() || null;
		this.connect();
		this.startHeartbeatMonitor();
	}

	get readyState() {
		return this.source?.readyState ?? closedReadyState;
	}

	addEventListener(type: string, listener: ManagedEventSourceListener) {
		const wrappers = this.listeners.get(type) ?? new Map();
		if (wrappers.has(listener)) return;

		const wrappedListener: ManagedEventSourceListener = (event) => {
			this.lastActivityAt = Date.now();
			if (event.lastEventId) {
				this.lastEventId = event.lastEventId;
			}
			listener(event);
		};
		wrappers.set(listener, wrappedListener);
		this.listeners.set(type, wrappers);
		this.source?.addEventListener(type, wrappedListener);
	}

	removeEventListener(type: string, listener: ManagedEventSourceListener) {
		const wrappers = this.listeners.get(type);
		const wrappedListener = wrappers?.get(listener);
		if (!wrappers || !wrappedListener) return;

		this.source?.removeEventListener(type, wrappedListener);
		wrappers.delete(listener);
		if (wrappers.size === 0) {
			this.listeners.delete(type);
		}
	}

	close() {
		this.closed = true;
		this.clearReconnectTimer();
		this.clearHeartbeatTimer();
		this.detachSource();
	}

	isClosed() {
		return this.closed;
	}

	private connect() {
		if (this.closed) return;

		this.lastActivityAt = Date.now();
		const source = this.createSource();
		this.source = source;
		source.addEventListener(heartbeatEventType, this.recordActivity);
		for (const [type, wrappers] of this.listeners) {
			for (const wrappedListener of wrappers.values()) {
				source.addEventListener(type, wrappedListener);
			}
		}
		source.onopen = () => {
			this.reconnectAttempts = 0;
			this.lastActivityAt = Date.now();
		};
		source.onerror = () => {
			if (this.closed || source.readyState !== closedReadyState) return;
			this.scheduleReconnect(source);
		};
	}

	private createSource() {
		const url =
			typeof this.options.url === "function"
				? this.options.url(this.lastEventId)
				: this.options.url;
		if (this.options.eventSourceFactory) {
			return this.options.eventSourceFactory(url);
		}
		if (typeof EventSource === "undefined") {
			throw new Error("EventSource is not available in this environment.");
		}
		return new EventSource(url);
	}

	private scheduleReconnect(source: ManagedEventSourceConnection) {
		if (source !== this.source || this.reconnectTimer) return;

		const delay = Math.min(
			this.options.reconnectDelayMs * 2 ** this.reconnectAttempts,
			this.options.maxReconnectDelayMs,
		);
		this.reconnectAttempts += 1;
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			if (this.closed || source !== this.source) return;
			this.detachSource();
			this.connect();
		}, delay);
	}

	private startHeartbeatMonitor() {
		if (this.options.heartbeatTimeoutMs <= 0) return;

		const checkIntervalMs = Math.max(250, Math.min(this.options.heartbeatTimeoutMs / 2, 5000));
		this.heartbeatTimer = window.setInterval(() => {
			if (this.closed || !this.source || this.reconnectTimer) return;
			if (Date.now() - this.lastActivityAt <= this.options.heartbeatTimeoutMs) return;
			// A half-dead connection (proxy timeout, network switch) never
			// fires onerror, so cycle it once the heartbeat goes silent.
			this.detachSource();
			this.connect();
		}, checkIntervalMs);
	}

	private clearReconnectTimer() {
		if (!this.reconnectTimer) return;
		window.clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}

	private clearHeartbeatTimer() {
		if (!this.heartbeatTimer) return;
		window.clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = null;
	}

	private detachSource() {
		if (!this.source) return;
		this.source.onopen = null;
		this.source.onerror = null;
		this.source.removeEventListener(heartbeatEventType, this.recordActivity);
		for (const [type, wrappers] of this.listeners) {
			for (const wrappedListener of wrappers.values()) {
				this.source.removeEventListener(type, wrappedListener);
			}
		}
		this.source.close();
		this.source = null;
	}
}
