import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GenerationTask } from "@/domains/generation/api/generation";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";
import { useResourceGenerationStatuses } from "./useResourceGenerationStatuses";

const makeTask = (overrides: Partial<GenerationTask> = {}): GenerationTask => ({
	id: "task-1",
	kind: "image",
	routeId: "route",
	familyId: "family",
	versionId: "version",
	provider: "provider",
	modelId: "model-id",
	model: "model",
	prompt: "prompt",
	referenceUrls: [],
	referenceAssetIds: [],
	params: {},
	status: "running",
	message: "",
	assets: [],
	usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	retryCount: 0,
	...overrides,
});

afterEach(() => {
	useMediaGenerationStore.setState({ activeRequest: null, optimisticStatuses: {} });
});

describe("useResourceGenerationStatuses", () => {
	it("derives a resource status from a matching task by documentId + sectionId", () => {
		const resources = [{ id: "res-1", documentId: "doc-1", sectionId: "sec-1" }];
		const tasks = [makeTask({ documentId: "doc-1", sectionId: "sec-1", status: "running" })];
		const { result } = renderHook(() => useResourceGenerationStatuses(resources, tasks));
		expect(result.current.get("res-1")?.kind).toBe("pending");
	});

	it("ignores tasks that do not match any resource section", () => {
		const resources = [{ id: "res-1", documentId: "doc-1", sectionId: "sec-1" }];
		const tasks = [makeTask({ documentId: "doc-1", sectionId: "other", status: "running" })];
		const { result } = renderHook(() => useResourceGenerationStatuses(resources, tasks));
		expect(result.current.has("res-1")).toBe(false);
	});

	it("overlays the global store's optimistic status when newer than the task status", () => {
		useMediaGenerationStore.getState().markGenerating("res-2");
		const resources = [{ id: "res-2", documentId: "doc-1", sectionId: "sec-2" }];
		const { result } = renderHook(() => useResourceGenerationStatuses(resources, []));
		expect(result.current.get("res-2")?.kind).toBe("pending");
	});
});
