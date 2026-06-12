import type { AxiosRequestConfig } from "axios";
import { createResource } from "@/shared/lib/api-factory";
import httpClient from "@/shared/lib/http";

export type PromptPresetSource = "builtin" | "user";

// 固定的提示词层(库内可复用的"积木")。
export type PromptLayer = "style" | "extra";

export type PromptPresetKind = "image" | "text" | "video";
// 旧的类型维度,已被 layer 取代,仅保留兼容字段。
export type PromptPresetType = "image" | "video";

export interface PromptPreset {
	id: string;
	name: string;
	layer: PromptLayer;
	type?: PromptPresetType;
	kind?: PromptPresetKind;
	category?: string;
	prompt: string;
	source: PromptPresetSource;
	builtin?: boolean;
}

export interface PromptPresetFilter {
	layer?: PromptLayer;
	kind?: PromptPresetKind;
	type?: PromptPresetType;
}

export const promptPresetsKey = "/prompt-presets";

interface PromptPresetsResponse {
	prompts: PromptPreset[];
}

export type PromptPresetInput = Pick<PromptPreset, "id" | "name" | "layer" | "prompt"> &
	Partial<Pick<PromptPreset, "kind" | "type" | "category">>;

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

// 按层取预设的 SWR key（稳定且唯一）。
export const promptPresetsLayerKey = (layer: PromptLayer) => `${promptPresetsKey}?layer=${layer}`;

// —— 向后兼容导出（风格层）：消费方只需把 import 路径换到本模块 ——
export type StylePreset = PromptPreset;
export const stylePresetsKey = promptPresetsLayerKey("style");
export const listStylePresets = (config?: AxiosRequestConfig): Promise<PromptPreset[]> =>
	listPromptPresets({ layer: "style" }, config);

// —— 向后兼容导出（其他层 = 旧的可复用提示词条目）——
export type PromptEntry = PromptPreset;
export type PromptEntryKind = PromptPresetKind;
export const promptsKey = promptPresetsKey;
export const listPrompts = (
	filter: { kind?: PromptPresetKind } = {},
	config?: AxiosRequestConfig,
): Promise<PromptPreset[]> => listPromptPresets({ layer: "extra", kind: filter.kind }, config);
