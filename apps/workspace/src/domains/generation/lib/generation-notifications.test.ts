import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownSectionContext } from "@/domains/documents/components/tiptap/section-context";
import type { GenerationSuccessNotification } from "@/domains/generation/stores/generation-notifications";
import {
	showGenerationSuccessSystemNotification,
	showGenerationTaskCompletedSystemNotification,
} from "./generation-notifications";

const section: MarkdownSectionContext = {
	blockId: "section_visual",
	documentId: "doc-a",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "画面",
	markdown: "## 画面",
	plainText: "画面",
	prompt: "生成画面",
};

const notification: GenerationSuccessNotification = {
	assetCount: 1,
	createdAt: "2026-06-09T00:00:00.000Z",
	description: "第一集 · 画面 已生成图片。",
	id: "generation-1",
	kind: "image",
	readAt: null,
	sourceTaskId: null,
	target: {
		kind: "document-section",
		documentId: "doc-a",
		documentTitle: "第一集",
		projectId: "project-a",
		section,
	},
	title: "生成完成",
};

describe("generation system notifications", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		delete window.mediagoDesktop;
	});

	it("uses the Electron desktop notification bridge in desktop runtime", async () => {
		const showNotification = vi.fn().mockResolvedValue(true);
		window.mediagoDesktop = {
			isElectron: true,
			showNotification,
		} as unknown as typeof window.mediagoDesktop;

		const result = await showGenerationSuccessSystemNotification(notification);

		expect(result).toBe("shown");
		expect(showNotification).toHaveBeenCalledWith({
			title: "生成完成",
			body: "第一集 · 画面 已生成图片。",
		});
	});

	it("shows a generic notification for a completed task without a notification target", async () => {
		const showNotification = vi.fn().mockResolvedValue(true);
		window.mediagoDesktop = {
			isElectron: true,
			showNotification,
		} as unknown as typeof window.mediagoDesktop;

		const result = await showGenerationTaskCompletedSystemNotification();

		expect(result).toBe("shown");
		expect(showNotification).toHaveBeenCalledWith({
			title: "生成完成",
			body: "生成任务已完成。",
		});
	});

	it("falls back outside desktop runtime", async () => {
		const result = await showGenerationSuccessSystemNotification(notification);

		expect(result).toBe("fallback");
	});
});
