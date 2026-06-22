import type { MarkdownSectionContext } from "@/domains/documents/components/tiptap/section-context";
import type { GenerationNotification } from "@/domains/generation/api/generation";
import { createStore } from "@/shared/lib/utils";

export interface DocumentSectionGenerationNotificationTarget {
	kind: "document-section";
	documentId: string;
	documentTitle: string;
	projectId: string;
	section: MarkdownSectionContext;
}

export type GenerationNotificationOpenKind = "image" | "audio" | "video";

export interface GenerationSuccessNotification {
	assetCount: number;
	createdAt: string;
	description: string;
	id: string;
	kind: GenerationNotificationOpenKind;
	readAt: string | null;
	sourceTaskId: string | null;
	target: DocumentSectionGenerationNotificationTarget;
	title: string;
}

interface AddGenerationSuccessNotificationInput {
	assetCount: number;
	kind?: GenerationNotificationOpenKind;
	sourceTaskId?: string | null;
	target: DocumentSectionGenerationNotificationTarget;
}

export interface PendingGenerationNotificationOpenRequest {
	kind: GenerationNotificationOpenKind;
	notificationId: string;
	target: DocumentSectionGenerationNotificationTarget;
}

interface GenerationNotificationState {
	notifications: GenerationSuccessNotification[];
	pendingOpenRequest: PendingGenerationNotificationOpenRequest | null;
	addNotification: (input: AddGenerationSuccessNotificationInput) => GenerationSuccessNotification;
	clearNotifications: () => void;
	consumeOpenRequest: (notificationId: string) => void;
	hasNotificationForTask: (sourceTaskId: string) => boolean;
	markAllRead: () => void;
	markRead: (notificationId: string) => void;
	requestOpenNotification: (notificationId: string) => GenerationSuccessNotification | null;
	setNotificationsFromServer: (records: GenerationNotification[]) => void;
	upsertNotificationFromServer: (record: GenerationNotification) => {
		inserted: boolean;
		notification: GenerationSuccessNotification | null;
	};
}

const maxGenerationNotifications = 100;

export const useGenerationNotificationStore = createStore<GenerationNotificationState>(
	(set, get) => ({
		notifications: [],
		pendingOpenRequest: null,
		addNotification: (input) => {
			const sourceTaskId = input.sourceTaskId?.trim() || null;
			const existing = sourceTaskId
				? get().notifications.find((notification) => notification.sourceTaskId === sourceTaskId)
				: null;
			if (existing) return existing;

			const notification = createGenerationSuccessNotification({ ...input, sourceTaskId });
			set((state) => ({
				notifications: [notification, ...state.notifications].slice(0, maxGenerationNotifications),
			}));
			return notification;
		},
		clearNotifications: () => set({ notifications: [], pendingOpenRequest: null }),
		consumeOpenRequest: (notificationId) =>
			set((state) =>
				state.pendingOpenRequest?.notificationId === notificationId
					? { pendingOpenRequest: null }
					: state,
			),
		hasNotificationForTask: (sourceTaskId) => {
			const normalizedSourceTaskId = sourceTaskId.trim();
			return Boolean(
				normalizedSourceTaskId &&
				get().notifications.some(
					(notification) => notification.sourceTaskId === normalizedSourceTaskId,
				),
			);
		},
		markAllRead: () => {
			const readAt = new Date().toISOString();
			set((state) => ({
				notifications: state.notifications.map((notification) =>
					notification.readAt ? notification : { ...notification, readAt },
				),
			}));
		},
		markRead: (notificationId) => {
			const readAt = new Date().toISOString();
			set((state) => ({
				notifications: state.notifications.map((notification) =>
					notification.id === notificationId && !notification.readAt
						? { ...notification, readAt }
						: notification,
				),
			}));
		},
		requestOpenNotification: (notificationId) => {
			const notification = get().notifications.find((item) => item.id === notificationId) ?? null;
			if (!notification) return null;

			const readAt = new Date().toISOString();
			set((state) => ({
				notifications: state.notifications.map((item) =>
					item.id === notificationId && !item.readAt ? { ...item, readAt } : item,
				),
				pendingOpenRequest: {
					kind: notification.kind,
					notificationId,
					target: notification.target,
				},
			}));
			return notification;
		},
		setNotificationsFromServer: (records) => {
			const incomingNotifications = records
				.map(generationNotificationFromRecord)
				.filter((notification): notification is GenerationSuccessNotification =>
					Boolean(notification),
				)
				.slice(0, maxGenerationNotifications);
			set((state) => ({
				notifications: mergeNotificationLists(incomingNotifications, state.notifications).slice(
					0,
					maxGenerationNotifications,
				),
			}));
		},
		upsertNotificationFromServer: (record) => {
			const notification = generationNotificationFromRecord(record);
			if (!notification) return { inserted: false, notification: null };

			const existing = findMatchingNotification(get().notifications, notification);
			set((state) => {
				const currentExisting = findMatchingNotification(state.notifications, notification);
				if (!currentExisting) {
					return {
						notifications: [notification, ...state.notifications].slice(
							0,
							maxGenerationNotifications,
						),
					};
				}
				return {
					notifications: state.notifications.map((item) =>
						item.id === currentExisting.id ? mergeNotification(item, notification) : item,
					),
				};
			});
			return { inserted: !existing, notification: existing ?? notification };
		},
	}),
	"generationNotificationStore",
);

