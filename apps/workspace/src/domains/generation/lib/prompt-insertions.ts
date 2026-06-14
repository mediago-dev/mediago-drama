import type { GenerationKind } from "@/domains/generation/api/generation";
import type { PromptPreset } from "@/domains/generation/api/prompt-presets";
import type { ComposerLayer } from "@/domains/generation/components/LayeredPromptComposer";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import { promptLayerLabels } from "@/domains/generation/lib/prompt-layers";

export const promptInsertItemsFromLayers = (
	layers: ComposerLayer[],
	kind: GenerationKind,
): PromptInsertItem[] =>
	layers.flatMap((layer) =>
		layer.presets
			.filter((preset) => shouldExposePromptPreset(preset, kind))
			.map((preset) => ({
				id: preset.id,
				layerLabel: promptLayerLabels[preset.layer] ?? layer.layer,
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
