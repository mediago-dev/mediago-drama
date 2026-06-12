import { createStore } from "@/lib/utils";

export type GenerationKind = "image" | "video";

interface GenerationDraftState {
	kind: GenerationKind;
	prompt: string;
	setKind: (kind: GenerationKind) => void;
	setPrompt: (prompt: string) => void;
	reset: () => void;
}

export const useGenerationDraftStore = createStore<GenerationDraftState>(
	(set) => ({
		kind: "image",
		prompt: "",
		setKind: (kind) => {
			set((state) => {
				state.kind = kind;
			});
		},
		setPrompt: (prompt) => {
			set((state) => {
				state.prompt = prompt;
			});
		},
		reset: () => {
			set((state) => {
				state.kind = "image";
				state.prompt = "";
			});
		},
	}),
	"generationDraftStore",
);
