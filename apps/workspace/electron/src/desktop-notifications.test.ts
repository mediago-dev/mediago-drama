import { describe, expect, it, vi } from "vitest";
import type { DesktopNotificationOptions } from "./ipc-contract.js";
import { createDesktopNotificationService } from "./desktop-notifications.js";

describe("desktop notification service", () => {
	it("resolves true after a native notification is shown", async () => {
		const native = new FakeNativeNotification();
		const showMacOSFallback = vi.fn<(options: DesktopNotificationOptions) => Promise<boolean>>();
		const showNotification = createDesktopNotificationService({
			createNotification: () => native,
			isSupported: () => true,
			platform: "darwin",
			showMacOSFallback,
		});

		const result = showNotification({
			notification: { title: "生成完成", body: "图片已生成。" },
		});
		native.emit("show");

		await expect(result).resolves.toBe(true);
		expect(showMacOSFallback).not.toHaveBeenCalled();
	});

	it("falls back on macOS when the native notification fails", async () => {
		const native = new FakeNativeNotification();
		const showMacOSFallback = vi.fn().mockResolvedValue(true);
		const showNotification = createDesktopNotificationService({
			createNotification: () => native,
			isSupported: () => true,
			platform: "darwin",
			showMacOSFallback,
		});
		const notification = { title: "生成完成", body: "生成任务已完成。" };

		const result = showNotification({ notification });
		native.emit("failed", "未能完成操作。（UNErrorDomain错误1。）");

		await expect(result).resolves.toBe(true);
		expect(showMacOSFallback).toHaveBeenCalledWith(notification);
	});

	it("returns false without a fallback on non-macOS platforms", async () => {
		const showMacOSFallback = vi.fn().mockResolvedValue(true);
		const showNotification = createDesktopNotificationService({
			createNotification: () => new FakeNativeNotification(),
			isSupported: () => false,
			platform: "win32",
			showMacOSFallback,
		});

		await expect(showNotification({ notification: { title: "生成完成" } })).resolves.toBe(false);
		expect(showMacOSFallback).not.toHaveBeenCalled();
	});
});

type NativeEvent = "click" | "close" | "failed" | "show";

class FakeNativeNotification {
	private readonly listeners = new Map<NativeEvent, (...args: never[]) => void>();

	on(event: NativeEvent, listener: (...args: never[]) => void) {
		this.listeners.set(event, listener);
	}

	show() {}

	emit(event: NativeEvent, ...args: string[]) {
		const listener = this.listeners.get(event);
		listener?.(...(args as never[]));
	}
}
