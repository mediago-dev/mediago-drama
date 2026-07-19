import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { KeyedMutator } from "swr";
import { mutate as mutateSWR } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetsResponse } from "@/domains/workspace/api/media";
import {
	deleteGenerationTask,
	deleteGenerationTaskAsset,
	type GenerationTask,
	getGenerationVideo,
	type GenerationTasksResponse,
} from "@/domains/generation/api/generation";
import type { ChatMessage } from "./useGenerationWorkspace.helpers";
import { orphanTaskIdForLocalEntry, useGenerationTaskActions } from "./useGenerationTaskActions";

vi.mock("@/domains/generation/api/generation", () => ({
	deleteGenerationTaskAsset: vi.fn(),
	deleteGenerationTask: vi.fn(),
	generationConversationsQueryKey: (
		kind?: string,
		scopeId = "studio",
		options: { allScopes?: boolean } = {},
	): readonly [string, string, string] => [
		"/generation/conversations",
		options.allScopes ? "*" : scopeId,
		kind ?? "",
	],
	getGenerationVideo: vi.fn(),
	selectedGenerationAssetsQueryKey: (projectId: string): readonly [string, string] => [
		"generation-selected-assets",
		projectId,
	],
}));

vi.mock("swr", () => ({
	mutate: vi.fn(),
}));

const submittedVideoMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
	id: "dmx.seedance-2.0-fast:task-1",
	role: "assistant",
	kind: "video",
	status: "submitted",
	content: "视频生成任务已提交，完成后请再次检查状态。",
	createdAt: "2026-06-06T07:00:00.000Z",
	updatedAt: "2026-06-06T07:00:00.000Z",
	...overrides,
});

const submittedImageMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
	id: "image-task-1",
	role: "assistant",
	kind: "image",
	status: "submitted",
	content: "图片生成任务已提交。",
	createdAt: "2026-06-06T07:00:00.000Z",
	updatedAt: "2026-06-06T07:00:00.000Z",
	...overrides,
});

const renderTaskActionsHook = (
	initialMessages: ChatMessage[] = [submittedVideoMessage()],
	options: { projectId?: string | null; tasks?: GenerationTask[] } = {},
) => {
	const mutateMediaAssets = vi.fn(async () => ({
		assets: [],
	})) as unknown as KeyedMutator<MediaAssetsResponse>;
	const mutateProjectGenerationTasks = vi.fn();
	const mutateTasks = vi.fn(async () => ({
		tasks: options.tasks ?? [],
	})) as unknown as KeyedMutator<GenerationTasksResponse>;

	const result = renderHook(() => {
		const [error, setError] = useState<string | null>(null);
		const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
		const [activeEntryId, setActiveEntryId] = useState<string | null>(null);

		return {
			activeEntryId,
			error,
			messages,
			...useGenerationTaskActions({
				conversationMessages: messages,
				kind: "video",
				mutateMediaAssets,
				mutateProjectGenerationTasks,
				mutateTasks,
				projectId: options.projectId,
				setActiveEntryId,
				setError,
				setMessages,
			}),
		};
	});

	return {
		...result,
		mutateMediaAssets,
		mutateProjectGenerationTasks,
		mutateTasks,
	};
};

