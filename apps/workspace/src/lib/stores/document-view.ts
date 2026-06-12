import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export type DocumentViewMode = "category" | "directory";

interface DocumentViewState {
	mode: DocumentViewMode;
	setMode: (mode: DocumentViewMode) => void;
	toggleMode: () => void;
}

const documentViewStoreKey = "document-view.v2";
const documentViewStoreVersion = 2;

const isDocumentViewMode = (value: unknown): value is DocumentViewMode =>
	value === "category" || value === "directory";

export const useDocumentViewStore = create<DocumentViewState>()(
	persist(
		immer((set, get) => ({
			mode: "directory",
			setMode: (mode) =>
				set((state) => {
					state.mode = mode;
				}),
			toggleMode: () => {
				const nextMode = get().mode === "category" ? "directory" : "category";
				set((state) => {
					state.mode = nextMode;
				});
			},
		})),
		{
			name: documentViewStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: documentViewStoreVersion,
			partialize: (state) => ({ mode: state.mode }),
			migrate: (persisted, version) =>
				version === documentViewStoreVersion ? persisted : { mode: "directory" },
			merge: (persisted, current) => {
				const mode = (persisted as Partial<Pick<DocumentViewState, "mode">> | undefined)?.mode;
				return { ...current, mode: isDocumentViewMode(mode) ? mode : current.mode };
			},
		},
	),
);
