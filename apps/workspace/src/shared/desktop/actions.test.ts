import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopUpdateCapability, showDesktopNotification } from "@/shared/desktop/actions";

describe("showDesktopNotification click bridge", () => {
	afterEach(() => {
		delete window.mediagoDesktop;
		vi.restoreAllMocks();
	});

	it("routes a native notification click back to its onClick handler", async () => {
		let clickBridge: ((id: string) => void) | undefined;
		const showNotification = vi.fn().mockResolvedValue(true);
		window.mediagoDesktop = {
			isElectron: true,
			showNotification,
			onNotificationClicked: (callback: (id: string) => void) => {
				clickBridge = callback;
				return () => {};
			},
		} as unknown as typeof window.mediagoDesktop;

		const onClick = vi.fn();
		const shown = await showDesktopNotification({
			title: "Agent 等待权限确认",
			body: "需要确认后继续。",
			group: "agent-permissions",
			onClick,
		});

		expect(shown).toBe(true);
		expect(showNotification).toHaveBeenCalledWith({
			title: "Agent 等待权限确认",
			body: "需要确认后继续。",
			id: "agent-permissions",
		});

		expect(onClick).not.toHaveBeenCalled();
		clickBridge?.("agent-permissions");
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("omits the id when no onClick handler is supplied", async () => {
		const showNotification = vi.fn().mockResolvedValue(true);
		window.mediagoDesktop = {
			isElectron: true,
			showNotification,
			onNotificationClicked: () => () => {},
		} as unknown as typeof window.mediagoDesktop;

		await showDesktopNotification({ title: "生成完成", body: "已生成图片。" });

		expect(showNotification).toHaveBeenCalledWith({
			title: "生成完成",
			body: "已生成图片。",
			id: undefined,
		});
	});
});

describe("getDesktopUpdateCapability", () => {
	afterEach(() => {
		delete window.mediagoDesktop;
		vi.restoreAllMocks();
	});

	it("uses the release list for the browser fallback download link", async () => {
		await expect(getDesktopUpdateCapability()).resolves.toMatchObject({
			supportsAutoUpdate: false,
			releasePageUrl: "https://github.com/mediago-dev/mediago-drama/releases",
		});
	});
});
