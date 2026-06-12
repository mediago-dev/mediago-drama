import { describe, expect, it } from "vitest";
import type { AgentRuntimeACPEvent } from "@/domains/agent/api/agent";
import type { AgentMessage } from "@/domains/agent/stores/types";
import {
	containsRuntimeLogMarkers,
	isACPToolRuntimeLog,
	normalizeRuntimeLogMessage,
} from "./runtime-log";

describe("ACP runtime log detection", () => {
	it("detects legacy Codex runtime logs wrapped as tool updates", () => {
		const acp: AgentRuntimeACPEvent = {
			kind: "toolCallUpdate",
			toolCallId: "2026-06-03T09:43:13.788359Z",
			toolKind: "other",
			status: "failed",
			content: [
				{
					type: "text",
					text: "ERROR codex_core::session::session: failed to load skill /tmp/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---",
				},
			],
		};

		expect(isACPToolRuntimeLog(acp)).toBe(true);
	});

	it("ignores generic tool titles when detecting Codex runtime logs", () => {
		const acp: AgentRuntimeACPEvent = {
			kind: "toolCallUpdate",
			toolCallId: "runtime-log-call",
			toolKind: "other",
			title: "工具调用",
			status: "failed",
			content: [
				{
					type: "terminal",
					text: "2026-06-03T12:54:28.436454Z ERROR codex_core::session::session: failed to load skill /tmp/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---",
				},
			],
		};

		expect(isACPToolRuntimeLog(acp)).toBe(true);
	});

	it("keeps real MCP tool updates classified as tools", () => {
		const acp: AgentRuntimeACPEvent = {
			kind: "toolCallUpdate",
			toolCallId: "call-edit",
			toolKind: "other",
			title: "Tool: mediago_drama/mutate_comment",
			status: "completed",
			locations: [{ path: "draft.md" }],
			content: [
				{
					type: "text",
					text: "ERROR codex_core::session appeared inside edited content",
				},
			],
		};

		expect(isACPToolRuntimeLog(acp)).toBe(false);
	});

	it("normalizes persisted legacy tool runtime logs as runtime messages", () => {
		const message: AgentMessage = {
			id: "tool-runtime-log",
			role: "assistant",
			kind: "tool",
			title: "工具调用",
			content:
				"ERROR codex_core::session::session: failed to load skill /tmp/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---",
			metadata: {
				acpKind: "other",
				toolCallId: "runtime-log-call",
			},
		};

		expect(normalizeRuntimeLogMessage(message)).toMatchObject({
			kind: "runtime",
			title: "运行日志",
			metadata: {
				runtimeLog: true,
				toolName: "运行日志",
			},
		});
	});

	it("detects Codex runtime logs from process stderr text", () => {
		expect(
			containsRuntimeLogMarkers(
				"\u001b[31mERROR\u001b[0m codex_core::session::session: failed to load skill /tmp/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---",
			),
		).toBe(true);
	});

	it("keeps persisted real MCP tool messages as tools", () => {
		const message: AgentMessage = {
			id: "tool-real",
			role: "assistant",
			kind: "tool",
			title: "Tool: mediago_drama/list_documents",
			content: "ERROR codex_core::session appeared inside returned document text",
			metadata: {
				acpKind: "mcp",
				toolCallId: "real-tool-call",
				locations: [{ path: "draft.md" }],
			},
		};

		expect(normalizeRuntimeLogMessage(message)).toMatchObject({
			kind: "tool",
			title: "Tool: mediago_drama/list_documents",
		});
	});
});
