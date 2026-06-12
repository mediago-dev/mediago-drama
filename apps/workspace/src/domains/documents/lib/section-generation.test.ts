import { describe, expect, it } from "vitest";
import { agentGenerationConversationScopeId } from "@/domains/generation/api/generation";
import type { MarkdownSectionIdentity } from "./editor-registry";
import {
	sectionGenerationConversationScopeId,
	sectionGenerationHistoryScopeId,
	sectionGenerationIdentityKey,
	sectionGenerationPreferenceScopeId,
} from "./section-generation";

const section = (overrides: Partial<MarkdownSectionIdentity>): MarkdownSectionIdentity => ({
	blockId: "section_visual",
	documentId: "doc-a",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "画面",
	...overrides,
});

describe("section generation identity", () => {
	it("isolates sections with the same block id in different documents", () => {
		const first = section({ documentId: "doc-a", blockId: "section_shared" });
		const second = section({ documentId: "doc-b", blockId: "section_shared" });

		expect(sectionGenerationIdentityKey(first)).not.toBe(sectionGenerationIdentityKey(second));
		expect(sectionGenerationHistoryScopeId(first, "project-1")).not.toBe(
			sectionGenerationHistoryScopeId(second, "project-1"),
		);
	});

	it("keeps project section generation preferences shared while tasks and history are section scoped", () => {
		const target = section({});

		expect(sectionGenerationConversationScopeId(target, "project-1")).toBe(
			"agent:project-1:section:doc-a:section_visual",
		);
		expect(sectionGenerationHistoryScopeId(target, "project-1")).toBe(
			"agent:project-1:section:doc-a:section_visual",
		);
		expect(sectionGenerationPreferenceScopeId(target, "project-1")).toBe(
			agentGenerationConversationScopeId,
		);
	});

	it("uses a section-specific scope outside projects", () => {
		const target = section({ documentId: "doc:1", blockId: "section/shared" });

		expect(sectionGenerationConversationScopeId(target)).toBe("section:doc%3A1:section%2Fshared");
		expect(sectionGenerationHistoryScopeId(target)).toBe("section:doc%3A1:section%2Fshared");
		expect(sectionGenerationPreferenceScopeId(target)).toBe("section:doc%3A1:section%2Fshared");
	});
});
