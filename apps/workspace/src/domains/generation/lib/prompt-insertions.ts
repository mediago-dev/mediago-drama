import type { GenerationKind } from "@/domains/generation/api/generation";
import type { PromptLayer, PromptPreset } from "@/domains/generation/api/prompt-presets";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import { promptLayerLabels } from "@/domains/generation/lib/prompt-layers";

const promptInsertLayerOrder: PromptLayer[] = ["style", "extra"];

export const promptInsertItemsFromPresets = (
	presets: PromptPreset[],
	kind: GenerationKind,
): PromptInsertItem[] =>
	promptInsertLayerOrder.flatMap((layer) =>
		presets
			.filter((preset) => preset.layer === layer)
			.filter((preset) => shouldExposePromptPreset(preset, kind))
			.map((preset) => ({
				id: preset.id,
				layerLabel: promptLayerLabels[preset.layer] ?? preset.layer,
				name: preset.name,
				prompt: preset.prompt,
				sourceLabel: preset.source === "builtin" ? "内置" : "用户",
			})),
	);

const shouldExposePromptPreset = (preset: PromptPreset, kind: GenerationKind) => {
	if (!preset.prompt.trim()) return false;
	if (preset.layer === "style") return true;
	return !preset.kind || preset.kind === kind;
};
