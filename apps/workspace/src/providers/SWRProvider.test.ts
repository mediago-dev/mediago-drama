import { beforeEach, describe, expect, it } from "vitest";
import {
	createPersistentSWRCache,
	persistentSWRCacheStorageKey,
	readPersistedSWRCache,
	shouldPersistSWRCacheKey,
	writePersistedSWRCache,
} from "./SWRProvider";

describe("persistent SWR cache", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("persists project workspace data without runtime loading state", () => {
		const cache = new Map([
			[
				"/projects",
				{
					data: { projects: [{ id: "project-a" }] },
					isLoading: true,
				},
			],
			[
				"/projects/project-a/workspace/state",
				{
					data: { projectId: "project-a", documents: [{ id: "doc-a" }] },
					error: new Error("stale"),
					isValidating: true,
					_k: "/projects/project-a/workspace/state",
				},
			],
			[
				"/settings/api-keys",
				{
					data: { providers: [{ id: "private" }] },
				},
			],
		]);

		writePersistedSWRCache(cache, localStorage);

		const persisted = readPersistedSWRCache(localStorage);
		expect(persisted).toHaveLength(2);
		expect(persisted.map(([key]) => key)).toEqual([
			"/projects",
			"/projects/project-a/workspace/state",
		]);
		expect(persisted[0]?.[1]).toEqual({ data: { projects: [{ id: "project-a" }] } });
		expect(persisted[1]?.[1]).toEqual({
			data: { projectId: "project-a", documents: [{ id: "doc-a" }] },
			_k: "/projects/project-a/workspace/state",
		});
		expect(JSON.stringify(persisted)).not.toContain("private");
	});

	it("hydrates a Map from persisted cache entries", () => {
		localStorage.setItem(
			persistentSWRCacheStorageKey,
			JSON.stringify([
				["/projects/project-a/workspace/state", { data: { projectId: "project-a" } }],
				["/agent/sessions", { data: [{ id: "session-a" }] }],
			]),
		);

		const cache = createPersistentSWRCache(localStorage);

		expect(cache.get("/projects/project-a/workspace/state")).toEqual({
			data: { projectId: "project-a" },
		});
		expect(cache.has("/agent/sessions")).toBe(false);
	});

	it("drops invalid storage payloads", () => {
		localStorage.setItem(persistentSWRCacheStorageKey, "{");

		expect(readPersistedSWRCache(localStorage)).toEqual([]);
		expect(localStorage.getItem(persistentSWRCacheStorageKey)).toBeNull();
	});

	it("keeps the persistent key set narrow", () => {
		expect(shouldPersistSWRCacheKey("/projects")).toBe(true);
		expect(shouldPersistSWRCacheKey("/projects/project-a/workspace/state")).toBe(true);
		expect(shouldPersistSWRCacheKey("/projects/project-a/workspace/documents")).toBe(false);
		expect(shouldPersistSWRCacheKey("/agent/sessions")).toBe(false);
	});
});
