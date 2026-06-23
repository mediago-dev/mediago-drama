export type DesktopRuntime = "electron" | "browser";

export const desktopRuntime = (): DesktopRuntime => {
	if (typeof window === "undefined") return "browser";
	if (window.mediagoDesktop?.isElectron) return "electron";
	return "browser";
};

export const isDesktopRuntime = () => desktopRuntime() !== "browser";
export const isElectronRuntime = () => desktopRuntime() === "electron";
