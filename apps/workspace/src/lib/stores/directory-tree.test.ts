import { afterEach, describe, expect, it, vi } from "vitest";

const STORE_KEY = "agent-directory-tree";

const loadStore = async () => {
	vi.resetModules();
	return import("./directory-tree");
};

const persistedState = () => JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");

describe("directory tree store", () => {
	afterEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it("toggles collapsed folders in project buckets", async () => {
		const { useDirectoryTreeStore } = await loadStore();

		useDirectoryTreeStore.getState().toggleFolder("project-a", "folder-a");
		useDirectoryTreeStore.getState().toggleFolder("project-b", "folder-a");
		useDirectoryTreeStore.getState().toggleFolder("project-a", "folder-b");

		expect(useDirectoryTreeStore.getState().collapsedByProject).toEqual({
			"project-a": { "folder-a": true, "folder-b": true },
			"project-b": { "folder-a": true },
		});
		expect(persistedState()).toMatchObject({
			state: {
				collapsedByProject: {
					"project-a": { "folder-a": true, "folder-b": true },
					"project-b": { "folder-a": true },
				},
			},
			version: 1,
		});

		useDirectoryTreeStore.getState().toggleFolder("project-a", "folder-a");

		expect(useDirectoryTreeStore.getState().collapsedByProject["project-a"]["folder-a"]).toBe(
			false,
		);
		expect(useDirectoryTreeStore.getState().collapsedByProject["project-b"]["folder-a"]).toBe(true);
	});

	it("sets and expands folder state without leaking between projects", async () => {
		const { useDirectoryTreeStore } = await loadStore();

		useDirectoryTreeStore.getState().setFolderCollapsed("project-a", "folder-a", true);
		useDirectoryTreeStore.getState().setFolderCollapsed("project-b", "folder-a", true);
		useDirectoryTreeStore.getState().expandFolder("project-a", "folder-a");

		expect(useDirectoryTreeStore.getState().collapsedByProject).toEqual({
			"project-a": { "folder-a": false },
			"project-b": { "folder-a": true },
		});
	});

	it("hydrates persisted collapsed folders", async () => {
		localStorage.setItem(
			STORE_KEY,
			JSON.stringify({
				state: { collapsedByProject: { "project-a": { "folder-a": true } } },
				version: 1,
			}),
		);

		const { useDirectoryTreeStore } = await loadStore();

		expect(useDirectoryTreeStore.getState().collapsedByProject).toEqual({
			"project-a": { "folder-a": true },
		});
	});
});
