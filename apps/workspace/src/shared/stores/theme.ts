import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
	mode: ThemeMode;
	setMode: (m: ThemeMode) => void;
	toggle: () => void;
}

const themeStoreKey = "app.theme.v1";

const isThemeMode = (value: unknown): value is ThemeMode =>
	value === "light" || value === "dark" || value === "system";

export const useThemeStore = create<ThemeState>()(
	persist(
		immer((set, get) => ({
			mode: "system",
			setMode: (m) =>
				set((state) => {
					state.mode = m;
				}),
			toggle: () => {
				const next = resolveThemeMode(get().mode) === "light" ? "dark" : "light";
				set((state) => {
					state.mode = next;
				});
			},
		})),
		{
			name: themeStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: 1,
			partialize: (state) => ({ mode: state.mode }),
			merge: (persisted, current) => {
				const mode = (persisted as Partial<Pick<ThemeState, "mode">> | undefined)?.mode;
				return { ...current, mode: isThemeMode(mode) ? mode : current.mode };
			},
		},
	),
);

export const resolveThemeMode = (mode: ThemeMode): "light" | "dark" => {
	if (mode !== "system") return mode;
	return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
