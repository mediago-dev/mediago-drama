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

	it("hides non-editable core prompt templates from agent instruction settings", () => {
		const templates: PromptTemplate[] = [
			template("AGENTS", true),
			{ ...template("DOCUMENT_RULES", true), editable: false },
		];

		expect(visibleInstructionTemplates(templates).map((template) => template.id)).toEqual([
			"AGENTS",
		]);
	});
});

const template = (id: string, injectable: boolean): PromptTemplate => ({
	content: `${id} content`,
	id,
	editable: true,
	injectable,
	name: `${id}.md`,
	source: "official",
});
