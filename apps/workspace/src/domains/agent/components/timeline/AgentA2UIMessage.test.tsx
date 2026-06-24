import { cleanup, render, screen } from "@testing-library/react";
import { basicCatalog } from "@a2ui/react/v0_9";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import { AgentA2UIMessage } from "./AgentA2UIMessage";

describe("AgentA2UIMessage", () => {
	afterEach(() => cleanup());

	it("renders a model-returned A2UI surface", () => {
		render(<AgentA2UIMessage message={a2uiMessage("测试界面")} />);

		expect(screen.getByText("测试界面")).toBeTruthy();
	});
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
