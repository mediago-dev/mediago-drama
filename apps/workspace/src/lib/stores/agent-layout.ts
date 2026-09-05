import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export type AgentLayoutMode = "panel" | "fullscreen";
export type AgentLayoutTab = "document" | "agent";
export type AgentPanelSize = "compact" | "comfortable" | "expanded";

interface AgentLayoutState {
	mode: AgentLayoutMode;
	tab: AgentLayoutTab;
	panelHeight: number | null;
	panelSize: AgentPanelSize;
	setMode: (mode: AgentLayoutMode) => void;
	setTab: (tab: AgentLayoutTab) => void;
	setPanelHeight: (height: number | null) => void;
	setPanelSize: (size: AgentPanelSize) => void;
	enterFullscreen: (tab?: AgentLayoutTab) => void;
	exitFullscreen: () => void;
}

const agentLayoutStoreKey = "agent-layout.v4";

const normalizeAgentLayoutMode = (value: unknown): AgentLayoutMode =>
	value === "fullscreen" ? value : "fullscreen";

const normalizeAgentPanelSize = (value: unknown): AgentPanelSize =>
	value === "compact" || value === "expanded" ? value : "comfortable";

const normalizeAgentPanelHeight = (value: unknown) => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.round(Math.min(820, Math.max(220, value)));
};

export const useAgentLayoutStore = create<AgentLayoutState>()(
	persist(
		immer((set) => ({
			mode: "fullscreen",
			tab: "document",
			panelHeight: null,
			panelSize: "compact",
			setMode: (mode) =>
				set((state) => {
					const nextMode = mode === "fullscreen" ? mode : "fullscreen";
					state.mode = nextMode;
				}),
			setTab: (tab) =>
				set((state) => {
					state.tab = tab;
				}),
			setPanelHeight: (panelHeight) =>
				set((state) => {
					state.panelHeight = normalizeAgentPanelHeight(panelHeight);
				}),
			setPanelSize: (panelSize) =>
				set((state) => {
					state.panelSize = panelSize;
					state.panelHeight = null;
				}),
			enterFullscreen: (tab = "agent") =>
				set((state) => {
					state.mode = "fullscreen";
					state.tab = tab;
				}),
			exitFullscreen: () =>
				set((state) => {
					state.mode = "fullscreen";
					state.tab = "document";
				}),
		})),
		{
			name: agentLayoutStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: 5,
			partialize: (state) => ({
				mode: state.mode,
				panelHeight: state.panelHeight,
				panelSize: state.panelSize,
			}),
			merge: (persisted, current) => {
				const state =
					(persisted as
						| Partial<Pick<AgentLayoutState, "mode" | "panelHeight" | "panelSize">>
						| undefined) ?? {};
				return {
					...current,
					mode: normalizeAgentLayoutMode(state.mode),
					panelHeight: normalizeAgentPanelHeight(state.panelHeight),
					panelSize: normalizeAgentPanelSize(state.panelSize),
					tab: "document",
				};
			},
		},
	),
);
