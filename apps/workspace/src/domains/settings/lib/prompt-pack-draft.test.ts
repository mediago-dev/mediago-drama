import { describe, expect, it } from "vitest";
import type { PromptPackContents } from "@/domains/settings/api/packs";
import {
	createDraftEntry,
	createPromptPackDraft,
	isPersistedPromptPackDraftDirty,
	isPromptPackDraftDirty,
	moveDraftPromptToCategory,
	removeDraftCategory,
	serializePromptPackDraft,
	upsertDraftCategory,
	validatePromptPackDraft,
} from "./prompt-pack-draft";

const contents = (): PromptPackContents => ({
	categories: [
		{ id: "style", label: "风格", order: 0, packId: "local.test", source: "user" },
		{ id: "extra", label: "其他", order: 1, packId: "local.test", source: "user" },
	],
	entries: [
		{
			body: "body\n",
			id: "local.test/prompt/demo",
			kind: "prompt",
			metadata: { category: "style", custom: "preserved" },
			name: "Demo",
			packId: "local.test",
			slug: "demo",
			source: "user",
			title: "Demo",
		},
	],
	pack: { enabled: true, id: "local.test", name: "Test", source: "local", version: "1.0.0" },
	revision: "revision-1",
});

describe("prompt pack draft model", () => {
	it("tracks changes against the persisted immutable baseline", () => {
		const draft = createPromptPackDraft(contents());
		expect(draft.base).toBeDefined();
		expect(isPersistedPromptPackDraftDirty(draft)).toBe(false);
		draft.working.entries[0].body = "更新后的正文";
		expect(isPersistedPromptPackDraftDirty(draft)).toBe(true);
	});

	it("moves prompts without discarding unrelated metadata", () => {
		const draft = createPromptPackDraft(contents());
		const moved = moveDraftPromptToCategory(draft.working, draft.working.entries[0].id, "extra");
		expect(moved.entries[0].metadata).toEqual({ category: "extra", custom: "preserved" });
		expect(draft.working.entries[0].metadata?.category).toBe("style");
	});

	it("keeps all structural changes inside one serializable working snapshot", () => {
		let draft = createPromptPackDraft(contents());
		draft.working = upsertDraftCategory(draft.working, { id: "new", label: "新分组" });
		draft.working = createDraftEntry(draft.working, "skill", "new-skill");
		draft.working = removeDraftCategory(draft.working, "style", "extra");
		expect(isPromptPackDraftDirty(contents(), draft.working)).toBe(true);
		expect(validatePromptPackDraft(draft.working)).toBeUndefined();
		expect(serializePromptPackDraft(draft)).toMatchObject({
			baseRevision: "revision-1",
			categories: expect.arrayContaining([expect.objectContaining({ id: "new" })]),
			entries: expect.arrayContaining([expect.objectContaining({ slug: "new-skill" })]),
		});
	});

	it("normalizes whitespace when checking dirty state", () => {
		const draft = createPromptPackDraft(contents());
		draft.working.entries[0].body = " body ";
		expect(isPromptPackDraftDirty(contents(), draft.working)).toBe(false);
	});
});
