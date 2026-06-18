import { describe, expect, it } from "vitest";
import type { GenerationTask } from "@/domains/generation/api/generation";
import {
	isPendingVideoMessage,
	messagesFromTasks,
	mergeConversationMessages,
} from "@/domains/generation/hooks/generationHistory";
import type { ChatMessage } from "@/domains/generation/hooks/generationTypes";
import { fallbackCatalog } from "./generationFallbackCatalog";

const chatMessage = (overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">) => ({
	kind: "text" as const,
	content: "",
	...overrides,
});

const generationTask = (overrides: Partial<GenerationTask> = {}): GenerationTask => ({
	id: "task-video",
	kind: "video",
	routeId: "dmx.seedance-2.0-fast",
	familyId: "seedance",
	versionId: "seedance-2.0-fast",
	provider: "dmx",
	modelId: "jimeng-seedance-2-fast",
	model: "doubao-seedance-2-0-fast-260128",
	prompt: "make a video",
	referenceUrls: [],
	referenceAssetIds: [],
	params: {},
	status: "submitted",
	message: "视频生成任务已提交，完成后请再次检查状态。",
	assets: [],
	usage: {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		reasoningTokens: 0,
		cachedTokens: 0,
	},
	createdAt: "2026-06-06T07:00:00.000Z",
	updatedAt: "2026-06-06T07:00:00.000Z",
	retryCount: 0,
	...overrides,
});

describe("mergeConversationMessages", () => {
	it("sorts merged history and local messages from oldest to newest", () => {
		const historyMessages = [
			chatMessage({
				id: "task-1:prompt",
				role: "user",
				content: "old prompt",
				createdAt: "2026-05-30T10:00:00.000Z",
			}),
			chatMessage({
				id: "task-1",
				role: "assistant",
				content: "old result",
				createdAt: "2026-05-30T10:00:00.000Z",
			}),
		];
		const localMessages = [
			chatMessage({
				id: "task-2:prompt",
				role: "user",
				content: "new prompt",
				createdAt: "2026-05-30T11:00:00.000Z",
			}),
			chatMessage({
				id: "task-2",
				role: "assistant",
				content: "new result",
				createdAt: "2026-05-30T11:00:00.000Z",
			}),
		];

		expect(
			mergeConversationMessages(historyMessages, localMessages).map((message) => message.id),
		).toEqual(["task-1:prompt", "task-1", "task-2:prompt", "task-2"]);
	});

	it("keeps history content when history and local messages share an id", () => {
		const localMessages = [
			chatMessage({
				id: "task-1",
				role: "assistant",
				content: "local loading content",
				status: "loading",
				createdAt: "2026-05-30T10:00:00.000Z",
			}),
		];
		const historyMessages = [
			chatMessage({
				id: "task-1",
				role: "assistant",
				content: "history completed content",
				status: "succeeded",
				createdAt: "2026-05-30T10:00:00.000Z",
			}),
		];

		expect(mergeConversationMessages(historyMessages, localMessages)).toEqual(historyMessages);
	});

	it("keeps a completed local result when the task history is still pending", () => {
		const localMessages = [
			chatMessage({
				id: "task-1",
				role: "assistant",
				kind: "image",
				content: "local completed content",
				status: "completed",
				assets: [{ kind: "image", url: "/api/v1/media-assets/generated/content" }],
				createdAt: "2026-05-30T10:00:00.000Z",
			}),
		];
		const historyMessages = [
			chatMessage({
				id: "task-1",
				role: "assistant",
				kind: "image",
				content: "history pending content",
				status: "running",
				assets: [],
				createdAt: "2026-05-30T10:00:00.000Z",
			}),
		];

		expect(mergeConversationMessages(historyMessages, localMessages)).toEqual(localMessages);
	});

	it("preserves user-before-assistant order for messages with the same timestamp", () => {
		const createdAt = "2026-05-30T10:00:00.000Z";
		const historyMessages = [
			chatMessage({
				id: "task-1:prompt",
				role: "user",
				content: "prompt",
				createdAt,
			}),
			chatMessage({
				id: "task-1",
				role: "assistant",
				content: "result",
				createdAt,
			}),
		];

		expect(mergeConversationMessages(historyMessages, []).map((message) => message.id)).toEqual([
			"task-1:prompt",
			"task-1",
		]);
	});

	it("treats pending tasks with persisted errors as terminal errors", () => {
		const messages = messagesFromTasks(
			[generationTask({ error: "dmx task status failed" })],
			[],
			fallbackCatalog,
		);
		const assistantMessage = messages.find((message) => message.role === "assistant");

		expect(assistantMessage).toMatchObject({
			id: "task-video",
			status: "error",
			content: "视频生成任务已提交，完成后请再次检查状态。",
			error: "dmx task status failed",
		});
		expect(isPendingVideoMessage(assistantMessage as ChatMessage)).toBe(false);
	});
});
