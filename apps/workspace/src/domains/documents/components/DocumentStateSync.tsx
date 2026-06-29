import type React from "react";
import { useEffect, useLayoutEffect } from "react";
import useSWR from "swr";
import {
	createWorkspaceEventSource,
	getWorkspaceDocuments,
	getWorkspaceFolders,
	getWorkspaceState,
	type WorkspaceEventPayload,
	type WorkspaceStatePayload,
	workspaceDocumentsChangedEventType,
	workspaceStateKey,
} from "@/domains/workspace/api/workspace";
import type { DocumentFolder, MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";

interface DocumentStateSyncProps {
	projectId?: string | null;
}

// Live SSE deltas drive real-time updates, so this full-state poll only acts as a
// slow self-healing reconcile in case an event is missed or the stream reconnects.
export const workspaceStateFallbackRefreshIntervalMs = 60000;

export const DocumentStateSync: React.FC<DocumentStateSyncProps> = ({ projectId }) => {
	const swrKey = projectId ? workspaceStateKey(projectId) : null;
	const { data, error, isLoading } = useSWR(swrKey, () => getWorkspaceState(projectId), {
		refreshInterval: workspaceStateFallbackRefreshIntervalMs,
	});

	useEffect(() => {
		if (!projectId) {
			useDocumentsStore.getState().prepareWorkspaceLoad("请选择一个项目");
			return;
		}
		const currentState = useDocumentsStore.getState();
		if (currentState.projectId !== projectId) {
			currentState.prepareWorkspaceLoad("正在加载项目工作区");
			return;
		}
		if (isLoading) {
			currentState.markWorkspaceSyncStatus("syncing", "正在加载项目工作区");
		}
	}, [isLoading, projectId]);

	useLayoutEffect(() => {
		if (!data) return;
		hydrateWorkspaceStateFromPayload(data, projectId);
	}, [data, projectId]);

	useEffect(() => {
		if (!error) return;
		useDocumentsStore.getState().markWorkspaceSyncStatus("error", "后端工作区加载失败");
	}, [error]);

	useEffect(() => {
		if (!projectId || typeof EventSource === "undefined") return;

		let closed = false;
		const eventSource = createWorkspaceEventSource(projectId);
		const isStale = () => closed || useDocumentsStore.getState().projectId !== projectId;

		const refreshFullState = () => {
			void getWorkspaceState(projectId)
				.then((payload) => {
					if (closed) return;
					hydrateWorkspaceStateFromPayload(payload, projectId);
				})
				.catch(() => {
					if (!closed) {
						useDocumentsStore.getState().markWorkspaceSyncStatus("error", "后端工作区加载失败");
					}
				});
		};

		const applyDelta = async (event: WorkspaceEventPayload) => {
			const changedIds = event.changedDocumentIds ?? [];
			const removedIds = event.removedDocumentIds ?? [];
			const structureChanged = Boolean(event.structureChanged);
			if (changedIds.length === 0 && removedIds.length === 0 && !structureChanged) return;
			try {
				let changedDocuments: MarkdownDocument[] = [];
				let folders: DocumentFolder[] | undefined;
				if (changedIds.length > 0) {
					// One batched request loads the changed documents and the full
					// folder/asset envelope in a single backend scan.
					const payload = await getWorkspaceDocuments(projectId, changedIds);
					if (isStale()) return;
					changedDocuments = payload.documents;
					if (structureChanged) folders = payload.folders;
				} else if (structureChanged) {
					const payload = await getWorkspaceFolders(projectId);
					if (isStale()) return;
					folders = payload.folders;
				}
				if (isStale()) return;
				useDocumentsStore.getState().applyWorkspaceDelta({
					changedDocuments,
					removedDocumentIds: removedIds,
					folders,
				});
			} catch {
				if (!closed) refreshFullState();
			}
		};

		const handleDocumentsChanged = (message: MessageEvent) => {
			const event = parseWorkspaceEvent(message.data);
			if (!event) {
				// Unparseable payload (or legacy event without a delta): reconcile fully.
				refreshFullState();
				return;
			}
			if (event.projectId && event.projectId !== projectId) return;
			if (event.fullReload) {
				refreshFullState();
				return;
			}
			void applyDelta(event);
		};

		eventSource.addEventListener(workspaceDocumentsChangedEventType, handleDocumentsChanged);
		return () => {
			closed = true;
			eventSource.removeEventListener(workspaceDocumentsChangedEventType, handleDocumentsChanged);
			eventSource.close();
		};
	}, [projectId]);

	return null;
};

const parseWorkspaceEvent = (raw: unknown): WorkspaceEventPayload | null => {
	if (typeof raw !== "string" || raw.trim() === "") return null;
	try {
		return JSON.parse(raw) as WorkspaceEventPayload;
	} catch {
		return null;
	}
};

const hydrateWorkspaceStateFromPayload = (
	payload: WorkspaceStatePayload,
	projectId?: string | null,
) => {
	if (projectId && payload.projectId && payload.projectId !== projectId) return;
	const currentState = useDocumentsStore.getState();
	if (
		currentState.projectId === (payload.projectId ?? projectId ?? null) &&
		currentState.documents.some((document) => document.isDirty)
	) {
		return;
	}
	useDocumentsStore
		.getState()
		.hydrateWorkspaceState(
			payload.documents,
			payload.operationLog,
			payload.workspaceDir,
			payload.projectId ?? projectId,
			payload.assets,
			payload.folders,
		);
};
