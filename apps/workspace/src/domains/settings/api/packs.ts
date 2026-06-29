import httpClient from "@/shared/lib/http";
import { apiURL } from "@/shared/lib/api-base";
import type { ApiResponse } from "@/types/api";

export type PromptPackSource = "default" | "imported";

export interface PromptPack {
	id: string;
	name: string;
	version: string;
	author?: string;
	description?: string;
	source: PromptPackSource;
	origin?: string;
	enabled: boolean;
	createdAt?: string;
	updatedAt?: string;
}

interface PromptPacksResponse {
	packs: PromptPack[];
}

export const promptPacksKey = "/packs";

export const listPromptPacks = async (): Promise<PromptPack[]> => {
	const response = await httpClient.get<PromptPacksResponse>(promptPacksKey);
	return response.data.packs;
};

export interface ExportPromptPackResult {
	blob: Blob;
	fileName: string;
}

export const exportPromptPack = async (id: string): Promise<ExportPromptPackResult> => {
	const response = await fetch(apiURL(`/packs/${encodeURIComponent(id)}/export`), {
		headers: authHeaders(),
	});
	if (!response.ok) throw await apiFetchError(response);
	return {
		blob: await response.blob(),
		fileName:
			fileNameFromContentDisposition(response.headers.get("content-disposition")) || `${id}.mgpack`,
	};
};

export const importPromptPackFile = async (file: File): Promise<PromptPack> => {
	const formData = new FormData();
	formData.append("file", file);
	const response = await fetch(apiURL("/packs/import"), {
		method: "POST",
		headers: authHeaders(),
		body: formData,
	});
	if (!response.ok) throw await apiFetchError(response);
	const payload = (await response.json()) as ApiResponse<PromptPack>;
	if (!payload.success) throw new Error(payload.message || "导入失败");
	return payload.data;
};

export const setPromptPackEnabled = async (id: string, enabled: boolean): Promise<PromptPack> => {
	const response = await httpClient.patch<PromptPack>(`/packs/${encodeURIComponent(id)}`, {
		enabled,
	});
	return response.data;
};

export const resetPromptPack = async (id: string): Promise<PromptPack> => {
	const response = await httpClient.post<PromptPack>(`/packs/${encodeURIComponent(id)}/reset`);
	return response.data;
};

export const uninstallPromptPack = async (id: string): Promise<void> => {
	await httpClient.delete(`/packs/${encodeURIComponent(id)}`);
};

const authHeaders = () => {
	const token = localStorage.getItem("token");
	return token ? { Authorization: `Bearer ${token}` } : undefined;
};

const apiFetchError = async (response: Response) => {
	try {
		const payload = (await response.json()) as ApiResponse;
		return new Error(payload.message || response.statusText);
	} catch {
		return new Error(response.statusText || "请求失败");
	}
};

const fileNameFromContentDisposition = (value: string | null) => {
	if (!value) return "";
	const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
	if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
	const asciiMatch = /filename="?([^";]+)"?/i.exec(value);
	return asciiMatch?.[1] ?? "";
};
