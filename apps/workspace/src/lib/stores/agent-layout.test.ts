import { afterEach, describe, expect, it, vi } from "vitest";

const STORE_KEY = "agent-layout.v1";

const loadStore = async () => {
	vi.resetModules();
	return import("./agent-layout");
};

const persistState = (state: Record<string, unknown>) => {
	localStorage.setItem(STORE_KEY, JSON.stringify({ state, version: 1 }));
};

const persistedState = () =>
	JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as {
		state?: { mode?: string; tab?: string };
		version?: number;
	};

describe("agent layout store", () => {
	afterEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it("uses fullscreen mode and agent tab by default", async () => {
		const { useAgentLayoutStore } = await loadStore();

		expect(useAgentLayoutStore.getState().mode).toBe("fullscreen");
		expect(useAgentLayoutStore.getState().tab).toBe("agent");
	});

	it("hydrates valid cached fullscreen mode and tab values", async () => {
		persistState({ mode: "fullscreen", tab: "document" });

		const { useAgentLayoutStore } = await loadStore();

		expect(useAgentLayoutStore.getState().mode).toBe("fullscreen");
		expect(useAgentLayoutStore.getState().tab).toBe("document");
	});

	it("ignores cached panel mode", async () => {
		persistState({ mode: "panel" });

		const { useAgentLayoutStore } = await loadStore();

		expect(useAgentLayoutStore.getState().mode).toBe("fullscreen");
	});

	it("persists mode and tab updates", async () => {
		const { useAgentLayoutStore } = await loadStore();

		useAgentLayoutStore.getState().setMode("fullscreen");
		useAgentLayoutStore.getState().setTab("document");

		expect(persistedState()).toMatchObject({
			state: { mode: "fullscreen", tab: "document" },
			version: 1,
		});

		useAgentLayoutStore.getState().enterFullscreen();

		expect(useAgentLayoutStore.getState().mode).toBe("fullscreen");
		expect(useAgentLayoutStore.getState().tab).toBe("agent");
		expect(persistedState().state).toMatchObject({ mode: "fullscreen", tab: "agent" });

		useAgentLayoutStore.getState().exitFullscreen();

		expect(useAgentLayoutStore.getState().mode).toBe("fullscreen");
		expect(useAgentLayoutStore.getState().tab).toBe("document");
		expect(persistedState().state).toMatchObject({ mode: "fullscreen", tab: "document" });
	});
});
