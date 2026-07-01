import { describe, expect, it } from "vitest";
import { removeStaleLocalPendingMessages } from "./generationWorkspaceState";
import type { ChatMessage } from "./generationTypes";

const T0 = Date.parse("2026-06-04T00:00:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const userMessage = (localId: string, content: string, offsetMs = 0): ChatMessage => ({
	id: `${localId}:prompt`,
	role: "user",
	kind: "video",
	content,
	createdAt: at(offsetMs),
	updatedAt: at(offsetMs),
});

const assistantMessage = (
	id: string,
	overrides: Partial<ChatMessage> = {},
	offsetMs = 0,
): ChatMessage => ({
	id,
	role: "assistant",
	kind: "video",
	content: "正在提交视频任务...",
	status: "submitting",
	createdAt: at(offsetMs),
	updatedAt: at(offsetMs),
	...overrides,
});

interface TaskInput {
	id: string;
	kind?: string;
	prompt?: string;
	status?: string;
	error?: string;
	createdAt?: string;
	updatedAt?: string;
}

const task = (overrides: Partial<TaskInput> = {}): TaskInput => ({
	id: "task-1",
	kind: "video",
	prompt: "优化后的提示词",
	status: "submitting",
	createdAt: at(20_000),
	updatedAt: at(20_000),
	...overrides,
});

const localIds = (messages: ChatMessage[]) => messages.map((message) => message.id);

describe("removeStaleLocalPendingMessages", () => {
	it("reclaims an orphaned optimize-and-generate phantom once it is old and a sibling task exists", () => {
		const messages = [
			userMessage("local-1", "用户原始提示词"),
			assistantMessage("local-1:assistant"),
		];
		const tasks = [task()];

		const result = removeStaleLocalPendingMessages(messages, tasks, T0 + 120_000);

		expect(result).toEqual([]);
	});

	it("keeps the phantom while it is still within the in-flight grace window", () => {
		const messages = [
			userMessage("local-1", "用户原始提示词"),
			assistantMessage("local-1:assistant"),
		];
		const tasks = [task()];

		const result = removeStaleLocalPendingMessages(messages, tasks, T0 + 10_000);

		expect(localIds(result)).toEqual(["local-1:prompt", "local-1:assistant"]);
	});

	it("keeps a genuine local failure when no sibling task proves the submit reached the server", () => {
		const messages = [
			userMessage("local-2", "用户原始提示词"),
			assistantMessage("local-2:error", {
				status: "error",
				error: "生成失败",
				content: "生成失败",
			}),
		];
		// Only an unrelated, much older task of the same kind is present.
		const tasks = [task({ id: "old-task", createdAt: at(-600_000), updatedAt: at(-600_000) })];

		const result = removeStaleLocalPendingMessages(messages, tasks, T0 + 120_000);

		expect(localIds(result)).toEqual(["local-2:prompt", "local-2:error"]);
	});

	it("reclaims an errored orphan (`:error` suffix) once a sibling task exists", () => {
		const messages = [
			userMessage("local-4", "用户原始提示词"),
			assistantMessage("local-4:error", {
				status: "error",
				error: "网络中断",
				content: "网络中断",
			}),
		];
		const tasks = [task({ createdAt: at(15_000), updatedAt: at(15_000) })];

		const result = removeStaleLocalPendingMessages(messages, tasks, T0 + 120_000);

		expect(result).toEqual([]);
	});

	it("still removes a pending phantom immediately via the exact-prompt fast path", () => {
		const messages = [userMessage("local-3", "一只猫"), assistantMessage("local-3:assistant")];
		// Same prompt on the task → matched right away, no grace required.
		const tasks = [task({ prompt: "一只猫", createdAt: at(2_000), updatedAt: at(2_000) })];

		const result = removeStaleLocalPendingMessages(messages, tasks, T0 + 5_000);

		expect(result).toEqual([]);
	});

	it("never touches non-local messages backed by real tasks", () => {
		const realUser: ChatMessage = {
			id: "task-1:prompt",
			role: "user",
			kind: "video",
			content: "优化后的提示词",
			createdAt: at(20_000),
			updatedAt: at(20_000),
		};
		const realAssistant = assistantMessage("task-1", { content: "生成中" }, 20_000);
		const messages = [
			realUser,
			realAssistant,
			userMessage("local-1", "用户原始提示词"),
			assistantMessage("local-1:assistant"),
		];
		const tasks = [task()];

		const result = removeStaleLocalPendingMessages(messages, tasks, T0 + 120_000);

		expect(localIds(result)).toEqual(["task-1:prompt", "task-1"]);
	});
});
