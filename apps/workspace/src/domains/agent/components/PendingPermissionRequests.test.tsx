import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	decideAgentPermission,
	type AgentRuntimeACPPermissionRequest,
} from "@/domains/agent/api/agent";
import { useAgentStore } from "@/domains/agent/stores";
import { PendingPermissionRequests } from "@/domains/agent/components/PendingPermissionRequests";
import { useProjectStore } from "@/domains/projects/stores";

vi.mock("@/domains/agent/api/agent", () => ({
	decideAgentPermission: vi.fn(),
}));

const request: AgentRuntimeACPPermissionRequest = {
	requestId: "permission-1",
	toolCall: {
		id: "call-1",
		kind: "edit",
		title: "Edit 第一章 分镜脚本.md",
	},
	options: [
		{
			kind: "allow_once",
			name: "允许一次",
			optionId: "approved",
		},
	],
	createdAt: "2026-06-09T10:08:44.601008Z",
};

describe("PendingPermissionRequests", () => {
	afterEach(() => {
		cleanup();
		vi.mocked(decideAgentPermission).mockReset();
		useAgentStore.setState({ permissionRequests: [], sessionId: null });
		useProjectStore.setState({ activeProjectId: null });
	});

	it("renders pending permissions without a timeline A2UI message", () => {
		useAgentStore.setState({
			permissionRequests: [request],
			sessionId: "session-1",
		});

		render(<PendingPermissionRequests />);

		expect(screen.getByLabelText("待确认工具权限")).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.getByText("请求写入文件")).toBeTruthy();
		expect(screen.getByText("目标文件")).toBeTruthy();
		expect(screen.getByText(/Edit 第一章 分镜脚本\.md/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "允许一次" })).toBeTruthy();
	});

	it("removes a pending permission after the decision is submitted", async () => {
		vi.mocked(decideAgentPermission).mockResolvedValue({
			running: true,
			sessionId: "session-1",
		});
		useProjectStore.setState({ activeProjectId: "project-1" });
		useAgentStore.setState({
			permissionRequests: [request],
			sessionId: "session-1",
		});

		render(<PendingPermissionRequests />);

		fireEvent.click(screen.getByRole("button", { name: "允许一次" }));

		await waitFor(() => {
			expect(decideAgentPermission).toHaveBeenCalledWith({
				projectId: "project-1",
				sessionId: "session-1",
				requestId: "permission-1",
				optionId: "approved",
			});
			expect(screen.queryByLabelText("待确认工具权限")).toBeFalsy();
		});
	});

	it("renders the backend pending set after a later run replaces the previous request", () => {
		useAgentStore.setState({
			permissionRequests: [request],
			sessionId: "session-1",
		});
		const { rerender } = render(<PendingPermissionRequests />);

		expect(screen.getByText(/Edit 第一章 分镜脚本\.md/)).toBeTruthy();

		useAgentStore.getState().syncPermissionRequests([
			{
				requestId: "permission-2",
				toolCall: {
					id: "call-2",
					kind: "edit",
					title: "Edit 第二章 分镜脚本.md",
				},
				options: [
					{
						kind: "allow_once",
						name: "允许一次",
						optionId: "approved",
					},
				],
			},
		]);
		rerender(<PendingPermissionRequests />);

		expect(screen.queryByText(/Edit 第一章 分镜脚本\.md/)).toBeFalsy();
		expect(screen.getByText(/Edit 第二章 分镜脚本\.md/)).toBeTruthy();
	});
});
