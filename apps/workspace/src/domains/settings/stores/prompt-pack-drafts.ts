import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { PromptPackContents } from "@/domains/settings/api/packs";
import {
	createPromptPackDraft,
	isPersistedPromptPackDraft,
	type PersistedPromptPackDraft,
	type PromptPackDraftContents,
} from "@/domains/settings/lib/prompt-pack-draft";

interface PromptPackDraftState {
	draftsByPackId: Record<string, PersistedPromptPackDraft>;
	startDraft: (contents: PromptPackContents) => void;
	putDraft: (draft: PersistedPromptPackDraft) => void;
	updateWorking: (packId: string, working: PromptPackDraftContents) => void;
	removeDraft: (packId: string) => void;
}

export const promptPackDraftStoreKey = "prompt-pack-drafts.v1";

export const usePromptPackDraftStore = create<PromptPackDraftState>()(
	persist(
		immer((set) => ({
			draftsByPackId: {},
			putDraft: (draft) =>
				set((state) => {
					state.draftsByPackId[draft.packId] = draft;
				}),
			removeDraft: (packId) =>
				set((state) => {
					delete state.draftsByPackId[packId];
				}),
			startDraft: (contents) =>
				set((state) => {
					state.draftsByPackId[contents.pack.id] = createPromptPackDraft(contents);
				}),
			updateWorking: (packId, working) =>
				set((state) => {
					const draft = state.draftsByPackId[packId];
					if (!draft) return;
					draft.working = working;
					draft.updatedAt = new Date().toISOString();
				}),
		})),
		{
			merge: (persisted, current) => {
				const raw = (persisted as Partial<PromptPackDraftState> | undefined)?.draftsByPackId;
				const draftsByPackId: Record<string, PersistedPromptPackDraft> = {};
				if (raw && typeof raw === "object") {
					for (const [packId, draft] of Object.entries(raw)) {
						if (isPersistedPromptPackDraft(draft) && draft.packId === packId) {
							draftsByPackId[packId] = draft;
						}
					}
				}
				return { ...current, draftsByPackId };
			},
			name: promptPackDraftStoreKey,
			partialize: (state) => ({ draftsByPackId: state.draftsByPackId }),
			storage: createJSONStorage(() => localStorage),
			version: 1,
		},
	),
);
