import httpClient from "@/shared/lib/http";
import { apiURL } from "@/shared/lib/api-base";
import type { ApiResponse } from "@/types/api";

export type PromptPackSource = "default" | "imported" | "local";

export interface PromptPack {
	id: string;
	name: string;
	version: string;
	releaseId?: string;
	author?: string;
	description?: string;
	source: PromptPackSource;
	origin?: string;
	enabled: boolean;
	createdAt?: string;
	updatedAt?: string;
	skillCount?: number;
	promptCount?: number;
}

export type PromptPackEntryKind = "skill" | "prompt";

export interface PromptPackEntry {
	id: string;
	packId: string;
	releaseId?: string;
	sourcePackageId?: string;
	sourceReleaseId?: string;
	kind: PromptPackEntryKind;
	slug: string;
	name: string;
	title?: string;
	description?: string;
	body: string;
	metadata?: Record<string, unknown>;
	source: "pack" | "user";
	overriddenFrom?: string;
	linked?: boolean;
	referenceEntryId?: string;
	referencePackId?: string;
	referenceSlug?: string;
	referenceSource?: "pack" | "user";
	referenceEditable?: boolean;
	referenceMissing?: boolean;
}

export interface PromptPackCategory {
	id: string;
	packId: string;
	label: string;
	order?: number;
	source: "pack" | "user";
	builtin?: boolean;
}

export interface PromptPackContents {
	pack: PromptPack;
	entries: PromptPackEntry[];
	categories?: PromptPackCategory[];
}

export interface PromptPackEntryReference {
	packId: string;
	kind: PromptPackEntryKind;
	slug: string;
}

interface PromptPacksResponse {
	packs: PromptPack[];
}

export const promptPacksKey = "/packs";

export const listPromptPacks = async (): Promise<PromptPack[]> => {
	const response = await httpClient.get<PromptPacksResponse>(promptPacksKey);
	return response.data.packs;
};

export interface CreatePromptPackInput {
	id: string;
	name: string;
	version?: string;
	author?: string;
	description?: string;
}

export const createPromptPack = async (input: CreatePromptPackInput): Promise<PromptPack> => {
	const response = await httpClient.post<PromptPack>(promptPacksKey, input);
	return response.data;
};

export const promptPackContentsKey = (id: string) =>
	`${promptPacksKey}/${encodeURIComponent(id)}/contents`;

export const getPromptPackContents = async (id: string): Promise<PromptPackContents> => {
	const response = await httpClient.get<PromptPackContents>(promptPackContentsKey(id));
	return response.data;
};

export interface PromptPackCategoryInput {
	id?: string;
	label: string;
	order: number;
}

const promptPackCategoriesKey = (packId: string) =>
	`${promptPacksKey}/${encodeURIComponent(packId)}/categories`;

export const createPromptPackCategory = async (
	packId: string,
	input: Required<Pick<PromptPackCategoryInput, "id">> & PromptPackCategoryInput,
): Promise<PromptPackCategory> => {
	const response = await httpClient.post<PromptPackCategory>(
		promptPackCategoriesKey(packId),
		input,
	);
	return response.data;
};

export const updatePromptPackCategory = async (
	packId: string,
	categoryId: string,
	input: PromptPackCategoryInput,
): Promise<PromptPackCategory> => {
	const response = await httpClient.put<PromptPackCategory>(
		`${promptPackCategoriesKey(packId)}/${encodeURIComponent(categoryId)}`,
		input,
	);
	return response.data;
};

export const deletePromptPackCategory = async (
	packId: string,
	categoryId: string,
	replacementCategoryId: string,
): Promise<void> => {
	await httpClient.delete(`${promptPackCategoriesKey(packId)}/${encodeURIComponent(categoryId)}`, {
		data: { replacementCategoryId },
	});
};

export const copyPromptPackEntries = async (
	id: string,
	entries: PromptPackEntryReference[],
): Promise<PromptPackEntry[]> => {
	const response = await httpClient.post<{ entries: PromptPackEntry[] }>(
		`${promptPacksKey}/${encodeURIComponent(id)}/entries/copy`,
		{ entries },
	);
	return response.data.entries;
};

export const detachPromptPackEntry = async (
	packId: string,
	entryId: string,
): Promise<PromptPackEntry> => {
	const response = await httpClient.post<PromptPackEntry>(
		`${promptPacksKey}/${encodeURIComponent(packId)}/entries/detach`,
		{ entryId },
	);
	return response.data;
};

export interface UpdatePromptPackEntryInput {
	name?: string;
	description?: string;
	body: string;
	metadata?: Record<string, unknown>;
}

export interface CreatePromptPackEntryInput {
	categoryId?: string;
	kind: PromptPackEntryKind;
	slug: string;
}

export const createPromptPackEntry = async (
	packId: string,
	input: CreatePromptPackEntryInput,
): Promise<PromptPackEntry> => {
	const response = await httpClient.post<PromptPackEntry>(
		`${promptPacksKey}/${encodeURIComponent(packId)}/entries`,
		input,
	);
	return response.data;
};

export const updatePromptPackEntry = async (
	packId: string,
	entryId: string,
	input: UpdatePromptPackEntryInput,
): Promise<PromptPackEntry> => {
	const response = await httpClient.put<PromptPackEntry>(
		`${promptPacksKey}/${encodeURIComponent(packId)}/entries`,
		{ entryId, ...input },
	);
	return response.data;
};

export const resetPromptPackEntry = async (
	packId: string,
	entryId: string,
): Promise<PromptPackEntry> => {
	const response = await httpClient.post<PromptPackEntry>(
		`${promptPacksKey}/${encodeURIComponent(packId)}/entries/reset`,
		{ entryId },
	);
	return response.data;
};

export const removePromptPackEntry = async (packId: string, entryId: string): Promise<void> => {
	await httpClient.post(`${promptPacksKey}/${encodeURIComponent(packId)}/entries/remove`, {
		entryId,
	});
};

export interface ExportPromptPackResult {
	blob: Blob;
	fileName: string;
}

export const promptPackExportFileName = (
	pack: Pick<PromptPack, "id" | "name" | "version">,
): string => {
	const sanitizeSegment = (value: string, maxLength: number) => {
		const withoutControls = Array.from(value, (character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f ? "-" : character;
		}).join("");
		return withoutControls
			.replace(/[<>:"/\\|?*]/g, "-")
			.replace(/\s+/g, " ")
			.replace(/-+/g, "-")
			.replace(/^[ ._-]+|[ ._-]+$/g, "")
			.slice(0, maxLength);
	};
	const readableName = sanitizeSegment(pack.name.trim() || pack.id, 96);
	const version = sanitizeSegment(pack.version.trim().replace(/^[vV]/, ""), 32) || "1.0.0";
	return `${readableName || "prompt-pack"}-v${version}.mgpack`;
};

export const exportPromptPack = async (id: string): Promise<ExportPromptPackResult> => {
	const response = await fetch(apiURL(`/packs/${encodeURIComponent(id)}/export`), {
		headers: authHeaders(),
	});
	if (!response.ok) throw await apiFetchError(response);
	return {
		blob: await response.blob(),
		fileName: fileNameFromContentDisposition(response.headers.get("content-disposition")),
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
	if (utf8Match?.[1]) {
		try {
			return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ""));
		} catch {
			return "";
		}
	}
	const asciiMatch = /filename="?([^";]+)"?/i.exec(value);
	return asciiMatch?.[1] ?? "";
};
