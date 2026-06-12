import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("useGenerationMessages", () => {
	afterEach(() => {
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
});
