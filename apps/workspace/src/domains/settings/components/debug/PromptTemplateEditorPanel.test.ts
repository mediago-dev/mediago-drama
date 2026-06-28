import { describe, expect, it } from "vitest";
import type { PromptTemplate } from "@/domains/settings/api/prompt-templates";
import { visibleInstructionTemplates } from "./PromptTemplateEditorPanel";

describe("visibleInstructionTemplates", () => {
	it("hides non-injectable internal prompt templates from agent instruction settings", () => {
		const templates: PromptTemplate[] = [
			template("AGENTS", true),
			template("TOOLS", true),
			template("INTERNAL_TEMPLATE", false),
		];

		expect(visibleInstructionTemplates(templates).map((template) => template.id)).toEqual([
			"AGENTS",
			"TOOLS",
		]);
	});
});

const template = (id: string, injectable: boolean): PromptTemplate => ({
	content: `${id} content`,
	id,
	injectable,
	name: `${id}.md`,
	source: "official",
});
