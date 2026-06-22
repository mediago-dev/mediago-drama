import { afterEach, describe, expect, it, vi } from "vitest";

const STORE_KEY = "episode-canvas-layout.v1";

const loadStore = async () => {
	vi.resetModules();
	return import("./canvas-layout");
};

const persistedState = () =>
	JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as {
		state?: {
			nodePositionsByScope?: Record<string, Record<string, { x: number; y: number }>>;
		};
		version?: number;
	};

describe("episode canvas layout store", () => {
	afterEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it("persists node positions by layout scope", async () => {
		const { useEpisodeCanvasLayoutStore } = await loadStore();

		useEpisodeCanvasLayoutStore.getState().setNodePositions("document:storyboard-1", {
			"node-a": { x: 120, y: 48 },
		});
		useEpisodeCanvasLayoutStore.getState().setNodePositions("document:storyboard-2", {
			"node-a": { x: 320, y: 96 },
		});

		expect(useEpisodeCanvasLayoutStore.getState().nodePositionsByScope).toEqual({
			"document:storyboard-1": { "node-a": { x: 120, y: 48 } },
			"document:storyboard-2": { "node-a": { x: 320, y: 96 } },
		});
		expect(persistedState()).toMatchObject({
			state: {
				nodePositionsByScope: {
					"document:storyboard-1": { "node-a": { x: 120, y: 48 } },
					"document:storyboard-2": { "node-a": { x: 320, y: 96 } },
				},
			},
			version: 1,
		});
	});

	it("clears one scope without affecting others", async () => {
		const { useEpisodeCanvasLayoutStore } = await loadStore();

		useEpisodeCanvasLayoutStore.getState().setNodePositions("document:storyboard-1", {
			"node-a": { x: 120, y: 48 },
		});
		useEpisodeCanvasLayoutStore.getState().setNodePositions("document:storyboard-2", {
			"node-a": { x: 320, y: 96 },
		});

		useEpisodeCanvasLayoutStore.getState().clearNodePositions("document:storyboard-1");

		expect(useEpisodeCanvasLayoutStore.getState().nodePositionsByScope).toEqual({
			"document:storyboard-2": { "node-a": { x: 320, y: 96 } },
		});
	});

	it("hydrates valid persisted positions and ignores invalid entries", async () => {
		localStorage.setItem(
			STORE_KEY,
			JSON.stringify({
				state: {
					nodePositionsByScope: {
						"document:storyboard-1": {
							"node-a": { x: 120, y: 48 },
							"node-b": { x: null, y: 24 },
							"node-c": { x: 10, y: "bad" },
						},
						"document:storyboard-2": {},
					},
				},
				version: 1,
			}),
		);

		const { useEpisodeCanvasLayoutStore } = await loadStore();

		await expect
			.poll(() => useEpisodeCanvasLayoutStore.getState().nodePositionsByScope)
			.toEqual({
				"document:storyboard-1": { "node-a": { x: 120, y: 48 } },
			});
	});

	it("removes the scope when the next positions are empty", async () => {
		const { useEpisodeCanvasLayoutStore } = await loadStore();

		useEpisodeCanvasLayoutStore.getState().setNodePositions("document:storyboard-1", {
			"node-a": { x: 120, y: 48 },
		});
		useEpisodeCanvasLayoutStore.getState().setNodePositions("document:storyboard-1", {});

		expect(useEpisodeCanvasLayoutStore.getState().nodePositionsByScope).toEqual({});
	});
});
