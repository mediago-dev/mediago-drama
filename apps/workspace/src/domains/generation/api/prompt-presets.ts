import type { AxiosRequestConfig } from "axios";
import { createResource } from "@/shared/lib/api-factory";
import httpClient from "@/shared/lib/http";

export type PromptPresetSource = "pack" | "user";

// 提示词分类(默认 style/extra，也允许用户自定义)。
export type PromptPresetCategory = string;

// 旧的类型维度,已被 category 取代,仅保留兼容字段。
export type PromptPresetType = "image" | "video";

export interface PromptPreset {
	id: string;
	name: string;
	category: PromptPresetCategory;
	type?: PromptPresetType;
	prompt: string;
	source: PromptPresetSource;
	builtin?: boolean;
	overridden?: boolean;
}

export interface PromptPresetFilter {
	category?: PromptPresetCategory;
	type?: PromptPresetType;
}

export const promptPresetsKey = "/prompt-presets";

interface PromptPresetsResponse {
	prompts: PromptPreset[];
}

export type PromptPresetInput = Pick<PromptPreset, "id" | "name" | "category" | "prompt"> &
	Partial<Pick<PromptPreset, "type">>;

const promptPresetResource = createResource<
	PromptPreset,
	PromptPresetInput,
	PromptPresetInput,
	PromptPresetsResponse,
	PromptPreset[]
>(promptPresetsKey, {
	key: promptPresetsKey,
	selectList: (response) => response.prompts,
});

export const listPromptPresets = async (
	filter: PromptPresetFilter = {},
	config?: AxiosRequestConfig,
): Promise<PromptPreset[]> =>
	promptPresetResource.list({
		...config,
		params: { ...config?.params, ...filter },
	});

export const getPromptPreset = promptPresetResource.get;
export const createPromptPreset = promptPresetResource.create;
export const updatePromptPreset = promptPresetResource.update;
export const deletePromptPreset = promptPresetResource.remove;

export const resetPromptPreset = async (id: string | number): Promise<PromptPreset> => {
	const response = await httpClient.post<PromptPreset>(
		`${promptPresetsKey}/${encodeURIComponent(String(id))}/reset`,
	);
	return response.data;
};

// 按分类取预设的 SWR key（稳定且唯一）。
export const promptPresetsCategoryKey = (category: PromptPresetCategory) =>
	`${promptPresetsKey}?category=${encodeURIComponent(category)}`;

// —— 向后兼容导出（风格分类）：消费方只需把 import 路径换到本模块 ——
export type StylePreset = PromptPreset;
export const stylePresetsKey = promptPresetsCategoryKey("style");
export const listStylePresets = (config?: AxiosRequestConfig): Promise<PromptPreset[]> =>
	listPromptPresets({ category: "style" }, config);

// —— 向后兼容导出（其他分类 = 旧的可复用提示词条目）——
export type PromptEntry = PromptPreset;
export const promptsKey = promptPresetsKey;
export const listPrompts = (config?: AxiosRequestConfig): Promise<PromptPreset[]> =>
	listPromptPresets({ category: "extra" }, config);
