import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export type DocumentAgentRuntimeMode = "mock" | "remote";
export type AgentRuntimeConfigField = "model" | "reasoning" | "permission";
export type PersistedAgentRuntimeConfig = Partial<Record<AgentRuntimeConfigField, string>>;

// A selection/form card the user has already decided. Persisted so the card
// renders frozen after a transcript hydrate re-materializes the original
// interactive payload (the in-memory chat store is rebuilt from the server on
// every refresh/reload, discarding the local freeze).
export interface ResolvedAgentSelection {
	status: string;
	summary: string;
}

// Cap the resolved map so it can't grow without bound across many sessions.
const resolvedSelectionLimit = 500;

interface AgentPersistenceState {
	documentRuntimeMode: DocumentAgentRuntimeMode;
	runtimeConfigDefaults: PersistedAgentRuntimeConfig;
	runtimeConfigByProject: Record<string, PersistedAgentRuntimeConfig>;
	sessionIdsByProject: Record<string, string>;
	resolvedSelections: Record<string, ResolvedAgentSelection>;
	getSessionId: (projectId: string) => string | null;
	setDocumentRuntimeMode: (mode: DocumentAgentRuntimeMode) => void;
	setRuntimeConfigValue: (
		projectId: string | null | undefined,
		field: AgentRuntimeConfigField,
		value: string,
	) => void;
	setSessionId: (projectId: string, sessionId: string) => void;
	markSelectionResolved: (selectionId: string, resolution: ResolvedAgentSelection) => void;
}

const agentPersistenceStoreKey = "agent-persistence.v1";

export const useAgentPersistenceStore = create<AgentPersistenceState>()(
	persist(
		immer((set, get) => ({
			documentRuntimeMode: "remote",
			runtimeConfigDefaults: {},
			runtimeConfigByProject: {},
			sessionIdsByProject: {},
			resolvedSelections: {},
			getSessionId: (projectId) => get().sessionIdsByProject[projectId] ?? null,
			setDocumentRuntimeMode: (mode) =>
				set((state) => {
					state.documentRuntimeMode = mode;
				}),
			setRuntimeConfigValue: (projectId, field, value) =>
				set((state) => {
					const trimmedValue = value.trim();
					if (!trimmedValue) {
						delete state.runtimeConfigDefaults[field];
						const trimmedProjectId = projectId?.trim() ?? "";
						if (!trimmedProjectId) return;
						delete state.runtimeConfigByProject[trimmedProjectId]?.[field];
						if (Object.keys(state.runtimeConfigByProject[trimmedProjectId] ?? {}).length === 0) {
							delete state.runtimeConfigByProject[trimmedProjectId];
						}
						return;
					}

					state.runtimeConfigDefaults[field] = trimmedValue;
					const trimmedProjectId = projectId?.trim() ?? "";
					if (!trimmedProjectId) return;
					state.runtimeConfigByProject[trimmedProjectId] ??= {};
					state.runtimeConfigByProject[trimmedProjectId][field] = trimmedValue;
				}),
			setSessionId: (projectId, sessionId) =>
				set((state) => {
					if (!projectId || !sessionId) return;
					state.sessionIdsByProject[projectId] = sessionId;
				}),
			markSelectionResolved: (selectionId, resolution) =>
				set((state) => {
					const id = selectionId.trim();
					if (!id) return;
					state.resolvedSelections[id] = resolution;
					const ids = Object.keys(state.resolvedSelections);
					if (ids.length > resolvedSelectionLimit) {
						for (const staleId of ids.slice(0, ids.length - resolvedSelectionLimit)) {
							delete state.resolvedSelections[staleId];
						}
					}
				}),
		})),
		{
			name: agentPersistenceStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: 1,
			partialize: (state) => ({
				documentRuntimeMode: state.documentRuntimeMode,
				runtimeConfigDefaults: state.runtimeConfigDefaults,
				runtimeConfigByProject: state.runtimeConfigByProject,
				sessionIdsByProject: state.sessionIdsByProject,
				resolvedSelections: state.resolvedSelections,
			}),
			merge: (persisted, current) => {
				const state =
					(persisted as
						| Partial<
								Pick<
									AgentPersistenceState,
									| "documentRuntimeMode"
									| "runtimeConfigDefaults"
									| "runtimeConfigByProject"
									| "sessionIdsByProject"
									| "resolvedSelections"
								>
						  >
						| undefined) ?? {};
				return {
					...current,
					documentRuntimeMode: state.documentRuntimeMode === "mock" ? "mock" : "remote",
					runtimeConfigDefaults: normalizeRuntimeConfig(state.runtimeConfigDefaults),
					runtimeConfigByProject: normalizeRuntimeConfigByProject(state.runtimeConfigByProject),
					sessionIdsByProject: normalizeSessionIdsByProject(state.sessionIdsByProject),
					resolvedSelections: normalizeResolvedSelections(state.resolvedSelections),
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

const normalizeRuntimeConfigByProject = (value: unknown) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	const runtimeConfigByProject: Record<string, PersistedAgentRuntimeConfig> = {};
	for (const [projectId, config] of Object.entries(value)) {
		const normalized = normalizeRuntimeConfig(config);
		if (Object.keys(normalized).length > 0) {
			runtimeConfigByProject[projectId] = normalized;
		}
	}

	return runtimeConfigByProject;
};

const normalizeRuntimeConfig = (value: unknown) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	const normalized: PersistedAgentRuntimeConfig = {};
	for (const field of ["model", "reasoning", "permission"] as const) {
		const fieldValue = (value as Record<string, unknown>)[field];
		if (typeof fieldValue === "string" && fieldValue.trim()) {
			normalized[field] = fieldValue.trim();
		}
	}

	return normalized;
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

const normalizeResolvedSelections = (value: unknown) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	const resolvedSelections: Record<string, ResolvedAgentSelection> = {};
	for (const [selectionId, resolution] of Object.entries(value)) {
		if (!selectionId || !resolution || typeof resolution !== "object") continue;
		const { status, summary } = resolution as Partial<ResolvedAgentSelection>;
		if (typeof status === "string" && status) {
			resolvedSelections[selectionId] = {
				status,
				summary: typeof summary === "string" ? summary : "",
			};
		}
	}

	return resolvedSelections;
};
