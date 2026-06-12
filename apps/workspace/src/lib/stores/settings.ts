import { create } from "zustand";

export type SettingsTabValue = "appearance" | "api-keys" | string;

interface SettingsNavigationState {
	activeTab: SettingsTabValue;
	setActiveTab: (tab: SettingsTabValue) => void;
}

export const useSettingsNavigationStore = create<SettingsNavigationState>()((set) => ({
	activeTab: "appearance",
	setActiveTab: (tab) => set({ activeTab: tab }),
}));
