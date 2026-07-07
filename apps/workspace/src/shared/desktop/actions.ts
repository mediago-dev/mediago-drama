import type {
	DesktopFileFilter,
	DesktopNotificationOptions,
	DesktopUpdateStatus,
	DesktopUpdateCheckResult,
	DesktopUpdateActionResult,
} from "@/shared/desktop/types";
import { desktopUpdateStatusEvent } from "@/shared/desktop/types";
import { desktopRuntime } from "@/shared/desktop/runtime";

export const copyDesktopFileToDirectory = async ({
	directory,
	filename,
	sourcePath,
}: {
	directory: string;
	filename?: string;
	sourcePath: string;
}) => {
	const runtime = desktopRuntime();
	if (runtime === "electron") {
		return window.mediagoDesktop?.copyFileToDirectory({ directory, filename, sourcePath });
	}
	throw new Error("当前运行环境不支持复制文件。");
};

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
			const notificationOptions: DesktopNotificationOptions = {
				body: options.body,
				title: options.title,
			};
			return Boolean(await window.mediagoDesktop?.showNotification(notificationOptions));
		}
	} catch {
		return false;
	}
	return false;
};

export const checkDesktopUpdate = async (): Promise<DesktopUpdateCheckResult> => {
	const runtime = desktopRuntime();
	const unsupportedResult: DesktopUpdateCheckResult = {
		supported: false as const,
		status: {
			currentVersion: "0.0.0",
			phase: "not-available" as const,
		},
		message: "当前运行环境不支持应用更新检查。",
	} satisfies DesktopUpdateCheckResult;
	if (runtime !== "electron") {
		return unsupportedResult;
	}

	const result = await window.mediagoDesktop?.checkForUpdate();
	if (!result) {
		return unsupportedResult;
	}
	return result;
};

export const downloadDesktopUpdate = async () => {
	const runtime = desktopRuntime();
	if (runtime !== "electron") {
		return {
			supported: false as const,
			ok: false as const,
			message: "当前运行环境不支持下载更新。",
		} satisfies DesktopUpdateActionResult;
	}
	const result = await window.mediagoDesktop?.downloadUpdate();
	if (!result) {
		return {
			supported: false as const,
			ok: false as const,
			message: "未检测到桌面端更新接口。",
		} satisfies DesktopUpdateActionResult;
	}
	return result;
};

export const getDesktopAppVersion = async () => {
	const runtime = desktopRuntime();
	if (runtime !== "electron") return null;
	return window.mediagoDesktop?.getAppVersion();
};

export const installDesktopUpdate = async () => {
	const runtime = desktopRuntime();
	if (runtime !== "electron") {
		return {
			supported: false as const,
			ok: false as const,
			message: "当前运行环境不支持安装更新。",
		} satisfies DesktopUpdateActionResult;
	}
	const result = await window.mediagoDesktop?.installUpdate();
	if (!result) {
		return {
			supported: false as const,
			ok: false as const,
			message: "未检测到桌面端更新接口。",
		} satisfies DesktopUpdateActionResult;
	}
	return result;
};

export const subscribeDesktopUpdateStatus = (listener: (payload: DesktopUpdateStatus) => void) => {
	if (typeof window === "undefined") return () => {};

	const handleEvent = (event: Event) => {
		const detail = (event as CustomEvent<DesktopUpdateStatus>).detail;
		if (!detail) return;
		listener(detail);
	};

	window.addEventListener(desktopUpdateStatusEvent, handleEvent as EventListener);
	return () => window.removeEventListener(desktopUpdateStatusEvent, handleEvent as EventListener);
};
