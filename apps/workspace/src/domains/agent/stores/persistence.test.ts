import { afterEach, describe, expect, it, vi } from "vitest";

const STORE_KEY = "agent-persistence.v1";

const loadStore = async () => {
	vi.resetModules();
	const module = await import("./persistence");
	await module.useAgentPersistenceStore.persist.rehydrate();
	return module;
};

const persistState = (state: Record<string, unknown>) => {
	localStorage.setItem(STORE_KEY, JSON.stringify({ state, version: 1 }));
};

const persistedState = () =>
	JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as {
		state?: {
			runtimeConfigDefaults?: Record<string, string>;
			runtimeConfigByProject?: Record<string, Record<string, string>>;
			sessionIdsByProject?: Record<string, string>;
		};
		version?: number;
	};

describe("agent persistence store", () => {
	afterEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it("hydrates cached runtime config values by project", async () => {
		persistState({
			documentRuntimeMode: "mock",
			runtimeConfigDefaults: {
				model: " global-model ",
				reasoning: "medium",
			},
			runtimeConfigByProject: {
				"project-1": {
					model: " gpt-5 ",
					permission: "acceptEdits",
					reasoning: "high",
				},
				"project-2": {
					model: 42,
					permission: "ask",
				},
				"project-3": null,
			},
			sessionIdsByProject: { "project-1": "session-1" },
		});

		const { useAgentPersistenceStore } = await loadStore();

		expect(useAgentPersistenceStore.getState().documentRuntimeMode).toBe("mock");
		expect(useAgentPersistenceStore.getState().runtimeConfigDefaults).toEqual({
			model: "global-model",
			reasoning: "medium",
		});
		expect(useAgentPersistenceStore.getState().runtimeConfigByProject).toEqual({
			"project-1": {
				model: "gpt-5",
				permission: "acceptEdits",
				reasoning: "high",
			},
			"project-2": {
				permission: "ask",
			},
		});
		expect(useAgentPersistenceStore.getState().getSessionId("project-1")).toBe("session-1");
	});

	it("persists runtime config updates as global defaults and project overrides", async () => {
		const { useAgentPersistenceStore } = await loadStore();

		useAgentPersistenceStore.getState().setRuntimeConfigValue("project-1", "model", " gpt-5 ");
		useAgentPersistenceStore.getState().setRuntimeConfigValue("project-1", "reasoning", "high");
		useAgentPersistenceStore.getState().setRuntimeConfigValue("", "permission", "ask");

		expect(useAgentPersistenceStore.getState().runtimeConfigDefaults).toEqual({
			model: "gpt-5",
			permission: "ask",
			reasoning: "high",
		});
		expect(useAgentPersistenceStore.getState().runtimeConfigByProject).toEqual({
			"project-1": {
				model: "gpt-5",
				reasoning: "high",
			},
		});
		expect(persistedState()).toMatchObject({
			state: {
				runtimeConfigDefaults: {
					model: "gpt-5",
					permission: "ask",
					reasoning: "high",
				},
				runtimeConfigByProject: {
					"project-1": {
						model: "gpt-5",
						reasoning: "high",
					},
				},
			},
			version: 1,
		});

		useAgentPersistenceStore.getState().setRuntimeConfigValue("project-1", "model", "");

		expect(persistedState().state?.runtimeConfigDefaults).toEqual({
			permission: "ask",
			reasoning: "high",
		});
		expect(persistedState().state?.runtimeConfigByProject?.["project-1"]).toEqual({
			reasoning: "high",
		});
	});
});
