import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export const OVERVIEW_SENTINEL = "__overview__";

type LastDocumentValue = string;

interface LastDocumentState {
	lastDocumentIdByProject: Record<string, LastDocumentValue | null>;
	getLastDocumentId: (projectId: string) => string | null | typeof OVERVIEW_SENTINEL;
	setLastDocumentId: (projectId: string, documentId: string | null) => void;
	clearLastDocumentId: (projectId: string) => void;
}

const lastDocumentStoreKey = "last-document.v1";

export const useLastDocumentStore = create<LastDocumentState>()(
	persist(
		immer((set, get) => ({
			lastDocumentIdByProject: {},
			getLastDocumentId: (projectId) => {
				const value = get().lastDocumentIdByProject[projectId];
				if (value === undefined) return null;
				return value ?? OVERVIEW_SENTINEL;
			},
			setLastDocumentId: (projectId, documentId) =>
				set((state) => {
					state.lastDocumentIdByProject[projectId] = documentId;
				}),
			clearLastDocumentId: (projectId) =>
				set((state) => {
					delete state.lastDocumentIdByProject[projectId];
				}),
		})),
		{
			name: lastDocumentStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: 1,
			partialize: (state) => ({ lastDocumentIdByProject: state.lastDocumentIdByProject }),
			merge: (persisted, current) => {
				const map = (persisted as Partial<LastDocumentState> | undefined)?.lastDocumentIdByProject;
				return {
					...current,
					lastDocumentIdByProject:
						map && typeof map === "object" ? map : current.lastDocumentIdByProject,
				};
			},
		},
	),
);
