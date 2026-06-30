import { describe, expect, it } from "vitest";
import type { GenerationTask } from "@/domains/generation/api/generation";
import {
	failedResourceGenerationStatus,
	generationStatusForSection,
	hasPendingGenerationTasks,
	isPendingGenerationStatus,
	mergeResourceGenerationStatusMaps,
	pendingResourceGenerationStatus,
	type ResourceGenerationStatus,
	resourceGenerationStatusFromTask,
	resourceGenerationStatusKind,
	visibleResourceGenerationStatus,
} from "@/domains/generation/lib/resource-generation-status";

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
	status: "completed",
	message: "",
	assets: [],
	usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	retryCount: 0,
	...overrides,
});

describe("resourceGenerationStatusKind", () => {
	it("maps server status strings to a status kind (case/whitespace insensitive)", () => {
		expect(resourceGenerationStatusKind(" Failed ")).toBe("failed");
		expect(resourceGenerationStatusKind("CANCELLED")).toBe("failed");
		expect(resourceGenerationStatusKind("succeeded")).toBe("completed");
		expect(resourceGenerationStatusKind("success")).toBe("completed");
		expect(resourceGenerationStatusKind("submitted")).toBe("pending");
		expect(resourceGenerationStatusKind("running")).toBe("pending");
	});
});

describe("isPendingGenerationStatus / hasPendingGenerationTasks", () => {
	it("treats only non-terminal statuses as pending", () => {
		expect(isPendingGenerationStatus("running")).toBe(true);
		expect(isPendingGenerationStatus("completed")).toBe(false);
		expect(hasPendingGenerationTasks([makeTask({ status: "completed" })])).toBe(false);
		expect(
			hasPendingGenerationTasks([
				makeTask({ status: "completed" }),
				makeTask({ id: "task-2", status: "running" }),
			]),
		).toBe(true);
	});
});

describe("resourceGenerationStatusFromTask", () => {
	it("carries the error message as the status message when present", () => {
		const status = resourceGenerationStatusFromTask(
			makeTask({ status: "failed", error: "boom", message: "ignored" }),
		);
		expect(status).toMatchObject({
			kind: "failed",
			label: "生成失败",
			message: "boom",
			taskId: "task-1",
		});
	});

	it("falls back to message when there is no error", () => {
		const status = resourceGenerationStatusFromTask(
			makeTask({ status: "running", message: "排队中" }),
		);
		expect(status).toMatchObject({ kind: "pending", label: "生成中", message: "排队中" });
	});
});

describe("generationStatusForSection", () => {
	const tasks = [
		makeTask({
			id: "old-complete",
			documentId: "doc-1",
			sectionId: "sec-1",
			status: "completed",
			updatedAt: "2026-01-01T00:00:00.000Z",
		}),
		makeTask({
			id: "newer-pending",
			documentId: "doc-1",
			sectionId: "sec-1",
			status: "running",
			updatedAt: "2026-01-02T00:00:00.000Z",
		}),
		makeTask({ id: "other-section", documentId: "doc-1", sectionId: "sec-2", status: "running" }),
	];

	it("matches by documentId + sectionId and prefers an active task over a completed one", () => {
		expect(generationStatusForSection(tasks, "doc-1", "sec-1")?.taskId).toBe("newer-pending");
	});

	it("returns undefined when no task matches the section", () => {
		expect(generationStatusForSection(tasks, "doc-1", "missing")).toBeUndefined();
	});

	it("trims ids before comparing", () => {
		expect(generationStatusForSection(tasks, " doc-1 ", " sec-2 ")?.taskId).toBe("other-section");
	});
});

describe("mergeResourceGenerationStatusMaps", () => {
	it("lets a newer optimistic status override a stale task status", () => {
		const taskStatuses = new Map<string, ResourceGenerationStatus>([
			[
				"res-1",
				resourceGenerationStatusFromTask(
					makeTask({ status: "completed", updatedAt: "2026-01-01T00:00:00.000Z" }),
				),
			],
		]);
		const optimistic = new Map<string, ResourceGenerationStatus>([
			[
				"res-1",
				pendingResourceGenerationStatus({
					taskId: "local:1",
					updatedAt: "2026-02-01T00:00:00.000Z",
				}),
			],
		]);
		expect(mergeResourceGenerationStatusMaps(taskStatuses, optimistic).get("res-1")?.kind).toBe(
			"pending",
		);
	});

	it("keeps the task status when it is newer than the optimistic one", () => {
		const taskStatuses = new Map<string, ResourceGenerationStatus>([
			[
				"res-1",
				resourceGenerationStatusFromTask(
					makeTask({ status: "completed", updatedAt: "2026-03-01T00:00:00.000Z" }),
				),
			],
		]);
		const optimistic = new Map<string, ResourceGenerationStatus>([
			[
				"res-1",
				pendingResourceGenerationStatus({
					taskId: "local:1",
					updatedAt: "2026-02-01T00:00:00.000Z",
				}),
			],
		]);
		expect(mergeResourceGenerationStatusMaps(taskStatuses, optimistic).get("res-1")?.kind).toBe(
			"completed",
		);
	});
});

describe("visibleResourceGenerationStatus", () => {
	it("hides completed statuses and surfaces in-progress/failed ones", () => {
		const completed = pendingResourceGenerationStatus({ taskId: "x" });
		expect(visibleResourceGenerationStatus(undefined)).toBeUndefined();
		expect(visibleResourceGenerationStatus({ ...completed, kind: "completed" })).toBeUndefined();
		expect(visibleResourceGenerationStatus(completed)).toBe(completed);
		expect(
			visibleResourceGenerationStatus(
				failedResourceGenerationStatus({ taskId: "x", message: "no" }),
			)?.kind,
		).toBe("failed");
	});
});