describe("useGenerationTaskActions", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("marks the current video message as failed when status refresh rejects", async () => {
		vi.mocked(getGenerationVideo).mockRejectedValue({ message: "dmx task status failed" });
		const { mutateProjectGenerationTasks, mutateTasks, result } = renderTaskActionsHook();

		await act(async () => {
			const message = result.current.messages[0];
			if (!message) throw new Error("missing test message");
			await result.current.refreshVideo(message);
		});

		expect(result.current.error).toBe("dmx task status failed");
		expect(result.current.messages[0]).toMatchObject({
			status: "error",
			content: "视频状态检查失败。",
			error: "dmx task status failed",
			errorCode: "status_check_failed",
			errorType: "provider_error",
			retryable: true,
		});
		expect(mutateTasks).toHaveBeenCalledTimes(1);
		expect(mutateProjectGenerationTasks).toHaveBeenCalledWith("video");
	});

	it("refreshes media assets when a video status check returns cached local assets", async () => {
		vi.mocked(getGenerationVideo).mockResolvedValue({
			id: "dmx.seedance-2.0-fast:task-1",
			role: "assistant",
			status: "completed",
			message: "done",
			assets: [{ kind: "video", url: "/api/media/assets/video-1/content" }],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				reasoningTokens: 0,
				cachedTokens: 0,
			},
		});
		const { mutateMediaAssets, result } = renderTaskActionsHook();

		await act(async () => {
			const message = result.current.messages[0];
			if (!message) throw new Error("missing test message");
			await result.current.refreshVideo(message);
		});

		expect(mutateMediaAssets).toHaveBeenCalledTimes(1);
	});

	it("uses a low-frequency fallback refresh for pending task lists", () => {
		vi.useFakeTimers();
		const { mutateTasks } = renderTaskActionsHook([submittedImageMessage()]);

		act(() => {
			vi.advanceTimersByTime(29_999);
		});
		expect(mutateTasks).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(mutateTasks).toHaveBeenCalledTimes(1);
	});

	it("throws asset deletion API errors without writing the composer error", async () => {
		vi.mocked(deleteGenerationTaskAsset).mockRejectedValue({
			message: "generation task asset not found",
		});
		const { mutateTasks, result } = renderTaskActionsHook([
			submittedImageMessage({
				id: "task-1",
				assets: [{ kind: "image", url: "/api/v1/media-assets/image-a/content" }],
			}),
		]);
		let thrown: unknown;

		await act(async () => {
			try {
				await result.current.deleteGenerationEntryAsset("task-1", 0);
			} catch (error) {
				thrown = error;
			}
		});

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toBe("generation task asset not found");
		expect(result.current.error).toBeNull();
		expect(result.current.deletedAssetPlaceholderCounts["task-1"]).toBeUndefined();
		expect(mutateTasks).toHaveBeenCalled();
	});

	it("deletes generated images by their persisted slot", async () => {
		vi.mocked(deleteGenerationTaskAsset).mockResolvedValue(
			{} as Awaited<ReturnType<typeof deleteGenerationTaskAsset>>,
		);
		const { result } = renderTaskActionsHook([
			submittedImageMessage({
				id: "task-1",
				assets: [{ kind: "image", url: "/api/v1/media-assets/image-a/content" }],
			}),
		]);

		await act(async () => {
			await result.current.deleteGenerationEntryAsset("task-1", 0);
		});

		expect(deleteGenerationTaskAsset).toHaveBeenCalledWith("task-1", 0);
		expect(result.current.deletedAssetPlaceholderCounts["task-1"]).toBeUndefined();
		expect(result.current.messages[0]?.assets).toEqual([]);
	});

	it("refreshes selected project assets after deleting a generated image slot", async () => {
		vi.mocked(deleteGenerationTaskAsset).mockResolvedValue(
			{} as Awaited<ReturnType<typeof deleteGenerationTaskAsset>>,
		);
		const { result } = renderTaskActionsHook(
			[
				submittedImageMessage({
					id: "task-1",
					assets: [{ kind: "image", url: "/api/v1/media-assets/image-a/content" }],
				}),
			],
			{ projectId: "project-a" },
		);

		await act(async () => {
			await result.current.deleteGenerationEntryAsset("task-1", 0);
		});

		expect(mutateSWR).toHaveBeenCalledWith(["generation-selected-assets", "project-a"]);
	});

	it("persists hidden placeholder image slots without deleting the whole task", async () => {
		vi.mocked(deleteGenerationTaskAsset).mockResolvedValue(
			{} as Awaited<ReturnType<typeof deleteGenerationTaskAsset>>,
		);
		const { mutateTasks, result } = renderTaskActionsHook([
			submittedImageMessage({ id: "task-1" }),
		]);

		await act(async () => {
			await result.current.deleteGenerationEntryAssetPlaceholder("task-1", 2);
		});

		expect(deleteGenerationTaskAsset).toHaveBeenCalledWith("task-1", 2);
		expect(result.current.messages[0]?.assets).toBeUndefined();
		expect(mutateTasks).toHaveBeenCalled();
	});

	it("persists hidden failed video slots for local entries backed by an orphan task", async () => {
		vi.mocked(deleteGenerationTaskAsset).mockResolvedValue(
			{} as Awaited<ReturnType<typeof deleteGenerationTaskAsset>>,
		);
		const { mutateProjectGenerationTasks, mutateTasks, result } = renderTaskActionsHook(
			[
				{
					id: "local-123:prompt",
					role: "user",
					kind: "video",
					content: "make a cat video",
					createdAt: "2026-06-06T07:00:00.000Z",
					updatedAt: "2026-06-06T07:00:00.000Z",
				},
				{
					id: "local-123:error",
					role: "assistant",
					kind: "video",
					status: "error",
					content: "生成请求失败。",
					createdAt: "2026-06-06T07:00:00.000Z",
					updatedAt: "2026-06-06T07:00:00.000Z",
				},
			],
			{
				tasks: [
					{ id: "generation-real", kind: "video", prompt: "make a cat video", status: "failed" },
				] as GenerationTask[],
			},
		);

		await act(async () => {
			await result.current.deleteGenerationEntryAssetPlaceholder("local-123:error", 0);
		});

		expect(deleteGenerationTaskAsset).toHaveBeenCalledWith("generation-real", 0);
		expect(mutateTasks).toHaveBeenCalled();
		expect(mutateProjectGenerationTasks).toHaveBeenCalledWith("video");
	});

	it("deletes the orphan backend task when removing a client-local errored entry", async () => {
		vi.mocked(deleteGenerationTask).mockResolvedValue({
			tasks: [],
		} as unknown as Awaited<ReturnType<typeof deleteGenerationTask>>);
		const { result } = renderTaskActionsHook(
			[
				{
					id: "local-123:prompt",
					role: "user",
					kind: "video",
					content: "make a cat video",
					createdAt: "2026-06-06T07:00:00.000Z",
					updatedAt: "2026-06-06T07:00:00.000Z",
				},
				{
					id: "local-123:error",
					role: "assistant",
					kind: "video",
					status: "error",
					content: "生成请求失败。",
					createdAt: "2026-06-06T07:00:00.000Z",
					updatedAt: "2026-06-06T07:00:00.000Z",
				},
			],
			{
				tasks: [
					{ id: "generation-real", kind: "video", prompt: "make a cat video", status: "failed" },
				] as GenerationTask[],
			},
		);

		await act(async () => {
			await result.current.deleteGenerationEntry("local-123:error");
		});

		expect(deleteGenerationTask).toHaveBeenCalledWith("generation-real");
	});

	it("does not delete any backend task when a client-local entry has no matching orphan", async () => {
		const { result } = renderTaskActionsHook(
			[
				{
					id: "local-999:prompt",
					role: "user",
					kind: "video",
					content: "unrelated prompt",
					createdAt: "2026-06-06T07:00:00.000Z",
					updatedAt: "2026-06-06T07:00:00.000Z",
				},
				{
					id: "local-999:error",
					role: "assistant",
					kind: "video",
					status: "error",
					content: "生成请求失败。",
					createdAt: "2026-06-06T07:00:00.000Z",
					updatedAt: "2026-06-06T07:00:00.000Z",
				},
			],
			{
				tasks: [
					{ id: "generation-other", kind: "video", prompt: "a different prompt", status: "failed" },
				] as GenerationTask[],
			},
		);

		await act(async () => {
			await result.current.deleteGenerationEntry("local-999:error");
		});

		expect(deleteGenerationTask).not.toHaveBeenCalled();
	});
});

