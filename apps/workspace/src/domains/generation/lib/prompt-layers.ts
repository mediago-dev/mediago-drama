import type { PromptLayer } from "@/domains/generation/api/prompt-presets";
import type { DocumentCategory } from "@/domains/documents/stores";

// 生成任务类型(对应文档分类;无项目/无分类时为 studio)。
export type GenerationTaskType = "character" | "scene" | "storyboard" | "prop" | "studio";

// 各任务类型在组合器里展示的「库内文字层」(主体词=输入框,不在此列)。
const taskTypeLayerMap: Record<GenerationTaskType, PromptLayer[]> = {
	character: ["style", "extra"],
	scene: ["style", "extra"],
	storyboard: ["style", "extra"],
	prop: ["style", "extra"],
	studio: ["style", "extra"],
};

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

export const taskTypeLayers = (taskType: GenerationTaskType): PromptLayer[] =>
	taskTypeLayerMap[taskType] ?? [];

// 把选中各层的文本按序叠加成一段风格串(交给 applyVisualStyle 追加到主体词)。
export const composeLayerStyle = (layerTexts: Array<string | undefined | null>): string =>
	layerTexts
		.map((text) => text?.trim() ?? "")
		.filter((text) => text !== "")
		.join("\n");

export const promptLayerLabels: Record<PromptLayer, string> = {
	style: "风格",
	extra: "其他",
};
