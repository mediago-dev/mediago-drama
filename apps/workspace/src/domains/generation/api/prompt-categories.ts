import { createResource } from "@/shared/lib/api-factory";
import type { PromptPresetCategory, PromptPresetSource } from "./prompt-presets";

export interface PromptCategory {
	id: PromptPresetCategory;
	label: string;
	source: PromptPresetSource;
	builtin?: boolean;
}

export interface PromptCategoryInput {
	id?: PromptPresetCategory;
	label: string;
}

export const promptCategoriesKey = "/prompt-categories";

interface PromptCategoriesResponse {
	categories: PromptCategory[];
}

const promptCategoryResource = createResource<
	PromptCategory,
	PromptCategoryInput,
	PromptCategoryInput,
	PromptCategoriesResponse,
	PromptCategory[]
>(promptCategoriesKey, {
	key: promptCategoriesKey,
	selectList: (response) => response.categories,
});

export const listPromptCategories = promptCategoryResource.list;
export const createPromptCategory = promptCategoryResource.create;
