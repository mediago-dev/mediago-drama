import { createStore } from "@/lib/utils";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
	mode: ThemeMode;
	setMode: (mode: ThemeMode) => void;
	toggle: () => void;
}

const themeKey = "app_theme_mode";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

const isThemeStorage = (value: unknown): value is ThemeStorage => {
	return (
		typeof value === "object" &&
		value !== null &&
		"getItem" in value &&
		"setItem" in value &&
		typeof value.getItem === "function" &&
		typeof value.setItem === "function"
	);
};

const getThemeStorage = (): ThemeStorage | undefined => {
	try {
		if (typeof window === "undefined") return undefined;
		return isThemeStorage(window.localStorage) ? window.localStorage : undefined;
	} catch {
		return undefined;
	}
};

const readStoredTheme = (): ThemeMode | undefined => {
	const cached = getThemeStorage()?.getItem(themeKey);
	if (cached === "light" || cached === "dark" || cached === "system") return cached;
	return undefined;
};

const writeStoredTheme = (mode: ThemeMode) => {
	getThemeStorage()?.setItem(themeKey, mode);
};

const getInitialTheme = (): ThemeMode => {
	return readStoredTheme() ?? "system";
};

export const useThemeStore = createStore<ThemeState>(
	(set, get) => ({
		mode: getInitialTheme(),
		setMode: (mode) => {
			writeStoredTheme(mode);
			set((state) => {
				state.mode = mode;
			});
		},
		toggle: () => {
			const next = resolveThemeMode(get().mode) === "light" ? "dark" : "light";
			writeStoredTheme(next);
			set((state) => {
				state.mode = next;
			});
		},
	}),
	"themeStore",
);

export const resolveThemeMode = (mode: ThemeMode): "light" | "dark" => {
	if (mode !== "system") return mode;
	if (typeof window === "undefined") return "light";
	return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
