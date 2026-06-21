import type { PromptPresetCategory } from "@/domains/generation/api/prompt-presets";
import type { DocumentCategory } from "@/domains/documents/stores";
import type { PromptCategory } from "@/domains/generation/api/prompt-categories";

// 生成任务类型(对应文档分类;无项目/无分类时为 studio)。
export type GenerationTaskType = "character" | "scene" | "storyboard" | "prop" | "studio";

export const taskTypeForCategory = (category?: DocumentCategory | null): GenerationTaskType => {
	switch (category) {
		case "character":
			return "character";
		case "scene":
			return "scene";
		case "storyboard":
			return "storyboard";
		case "prop":
			return "prop";
		default:
			return "studio";
	}
};

export const stylePromptCategory = "style";
export const extraPromptCategory = "extra";

export const defaultPromptCategoryOptions: { value: PromptPresetCategory; label: string }[] = [
	{ value: stylePromptCategory, label: "风格" },
	{ value: extraPromptCategory, label: "其他" },
];

export const defaultPromptCategories: PromptCategory[] = defaultPromptCategoryOptions.map(
	(option) => ({
		id: option.value,
		label: option.label,
		source: "pack",
		builtin: true,
	}),
);

export const promptCategoryLabel = (
	category: PromptPresetCategory,
	categories: PromptCategory[] = defaultPromptCategories,
) => categories.find((option) => option.id === category)?.label ?? category;

export const promptCategoryOrder = (category: PromptPresetCategory) => {
	switch (category) {
		case stylePromptCategory:
			return 0;
		case extraPromptCategory:
			return 1;
		default:
			return 99;
	}
};
