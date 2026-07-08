import type { Key, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AgentMessage, useAgentStore } from "@/domains/agent/stores";
import { AgentTimeline } from "./AgentTimeline";

vi.mock("react-virtuoso", () => ({
	Virtuoso: ({ className, data = [], computeItemKey, itemContent }: MockVirtuosoProps) => (
		<div className={className} data-testid="virtuoso">
			{[{ index: -1, item: undefined }, ...data.map((item, index) => ({ index, item }))].map(
				({ index, item }) => (
					<div key={computeItemKey?.(index, item, undefined) ?? index}>
						{itemContent(index, item, undefined)}
					</div>
				),
			)}
		</div>
	),
}));

interface MockVirtuosoProps {
	className?: string;
	data?: unknown[];
	computeItemKey?: (index: number, item: unknown, context: unknown) => Key;
	itemContent: (index: number, item: unknown, context: unknown) => ReactNode;
}

describe("AgentTimeline", () => {
	afterEach(() => {
		cleanup();
		useAgentStore.setState({ isRunning: false, permissionRequests: [], rootRunId: null });
	});

	it("ignores transient empty rows emitted by the virtual list", () => {
		expect(() =>
			render(
				<AgentTimeline
					isRunning={false}
					messages={[
						userMessage({
							content: "恢复历史会话",
						}),
					]}
				/>,
			),
		).not.toThrow();

		expect(screen.getByText("恢复历史会话")).toBeTruthy();
	});

	it("renders uploaded attachments as cards above the user bubble", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						content: "这个文档讲了什么故事",
						metadata: {
							displayAttachments: [
								{
									id: "attachment-1",
									kind: "file",
									mimeType: "text/plain",
									name: "完美世界.txt",
									size: 14_469_529,
								},
							],
						},
					}),
				]}
			/>,
		);

		expect(screen.getByText("完美世界.txt")).toBeTruthy();
		expect(screen.getByText("13.8 MB")).toBeTruthy();
		expect(screen.getByText("这个文档讲了什么故事")).toBeTruthy();
		expect(screen.queryByText(/附件上下文/)).toBeFalsy();
		expect(screen.queryByText(/内容：/)).toBeFalsy();
	});

	it("renders mention and skill chips from display segments in the user bubble", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						content: "剧本写作 理解一下这个文本，帮我进行剧本写作",
						metadata: {
							displaySegments: [
								{ type: "skill", name: "screenplay-writer", title: "剧本写作" },
								{ type: "text", text: " 理解一下这个文本，帮我进行" },
								{ type: "mention", title: "角色档案", category: "character", kind: "document" },
							],
						},
					}),
				]}
			/>,
		);

		expect(screen.getByText("剧本写作")).toBeTruthy();
		expect(screen.getByText("角色档案")).toBeTruthy();
		expect(screen.getByText(/理解一下这个文本/)).toBeTruthy();
		// The plain-text fallback must not render alongside the segments.
		expect(screen.queryByText("剧本写作 理解一下这个文本，帮我进行剧本写作")).toBeFalsy();
		expect(screen.queryByText(/请先调用 MCP/)).toBeFalsy();
	});

	it("shows attachment cards without bubble text for attachment-only sends", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						content: "",
						metadata: {
							displayAttachments: [
								{
									id: "attachment-1",
									kind: "file",
									mimeType: "text/plain",
									name: "开局欺诈师，扮演神明的我成真了.txt",
									size: 1024,
								},
							],
						},
					}),
				]}
			/>,
		);

		expect(screen.getByText("开局欺诈师，扮演神明的我成真了.txt")).toBeTruthy();
		const bubble = document.querySelector(".agent-user-bubble");
		expect(bubble?.querySelector("p")).toBeNull();
	});

	it("deduplicates repeated attachment display metadata", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						content: "这个故事讲了什么",
						metadata: {
							displayAttachments: [
								{
									id: "attachment-1",
									kind: "file",
									mimeType: "text/plain",
									name: "高武：这BOSS不削能玩？.txt",
									size: 6_081_741,
								},
								{
									id: "attachment-2",
									kind: "file",
									mimeType: "text/plain",
									name: "高武：这BOSS不削能玩？.txt",
									size: 6_081_741,
								},
							],
						},
					}),
				]}
			/>,
		);

		expect(screen.getAllByText("高武：这BOSS不削能玩？.txt")).toHaveLength(1);
	});

	it("hides legacy inline attachment context from the user bubble", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						content: [
							"这个文档讲了什么故事",
							"",
							"附件上下文：",
							"1. 文件：完美世界.txt",
							"MIME：text/plain",
							"大小：13.8 MB",
							"说明：内容过长，已截取前半部分。",
							"内容：",
							"```",
							"���旧附件正文不应该显示���",
							"```",
						].join("\n"),
					}),
				]}
			/>,
		);

		expect(screen.getByText("完美世界.txt")).toBeTruthy();
		expect(screen.getByText("13.8 MB")).toBeTruthy();
		expect(screen.getByText("这个文档讲了什么故事")).toBeTruthy();
		expect(screen.queryByText(/附件上下文/)).toBeFalsy();
		expect(screen.queryByText(/旧附件正文/)).toBeFalsy();
	});

	it("deduplicates one file referenced as both inline attachment and saved asset", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						content: [
							"这个故事讲了什么",
							"",
							"附件上下文：",
							"1. 文件：开局欺诈师，扮演神明的我成真了.txt",
							"MIME：text/plain",
							"大小：9.0 MB",
							"内容：",
							"```",
							"正文片段",
							"```",
							"",
							"已保存到资料的原始文件：",
							"1. 开局欺诈师，扮演神明的我成真了.txt",
							"类型：text",
							"MIME：text/plain",
							"大小：9437184 bytes",
							"URL：http://localhost/api/v1/projects/project-1/assets/asset-1/content",
						].join("\n"),
					}),
				]}
			/>,
		);

		expect(screen.getAllByText("开局欺诈师，扮演神明的我成真了.txt")).toHaveLength(1);
		expect(screen.getAllByText("9.0 MB")).toHaveLength(1);
		expect(screen.getByText("这个故事讲了什么")).toBeTruthy();
	});

	it("deduplicates legacy attachments when rounded display size differs from exact bytes", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						content: [
							"这个故事讲了什么",
							"",
							"附件上下文：",
							"1. 文件：颠覆全球：开局扮演反派大佬.txt",
							"MIME：text/plain",
							"大小：3.6 MB",
							"内容：",
							"```",
							"正文片段",
							"```",
							"",
							"已保存到素材库的原始文件：",
							"1. 颠覆全球：开局扮演反派大佬.txt",
							"类型：text",
							"MIME：text/plain",
							"大小：3734528 bytes",
							"URL：http://localhost/api/v1/projects/project-1/assets/asset-1/content",
						].join("\n"),
					}),
				]}
			/>,
		);

		expect(screen.getAllByText("颠覆全球：开局扮演反派大佬.txt")).toHaveLength(1);
		expect(screen.getAllByText("3.6 MB")).toHaveLength(1);
	});

	it("renders structured assistant markdown as a final reply card", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					assistantMessage({
						content: [
							"## 第二章 · 分镜文档已生成",
							"我已整理完整镜头序列。",
							"",
							"- 共拆解 18 个镜头",
							"- 已写入 docs/第二章·分镜.md",
						].join("\n"),
					}),
				]}
			/>,
		);

		expect(screen.getByText("文档智能体")).toBeTruthy();
		expect(screen.getByText("最终回复")).toBeTruthy();
		expect(screen.getByText("第二章 · 分镜文档已生成")).toBeTruthy();
		expect(screen.getByText("共拆解 18 个镜头")).toBeTruthy();
	});

	it("keeps top-level think content as a standalone thought block", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					assistantMessage({
						content: "<think>需要先读取项目结构，再输出结论。</think>",
					}),
				]}
			/>,
		);

		expect(screen.getByText("思考")).toBeTruthy();
		expect(screen.getByText("1 段")).toBeTruthy();
		expect(screen.queryByText("最终回复")).toBeFalsy();
	});

	it("renders plan entries with progress state", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					assistantMessage({
						id: "plan-1",
						kind: "plan",
						content: "",
						metadata: {
							planEntries: [
								{ content: "读取第二章剧本与角色设定", status: "completed" },
								{ content: "匹配分镜模板与镜头规范", status: "completed" },
								{ content: "逐场拆解镜头并撰写画面说明", status: "in_progress" },
							],
						},
					}),
				]}
			/>,
		);

		expect(screen.getByText("2 / 3 完成")).toBeTruthy();
		expect(screen.getByText("读取第二章剧本与角色设定")).toBeTruthy();
		expect(screen.getByText("逐场拆解镜头并撰写画面说明")).toBeTruthy();
	});

	it("renders tool group rows with localized status badges", () => {
		render(
			<AgentTimeline
				isRunning
				messages={[
					assistantMessage({
						id: "tool-read",
						kind: "tool",
						title: "读取章节脚本",
						metadata: {
							acpKind: "read",
							durationMs: 1800,
							filePath: "drama/第二章/script.md",
							status: "completed",
							toolCallId: "call-read",
						},
					}),
					assistantMessage({
						id: "tool-edit",
						kind: "tool",
						title: "生成分镜文档",
						metadata: {
							acpKind: "edit",
							filePath: "docs/第二章·分镜.md",
							status: "in_progress",
							toolCallId: "call-edit",
						},
					}),
				]}
			/>,
		);

		expect(screen.getByText(/已探索 1 个文件/)).toBeTruthy();
		expect(screen.getByText("读取章节脚本")).toBeTruthy();
		expect(screen.getByText("生成分镜文档")).toBeTruthy();
		expect(screen.getByText("完成")).toBeTruthy();
		expect(screen.getByText("运行中")).toBeTruthy();
	});

	it("hides stale permission A2UI cards after the request leaves pending state", () => {
		useAgentStore.setState({ isRunning: false, permissionRequests: [] });

		render(<AgentTimeline isRunning={false} messages={[permissionA2UIMessage()]} />);

		expect(screen.queryByText(/需要确认工具权限/)).toBeFalsy();
		expect(screen.queryByText("允许一次")).toBeFalsy();
	});

	it("hides permission A2UI while the run is waiting and pending state is missing", () => {
		useAgentStore.setState({ isRunning: true, permissionRequests: [], rootRunId: "run-2" });

		render(<AgentTimeline isRunning messages={[permissionA2UIMessage({ runId: "run-2" })]} />);

		expect(screen.queryByText(/需要确认工具权限/)).toBeFalsy();
		expect(screen.queryByText("允许一次")).toBeFalsy();
	});

	it("does not revive an old permission A2UI from a previous run", () => {
		useAgentStore.setState({ isRunning: true, permissionRequests: [], rootRunId: "run-2" });

		render(<AgentTimeline isRunning messages={[permissionA2UIMessage({ runId: "run-1" })]} />);

		expect(screen.queryByText(/需要确认工具权限/)).toBeFalsy();
		expect(screen.queryByText("允许一次")).toBeFalsy();
	});

	it("hides permission A2UI cards while the independent pending card owns the action", () => {
		useAgentStore.setState({
			isRunning: true,
			permissionRequests: [
				{
					requestId: "permission-1",
					options: [{ optionId: "allow-once", kind: "allow_once", name: "Allow once" }],
					toolCall: { title: "Read 素材.txt", kind: "read" },
				},
			],
		});

		render(<AgentTimeline isRunning messages={[permissionA2UIMessage()]} />);

		expect(screen.queryByText(/需要确认工具权限/)).toBeFalsy();
		expect(screen.queryByText("允许一次")).toBeFalsy();
	});
});

