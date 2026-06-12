import { afterEach, describe, expect, it } from "vitest";
import type { MarkdownSectionContext } from "@/domains/documents/components/tiptap/section-context";
import type { GenerationNotification } from "@/domains/generation/api/generation";
import { useGenerationNotificationStore } from "./generation-notifications";

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

describe("generation notification store", () => {
	afterEach(() => {
		useGenerationNotificationStore.getState().clearNotifications();
	});

	it("adds unread generation success notifications", () => {
		const notification = addNotification();

		expect(notification.readAt).toBeNull();
		expect(notification.description).toBe("第一集 · 画面 已生成 2 张图片。");
		expect(useGenerationNotificationStore.getState().notifications).toHaveLength(1);
	});

	it("marks a notification read and stores an open request", () => {
		const notification = addNotification();

		const opened = useGenerationNotificationStore
			.getState()
			.requestOpenNotification(notification.id);

		expect(opened?.id).toBe(notification.id);
		expect(useGenerationNotificationStore.getState().notifications[0]?.readAt).toBeTruthy();
		expect(useGenerationNotificationStore.getState().pendingOpenRequest).toMatchObject({
			notificationId: notification.id,
			target: { documentId: "doc-a", projectId: "project-a" },
		});

		useGenerationNotificationStore.getState().consumeOpenRequest(notification.id);
		expect(useGenerationNotificationStore.getState().pendingOpenRequest).toBeNull();
	});

	it("loads server notifications", () => {
		useGenerationNotificationStore.getState().setNotificationsFromServer([serverNotification()]);

		expect(useGenerationNotificationStore.getState().notifications).toEqual([
			expect.objectContaining({
				id: "notification-1",
				sourceTaskId: "task-1",
				readAt: null,
				description: "第一集 · 画面 已生成图片。",
			}),
		]);
	});

	it("upserts server notifications without duplicating task records", () => {
		const first = useGenerationNotificationStore
			.getState()
			.upsertNotificationFromServer(serverNotification());
		const second = useGenerationNotificationStore.getState().upsertNotificationFromServer({
			...serverNotification(),
			id: "notification-2",
			description: "第一集 · 画面 已生成 2 张图片。",
			assetCount: 2,
		});

		expect(first.inserted).toBe(true);
		expect(second.inserted).toBe(false);
		expect(useGenerationNotificationStore.getState().notifications).toHaveLength(1);
		expect(useGenerationNotificationStore.getState().notifications[0]).toMatchObject({
			id: "notification-2",
			sourceTaskId: "task-1",
			assetCount: 2,
		});
	});

	it("does not drop live notifications when an older server list resolves later", () => {
		useGenerationNotificationStore
			.getState()
			.upsertNotificationFromServer(serverNotification({ id: "notification-live" }));

		useGenerationNotificationStore.getState().setNotificationsFromServer([]);

		expect(useGenerationNotificationStore.getState().notifications).toEqual([
			expect.objectContaining({
				id: "notification-live",
				sourceTaskId: "task-1",
			}),
		]);
	});
});

const addNotification = () =>
	useGenerationNotificationStore.getState().addNotification({
		assetCount: 2,
		target: notificationTarget(),
	});

const notificationTarget = () => ({
	kind: "document-section" as const,
	documentId: "doc-a",
	documentTitle: "第一集",
	projectId: "project-a",
	section,
});

const serverNotification = (
	overrides: Partial<GenerationNotification> = {},
): GenerationNotification => ({
	id: "notification-1",
	taskId: "task-1",
	taskKind: "image",
	taskStatus: "completed",
	projectId: "project-a",
	title: "生成完成",
	description: "第一集 · 画面 已生成图片。",
	assetCount: 1,
	readAt: "",
	target: {
		...notificationTarget(),
		section: {
			blockId: section.blockId,
			documentId: section.documentId,
			headingLevel: section.headingLevel,
			headingOccurrence: section.headingOccurrence,
			headingText: section.headingText,
			markdown: section.markdown,
			plainText: section.plainText,
			prompt: section.prompt,
		},
	},
	createdAt: "2026-06-09T00:00:00.000Z",
	updatedAt: "2026-06-09T00:00:00.000Z",
	...overrides,
});
