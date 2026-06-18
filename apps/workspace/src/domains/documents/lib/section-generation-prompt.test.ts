import { describe, expect, it } from "vitest";
import { createSectionGenerationPrompt } from "./section-generation-prompt";

describe("section generation prompt", () => {
	it("keeps the section markdown format without prompt wrapper text", () => {
		const prompt = createSectionGenerationPrompt(
			[
				"<!-- section-id: section_role -->",
				"## 主角 底层青年 / 低阶散修",
				"",
				"![正在生成图片](<data:image/svg+xml;base64,abc>)",
				"",
				"**身份**：出身寒微，修为低阶。",
				"",
				"- 衣着朴素",
				"- 眼神坚韧",
				"",
				"![角色参考](</api/media/assets/ref-a/content>)",
			].join("\n"),
		);

		expect(prompt).toBe(
			[
				"## 主角 底层青年 / 低阶散修",
				"",
				"**身份**：出身寒微，修为低阶。",
				"",
				"- 衣着朴素",
				"- 眼神坚韧",
			].join("\n"),
		);
		expect(prompt).not.toContain("请根据下面这个标题区域");
		expect(prompt).not.toContain("section-id");
		expect(prompt).not.toContain("data:image");
	});

	it("falls back to the title when the section only contains removed content", () => {
		expect(
			createSectionGenerationPrompt(
				[
					"<!-- section-id: section_empty -->",
					"![正在生成图片](<data:image/svg+xml;base64,abc>)",
				].join("\n"),
				"主角 底层青年 / 低阶散修",
			),
		).toBe("主角 底层青年 / 低阶散修");
	});
});
