import type React from "react";
import { useEffect } from "react";
import { resolveThemeMode, useThemeStore } from "@/lib/stores/theme";

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
	const { mode } = useThemeStore();

	useEffect(() => {
		const applyTheme = () => {
			const resolvedMode = resolveThemeMode(mode);
			const root = document.documentElement;
			root.setAttribute("data-theme", resolvedMode);
			root.classList.toggle("dark", resolvedMode === "dark");
			root.classList.toggle("light", resolvedMode === "light");
			root.style.colorScheme = resolvedMode;
			document.body.classList.toggle("dark", resolvedMode === "dark");
			document.body.classList.toggle("light", resolvedMode === "light");
		};

		applyTheme();
		if (mode !== "system") return;

		const query = window.matchMedia?.("(prefers-color-scheme: dark)");
		query?.addEventListener("change", applyTheme);
		return () => query?.removeEventListener("change", applyTheme);
	}, [mode]);

	return <>{children}</>;
};
