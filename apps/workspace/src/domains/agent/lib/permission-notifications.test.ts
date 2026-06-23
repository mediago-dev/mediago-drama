import { afterEach, describe, expect, it, vi } from "vitest";
import { showAgentPermissionSystemNotification } from "@/domains/agent/lib/permission-notifications";
import type { AgentRuntimeACPPermissionRequest } from "@/domains/agent/api/agent";

const request: AgentRuntimeACPPermissionRequest = {
	requestId: "permission-1",
	options: [{ optionId: "approved", kind: "allow_once", name: "允许一次" }],
	toolCall: { title: "Edit 第一章 分镜脚本.md", kind: "edit" },
};

describe("permission notifications", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		delete window.mediagoDesktop;
	});

	it("uses the Electron desktop notification bridge in desktop runtime", async () => {
		const showNotification = vi.fn().mockResolvedValue(true);
		window.mediagoDesktop = {
			isElectron: true,
			showNotification,
		} as unknown as typeof window.mediagoDesktop;

		const result = await showAgentPermissionSystemNotification(request, vi.fn());

		expect(result).toBe("shown");
		expect(showNotification).toHaveBeenCalledWith({
			title: "Agent 等待权限确认",
			body: "智能体请求执行 Edit 第一章 分镜脚本.md，需要确认后继续。",
		});
	});

	it("creates a system notification when permission is granted", async () => {
		const created: MockSystemNotification[] = [];
		class MockSystemNotification {
			static permission: NotificationPermission = "granted";
			static requestPermission = vi.fn();
			title: string;
			options?: NotificationOptions;
			onclick: (() => void) | null = null;

			constructor(title: string, options?: NotificationOptions) {
				this.title = title;
				this.options = options;
				created.push(this);
			}

			close = vi.fn();
		}
		vi.stubGlobal("Notification", MockSystemNotification);
		const onClick = vi.fn();

		const result = await showAgentPermissionSystemNotification(request, onClick);

		expect(result).toBe("shown");
		expect(created).toHaveLength(1);
		expect(created[0]?.title).toBe("Agent 等待权限确认");
		expect(created[0]?.options?.tag).toBe("agent-permission-permission-1");
		created[0]?.onclick?.();
		expect(onClick).toHaveBeenCalledTimes(1);
		expect(created[0]?.close).toHaveBeenCalledTimes(1);
	});

	it("falls back when notification permission is denied", async () => {
		class MockSystemNotification {
			static permission: NotificationPermission = "denied";
			static requestPermission = vi.fn();
		}
		vi.stubGlobal("Notification", MockSystemNotification);

		const result = await showAgentPermissionSystemNotification(request, vi.fn());

		expect(result).toBe("fallback");
	});
});
