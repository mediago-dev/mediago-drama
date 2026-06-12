import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export type DocumentAgentRuntimeMode = "mock" | "remote";

interface AgentPersistenceState {
	documentRuntimeMode: DocumentAgentRuntimeMode;
	sessionIdsByProject: Record<string, string>;
	getSessionId: (projectId: string) => string | null;
	setDocumentRuntimeMode: (mode: DocumentAgentRuntimeMode) => void;
	setSessionId: (projectId: string, sessionId: string) => void;
}

const agentPersistenceStoreKey = "agent-persistence.v1";

export const useAgentPersistenceStore = create<AgentPersistenceState>()(
	persist(
		immer((set, get) => ({
			documentRuntimeMode: "remote",
			sessionIdsByProject: {},
			getSessionId: (projectId) => get().sessionIdsByProject[projectId] ?? null,
			setDocumentRuntimeMode: (mode) =>
				set((state) => {
					state.documentRuntimeMode = mode;
				}),
			setSessionId: (projectId, sessionId) =>
				set((state) => {
					if (!projectId || !sessionId) return;
					state.sessionIdsByProject[projectId] = sessionId;
				}),
		})),
		{
			name: agentPersistenceStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: 1,
			partialize: (state) => ({
				documentRuntimeMode: state.documentRuntimeMode,
				sessionIdsByProject: state.sessionIdsByProject,
			}),
			merge: (persisted, current) => {
				const state =
					(persisted as
						| Partial<Pick<AgentPersistenceState, "documentRuntimeMode" | "sessionIdsByProject">>
						| undefined) ?? {};
				return {
					...current,
					documentRuntimeMode: state.documentRuntimeMode === "mock" ? "mock" : "remote",
					sessionIdsByProject: normalizeSessionIdsByProject(state.sessionIdsByProject),
				};
			},
		},
	),
);

export const getPersistedAgentSessionId = (projectId: string) =>
	useAgentPersistenceStore.getState().getSessionId(projectId);

export const setPersistedAgentSessionId = (projectId: string, sessionId: string) => {
	useAgentPersistenceStore.getState().setSessionId(projectId, sessionId);
};

const normalizeSessionIdsByProject = (value: unknown) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	const sessionIdsByProject: Record<string, string> = {};
	for (const [projectId, sessionId] of Object.entries(value)) {
		if (projectId && typeof sessionId === "string" && sessionId) {
			sessionIdsByProject[projectId] = sessionId;
		}
	}

	return sessionIdsByProject;
};
