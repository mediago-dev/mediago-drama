import { describe, expect, it } from "vitest";
import { agentDisplayPrompt, referenceDisplayPrompt } from "./display-prompt";

describe("agent display prompt", () => {
	it("formats document references for chat bubbles", () => {
		expect(referenceDisplayPrompt([{ title: "角色档案" }, { title: "第一集剧本" }])).toBe(
			"@角色档案 @第一集剧本",
		);
	});

	it("keeps mention-only prompts visible", () => {
		expect(agentDisplayPrompt({ prompt: "", references: [{ title: "角色档案" }] })).toBe(
			"@角色档案",
		);
	});

	it("prefixes references before user text", () => {
		expect(
			agentDisplayPrompt({
				prompt: "帮我将所有的角色提取，写到文档中",
				references: [{ title: "第一集剧本" }],
			}),
		).toBe("@第一集剧本 帮我将所有的角色提取，写到文档中");
	});

	it("does not duplicate references that are already visible inline", () => {
		expect(
			agentDisplayPrompt({
				prompt: "可以帮我把 @完美世界.txt 这个文档转换成 utf8 编码吗？",
				references: [{ title: "完美世界.txt" }],
			}),
		).toBe("可以帮我把 @完美世界.txt 这个文档转换成 utf8 编码吗？");
	});

	it("keeps attachments out of the prompt text shown in chat bubbles", () => {
		expect(
			agentDisplayPrompt({
				prompt: "整理人物",
				references: [{ title: "第一集剧本" }],
			}),
		).toBe("@第一集剧本 整理人物");
	});
});
