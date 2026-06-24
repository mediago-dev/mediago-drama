import type React from "react";
import { useEffect } from "react";
import { Toaster } from "@/shared/components/ui/sonner";
import { resolveThemeMode, useThemeStore } from "@/shared/stores/theme";

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
	const mode = useThemeStore((state) => state.mode);

	// 同步主题到 DOM
	useEffect(() => {
		const applyTheme = () => {
			const resolvedMode = resolveThemeMode(mode);
			const root = document.documentElement;
			root.setAttribute("data-theme", resolvedMode);
			root.classList.toggle("dark", resolvedMode === "dark");
			root.classList.toggle("light", resolvedMode === "light");
			root.style.colorScheme = resolvedMode;
			void window.mediagoDesktop?.setNativeThemeSource(mode);
		};

		applyTheme();
		if (mode !== "system") return;

		const query = window.matchMedia?.("(prefers-color-scheme: dark)");
		query?.addEventListener("change", applyTheme);
		return () => query?.removeEventListener("change", applyTheme);
	}, [mode]);

	return (
		<>
			{children}
			<Toaster />
		</>
	);
};
