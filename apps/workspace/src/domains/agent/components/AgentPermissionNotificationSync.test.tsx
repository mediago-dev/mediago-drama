import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AgentPermissionNotificationSync } from "@/domains/agent/components/AgentPermissionNotificationSync";
import { showAgentPermissionSystemNotification } from "@/domains/agent/lib/permission-notifications";
import { useAgentStore } from "@/domains/agent/stores";

const mocks = vi.hoisted(() => ({
	toastWarning: vi.fn(),
}));

vi.mock("@/domains/agent/lib/permission-notifications", () => ({
	showAgentPermissionSystemNotification: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		warning: mocks.toastWarning,
	}),
}));

describe("AgentPermissionNotificationSync", () => {
	beforeEach(() => {
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.mocked(showAgentPermissionSystemNotification).mockReset();
		mocks.toastWarning.mockReset();
		useAgentStore.setState({ permissionRequests: [], sessionId: null });
	});

	it("sends a system notification when a permission waits outside the agent surface", async () => {
		vi.mocked(showAgentPermissionSystemNotification).mockResolvedValue("shown");
		useAgentStore.setState({
			permissionRequests: [
				{
					requestId: "permission-1",
					options: [{ optionId: "approved", kind: "allow_once", name: "允许一次" }],
					toolCall: { title: "Edit 第一章 分镜脚本.md", kind: "edit" },
				},
			],
		});

		render(
			<MemoryRouter>
				<AgentPermissionNotificationSync isAgentSurfaceActive={false} projectId="project-1" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(showAgentPermissionSystemNotification).toHaveBeenCalledTimes(1);
		});
		expect(vi.mocked(showAgentPermissionSystemNotification).mock.calls[0]?.[0].requestId).toBe(
			"permission-1",
		);
	});

	it("does not notify while the window is active on the agent surface", async () => {
		useAgentStore.setState({
			permissionRequests: [
				{
					requestId: "permission-1",
					options: [{ optionId: "approved", kind: "allow_once", name: "允许一次" }],
					toolCall: { title: "Edit 第一章 分镜脚本.md", kind: "edit" },
				},
			],
		});

		render(
			<MemoryRouter>
				<AgentPermissionNotificationSync isAgentSurfaceActive projectId="project-1" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(showAgentPermissionSystemNotification).not.toHaveBeenCalled();
		});
	});

	it("falls back to an in-app toast when system notifications are unavailable", async () => {
		vi.mocked(showAgentPermissionSystemNotification).mockResolvedValue("fallback");
		useAgentStore.setState({
			permissionRequests: [
				{
					requestId: "permission-1",
					options: [{ optionId: "approved", kind: "allow_once", name: "允许一次" }],
					toolCall: { title: "Edit 第一章 分镜脚本.md", kind: "edit" },
				},
			],
		});

		render(
			<MemoryRouter>
				<AgentPermissionNotificationSync isAgentSurfaceActive={false} projectId="project-1" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(mocks.toastWarning).toHaveBeenCalledWith("Agent 等待权限确认", {
				description: "Edit 第一章 分镜脚本.md",
			});
		});
	});
});
