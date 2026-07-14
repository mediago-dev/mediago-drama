import { execFile } from "node:child_process";
import { Notification } from "electron";
import type { DesktopNotificationOptions } from "./ipc-contract.js";

interface NativeNotification {
	on(event: "click" | "close" | "show", listener: () => void): void;
	on(event: "failed", listener: (event: unknown, error: string) => void): void;
	show(): void;
}

interface DesktopNotificationDependencies {
	createNotification(options: { body: string; title: string }): NativeNotification;
	isSupported(): boolean;
	platform: NodeJS.Platform;
	showMacOSFallback(options: DesktopNotificationOptions): Promise<boolean>;
}

interface ShowDesktopSystemNotificationOptions {
	notification: DesktopNotificationOptions;
	onClick?: () => void;
}

const notificationRetentionMs = 60_000;

export const createDesktopNotificationService = (dependencies: DesktopNotificationDependencies) => {
	const liveNotifications = new Set<NativeNotification>();

	return async ({
		notification: options,
		onClick,
	}: ShowDesktopSystemNotificationOptions): Promise<boolean> => {
		if (!dependencies.isSupported()) {
			return showPlatformFallback(dependencies, options);
		}

		return new Promise<boolean>((resolve) => {
			const notification = dependencies.createNotification({
				title: options.title,
				body: options.body ?? "",
			});
			liveNotifications.add(notification);

			let settled = false;
			const retentionTimer = setTimeout(() => {
				liveNotifications.delete(notification);
			}, notificationRetentionMs);
			retentionTimer.unref();

			const release = () => {
				clearTimeout(retentionTimer);
				liveNotifications.delete(notification);
			};
			const settle = (shown: boolean) => {
				if (settled) return;
				settled = true;
				resolve(shown);
			};

			notification.on("click", () => {
				onClick?.();
				release();
			});
			notification.on("close", release);
			notification.on("show", () => {
				console.log(`[mediago-electron] system notification shown: ${options.title}`);
				settle(true);
			});
			notification.on("failed", (_event, error) => {
				console.warn(
					`[mediago-electron] native system notification failed: ${error || "unknown error"}`,
				);
				release();
				void showPlatformFallback(dependencies, options).then(settle);
			});
			notification.show();
		});
	};
};

const showPlatformFallback = (
	dependencies: DesktopNotificationDependencies,
	options: DesktopNotificationOptions,
) =>
	dependencies.platform === "darwin"
		? dependencies.showMacOSFallback(options)
		: Promise.resolve(false);

const showMacOSAppleScriptNotification = (options: DesktopNotificationOptions) =>
	new Promise<boolean>((resolve) => {
		execFile(
			"/usr/bin/osascript",
			[
				"-e",
				"on run argv",
				"-e",
				"display notification (item 2 of argv) with title (item 1 of argv)",
				"-e",
				"end run",
				"--",
				options.title,
				options.body ?? "",
			],
			(error) => {
				if (error) {
					console.warn(`[mediago-electron] macOS notification fallback failed: ${error.message}`);
					resolve(false);
					return;
				}
				console.log(`[mediago-electron] macOS notification fallback shown: ${options.title}`);
				resolve(true);
			},
		);
	});

export const showDesktopSystemNotification = createDesktopNotificationService({
	createNotification: (options) => new Notification(options),
	isSupported: () => Notification.isSupported(),
	platform: process.platform,
	showMacOSFallback: showMacOSAppleScriptNotification,
});
