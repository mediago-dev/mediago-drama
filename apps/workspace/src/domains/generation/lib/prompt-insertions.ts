import type { PromptCategory } from "@/domains/generation/api/prompt-categories";
import type { PromptPreset, PromptPresetIndex } from "@/domains/generation/api/prompt-presets";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import {
	promptCategoryLabel,
	promptCategoryOrder,
} from "@/domains/generation/lib/prompt-categories";

export const promptInsertItemsFromPresets = (
	presets: Array<PromptPreset | PromptPresetIndex>,
	categories: PromptCategory[] = [],
): PromptInsertItem[] =>
	presets
		.filter((preset) => !("prompt" in preset) || preset.prompt.trim())
		.slice()
		.sort(comparePromptPresetsForInsertion)
		.map((preset) => ({
			id: preset.id,
			categoryLabel: promptCategoryLabel(preset.category, categories),
			name: preset.name,
			prompt: "prompt" in preset ? preset.prompt : "",
			sourceRef:
				"sourcePackageId" in preset && preset.sourcePackageId && preset.sourceReleaseId
					? { packageId: preset.sourcePackageId, releaseId: preset.sourceReleaseId }
					: undefined,
			sourceLabel: preset.source === "pack" ? "来自包" : "用户新增",
		}));

const comparePromptPresetsForInsertion = (
	left: PromptPreset | PromptPresetIndex,
	right: PromptPreset | PromptPresetIndex,
) => {
	const categoryDelta = promptCategoryOrder(left.category) - promptCategoryOrder(right.category);
	if (categoryDelta !== 0) return categoryDelta;
	if (left.category !== right.category)
		return left.category.localeCompare(right.category, "zh-Hans-CN");
	if (left.name !== right.name) return left.name.localeCompare(right.name, "zh-Hans-CN");
	return left.id.localeCompare(right.id, "zh-Hans-CN");
};
