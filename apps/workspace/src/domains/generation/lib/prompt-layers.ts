import type { PromptLayer } from "@/domains/generation/api/prompt-presets";
import type { DocumentCategory } from "@/domains/documents/stores";

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

export const promptLayerLabels: Record<PromptLayer, string> = {
	style: "风格",
	extra: "其他",
};
