import { describe, expect, it } from "vitest";
import { composeSkillMarkdown, splitSkillMarkdown, updateSkillDescription } from "./skill-markdown";

describe("skill markdown helpers", () => {
	it("splits skill frontmatter from markdown body", () => {
		const parts = splitSkillMarkdown(`---
name: scene-writer
description: 场景指导
hint:
  document_category: scene
---
# 场景指导

正文
`);

		expect(parts.hasFrontmatter).toBe(true);
		expect(parts.frontmatter).toContain("name: scene-writer");
		expect(parts.frontmatter).toContain("document_category: scene");
		expect(parts.body).toBe("# 场景指导\n\n正文");
	});

	it("composes a valid skill markdown file", () => {
		const markdown = composeSkillMarkdown({
			frontmatter: "name: scene-writer\ndescription: 场景指导",
			body: "# 场景指导\n\n正文",
		});

		expect(markdown).toBe(`---
name: scene-writer
description: 场景指导
---
# 场景指导

正文
`);
	});

	it("keeps invalid raw content editable as body content", () => {
		const parts = splitSkillMarkdown("not frontmatter\n# Heading");

		expect(parts.hasFrontmatter).toBe(false);
		expect(parts.frontmatter).toBe("");
		expect(parts.body).toBe("not frontmatter\n# Heading");
	});

	it("updates an existing description without changing other metadata", () => {
		const frontmatter = updateSkillDescription(
			"name: scene-writer\ndescription: 旧描述\nhint:\n  document_category: scene",
			"按场景任务提供写作指导",
		);

		expect(frontmatter).toBe(
			'name: scene-writer\ndescription: "按场景任务提供写作指导"\nhint:\n  document_category: scene',
		);
	});

	it("adds a missing description after the skill name", () => {
		expect(updateSkillDescription("name: scene-writer\ntitle: 场景写作", "场景指导")).toBe(
			'name: scene-writer\ndescription: "场景指导"\ntitle: 场景写作',
		);
	});
});
