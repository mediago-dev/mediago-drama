import { desktopRuntime } from "@/shared/desktop/runtime";

export const startDesktopWindowDrag = async () => {
	const runtime = desktopRuntime();
	if (runtime === "electron") {
		await window.mediagoDesktop?.startWindowDrag();
	}
};
