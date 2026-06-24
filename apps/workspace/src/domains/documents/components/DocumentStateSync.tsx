import type React from "react";
import { useEffect, useLayoutEffect } from "react";
import useSWR from "swr";
import {
	createWorkspaceEventSource,
	getWorkspaceState,
	type WorkspaceStatePayload,
	workspaceDocumentsChangedEventType,
	workspaceStateKey,
} from "@/domains/workspace/api/workspace";
import { useDocumentsStore } from "@/domains/documents/stores";

interface DocumentStateSyncProps {
	projectId?: string | null;
}

export const workspaceStateFallbackRefreshIntervalMs = 10000;

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
		const refreshWorkspaceState = () => {
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

		eventSource.addEventListener(workspaceDocumentsChangedEventType, refreshWorkspaceState);
		return () => {
			closed = true;
			eventSource.removeEventListener(workspaceDocumentsChangedEventType, refreshWorkspaceState);
			eventSource.close();
		};
	}, [projectId]);

	return null;
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
