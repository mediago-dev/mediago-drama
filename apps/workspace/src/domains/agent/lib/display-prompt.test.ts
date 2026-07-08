import { describe, expect, it } from "vitest";
import { agentPromptWithReferences } from "./display-prompt";

describe("agent machine prompt references", () => {
	it("formats reference-only prompts as @ tokens", () => {
		expect(
			agentPromptWithReferences({
				prompt: "",
				references: [{ title: "角色档案" }, { title: "第一集剧本" }],
			}),
		).toBe("@角色档案 @第一集剧本");
	});

	it("keeps mention-only prompts non-empty for the agent", () => {
		expect(agentPromptWithReferences({ prompt: "", references: [{ title: "角色档案" }] })).toBe(
			"@角色档案",
		);
	});

	it("prefixes references before user text", () => {
		expect(
			agentPromptWithReferences({
				prompt: "帮我将所有的角色提取，写到文档中",
				references: [{ title: "第一集剧本" }],
			}),
		).toBe("@第一集剧本 帮我将所有的角色提取，写到文档中");
	});

	it("does not duplicate references that are already spelled out inline", () => {
		expect(
			agentPromptWithReferences({
				prompt: "可以帮我把 @完美世界.txt 这个文档转换成 utf8 编码吗？",
				references: [{ title: "完美世界.txt" }],
			}),
		).toBe("可以帮我把 @完美世界.txt 这个文档转换成 utf8 编码吗？");
	});
});
