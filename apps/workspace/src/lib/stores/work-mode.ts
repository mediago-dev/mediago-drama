import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export type WorkMode = "agent" | "studio";

interface WorkModeState {
	mode: WorkMode;
	setMode: (mode: WorkMode) => void;
}

const workModeStoreKey = "work-mode.v1";

const isWorkMode = (value: unknown): value is WorkMode => value === "agent" || value === "studio";

export const useWorkModeStore = create<WorkModeState>()(
	persist(
		immer((set) => ({
			mode: "agent",
			setMode: (mode) =>
				set((state) => {
					state.mode = mode;
				}),
		})),
		{
			name: workModeStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: 1,
			partialize: (state) => ({ mode: state.mode }),
			merge: (persisted, current) => {
				const mode = (persisted as Partial<Pick<WorkModeState, "mode">> | undefined)?.mode;
				return { ...current, mode: isWorkMode(mode) ? mode : current.mode };
			},
		},
	),
);
