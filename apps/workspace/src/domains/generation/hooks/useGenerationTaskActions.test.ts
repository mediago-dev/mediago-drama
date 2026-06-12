import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { KeyedMutator } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetsResponse } from "@/domains/workspace/api/media";
import {
	getGenerationVideo,
	type GenerationTasksResponse,
} from "@/domains/generation/api/generation";
import type { ChatMessage } from "./useGenerationWorkspace.helpers";
import { useGenerationTaskActions } from "./useGenerationTaskActions";

vi.mock("@/domains/generation/api/generation", () => ({
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

const renderTaskActionsHook = (initialMessages: ChatMessage[] = [submittedVideoMessage()]) => {
	const mutateMediaAssets = vi.fn(async () => ({
		assets: [],
	})) as unknown as KeyedMutator<MediaAssetsResponse>;
	const mutateProjectGenerationTasks = vi.fn();
	const mutateTasks = vi.fn(async () => ({
		tasks: [],
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
});