describe("orphanTaskIdForLocalEntry", () => {
	const promptMessage = (localId: string, content: string): ChatMessage => ({
		id: `${localId}:prompt`,
		role: "user",
		kind: "video",
		content,
		createdAt: "2026-06-06T07:00:00.000Z",
		updatedAt: "2026-06-06T07:00:00.000Z",
	});

	it("matches a single orphan task by kind and exact prompt", () => {
		const messages = [promptMessage("local-1", "a shot of the sea")];
		const tasks = [
			{ id: "task-a", kind: "video", prompt: "a shot of the sea", status: "failed" },
			{ id: "task-b", kind: "image", prompt: "a shot of the sea", status: "failed" },
		] as GenerationTask[];

		expect(orphanTaskIdForLocalEntry(tasks, "local-1:error", messages, "video")).toBe("task-a");
	});

	it("returns null when the entry id is not client-local", () => {
		expect(orphanTaskIdForLocalEntry([], "generation-real:error", [], "video")).toBeNull();
	});

	it("returns null when the matching task is already shown as its own entry", () => {
		const messages = [
			promptMessage("local-1", "a shot of the sea"),
			{
				id: "task-a",
				role: "assistant",
				kind: "video",
				status: "failed",
				content: "生成请求失败。",
			} as ChatMessage,
		];
		const tasks = [
			{ id: "task-a", kind: "video", prompt: "a shot of the sea", status: "failed" },
		] as GenerationTask[];

		expect(orphanTaskIdForLocalEntry(tasks, "local-1:error", messages, "video")).toBeNull();
	});

	it("returns null when more than one task matches (ambiguous)", () => {
		const messages = [promptMessage("local-1", "a shot of the sea")];
		const tasks = [
			{ id: "task-a", kind: "video", prompt: "a shot of the sea", status: "failed" },
			{ id: "task-b", kind: "video", prompt: "a shot of the sea", status: "failed" },
		] as GenerationTask[];

		expect(orphanTaskIdForLocalEntry(tasks, "local-1:error", messages, "video")).toBeNull();
	});
});
