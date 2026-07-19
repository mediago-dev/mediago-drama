import { beforeEach, describe, expect, it } from "vitest";
import type { PromptPackContents } from "@/domains/settings/api/packs";
import { usePromptPackDraftStore } from "./prompt-pack-drafts";

const contents = (id: string): PromptPackContents => ({
	categories: [],
	entries: [],
	pack: { enabled: true, id, name: id, source: "local", version: "1.0.0" },
	revision: `revision-${id}`,
});

describe("prompt pack draft store", () => {
	beforeEach(() => {
		localStorage.clear();
		usePromptPackDraftStore.setState({ draftsByPackId: {} });
	});

	it("persists drafts independently per pack and removes only the abandoned draft", () => {
		const state = usePromptPackDraftStore.getState();
		state.startDraft(contents("local.one"));
		state.startDraft(contents("local.two"));
		expect(Object.keys(usePromptPackDraftStore.getState().draftsByPackId)).toEqual([
			"local.one",
			"local.two",
		]);
		usePromptPackDraftStore.getState().removeDraft("local.one");
		expect(usePromptPackDraftStore.getState().draftsByPackId["local.one"]).toBeUndefined();
		expect(usePromptPackDraftStore.getState().draftsByPackId["local.two"]).toBeDefined();
		expect(localStorage.getItem("prompt-pack-drafts.v1")).toContain("local.two");
	});

	it("updates the complete working copy synchronously", () => {
		usePromptPackDraftStore.getState().startDraft(contents("local.one"));
		const draft = usePromptPackDraftStore.getState().draftsByPackId["local.one"];
		usePromptPackDraftStore.getState().updateWorking("local.one", {
			...draft.working,
			categories: [{ id: "new", label: "新分组", order: 0, packId: "local.one", source: "user" }],
		});
		expect(
			usePromptPackDraftStore.getState().draftsByPackId["local.one"].working.categories,
		).toHaveLength(1);
		expect(localStorage.getItem("prompt-pack-drafts.v1")).toContain("新分组");
	});

	it("rehydrates a valid draft from localStorage after the in-memory state is lost", async () => {
		usePromptPackDraftStore.getState().startDraft(contents("local.one"));
		const draft = usePromptPackDraftStore.getState().draftsByPackId["local.one"];
		usePromptPackDraftStore.getState().updateWorking("local.one", {
			...draft.working,
			categories: [
				{ id: "recovered", label: "恢复后的分组", order: 0, packId: "local.one", source: "user" },
			],
		});
		const persisted = localStorage.getItem("prompt-pack-drafts.v1");
		expect(persisted).toContain("恢复后的分组");

		usePromptPackDraftStore.setState({ draftsByPackId: {} });
		localStorage.setItem("prompt-pack-drafts.v1", persisted ?? "");
		await usePromptPackDraftStore.persist.rehydrate();

		expect(
			usePromptPackDraftStore.getState().draftsByPackId["local.one"].working.categories[0],
		).toMatchObject({ id: "recovered", label: "恢复后的分组" });
	});
});
