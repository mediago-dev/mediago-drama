import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAnalyticsProperties, TalkingDataAnalytics } from "./talking-data";

describe("normalizeAnalyticsProperties", () => {
	it("keeps scalar values as strings and omits empty values", () => {
		expect(
			normalizeAnalyticsProperties({
				count: 2,
				enabled: true,
				empty: "",
				missing: undefined,
				none: null,
				source: "home",
			}),
		).toEqual({
			count: "2",
			enabled: "true",
			empty: "",
			source: "home",
		});
	});
});

describe("TalkingDataAnalytics", () => {
	beforeEach(() => {
		document.head.innerHTML = "";
		delete window.TDAPP;
	});

	it("does not inject the sdk when no app id is configured", () => {
		const analytics = new TalkingDataAnalytics();

		expect(analytics.init()).toBe(false);
		expect(document.querySelectorAll("script")).toHaveLength(0);
	});

	it("injects the TalkingData H5 sdk once", () => {
		const analytics = new TalkingDataAnalytics({ appId: "app-123", version: "1.2.3" });

		expect(analytics.init()).toBe(true);
		expect(analytics.init()).toBe(true);

		const scripts = document.querySelectorAll("script[data-mediago-analytics='talking-data']");
		expect(scripts).toHaveLength(1);
		expect(scripts[0]).toHaveAttribute(
			"src",
			"https://jic.talkingdata.com/app/h5/v1?appid=app-123&vn=1.2.3&vc=1.2.3",
		);
	});

	it("does not inject remote analytics code into Electron", () => {
		window.mediagoDesktop = { isElectron: true } as typeof window.mediagoDesktop;
		const analytics = new TalkingDataAnalytics({ appId: "app-123" });

		expect(analytics.init()).toBe(false);
		expect(document.querySelector("script[data-mediago-analytics='talking-data']")).toBeNull();

		delete window.mediagoDesktop;
	});

	it("tracks events through TDAPP when available", () => {
		const onEvent = vi.fn();
		window.TDAPP = { onEvent };
		const analytics = new TalkingDataAnalytics({ appId: "app-123" });

		analytics.track("OPEN_PROJECT", { project_id: "project-1", success: true });

		expect(onEvent).toHaveBeenCalledWith("OPEN_PROJECT", "", {
			project_id: "project-1",
			success: "true",
		});
	});
});
