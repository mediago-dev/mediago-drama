import { afterEach, describe, expect, it, vi } from "vitest";
import { showAgentCompletionSystemNotification } from "@/domains/agent/lib/completion-notifications";

describe("completion notifications", () => {
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

		const result = await showAgentCompletionSystemNotification("completed", undefined, vi.fn());

		expect(result).toBe("shown");
		expect(showNotification).toHaveBeenCalledWith({
			title: "Agent 调用完成",
			body: "智能体已完成本次运行，点击查看结果。",
			id: "agent-completion",
		});
	});

	it("labels failed runs distinctly", async () => {
		const showNotification = vi.fn().mockResolvedValue(true);
		window.mediagoDesktop = {
			isElectron: true,
			showNotification,
		} as unknown as typeof window.mediagoDesktop;

		await showAgentCompletionSystemNotification("failed", undefined, vi.fn());

		expect(showNotification).toHaveBeenCalledWith({
			title: "Agent 运行失败",
			body: "智能体本次运行失败，点击查看详情。",
			id: "agent-completion",
		});
	});

	it("falls back when neither desktop bridge nor web notifications are available", async () => {
		vi.stubGlobal("Notification", undefined);

		const result = await showAgentCompletionSystemNotification("completed", undefined, vi.fn());

		expect(result).toBe("fallback");
	});
});
