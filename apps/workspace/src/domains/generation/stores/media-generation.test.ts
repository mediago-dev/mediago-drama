import { afterEach, describe, expect, it } from "vitest";
import type { MarkdownSectionContext } from "@/domains/documents/components/tiptap/section-context";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";

const section: MarkdownSectionContext = {
	blockId: "section_visual",
	documentId: "story-doc",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "画面",
	markdown: "## 画面",
	plainText: "画面",
	prompt: "画面提示词。",
};

afterEach(() => {
	useMediaGenerationStore.setState({
		activeRequest: null,
		optimisticStatuses: {},
	});
});

describe("useMediaGenerationStore active request", () => {
	it("keeps one global notification request and replaces it on the next open", () => {
		const { open, close } = useMediaGenerationStore.getState();
		open({ kind: "image", projectId: "project-a", section });
		expect(useMediaGenerationStore.getState().activeRequest).toMatchObject({
			kind: "image",
			projectId: "project-a",
		});

		open({ kind: "video", projectId: "project-a", section });
		expect(useMediaGenerationStore.getState().activeRequest?.kind).toBe("video");

		close();
		expect(useMediaGenerationStore.getState().activeRequest).toBeNull();
	});
});

describe("useMediaGenerationStore optimistic statuses", () => {
	it("marks a resource as generating then clears it", () => {
		const { markGenerating, clearStatus } = useMediaGenerationStore.getState();
		markGenerating("res-1");
		expect(useMediaGenerationStore.getState().optimisticStatuses["res-1"]).toMatchObject({
			kind: "pending",
			label: "生成中",
		});

		clearStatus("res-1");
		expect(useMediaGenerationStore.getState().optimisticStatuses["res-1"]).toBeUndefined();
	});

	it("marks a resource as failed with a message", () => {
		useMediaGenerationStore.getState().markFailed("res-2", { message: "boom" });
		expect(useMediaGenerationStore.getState().optimisticStatuses["res-2"]).toMatchObject({
			kind: "failed",
			message: "boom",
		});
	});

	it("clearStatus is a no-op for unknown keys", () => {
		const before = useMediaGenerationStore.getState().optimisticStatuses;
		useMediaGenerationStore.getState().clearStatus("missing");
		expect(useMediaGenerationStore.getState().optimisticStatuses).toBe(before);
	});

	it("clearStatuses drops every optimistic status", () => {
		const store = useMediaGenerationStore.getState();
		store.markGenerating("res-a");
		store.markGenerating("res-b");
		store.clearStatuses();
		expect(useMediaGenerationStore.getState().optimisticStatuses).toEqual({});
	});
});
