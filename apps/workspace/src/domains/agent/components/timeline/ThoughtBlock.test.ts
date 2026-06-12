import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import { readableThoughtContent } from "./ThoughtBlock";

describe("readableThoughtContent", () => {
	it("flows streamed Chinese thought fragments into a readable paragraph", () => {
		const content = readableThoughtContent(
			[
				"思考：",
				"用户",
				"只是打了个",
				"招呼“你好”，",
				"根据",
				"规则",
				"，我不应该",
				"修改",
				"文件，只需要",
				"友好",
				"地回复",
				"即可",
				"。",
			].map(thoughtMessage),
		);

		expect(content).toBe(
			"思考：用户只是打了个招呼“你好”，根据规则，我不应该修改文件，只需要友好地回复即可。",
		);
	});

	it("keeps spaces between streamed latin words", () => {
		const content = readableThoughtContent(
			["Thinking:", "the", "user", "said", "hello", "."].map(thoughtMessage),
		);

		expect(content).toBe("Thinking: the user said hello.");
	});
});

const thoughtMessage = (content: string): AgentMessage => ({
	id: `thought-${content}`,
	role: "assistant",
	content,
	kind: "thought",
	status: "complete",
});