const generationNotificationFromRecord = (
	record: GenerationNotification,
): GenerationSuccessNotification | null => {
	if (record.target.kind !== "document-section") return null;

	const target = generationNotificationTargetFromRecord(record);
	if (!target) return null;

	return {
		assetCount: record.assetCount,
		createdAt: record.createdAt,
		description: record.description,
		id: record.id,
		kind: generationNotificationKindFromTaskKind(record.taskKind),
		readAt: record.readAt?.trim() || null,
		sourceTaskId: record.taskId?.trim() || null,
		target,
		title: record.title,
	};
};

const generationNotificationTargetFromRecord = (
	record: GenerationNotification,
): DocumentSectionGenerationNotificationTarget | null => {
	const projectId = record.target.projectId?.trim() || record.projectId?.trim() || "";
	const documentId = record.target.documentId?.trim() || record.target.section.documentId.trim();
	if (!projectId || !documentId) return null;

	return {
		kind: "document-section",
		documentId,
		documentTitle: record.target.documentTitle?.trim() || "未命名文档",
		projectId,
		section: {
			blockId: record.target.section.blockId,
			documentId,
			headingLevel: record.target.section.headingLevel,
			headingOccurrence: record.target.section.headingOccurrence,
			headingText: record.target.section.headingText,
			markdown: record.target.section.markdown,
			plainText: record.target.section.plainText,
			prompt: record.target.section.prompt,
		},
	};
};

const createGenerationSuccessNotification = ({
	assetCount,
	kind = "image",
	sourceTaskId,
	target,
}: AddGenerationSuccessNotificationInput): GenerationSuccessNotification => {
	const documentTitle = target.documentTitle.trim() || "未命名文档";
	const sectionTitle = target.section.headingText.trim() || "未命名章节";
	const description = generationNotificationDescription(
		kind,
		documentTitle,
		sectionTitle,
		assetCount,
	);

	return {
		assetCount,
		createdAt: new Date().toISOString(),
		description,
		id: generationNotificationId(),
		kind,
		readAt: null,
		sourceTaskId: sourceTaskId?.trim() || null,
		target,
		title: "生成完成",
	};
};

const generationNotificationKindFromTaskKind = (
	taskKind: string,
): GenerationNotificationOpenKind => {
	const normalizedKind = taskKind.trim();
	if (normalizedKind === "audio" || normalizedKind === "video") return normalizedKind;
	return "image";
};

const generationNotificationDescription = (
	kind: GenerationNotificationOpenKind,
	documentTitle: string,
	sectionTitle: string,
	assetCount: number,
) => {
	if (kind === "video") {
		return assetCount > 1
			? `${documentTitle} · ${sectionTitle} 已生成 ${assetCount} 个视频。`
			: `${documentTitle} · ${sectionTitle} 已生成视频。`;
	}
	if (kind === "audio") {
		return assetCount > 1
			? `${documentTitle} · ${sectionTitle} 已生成 ${assetCount} 条音频。`
			: `${documentTitle} · ${sectionTitle} 已生成音频。`;
	}
	return assetCount > 1
		? `${documentTitle} · ${sectionTitle} 已生成 ${assetCount} 张图片。`
		: `${documentTitle} · ${sectionTitle} 已生成图片。`;
};

const findMatchingNotification = (
	notifications: GenerationSuccessNotification[],
	notification: GenerationSuccessNotification,
) =>
	notifications.find((item) => item.id === notification.id) ??
	(notification.sourceTaskId
		? notifications.find((item) => item.sourceTaskId === notification.sourceTaskId)
		: undefined);

const mergeNotification = (
	current: GenerationSuccessNotification,
	next: GenerationSuccessNotification,
): GenerationSuccessNotification => ({
	...next,
	readAt: next.readAt ?? current.readAt,
});

const mergeNotificationLists = (
	incoming: GenerationSuccessNotification[],
	current: GenerationSuccessNotification[],
) => {
	const merged = [...incoming];
	for (const notification of current) {
		const existing = findMatchingNotification(merged, notification);
		if (!existing) {
			merged.push(notification);
			continue;
		}

		const existingIndex = merged.findIndex((item) => item.id === existing.id);
		if (existingIndex >= 0) {
			merged[existingIndex] = mergeNotification(notification, existing);
		}
	}
	return merged;
};

const generationNotificationId = () =>
	`generation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
