export type AnalyticsPropertyValue = string | number | boolean | null | undefined;
export type AnalyticsProperties = Record<string, AnalyticsPropertyValue>;

interface TalkingDataGlobal {
	onEvent(eventId: string, eventLabel?: string, mapKv?: Record<string, string>): void;
}

declare global {
	interface Window {
		TDAPP?: TalkingDataGlobal;
	}
}

export interface TalkingDataAnalyticsOptions {
	appId?: string;
	version?: string;
	scriptBaseUrl?: string;
}

export class TalkingDataAnalytics {
	private readonly appId?: string;
	private readonly version?: string;
	private readonly scriptBaseUrl: string;
	private initialized = false;

	constructor(options: TalkingDataAnalyticsOptions = {}) {
		this.appId = trimOptional(options.appId);
		this.version = trimOptional(options.version);
		this.scriptBaseUrl = options.scriptBaseUrl ?? "https://jic.talkingdata.com/app/h5/v1";
	}

	init(): boolean {
		if (this.initialized) return Boolean(this.appId);
		this.initialized = true;

		if (
			!this.appId ||
			typeof document === "undefined" ||
			(typeof window !== "undefined" && window.mediagoDesktop?.isElectron)
		) {
			return false;
		}
		if (document.querySelector("script[data-mediago-analytics='talking-data']")) return true;

		const script = document.createElement("script");
		script.async = true;
		script.dataset.mediagoAnalytics = "talking-data";
		script.src = this.scriptUrl();
		document.head.appendChild(script);
		return true;
	}

	track(eventId: string, properties: AnalyticsProperties = {}): void {
		if (!eventId.trim()) return;
		this.init();
		if (typeof window === "undefined") return;

		try {
			window.TDAPP?.onEvent(eventId, "", normalizeAnalyticsProperties(properties));
		} catch {
			// Analytics must never affect product flows.
		}
	}

	private scriptUrl(): string {
		const params = new URLSearchParams({ appid: this.appId ?? "" });
		if (this.version) {
			params.set("vn", this.version);
			params.set("vc", this.version);
		}
		return `${this.scriptBaseUrl}?${params.toString()}`;
	}
}

export const normalizeAnalyticsProperties = (
	properties: AnalyticsProperties,
): Record<string, string> => {
	const normalized: Record<string, string> = {};

	for (const [key, value] of Object.entries(properties)) {
		if (!key || value === undefined || value === null) continue;
		normalized[key] = String(value);
	}

	return normalized;
};

const trimOptional = (value?: string) => {
	const trimmed = value?.trim();
	return trimmed || undefined;
};

export const analytics = new TalkingDataAnalytics({
	appId: import.meta.env.VITE_TALKINGDATA_APP_ID,
	version: import.meta.env.VITE_APP_VERSION,
});
