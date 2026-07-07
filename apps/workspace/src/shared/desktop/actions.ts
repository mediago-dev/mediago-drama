import type {
	DesktopFileFilter,
	DesktopUpdateAck,
	DesktopUpdateCapability,
	DesktopUpdateStatus,
} from "@/shared/desktop/types";
import { desktopRuntime } from "@/shared/desktop/runtime";

const browserFallbackAck: DesktopUpdateAck = {
	ok: false,
	message: "当前运行环境不支持应用内更新。",
};

const missingBridgeAck: DesktopUpdateAck = {
	ok: false,
	message: "未检测到桌面端更新接口。",
};

const browserFallbackCapability: DesktopUpdateCapability = {
	supportsAutoUpdate: false,
	releasePageUrl: "https://github.com/mediago-dev/mediago-drama/releases/latest",
	reason: "当前运行环境不支持应用内更新。",
};

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

const notificationClickHandlers = new Map<string, () => void>();
let notificationClickBridgeReady = false;

// Route native-notification clicks (emitted by the Electron main process) back to
// the handler that was registered when the notification was shown.
const ensureNotificationClickBridge = () => {
	if (notificationClickBridgeReady) return;
	const desktop = window.mediagoDesktop;
	if (!desktop?.onNotificationClicked) return;
	notificationClickBridgeReady = true;
	desktop.onNotificationClicked((id) => {
		const handler = notificationClickHandlers.get(id);
		if (!handler) return;
		notificationClickHandlers.delete(id);
		handler();
	});
};

export const showDesktopNotification = async (options: {
	autoCancel?: boolean;
	body: string;
	group?: string;
	onClick?: () => void;
	title: string;
}) => {
	const runtime = desktopRuntime();
	try {
		if (runtime === "electron") {
			let id: string | undefined;
			if (options.onClick) {
				// Key by group so at most one handler lives per notification channel and
				// the map cannot grow unbounded.
				id = options.group ?? `notification-${notificationClickHandlers.size + 1}`;
				ensureNotificationClickBridge();
				notificationClickHandlers.set(id, options.onClick);
			}
			return Boolean(
				await window.mediagoDesktop?.showNotification({
					body: options.body,
					title: options.title,
					id,
				}),
			);
		}
	} catch {
		return false;
	}
	return false;
};

export const getDesktopAppVersion = async () => {
	const runtime = desktopRuntime();
	if (runtime !== "electron") return null;
	return window.mediagoDesktop?.getAppVersion();
};

export const getDesktopUpdateCapability = async (): Promise<DesktopUpdateCapability> => {
	const runtime = desktopRuntime();
	if (runtime !== "electron") return browserFallbackCapability;
	return (await window.mediagoDesktop?.getUpdateCapability()) ?? browserFallbackCapability;
};

export const checkDesktopUpdate = async (): Promise<DesktopUpdateAck> => {
	const runtime = desktopRuntime();
	if (runtime !== "electron") return browserFallbackAck;
	return (await window.mediagoDesktop?.checkForUpdate()) ?? missingBridgeAck;
};

export const downloadDesktopUpdate = async (): Promise<DesktopUpdateAck> => {
	const runtime = desktopRuntime();
	if (runtime !== "electron") return browserFallbackAck;
	return (await window.mediagoDesktop?.downloadUpdate()) ?? missingBridgeAck;
};

export const installDesktopUpdate = async (): Promise<DesktopUpdateAck> => {
	const runtime = desktopRuntime();
	if (runtime !== "electron") return browserFallbackAck;
	return (await window.mediagoDesktop?.installUpdate()) ?? missingBridgeAck;
};

export const subscribeDesktopUpdateStatus = (
	listener: (status: DesktopUpdateStatus) => void,
): (() => void) => {
	const runtime = desktopRuntime();
	if (runtime !== "electron") return () => {};
	return window.mediagoDesktop?.onUpdateStatus(listener) ?? (() => {});
};
