import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createProjectActions } from "./actions";
import type { ProjectState } from "./types";

const projectStoreKey = "projects.v1";

export const useProjectStore = create<ProjectState>()(
	persist(
		immer((set) => ({
			activeProjectId: null,
			...createProjectActions(set),
		})),
		{
			name: projectStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: 1,
			partialize: (state) => ({ activeProjectId: state.activeProjectId }),
			merge: (persisted, current) => {
				const activeProjectId = (
					persisted as Partial<Pick<ProjectState, "activeProjectId">> | undefined
				)?.activeProjectId;
				return {
					...current,
					activeProjectId: typeof activeProjectId === "string" ? activeProjectId : null,
				};
			},
		},
	),
);
