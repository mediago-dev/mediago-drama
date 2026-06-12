import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

interface UIPreferencesState {
	generationHistoryPanelWidth: number;
	generationInputPanelHeight: number;
	generationInspectorWidth: number;
	workspaceSidebarWidth: number;
	setGenerationHistoryPanelWidth: (width: number) => void;
	setGenerationInputPanelHeight: (height: number) => void;
	setGenerationInspectorWidth: (width: number) => void;
	setWorkspaceSidebarWidth: (width: number) => void;
}

const uiPreferencesStoreKey = "ui-preferences.v1";

const defaultUIPreferences = {
	generationHistoryPanelWidth: 380,
	generationInputPanelHeight: 300,
	generationInspectorWidth: 448,
	workspaceSidebarWidth: 260,
} as const;

const finiteNumberOrDefault = (value: unknown, fallback: number) =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const useUIPreferencesStore = create<UIPreferencesState>()(
	persist(
		immer((set) => ({
			...defaultUIPreferences,
			setGenerationHistoryPanelWidth: (width) =>
				set((state) => {
					state.generationHistoryPanelWidth = width;
				}),
			setGenerationInputPanelHeight: (height) =>
				set((state) => {
					state.generationInputPanelHeight = height;
				}),
			setGenerationInspectorWidth: (width) =>
				set((state) => {
					state.generationInspectorWidth = width;
				}),
			setWorkspaceSidebarWidth: (width) =>
				set((state) => {
					state.workspaceSidebarWidth = width;
				}),
		})),
		{
			name: uiPreferencesStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: 1,
			partialize: (state) => ({
				generationHistoryPanelWidth: state.generationHistoryPanelWidth,
				generationInputPanelHeight: state.generationInputPanelHeight,
				generationInspectorWidth: state.generationInspectorWidth,
				workspaceSidebarWidth: state.workspaceSidebarWidth,
			}),
			merge: (persisted, current) => {
				const state =
					(persisted as
						| Partial<
								Pick<
									UIPreferencesState,
									| "generationHistoryPanelWidth"
									| "generationInputPanelHeight"
									| "generationInspectorWidth"
									| "workspaceSidebarWidth"
								>
						  >
						| undefined) ?? {};
				return {
					...current,
					generationHistoryPanelWidth: finiteNumberOrDefault(
						state.generationHistoryPanelWidth,
						defaultUIPreferences.generationHistoryPanelWidth,
					),
					generationInputPanelHeight: finiteNumberOrDefault(
						state.generationInputPanelHeight,
						defaultUIPreferences.generationInputPanelHeight,
					),
					generationInspectorWidth: finiteNumberOrDefault(
						state.generationInspectorWidth,
						defaultUIPreferences.generationInspectorWidth,
					),
					workspaceSidebarWidth: finiteNumberOrDefault(
						state.workspaceSidebarWidth,
						defaultUIPreferences.workspaceSidebarWidth,
					),
				};
			},
		},
	),
);