const userMessage = (patch: Partial<AgentMessage>): AgentMessage => ({
	id: patch.id ?? "user-1",
	role: "user",
	content: patch.content ?? "content",
	kind: patch.kind ?? "message",
	status: patch.status ?? "complete",
	createdAt: patch.createdAt ?? "2026-06-08T08:00:00.000Z",
	metadata: patch.metadata,
});

const assistantMessage = (patch: Partial<AgentMessage>): AgentMessage => ({
	id: patch.id ?? "assistant-1",
	role: "assistant",
	content: patch.content ?? "content",
	kind: patch.kind ?? "message",
	status: patch.status ?? "complete",
	createdAt: patch.createdAt ?? "2026-06-08T08:00:01.000Z",
	metadata: patch.metadata,
	title: patch.title,
});

const permissionA2UIMessage = (metadata: Record<string, unknown> = {}): AgentMessage => ({
	id: "permission-ui",
	role: "assistant",
	content: "需要确认工具权限",
	kind: "message",
	status: "complete",
	createdAt: "2026-06-08T08:00:01.000Z",
	metadata: {
		...metadata,
		a2ui: {
			version: "v0.9",
			surfaceId: "agent-permission-permission-1",
			messages: [
				{
					version: "v0.9",
					createSurface: {
						surfaceId: "agent-permission-permission-1",
						catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
					},
				},
				{
					version: "v0.9",
					updateComponents: {
						surfaceId: "agent-permission-permission-1",
						components: [
							{
								id: "root",
								component: "Column",
								children: ["title", "summary", "actions"],
								align: "stretch",
							},
							{
								id: "title",
								component: "Text",
								text: "需要确认工具权限",
								variant: "h5",
							},
							{
								id: "summary",
								component: "Text",
								text: "智能体请求执行：Read 素材.txt",
								variant: "body",
							},
							{
								id: "actions",
								component: "Row",
								children: ["permission-option-allow-once"],
								justify: "end",
								align: "center",
							},
							{
								id: "permission-option-label-allow-once",
								component: "Text",
								text: "允许一次",
								variant: "body",
							},
							{
								id: "permission-option-allow-once",
								component: "Button",
								child: "permission-option-label-allow-once",
								variant: "primary",
								action: {
									event: {
										name: "agent.permission.decide",
										context: {
											kind: "agent_permission",
											optionId: "allow-once",
											requestId: "permission-1",
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
