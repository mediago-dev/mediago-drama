import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { basicCatalog } from "@a2ui/react/v0_9";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import { createAttachmentDecisionA2UIPayload } from "@/domains/agent/components/chat/AgentAttachments";
import { AgentA2UIMessage } from "./AgentA2UIMessage";

describe("AgentA2UIMessage", () => {
	afterEach(() => cleanup());

	it("renders a model-returned A2UI surface", () => {
		render(<AgentA2UIMessage message={a2uiMessage("是否添加到素材库？")} />);

		expect(screen.getByText("是否添加到素材库？")).toBeTruthy();
	});

	it("dispatches deterministic attachment action context", () => {
		const onAction = vi.fn();
		const message: AgentMessage = {
			id: "message-attachment-ui",
			role: "assistant",
			content: "请选择附件处理方式。",
			kind: "message",
			status: "complete",
			metadata: {
				a2ui: createAttachmentDecisionA2UIPayload("batch-1", [
					new File(["hello"], "notes.txt", { type: "text/plain" }),
				]),
			},
		};

		render(<AgentA2UIMessage message={message} onAction={onAction} />);
		fireEvent.click(screen.getByText("添加到素材库"));

		expect(onAction).toHaveBeenCalledWith(
			message,
			expect.objectContaining({
				name: "attachment.import.decide",
				context: expect.objectContaining({
					kind: "attachment_import_decision",
					batchId: "batch-1",
					decision: "add_to_library",
				}),
			}),
		);
	});

	it("renders attachment headings without raw markdown markers", async () => {
		render(
			<AgentA2UIMessage
				message={{
					id: "message-attachment-ui",
					role: "assistant",
					content: "请选择附件处理方式。",
					kind: "message",
					status: "complete",
					metadata: {
						a2ui: createAttachmentDecisionA2UIPayload("batch-1", [
							new File(["hello"], "notes.txt", { type: "text/plain" }),
						]),
					},
				}}
			/>,
		);

		expect(await screen.findByText("是否添加到素材库？")).toBeTruthy();
		expect(screen.getByText("附件可以作为本次对话上下文，也可以原文件保存到素材库。")).toBeTruthy();
		expect(
			screen.queryByText("附件可以作为本次对话上下文，也可以创建为素材分类文档。"),
		).toBeFalsy();
		expect(screen.queryByText("##### 是否添加到素材库？")).toBeFalsy();
		expect(screen.queryByText("*1. notes.txt（5 B）*")).toBeFalsy();
		expect(screen.getByText("1. notes.txt（5 B）")).toBeTruthy();
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
