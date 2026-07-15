import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentMessage, useAgentStore } from "@/domains/agent/stores";
import { AgentTimeline } from "./AgentTimeline";

describe("AgentTimeline", () => {
	afterEach(() => {
		cleanup();
		useAgentStore.setState({
			conversations: {},
			isRunning: false,
			permissionRequests: [],
			rootRunId: null,
		});
	});

	it("uses real content height and bottom-aligns short conversations", () => {
		useAgentStore.setState({ sessionId: "session-1" });

		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						content: "第一轮消息",
					}),
					userMessage({
						id: "user-message-2",
						content: "贴近输入框显示",
					}),
				]}
			/>,
		);

		expect(screen.getByTestId("agent-timeline")).toHaveAttribute("data-agent-session", "session-1");
		expect(screen.getByTestId("agent-timeline")).toHaveClass("overflow-y-auto");
		expect(screen.getByTestId("agent-timeline-list")).toHaveClass("min-h-full", "justify-end");
	});

	it("renders conversation rows without virtual placeholders", () => {
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
						turnId: "turn-final-markdown",
						itemId: "item-final-markdown",
						phase: "final_answer",
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

		const heading = screen.getByText("第二章 · 分镜文档已生成");
		expect(heading.closest(".agent-final-answer")).toBeInTheDocument();
		expect(screen.getByText("共拆解 18 个镜头")).toBeTruthy();
		expect(screen.queryByText("文档智能体")).not.toBeInTheDocument();
		expect(screen.queryByText("最终回复")).not.toBeInTheDocument();
	});

	it("keeps top-level think content inside the completed process disclosure", () => {
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

		const disclosure = screen.getByRole("button", { name: /已处理/ });
		expect(disclosure).toHaveAttribute("aria-expanded", "false");
		expect(disclosureRegion(disclosure)).toHaveAttribute("aria-hidden", "true");
		expect(disclosureRegion(disclosure)).toHaveTextContent("需要先读取项目结构，再输出结论。");

		fireEvent.click(disclosure);

		expect(disclosure).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByText("需要先读取项目结构，再输出结论。")).toBeInTheDocument();
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

		const disclosure = screen.getByRole("button", { name: /已处理/ });
		expect(disclosure).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(disclosure);

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

	it("shows normalized tool output in a compact disclosure and keeps raw JSON secondary", () => {
		render(
			<AgentTimeline
				isRunning
				messages={[
					assistantMessage({
						id: "tool-exec",
						kind: "tool",
						title: "rg --files -g '*.md'",
						metadata: {
							acpKind: "execute",
							inputJson: { command: "rg --files -g '*.md'" },
							outputBlocks: [{ type: "terminal", text: "exec-123", terminalId: "exec-123" }],
							outputJson: {
								exit_code: 0,
								formatted_output: "chapter-1.md\nchapter-2.md",
							},
							status: "completed",
							toolCallId: "call-exec",
						},
					}),
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /1 项调用/ }));
		fireEvent.click(screen.getByRole("button", { name: /rg --files/ }));

		expect(screen.getAllByText("chapter-1.md", { exact: false }).length).toBeGreaterThan(0);
		expect(screen.queryByText("exec-123")).not.toBeInTheDocument();
		expect(screen.getAllByText("原始结果").length).toBeGreaterThan(0);
	});

	it("folds completed process items while keeping the final answer outside and visible", () => {
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						id: "user-completed",
						turnId: "turn-completed",
						itemId: "item-user-completed",
						content: "整理第二章分镜",
					}),
					assistantMessage({
						id: "thought-completed",
						turnId: "turn-completed",
						itemId: "item-thought-completed",
						phase: "commentary",
						kind: "thought",
						content: "先核对场次和角色连续性。",
					}),
					assistantMessage({
						id: "plan-completed",
						turnId: "turn-completed",
						itemId: "item-plan-completed",
						phase: "commentary",
						kind: "plan",
						content: "",
						metadata: {
							planEntries: [
								{ content: "读取第二章", status: "completed" },
								{ content: "生成分镜", status: "completed" },
							],
						},
					}),
					assistantMessage({
						id: "final-completed",
						turnId: "turn-completed",
						itemId: "item-final-completed",
						phase: "final_answer",
						content: "第二章分镜已经整理完成。",
					}),
				]}
			/>,
		);

		const disclosure = screen.getByRole("button", { name: /已处理/ });
		const finalAnswer = screen.getByText("第二章分镜已经整理完成。");
		expect(disclosure).toHaveAttribute("aria-expanded", "false");
		expect(finalAnswer.closest(".agent-final-answer")).toBeInTheDocument();
		expect(finalAnswer.closest(".agent-process-disclosure")).toBeNull();
		expect(disclosureRegion(disclosure)).toHaveAttribute("aria-hidden", "true");
		expect(disclosureRegion(disclosure)).toHaveTextContent("先核对场次和角色连续性。");
		expect(disclosureRegion(disclosure)).toHaveTextContent("读取第二章");

		fireEvent.click(disclosure);

		expect(screen.getByText("先核对场次和角色连续性。")).toBeInTheDocument();
		expect(screen.getByText("读取第二章")).toBeInTheDocument();
		expect(screen.getByText("第二章分镜已经整理完成。")).toBeInTheDocument();
	});

	it("preserves a manual disclosure override when virtualization unmounts the turn", () => {
		const messages = [
			userMessage({ id: "user-virtualized", turnId: "turn-virtualized" }),
			assistantMessage({
				id: "thought-virtualized",
				turnId: "turn-virtualized",
				itemId: "item-thought-virtualized",
				phase: "commentary",
				kind: "thought",
				content: "虚拟化过程内容。",
			}),
		];
		const view = render(<AgentTimeline isRunning={false} messages={messages} />);
		fireEvent.click(screen.getByRole("button", { name: /已处理/ }));
		expect(screen.getByText("虚拟化过程内容。")).toBeInTheDocument();

		view.rerender(<AgentTimeline isRunning={false} messages={[]} />);
		view.rerender(<AgentTimeline isRunning={false} messages={messages} />);

		expect(screen.getByRole("button", { name: /已处理/ })).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByText("虚拟化过程内容。")).toBeInTheDocument();
	});

	it("collapses a manually reopened running process when it completes successfully", () => {
		const runningMessages = [
			userMessage({
				id: "user-running-manual",
				turnId: "turn-running-manual",
				itemId: "item-user-running-manual",
			}),
			assistantMessage({
				id: "commentary-running-manual",
				turnId: "turn-running-manual",
				itemId: "item-commentary-running-manual",
				phase: "commentary",
				content: "运行中的过程内容。",
				status: "streaming",
			}),
		];
		const completedMessages = runningMessages.map((message) =>
			message.role === "assistant" ? { ...message, status: "complete" as const } : message,
		);
		const view = render(<AgentTimeline isRunning messages={runningMessages} />);
		let disclosure = screen.getByRole("button", { name: /正在处理/ });

		fireEvent.click(disclosure);
		expect(disclosure).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(disclosure);
		expect(disclosure).toHaveAttribute("aria-expanded", "true");

		view.rerender(<AgentTimeline isRunning={false} messages={completedMessages} />);

		disclosure = screen.getByRole("button", { name: /已处理/ });
		expect(disclosure).toHaveAttribute("aria-expanded", "false");
		expect(disclosureRegion(disclosure)).toHaveAttribute("aria-hidden", "true");
	});

	it("expands the process disclosure by default for a running turn", () => {
		render(
			<AgentTimeline
				isRunning
				messages={[
					userMessage({
						id: "user-running",
						turnId: "turn-running",
						itemId: "item-user-running",
					}),
					assistantMessage({
						id: "commentary-running",
						turnId: "turn-running",
						itemId: "item-commentary-running",
						phase: "commentary",
						content: "正在读取项目资料。",
						status: "streaming",
					}),
				]}
			/>,
		);

		const disclosure = screen.getByRole("button", { name: /正在处理/ });
		expect(disclosure).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByText("正在读取项目资料。")).toBeInTheDocument();
	});

	it("keeps the loading indicator in an empty running process body", () => {
		render(
			<AgentTimeline
				isRunning
				messages={[
					userMessage({
						id: "user-running-empty",
						turnId: "turn-running-empty",
						itemId: "item-user-running-empty",
					}),
				]}
			/>,
		);

		const emptyState = screen.getByText("正在准备第一项操作…").closest(".agent-process-empty");
		expect(emptyState).not.toBeNull();
		expect(emptyState?.querySelector(".lucide-loader-circle")).not.toBeNull();
	});

	it("keeps a failed turn expanded from the durable conversation outcome", () => {
		const messages = [
			userMessage({ id: "user-failed", turnId: "run-failed", itemId: "item-user-failed" }),
			assistantMessage({
				id: "thought-failed",
				turnId: "run-failed",
				itemId: "item-thought-failed",
				phase: "commentary",
				kind: "thought",
				content: "检查失败原因。",
			}),
		];
		useAgentStore.setState({
			rootRunId: "run-failed",
			isRunning: false,
			conversations: {
				"run-failed": {
					runId: "run-failed",
					status: "failed",
					messages,
					streamingMessageId: null,
					children: [],
					createdAt: "2026-07-14T08:00:00.000Z",
					updatedAt: "2026-07-14T08:00:03.000Z",
				},
			},
		});

		render(<AgentTimeline isRunning={false} messages={messages} />);

		const disclosure = screen.getByRole("button", { name: /处理失败/ });
		expect(disclosure).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByText("检查失败原因。")).toBeInTheDocument();
	});

	it("uses the resolved conversation for lifecycle when the root run is stale and empty", () => {
		const messages = [
			userMessage({ id: "user-resolved", turnId: "run-resolved", itemId: "item-user-resolved" }),
			assistantMessage({
				id: "thought-resolved",
				turnId: "run-resolved",
				itemId: "item-thought-resolved",
				phase: "commentary",
				kind: "thought",
				content: "已经完成的过程内容。",
			}),
		];
		useAgentStore.setState({
			rootRunId: "run-stale-empty",
			isRunning: true,
			conversations: {
				"run-stale-empty": {
					runId: "run-stale-empty",
					status: "running",
					messages: [],
					streamingMessageId: null,
					children: [],
					createdAt: "2026-07-14T08:00:00.000Z",
					updatedAt: "2026-07-14T08:00:05.000Z",
				},
				"run-resolved": {
					runId: "run-resolved",
					status: "completed",
					messages,
					streamingMessageId: null,
					children: [],
					createdAt: "2026-07-14T08:00:01.000Z",
					updatedAt: "2026-07-14T08:00:03.000Z",
				},
			},
		});

		render(<AgentTimeline isRunning messages={messages} />);

		const disclosure = screen.getByRole("button", { name: /已处理/ });
		expect(disclosure).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByRole("button", { name: /正在处理/ })).not.toBeInTheDocument();
	});

	it("renders one primary process disclosure for multiple thoughts and tools in one turn", () => {
		render(
			<AgentTimeline
				isRunning
				messages={[
					userMessage({
						id: "user-one-disclosure",
						turnId: "turn-one-disclosure",
						itemId: "item-user-one-disclosure",
					}),
					assistantMessage({
						id: "thought-one",
						turnId: "turn-one-disclosure",
						itemId: "item-thought-one",
						phase: "commentary",
						kind: "thought",
						content: "检查已有资料。",
					}),
					assistantMessage({
						id: "thought-two",
						turnId: "turn-one-disclosure",
						itemId: "item-thought-two",
						phase: "commentary",
						kind: "thought",
						content: "确认目标文件。",
					}),
					assistantMessage({
						id: "tool-one",
						turnId: "turn-one-disclosure",
						itemId: "item-tool-one",
						phase: "commentary",
						kind: "tool",
						title: "读取剧本",
						metadata: { acpKind: "read", status: "completed", toolCallId: "call-one" },
					}),
					assistantMessage({
						id: "tool-two",
						turnId: "turn-one-disclosure",
						itemId: "item-tool-two",
						phase: "commentary",
						kind: "tool",
						title: "写入分镜",
						metadata: { acpKind: "edit", status: "completed", toolCallId: "call-two" },
					}),
				]}
			/>,
		);

		expect(document.querySelectorAll(".agent-process-disclosure")).toHaveLength(1);
		expect(screen.getByRole("button", { name: /正在处理/ })).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		expect(screen.getByText("检查已有资料。确认目标文件。")).toBeInTheDocument();

		const toolGroup = screen.getByRole("button", { name: /已探索 1 个文件 · 1 处编辑/ });
		expect(toolGroup).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(toolGroup);
		expect(screen.getByRole("button", { name: /读取剧本/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /写入分镜/ })).toBeInTheDocument();
	});

	it("uses explicit phase instead of content length or Markdown to choose process and final lanes", () => {
		const longFinal = [
			"## 最终结果",
			"这是一个刻意写得很长的最终回复，用于确认最终内容不会因为字符很多、包含 Markdown 标题或列表而被错误放进过程区域。",
			"- 已完成章节拆解",
			"- 已保存最终文档",
		].join("\n");
		render(
			<AgentTimeline
				isRunning={false}
				messages={[
					userMessage({
						id: "user-explicit-phase",
						turnId: "turn-explicit-phase",
						itemId: "item-user-explicit-phase",
					}),
					assistantMessage({
						id: "short-commentary",
						turnId: "turn-explicit-phase",
						itemId: "item-short-commentary",
						phase: "commentary",
						content: "先检查。",
					}),
					assistantMessage({
						id: "long-final",
						turnId: "turn-explicit-phase",
						itemId: "item-long-final",
						phase: "final_answer",
						content: longFinal,
					}),
				]}
			/>,
		);

		const disclosure = screen.getByRole("button", { name: /已处理/ });
		const finalHeading = screen.getByText("最终结果");
		expect(disclosure).toHaveAttribute("aria-expanded", "false");
		expect(disclosureRegion(disclosure)).toHaveAttribute("aria-hidden", "true");
		expect(disclosureRegion(disclosure)).toHaveTextContent("先检查。");
		expect(finalHeading.closest(".agent-final-answer")).toBeInTheDocument();
		expect(finalHeading.closest(".agent-process-disclosure")).toBeNull();

		fireEvent.click(disclosure);

		expect(screen.getByText("先检查。")).toBeInTheDocument();
		expect(screen.getByText("最终结果")).toBeInTheDocument();
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

const disclosureRegion = (trigger: HTMLElement) => {
	const contentId = trigger.getAttribute("aria-controls");
	expect(contentId).toBeTruthy();
	const region = document.getElementById(contentId ?? "");
	expect(region).not.toBeNull();
	return region as HTMLElement;
};

const userMessage = (patch: Partial<AgentMessage>): AgentMessage => ({
	...patch,
	id: patch.id ?? "user-1",
	role: "user",
	content: patch.content ?? "content",
	kind: patch.kind ?? "message",
	status: patch.status ?? "complete",
	createdAt: patch.createdAt ?? "2026-06-08T08:00:00.000Z",
});

const assistantMessage = (patch: Partial<AgentMessage>): AgentMessage => ({
	...patch,
	id: patch.id ?? "assistant-1",
	role: "assistant",
	content: patch.content ?? "content",
	kind: patch.kind ?? "message",
	status: patch.status ?? "complete",
	createdAt: patch.createdAt ?? "2026-06-08T08:00:01.000Z",
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
