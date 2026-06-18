import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownSectionContext } from "@/domains/documents/components/tiptap/section-context";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { GenerationNotificationButton } from "./GenerationNotificationButton";

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

describe("GenerationNotificationButton", () => {
	afterEach(() => {
		cleanup();
		useGenerationNotificationStore.getState().clearNotifications();
	});

	it("shows unread count and opens a notification", async () => {
		const notification = useGenerationNotificationStore.getState().addNotification({
			assetCount: 1,
			target: {
				kind: "document-section",
				documentId: "doc-a",
				documentTitle: "第一集",
				projectId: "project-a",
				section,
			},
		});
		const onOpenNotification = vi.fn();

		render(<GenerationNotificationButton onOpenNotification={onOpenNotification} />);

		expect(screen.getByRole("button", { name: "生成通知，1 条未读" })).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "生成通知，1 条未读" }));
		fireEvent.click(screen.getByRole("button", { name: `打开 ${notification.description}` }));

		expect(screen.queryByRole("dialog", { name: "生成通知" })).toBeNull();
		await waitFor(() => expect(onOpenNotification).toHaveBeenCalledWith(notification));
	});
});
