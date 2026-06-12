import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	decideAgentPermission,
	type AgentRuntimeACPPermissionRequest,
} from "@/domains/agent/api/agent";
import { PermissionRequestCard } from "@/domains/agent/components/PermissionRequestCard";
import { useProjectStore } from "@/domains/projects/stores";

const mocks = vi.hoisted(() => ({
	toastError: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: mocks.toastError,
	}),
}));

vi.mock("@/domains/agent/api/agent", () => ({
	decideAgentPermission: vi.fn(),
}));

const request: AgentRuntimeACPPermissionRequest = {
	requestId: "permission-1",
	toolCall: {
		id: "call-1",
		kind: "edit",
		title: "替换章节内容",
	},
	options: [
		{
			kind: "allow_once",
			name: "Allow",
			optionId: "allow-once",
		},
	],
	createdAt: "2026-06-03T10:00:00.000Z",
};

describe("PermissionRequestCard", () => {
	afterEach(() => {
		cleanup();
		vi.mocked(decideAgentPermission).mockReset();
		mocks.toastError.mockReset();
		useProjectStore.setState({ activeProjectId: null });
	});

	it("submits selected permission option", async () => {
		vi.mocked(decideAgentPermission).mockResolvedValue({
			running: true,
			sessionId: "session-1",
		});
		useProjectStore.setState({ activeProjectId: "project-1" });
		const onDecided = vi.fn();

		render(<PermissionRequestCard request={request} sessionId="session-1" onDecided={onDecided} />);

		fireEvent.click(screen.getByRole("button", { name: "Allow" }));

		await waitFor(() => {
			expect(decideAgentPermission).toHaveBeenCalledWith({
				projectId: "project-1",
				sessionId: "session-1",
				requestId: "permission-1",
				optionId: "allow-once",
			});
			expect(onDecided).toHaveBeenCalledTimes(1);
		});
	});

	it("contains long tool titles inside a scrollable command summary", () => {
		const longCommandRequest: AgentRuntimeACPPermissionRequest = {
			...request,
			toolCall: {
				id: "call-long",
				kind: "execute",
				title:
					"node -e \"const fs=require('fs');const p='未命名文件夹/第一章 抽到天级反派模板！-分镜脚本.md';const sections=new Map();for(const num of ['01','02','03','04','05','06']){const parts=sections.get(num);if(!parts)throw new Error('missing '+num);}\"",
			},
			options: [{ kind: "allow_once", name: "Yes, proceed", optionId: "allow-once" }],
		};

		render(
			<PermissionRequestCard
				request={longCommandRequest}
				sessionId="session-1"
				onDecided={vi.fn()}
			/>,
		);

		const summary = screen.getByLabelText("权限请求执行内容");
		expect(summary.className).toContain("max-h-20");
		expect(summary.className).toContain("overflow-auto");
		expect(summary.className).toContain("break-all");
		expect(screen.getByText("execute")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Yes, proceed" })).toBeTruthy();
	});

	it("surfaces stale permission request failures", async () => {
		vi.mocked(decideAgentPermission).mockRejectedValue({
			code: 404,
			message: "permission request not found",
		});
		useProjectStore.setState({ activeProjectId: "project-1" });
		const onDecided = vi.fn();

		render(<PermissionRequestCard request={request} sessionId="session-1" onDecided={onDecided} />);

		fireEvent.click(screen.getByRole("button", { name: "Allow" }));

		await waitFor(() => {
			expect(screen.getByText("permission request not found").textContent).toBe(
				"permission request not found",
			);
			expect(mocks.toastError).toHaveBeenCalledWith("权限确认失败", {
				description: "permission request not found",
			});
			expect(onDecided).toHaveBeenCalledTimes(1);
		});
	});
});
