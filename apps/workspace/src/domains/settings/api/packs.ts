import httpClient from "@/shared/lib/http";

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

interface InstallPromptPackInput {
	path: string;
}

export const promptPacksKey = "/packs";

export const listPromptPacks = async (): Promise<PromptPack[]> => {
	const response = await httpClient.get<PromptPacksResponse>(promptPacksKey);
	return response.data.packs;
};

export const installPromptPack = async (path: string): Promise<PromptPack> => {
	const response = await httpClient.post<PromptPack>("/packs/install", {
		path,
	} satisfies InstallPromptPackInput);
	return response.data;
};

export const setPromptPackEnabled = async (id: string, enabled: boolean): Promise<PromptPack> => {
	const response = await httpClient.patch<PromptPack>(`/packs/${encodeURIComponent(id)}`, {
		enabled,
	});
	return response.data;
};

export const uninstallPromptPack = async (id: string): Promise<void> => {
	await httpClient.delete(`/packs/${encodeURIComponent(id)}`);
};
