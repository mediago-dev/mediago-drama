import { afterEach, describe, expect, it, vi } from "vitest";

const STORE_KEY = "agent-layout.v4";

const loadStore = async () => {
	vi.resetModules();
	return import("./agent-layout");
};

const persistState = (state: Record<string, unknown>) => {
	localStorage.setItem(STORE_KEY, JSON.stringify({ state, version: 5 }));
};

const persistedState = () =>
	JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as {
		state?: { mode?: string; panelHeight?: number | null; panelSize?: string; tab?: string };
		version?: number;
	};

describe("agent layout store", () => {
	afterEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it("uses fullscreen mode with the assistant closed by default", async () => {
		const { useAgentLayoutStore } = await loadStore();

		expect(useAgentLayoutStore.getState().mode).toBe("fullscreen");
		expect(useAgentLayoutStore.getState().tab).toBe("document");
		expect(useAgentLayoutStore.getState().panelHeight).toBeNull();
		expect(useAgentLayoutStore.getState().panelSize).toBe("comfortable");
	});

	it("keeps the assistant closed when hydrating cached layout values", async () => {
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

	it("persists the preferred assistant height without reopening it", async () => {
		const { useAgentLayoutStore } = await loadStore();

		useAgentLayoutStore.getState().setPanelSize("expanded");
		useAgentLayoutStore.getState().setTab("agent");

		expect(persistedState()).toMatchObject({
			state: { mode: "fullscreen", panelSize: "expanded" },
			version: 5,
		});
		expect(persistedState().state?.tab).toBeUndefined();
	});

	it("persists layout mode without reopening the assistant on the next launch", async () => {
		const { useAgentLayoutStore } = await loadStore();

		useAgentLayoutStore.getState().setMode("fullscreen");
		useAgentLayoutStore.getState().setTab("document");

		expect(persistedState()).toMatchObject({
			state: { mode: "fullscreen", panelSize: "comfortable" },
			version: 5,
		});

		useAgentLayoutStore.getState().enterFullscreen();

		expect(useAgentLayoutStore.getState().mode).toBe("fullscreen");
		expect(useAgentLayoutStore.getState().tab).toBe("agent");
		expect(persistedState().state).toMatchObject({ mode: "fullscreen" });
		expect(persistedState().state?.tab).toBeUndefined();

		useAgentLayoutStore.getState().exitFullscreen();

		expect(useAgentLayoutStore.getState().mode).toBe("fullscreen");
		expect(useAgentLayoutStore.getState().tab).toBe("document");
		expect(persistedState().state).toMatchObject({ mode: "fullscreen" });
	});

	it("persists a dragged height and resets it when a size preset is selected", async () => {
		const { useAgentLayoutStore } = await loadStore();

		useAgentLayoutStore.getState().setPanelHeight(566.4);
		expect(useAgentLayoutStore.getState().panelHeight).toBe(566);
		expect(persistedState()).toMatchObject({ state: { panelHeight: 566 }, version: 5 });

		useAgentLayoutStore.getState().setPanelSize("compact");
		expect(useAgentLayoutStore.getState().panelHeight).toBeNull();
	});
});
