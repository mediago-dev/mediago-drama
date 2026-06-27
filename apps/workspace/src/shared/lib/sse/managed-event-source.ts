import {
	EventStreamContentType,
	fetchEventSource,
	type FetchEventSourceInit,
} from "@microsoft/fetch-event-source";

export type ManagedEventSourceListener = (event: MessageEvent) => void;
export type ManagedFetchEventSource = typeof fetchEventSource;

type FetchEventSourceMessage = Parameters<NonNullable<FetchEventSourceInit["onmessage"]>>[0];

export interface ManagedEventSourceOptions {
	url: string | ((lastEventId: string | null) => string);
	initialLastEventId?: string | null;
	reconnectDelayMs?: number;
	maxReconnectDelayMs?: number;
	/** Reconnect after this long without any event; 0 disables the check. */
	heartbeatTimeoutMs?: number;
	fetchEventSource?: ManagedFetchEventSource;
	fetch?: typeof fetch;
	headers?: Record<string, string>;
	openWhenHidden?: boolean;
}

type ResolvedManagedEventSourceOptions = Omit<
	ManagedEventSourceOptions,
	| "fetchEventSource"
	| "heartbeatTimeoutMs"
	| "maxReconnectDelayMs"
	| "reconnectDelayMs"
	| "openWhenHidden"
> & {
	fetchEventSource: ManagedFetchEventSource;
	heartbeatTimeoutMs: number;
	maxReconnectDelayMs: number;
	reconnectDelayMs: number;
	openWhenHidden: boolean;
};

const defaultReconnectDelayMs = 500;
const defaultMaxReconnectDelayMs = 5000;
const defaultHeartbeatTimeoutMs = 45_000;
const connectingReadyState = 0;
const openReadyState = 1;
const closedReadyState = 2;

export class ManagedEventSource {
	private readonly options: ResolvedManagedEventSourceOptions;
	private readonly listeners = new Map<string, Set<ManagedEventSourceListener>>();
	private abortController: AbortController | null = null;
	private reconnectTimer: number | null = null;
	private heartbeatTimer: number | null = null;
	private reconnectAttempts = 0;
	private connectionId = 0;
	private lastEventId: string | null;
	private lastActivityAt = Date.now();
	private closed = false;
	private readyStateValue = closedReadyState;

	constructor(options: ManagedEventSourceOptions) {
		this.options = {
			...options,
			fetchEventSource: options.fetchEventSource ?? fetchEventSource,
			heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? defaultHeartbeatTimeoutMs,
			maxReconnectDelayMs: options.maxReconnectDelayMs ?? defaultMaxReconnectDelayMs,
			openWhenHidden: options.openWhenHidden ?? true,
			reconnectDelayMs: options.reconnectDelayMs ?? defaultReconnectDelayMs,
		};
		this.lastEventId = options.initialLastEventId?.trim() || null;
		this.connect();
		this.startHeartbeatMonitor();
	}

	get readyState() {
		return this.readyStateValue;
	}

	addEventListener(type: string, listener: ManagedEventSourceListener) {
		const listeners = this.listeners.get(type) ?? new Set<ManagedEventSourceListener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: ManagedEventSourceListener) {
		const listeners = this.listeners.get(type);
		if (!listeners) return;

		listeners.delete(listener);
		if (listeners.size === 0) {
			this.listeners.delete(type);
		}
	}

	close() {
		this.closed = true;
		this.clearReconnectTimer();
		this.clearHeartbeatTimer();
		this.abortActiveConnection();
	}

	isClosed() {
		return this.closed;
	}

	private connect() {
		if (this.closed) return;

		this.lastActivityAt = Date.now();
		const connectionId = ++this.connectionId;
		const abortController = new AbortController();
		this.abortController = abortController;
		this.readyStateValue = connectingReadyState;

		const requestOptions: FetchEventSourceInit = {
			openWhenHidden: this.options.openWhenHidden,
			signal: abortController.signal,
			onclose: () => {
				if (!this.isActiveConnection(connectionId, abortController)) return;
				this.readyStateValue = closedReadyState;
			},
			onerror: (error) => {
				throw error;
			},
			onmessage: (message) => {
				if (!this.isActiveConnection(connectionId, abortController)) return;
				this.handleMessage(message);
			},
			onopen: async (response) => {
				if (!this.isActiveConnection(connectionId, abortController)) return;
				this.handleOpenResponse(response);
			},
		};

		if (this.options.fetch) {
			requestOptions.fetch = this.options.fetch;
		}
		if (this.options.headers) {
			requestOptions.headers = this.options.headers;
		}

		void this.options.fetchEventSource(this.createUrl(), requestOptions).then(
			() => this.scheduleReconnect(connectionId, abortController),
			() => this.scheduleReconnect(connectionId, abortController),
		);
	}

	private createUrl() {
		return typeof this.options.url === "function"
			? this.options.url(this.lastEventId)
			: this.options.url;
	}

	private handleOpenResponse(response: Response) {
		if (!response.ok) {
			throw new Error(`SSE connection failed with status ${response.status}.`);
		}

		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		if (!contentType.startsWith(EventStreamContentType)) {
			throw new Error(`Expected SSE content type, received "${contentType || "unknown"}".`);
		}

		this.readyStateValue = openReadyState;
		this.reconnectAttempts = 0;
		this.lastActivityAt = Date.now();
	}

	private handleMessage(message: FetchEventSourceMessage) {
		this.lastActivityAt = Date.now();
		if (message.id) {
			this.lastEventId = message.id;
		}

		const type = message.event || "message";
		const event = new MessageEvent(type, {
			data: message.data,
			lastEventId: message.id,
		});
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	private scheduleReconnect(connectionId: number, abortController: AbortController) {
		if (!this.isActiveConnection(connectionId, abortController) || this.reconnectTimer) return;

		this.abortController = null;
		this.readyStateValue = closedReadyState;
		const delay = Math.min(
			this.options.reconnectDelayMs * 2 ** this.reconnectAttempts,
			this.options.maxReconnectDelayMs,
		);
		this.reconnectAttempts += 1;
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			if (this.closed || connectionId !== this.connectionId) return;
			this.connect();
		}, delay);
	}

	private startHeartbeatMonitor() {
		if (this.options.heartbeatTimeoutMs <= 0) return;

		const checkIntervalMs = Math.max(250, Math.min(this.options.heartbeatTimeoutMs / 2, 5000));
		this.heartbeatTimer = window.setInterval(() => {
			if (this.closed || !this.abortController || this.reconnectTimer) return;
			if (Date.now() - this.lastActivityAt <= this.options.heartbeatTimeoutMs) return;
			// A half-dead connection (proxy timeout, network switch) never
			// reaches onerror, so cycle it once the heartbeat goes silent.
			this.abortActiveConnection();
			this.connect();
		}, checkIntervalMs);
	}

	private isActiveConnection(connectionId: number, abortController: AbortController) {
		return (
			!this.closed &&
			this.connectionId === connectionId &&
			this.abortController === abortController &&
			!abortController.signal.aborted
		);
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

	private abortActiveConnection() {
		this.connectionId += 1;
		const abortController = this.abortController;
		this.abortController = null;
		this.readyStateValue = closedReadyState;
		abortController?.abort();
	}
}
