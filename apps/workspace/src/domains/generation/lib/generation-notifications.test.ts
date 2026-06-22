import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownSectionContext } from "@/domains/documents/components/tiptap/section-context";
import type { GenerationSuccessNotification } from "@/domains/generation/stores/generation-notifications";
import { showGenerationSuccessSystemNotification } from "./generation-notifications";

const tauriNotificationMocks = vi.hoisted(() => ({
	isPermissionGranted: vi.fn(),
	requestPermission: vi.fn(),
	sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => tauriNotificationMocks);

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
		vi.mocked(tauriNotificationMocks.isPermissionGranted).mockReset();
		vi.mocked(tauriNotificationMocks.requestPermission).mockReset();
		tauriNotificationMocks.sendNotification.mockReset();
		delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
	});

	it("uses the Tauri notification plugin in desktop runtime", async () => {
		Object.defineProperty(window, "__TAURI_INTERNALS__", {
			configurable: true,
			value: {},
		});
		tauriNotificationMocks.isPermissionGranted.mockResolvedValue(false);
		tauriNotificationMocks.requestPermission.mockResolvedValue("granted");

		const result = await showGenerationSuccessSystemNotification(notification);

		expect(result).toBe("shown");
		expect(tauriNotificationMocks.sendNotification).toHaveBeenCalledWith({
			title: "生成完成",
			body: "第一集 · 画面 已生成图片。",
			group: "generation-success",
			autoCancel: true,
		});
	});

	it("falls back outside Tauri runtime", async () => {
		const result = await showGenerationSuccessSystemNotification(notification);

		expect(result).toBe("fallback");
		expect(tauriNotificationMocks.sendNotification).not.toHaveBeenCalled();
	});
});
