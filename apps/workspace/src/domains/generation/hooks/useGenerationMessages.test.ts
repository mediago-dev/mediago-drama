import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationTask } from "@/domains/generation/api/generation";
import {
	readScopedGenerationMessages,
	useScopedGenerationHistoryStore,
	writeScopedGenerationMessages,
	type ChatMessage,
} from "./useGenerationWorkspace.helpers";
import { fallbackCatalog } from "./generationFallbackCatalog";
import { useGenerationMessages } from "./useGenerationMessages";

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
	id: "message-1",
	role: "assistant",
	kind: "image",
	content: "done",
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
	...overrides,
});

const generationTask = (overrides: Partial<GenerationTask> = {}): GenerationTask => ({
	id: "task-1",
	kind: "image",
	routeId: "route-image",
	familyId: "image",
	versionId: "image-v1",
	provider: "openai",
	modelId: "image-model",
	model: "image-model",
	prompt: "draw a cat",
	referenceUrls: [],
	referenceAssetIds: [],
	params: {},
	status: "running",
	message: "正在生成图像...",
	assets: [],
	usage: {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		reasoningTokens: 0,
		cachedTokens: 0,
	},
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
	retryCount: 0,
	...overrides,
});

describe("useGenerationMessages", () => {
	afterEach(() => {
		cleanup();
		useScopedGenerationHistoryStore.setState({ messagesByScope: {} });
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("hydrates, updates, and persists scoped messages", async () => {
		const scopeId = "generation-scope";
		writeScopedGenerationMessages(scopeId, [message({ id: "stored" })]);

		const { result } = renderHook(() =>
			useGenerationMessages({
				catalog: fallbackCatalog,
				historyScopeId: scopeId,
				mediaAssets: [],
				recentTasks: [],
			}),
		);

		expect(result.current.conversationMessages.map((item) => item.id)).toEqual(["stored"]);

		act(() => {
			result.current.setMessages([message({ id: "next" })]);
		});

		await waitFor(() => {
			expect(readScopedGenerationMessages(scopeId).map((item) => item.id)).toEqual(["next"]);
		});
		expect(result.current.activeEntry?.id).toBe("next");
	});

	it("does not persist previous scope messages when scope changes", async () => {
		writeScopedGenerationMessages("scope-a", [message({ id: "scope-a-message" })]);

		const { rerender, result } = renderHook(
			({ scopeId }) =>
				useGenerationMessages({
					catalog: fallbackCatalog,
					historyScopeId: scopeId,
					mediaAssets: [],
					recentTasks: [],
				}),
			{ initialProps: { scopeId: "scope-a" } },
		);

		expect(result.current.conversationMessages.map((item) => item.id)).toEqual(["scope-a-message"]);

		rerender({ scopeId: "scope-b" });

		await waitFor(() => {
			expect(result.current.conversationMessages).toEqual([]);
		});
		expect(readScopedGenerationMessages("scope-a").map((item) => item.id)).toEqual([
			"scope-a-message",
		]);
		expect(readScopedGenerationMessages("scope-b")).toEqual([]);
	});

	it("supports controlled active entry changes", () => {
		const onActiveEntryIdChange = vi.fn();
		const { result } = renderHook(() =>
			useGenerationMessages({
				activeEntryId: "controlled",
				catalog: fallbackCatalog,
				mediaAssets: [],
				onActiveEntryIdChange,
				recentTasks: [],
			}),
		);

		act(() => {
			result.current.setActiveEntryId("next");
		});

		expect(result.current.activeEntryId).toBe("controlled");
		expect(onActiveEntryIdChange).toHaveBeenCalledWith("next");
	});

	it("keeps a local completed result while the task refresh is still pending", async () => {
		const scopeId = "generation-scope";
		writeScopedGenerationMessages(scopeId, [
			message({
				id: "task-1:prompt",
				role: "user",
				content: "draw a cat",
			}),
			message({
				id: "task-1",
				role: "assistant",
				status: "completed",
				content: "done",
				assets: [{ kind: "image", url: "/api/v1/media-assets/generated/content" }],
			}),
		]);

		const { result } = renderHook(() =>
			useGenerationMessages({
				catalog: fallbackCatalog,
				historyScopeId: scopeId,
				mediaAssets: [],
				recentTasks: [generationTask()],
			}),
		);

		await waitFor(() => {
			expect(result.current.activeEntry).toMatchObject({
				id: "task-1",
				status: "completed",
				assets: [{ kind: "image", url: "/api/v1/media-assets/generated/content" }],
			});
		});
		expect(readScopedGenerationMessages(scopeId)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "task-1",
					status: "completed",
				}),
			]),
		);
	});

	it("removes stale local pending messages once the matching task materializes", async () => {
		const scopeId = "generation-scope";
		writeScopedGenerationMessages(scopeId, [
			message({
				id: "local-123abc:prompt",
				role: "user",
				content: "draw a cat",
				createdAt: "2026-06-04T00:00:00.000Z",
			}),
			message({
				id: "local-123abc:assistant",
				role: "assistant",
				status: "loading",
				content: "正在生成图像...",
				createdAt: "2026-06-04T00:00:00.000Z",
			}),
		]);

		const { result } = renderHook(() =>
			useGenerationMessages({
				catalog: fallbackCatalog,
				historyScopeId: scopeId,
				mediaAssets: [],
				recentTasks: [
					generationTask({
						id: "task-materialized",
						status: "completed",
						message: "done",
						assets: [{ kind: "image", url: "/api/v1/media-assets/generated/content" }],
						updatedAt: "2026-06-04T00:00:05.000Z",
					}),
				],
			}),
		);

		await waitFor(() => {
			expect(result.current.conversationMessages.map((item) => item.id)).toEqual([
				"task-materialized:prompt",
				"task-materialized",
			]);
		});
		expect(readScopedGenerationMessages(scopeId)).toEqual([]);
	});
});
