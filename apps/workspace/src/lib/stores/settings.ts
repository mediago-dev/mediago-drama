import { create } from "zustand";

export const projectSettingsGeneralTab = "project-general";

export type SettingsTabValue =
	| "appearance"
	| "api-keys"
	| "billing"
	| "shortcuts"
	| typeof projectSettingsGeneralTab
	| string;

interface SettingsNavigationState {
	activeTab: SettingsTabValue;
	setActiveTab: (tab: SettingsTabValue) => void;
}

export const useSettingsNavigationStore = create<SettingsNavigationState>()((set) => ({
	activeTab: "appearance",
	setActiveTab: (tab) => set({ activeTab: tab }),
}));
