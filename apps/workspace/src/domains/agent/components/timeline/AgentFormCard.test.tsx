import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideAgentSelection } from "@/domains/agent/api/agent";
import { type AgentMessage, useAgentStore } from "@/domains/agent/stores";
import { useAgentPersistenceStore } from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";
import { AgentFormCard } from "./AgentFormCard";

const mocks = vi.hoisted(() => ({
	decideAgentPermission: vi.fn(),
	decideAgentSelection: vi.fn(),
	decideDocumentToolApproval: vi.fn(),
}));

vi.mock("@/domains/agent/api/agent", () => mocks);

describe("AgentFormCard", () => {
	afterEach(() => {
		cleanup();
		vi.mocked(decideAgentSelection).mockReset();
		useAgentStore.getState().resetSession();
		useProjectStore.setState({ activeProjectId: null });
		useAgentPersistenceStore.setState({ resolvedSelections: {} });
	});

	it("submits edited field values and freezes the card with a summary", async () => {
		vi.mocked(decideAgentSelection).mockResolvedValue({
			id: "selection-1",
			title: "确认生成参数",
			options: [],
			allowCustom: false,
			status: "submitted",
			decision: { values: { aspectRatio: "16:9", optimizePrompt: true, n: 2 } },
			createdAt: "2026-06-08T10:00:00.000Z",
		} as never);
		const message = formMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);

		expect(screen.getByText("确认生成参数")).toBeTruthy();
		fireEvent.click(screen.getByText("16:9 横版"));
		fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
		fireEvent.click(screen.getByText("确认生成"));

		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [selectionId, request, projectId] = vi.mocked(decideAgentSelection).mock.calls[0];
		expect(selectionId).toBe("selection-1");
		expect(projectId).toBe("project-1");
		expect(request).toEqual({
			values: { aspectRatio: "16:9", optimizePrompt: true, n: 2 },
		});

		// The card freezes into a read-only summary; the confirm button is gone.
		await waitFor(() => expect(screen.getByText(/已提交：/)).toBeTruthy());
		expect(screen.getByText(/16:9 横版/)).toBeTruthy();
		expect(screen.queryByText("确认生成")).toBeNull();

		const resolved = useAgentPersistenceStore.getState().resolvedSelections["selection-1"];
		expect(resolved?.status).toBe("submitted");
		expect(resolved?.summary).toContain("16:9 横版");
	});

	it("cancels the form and freezes the card", async () => {
		vi.mocked(decideAgentSelection).mockResolvedValue({
			id: "selection-1",
			title: "确认生成参数",
			options: [],
			allowCustom: false,
			status: "cancelled",
			decision: { cancelled: true },
			createdAt: "2026-06-08T10:00:00.000Z",
		} as never);
		const message = formMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);
		fireEvent.click(screen.getByText("取消"));

		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [, request] = vi.mocked(decideAgentSelection).mock.calls[0];
		expect(request).toEqual({ cancelled: true });
		await waitFor(() => expect(screen.getByText(/已取消/)).toBeTruthy());
		expect(useAgentPersistenceStore.getState().resolvedSelections["selection-1"]?.status).toBe(
			"cancelled",
		);
	});

	it("renders an already-decided form frozen and non-interactive after a hydrate", () => {
		// Simulates a transcript hydrate that re-materializes the original
		// interactive form after the user already decided it.
		useAgentPersistenceStore.setState({
			resolvedSelections: {
				"selection-1": { status: "submitted", summary: "已提交：比例 16:9 横版" },
			},
		});
		const message = formMessage();
		seedConversation(message);

		render(<AgentFormCard message={message} />);

		expect(screen.getByText("确认生成参数")).toBeTruthy();
		expect(screen.getByText("已提交：比例 16:9 横版")).toBeTruthy();
		// No interactive controls: the form cannot be confirmed a second time.
		expect(screen.queryByText("确认生成")).toBeNull();
		expect(screen.queryByText("取消")).toBeNull();
		expect(screen.queryByRole("spinbutton")).toBeNull();
	});
});

const seedConversation = (message: AgentMessage) => {
	useAgentStore.setState({
		sessionId: "session-1",
		rootRunId: "run-1",
		conversations: {
			"run-1": {
				runId: "run-1",
				name: "主智能体",
				status: "running",
				messages: [message],
				streamingMessageId: null,
				children: [],
				createdAt: "2026-06-08T10:00:00.000Z",
				updatedAt: "2026-06-08T10:00:00.000Z",
			},
		},
	});
};

const formMessage = (): AgentMessage => ({
	id: "form-ui",
	role: "assistant",
	content: "需要你确认参数",
	kind: "message",
	status: "complete",
	createdAt: "2026-06-08T10:00:00.000Z",
	metadata: {
		form: {
			selectionId: "selection-1",
			projectId: "project-1",
			title: "确认生成参数",
			submitLabel: "确认生成",
			fields: [
				{
					id: "aspectRatio",
					label: "比例",
					type: "select",
					default: "3:4",
					options: [
						{ value: "3:4", label: "3:4 竖版" },
						{ value: "16:9", label: "16:9 横版" },
					],
				},
				{ id: "optimizePrompt", label: "优化提示词", type: "toggle", default: true },
				{ id: "n", label: "张数", type: "number", default: 4, min: 1, max: 4 },
			],
		},
	},
});
