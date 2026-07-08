import type { AgentRuntimeEvent } from "@/domains/agent/api/agent";
import { type AgentRuntimeStatus, useAgentStore } from "@/domains/agent/stores";
import { type MarkdownDocument, useDocumentsStore } from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { getWorkspaceState } from "@/domains/workspace/api/workspace";

// Small leaf helpers shared by the agent runtime modules (controller,
// streaming-events, session-sync, document-streaming). Keep this file free of
// imports from those modules so the dependency graph stays acyclic.

export const isCurrentAgentProject = (projectId: string | null) =>
	useProjectStore.getState().activeProjectId === projectId;

export const eventRunId = (event: AgentRuntimeEvent) => event.runId?.trim() || undefined;

export const debugAgentError = (message: string, error: unknown) => {
	if (!import.meta.env.DEV) return;
	console.debug(`[agent] ${message}`, error);
};

export const refreshWorkspaceStateFromBackend = async (projectId?: string) => {
	const targetProjectId = projectId ?? useProjectStore.getState().activeProjectId;
	if (!targetProjectId) return;
	try {
		const state = await getWorkspaceState(targetProjectId);
		if (!isCurrentAgentProject(targetProjectId)) return;
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				state.documents,
				state.operationLog,
				state.workspaceDir,
				state.projectId ?? targetProjectId,
				state.assets,
			);
	} catch {
		useAgentStore
			.getState()
			.recordActivity("runtime", "文档同步失败", "智能体完成后刷新后端文档状态失败。");
	}
};

export const acpRuntimeStatus: AgentRuntimeStatus = {
	runtime: "acp",
	fallback: false,
	validated: true,
};

export const fallbackAgentDocument = (): MarkdownDocument => ({
	id: "",
	title: "当前文档",
	content: "",
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: new Date().toISOString(),
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});
