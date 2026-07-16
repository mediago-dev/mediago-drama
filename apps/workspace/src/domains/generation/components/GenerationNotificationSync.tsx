import { useEffect } from "react";
import { useSWRConfig } from "swr";
import {
	createGenerationNotificationEventSource,
	generationConversationsKey,
	generationTasksKey,
	getGenerationNotifications,
	type GenerationNotificationEvent,
} from "@/domains/generation/api/generation";
import { refreshSelectedGenerationAssetDependents } from "@/domains/generation/lib/refresh-selected-assets";
import {
	showGenerationSuccessSystemNotification,
	showGenerationTaskCompletedSystemNotification,
} from "@/domains/generation/lib/generation-notifications";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { mediaAssetsKey } from "@/domains/workspace/api/media";

const generationNotificationCompletedEventType = "generation.notification.completed";
const generationNotificationConnectedEventType = "generation.notification.connected";
const generationTaskStartedEventType = "generation.task.started";
// Fired for tasks that completed in the background without a tracked
// notification target (e.g. agent-submitted image tasks): no notification
// record, but resource covers/counts still need revalidating.
const generationTaskCompletedEventType = "generation.task.completed";

export const GenerationNotificationSync = () => {
	const { mutate } = useSWRConfig();

	useEffect(() => {
		let closed = false;

		void getGenerationNotifications()
			.then((response) => {
				if (!closed) {
					useGenerationNotificationStore
						.getState()
						.setNotificationsFromServer(response.notifications);
				}
			})
			.catch(() => {
				// The live stream can still deliver new notifications after a transient list error.
			});

		const source = createGenerationNotificationEventSource();
		const handleCompleted = (event: MessageEvent<string>) => {
			const payload = parseGenerationNotificationEvent(event.data);
			if (!payload?.notification) return;

			revalidateGenerationCaches(mutate);
			refreshSelectedGenerationAssetDependents(
				payload.projectId || payload.notification.projectId,
				undefined,
				mutate,
			);
			const result = useGenerationNotificationStore
				.getState()
				.upsertNotificationFromServer(payload.notification);
			if (result.inserted && result.notification && !result.notification.readAt) {
				void showGenerationSuccessSystemNotification(result.notification);
			}
		};
		const handleTaskCompleted = (event: MessageEvent<string>) => {
			const payload = parseGenerationNotificationEvent(event.data);
			if (!payload) return;
			revalidateGenerationCaches(mutate);
			refreshSelectedGenerationAssetDependents(payload.projectId, undefined, mutate);
			void showGenerationTaskCompletedSystemNotification();
		};
		const handleTaskStarted = (event: MessageEvent<string>) => {
			if (!parseGenerationNotificationEvent(event.data)) return;
			revalidateGenerationTaskCaches(mutate);
		};
		const handleConnected = (event: MessageEvent<string>) => {
			if (!parseGenerationNotificationEvent(event.data)) return;
			// The broker has no replay buffer. Revalidate once after every connect
			// so a task-start event missed during a disconnect is recovered.
			revalidateGenerationTaskCaches(mutate);
		};

		source.addEventListener(generationNotificationConnectedEventType, handleConnected);
		source.addEventListener(generationNotificationCompletedEventType, handleCompleted);
		source.addEventListener(generationTaskStartedEventType, handleTaskStarted);
		source.addEventListener(generationTaskCompletedEventType, handleTaskCompleted);
		return () => {
			closed = true;
			source.removeEventListener(generationNotificationConnectedEventType, handleConnected);
			source.removeEventListener(generationNotificationCompletedEventType, handleCompleted);
			source.removeEventListener(generationTaskStartedEventType, handleTaskStarted);
			source.removeEventListener(generationTaskCompletedEventType, handleTaskCompleted);
			source.close();
		};
	}, [mutate]);

	return null;
};

const parseGenerationNotificationEvent = (value: string): GenerationNotificationEvent | null => {
	try {
		return JSON.parse(value) as GenerationNotificationEvent;
	} catch {
		return null;
	}
};

type SWRMutator = ReturnType<typeof useSWRConfig>["mutate"];

const revalidateGenerationTaskCaches = (mutate: SWRMutator) => {
	void mutate(isGenerationTasksCacheKey);
	void mutate(isGenerationConversationsCacheKey);
};

const revalidateGenerationCaches = (mutate: SWRMutator) => {
	revalidateGenerationTaskCaches(mutate);
	void mutate(isMediaAssetsCacheKey);
};

const isGenerationTasksCacheKey = (key: unknown) =>
	Array.isArray(key) && key[0] === generationTasksKey;

const isGenerationConversationsCacheKey = (key: unknown) =>
	Array.isArray(key) && key[0] === generationConversationsKey;

const isMediaAssetsCacheKey = (key: unknown) => Array.isArray(key) && key[0] === mediaAssetsKey;
