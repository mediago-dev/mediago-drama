import type { DesktopFileFilter } from "@/shared/desktop/types";
import { desktopRuntime } from "@/shared/desktop/runtime";

export const pickDesktopDirectory = async (title: string) => {
	const runtime = desktopRuntime();
	if (runtime === "electron") return window.mediagoDesktop?.pickDirectory({ title }) ?? null;
	return null;
};

export const pickDesktopFile = async ({
	filters,
	title,
}: {
	filters?: DesktopFileFilter[];
	title?: string;
}) => {
	const runtime = desktopRuntime();
	if (runtime === "electron") {
		return window.mediagoDesktop?.pickFile({ filters, title }) ?? null;
	}
	return null;
};

export const openExternalUrl = async (url: string) => {
	const runtime = desktopRuntime();
	try {
		if (runtime === "electron") {
			await window.mediagoDesktop?.openExternal(url);
			return;
		}
	} catch {
		// Fall back to the browser path below.
	}
	window.open(url, "_blank", "noopener,noreferrer");
};

export const openNativePath = async (path: string) => {
	const runtime = desktopRuntime();
	if (runtime === "electron") return window.mediagoDesktop?.openPath(path);
	throw new Error("当前运行环境不支持打开本地文件夹。");
};

export const revealNativePath = async (path: string) => {
	const runtime = desktopRuntime();
	if (runtime === "electron") return window.mediagoDesktop?.revealPath(path);
	throw new Error("当前运行环境不支持打开本地文件夹。");
};

export const showDesktopNotification = async (options: {
	autoCancel?: boolean;
	body: string;
	group?: string;
	title: string;
}) => {
	const runtime = desktopRuntime();
	try {
		if (runtime === "electron") {
			return Boolean(
				await window.mediagoDesktop?.showNotification({
					body: options.body,
					title: options.title,
				}),
			);
		}
	} catch {
		return false;
	}
	return false;
};
