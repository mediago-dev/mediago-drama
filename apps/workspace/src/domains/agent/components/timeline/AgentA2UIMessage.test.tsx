import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { basicCatalog } from "@a2ui/react/v0_9";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import { AgentA2UIMessage } from "./AgentA2UIMessage";

describe("AgentA2UIMessage", () => {
	afterEach(() => cleanup());

	it("renders a model-returned A2UI surface", () => {
		render(<AgentA2UIMessage message={a2uiMessage("测试界面")} />);

		expect(screen.getByText("测试界面")).toBeTruthy();
	});

	it("renders a selection card with option image and posts the click action", () => {
		const onAction = vi.fn();
		render(<AgentA2UIMessage message={selectionCardMessage()} onAction={onAction} />);

		expect(screen.getByText(/选择一种插画风格/)).toBeTruthy();
		const image = document.querySelector("img");
		expect(image?.getAttribute("src")).toBe("https://x/sweet.png");

		fireEvent.click(screen.getByText(/甜美粉彩/));
		expect(onAction).toHaveBeenCalledTimes(1);
		const [, action] = onAction.mock.calls[0] ?? [];
		expect(action).toMatchObject({
			name: "agent_selection.decide",
			context: {
				kind: "agent_selection",
				optionId: "sweet",
				projectId: "project-1",
				selectionId: "selection-1",
			},
		});
	});
});

// Mirrors the server-side BuildSelectionA2UI output shape.
const selectionCardMessage = (): AgentMessage => ({
	id: "selection-ui",
	role: "assistant",
	content: "需要你选择",
	kind: "message",
	status: "complete",
	metadata: {
		a2ui: {
			version: "v0.9",
			surfaceId: "agent-selection-selection-1",
			messages: [
				{
					version: "v0.9",
					createSurface: {
						surfaceId: "agent-selection-selection-1",
						catalogId: basicCatalog.id,
					},
				},
				{
					version: "v0.9",
					updateComponents: {
						surfaceId: "agent-selection-selection-1",
						components: [
							{ id: "root", component: "Column", children: ["title", "opt-0"], align: "stretch" },
							{ id: "title", component: "Text", text: "选择一种插画风格", variant: "h5" },
							{ id: "opt-0", component: "Column", children: ["opt-img-0", "opt-btn-0"] },
							{
								id: "opt-img-0",
								component: "Image",
								url: "https://x/sweet.png",
								description: "甜美粉彩",
								variant: "smallFeature",
							},
							{ id: "opt-label-0", component: "Text", text: "甜美粉彩" },
							{
								id: "opt-btn-0",
								component: "Button",
								child: "opt-label-0",
								variant: "primary",
								action: {
									event: {
										name: "agent_selection.decide",
										context: {
											kind: "agent_selection",
											projectId: "project-1",
											selectionId: "selection-1",
											optionId: "sweet",
										},
									},
								},
							},
						],
					},
				},
			],
		},
	},
});

const a2uiMessage = (text: string): AgentMessage => ({
	id: "message-ui",
	role: "assistant",
	content: "Agent 已生成交互界面。",
	kind: "message",
	status: "complete",
	metadata: {
		a2ui: {
			version: "v0.9",
			surfaceId: "attachment",
			messages: [
				{
					version: "v0.9",
					createSurface: {
						surfaceId: "attachment",
						catalogId: basicCatalog.id,
					},
				},
				{
					version: "v0.9",
					updateComponents: {
						surfaceId: "attachment",
						components: [
							{
								id: "root",
								component: "Column",
								children: ["title"],
							},
							{
								id: "title",
								component: "Text",
								text,
							},
						],
					},
				},
			],
		},
	},
});
