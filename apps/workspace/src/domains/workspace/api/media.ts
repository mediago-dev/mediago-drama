import httpClient from "@/shared/lib/http";

export type MediaAssetKind = "image" | "video" | "audio" | "text";

export interface MediaAsset {
	id: string;
	kind: MediaAssetKind;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	url: string;
	sourceUrl?: string;
	projectId?: string;
	source?: "upload" | "generation" | "toolbox" | "preview" | string;
	conversationId?: string;
	sectionId?: string;
	relativePath?: string;
	downloadPath?: string;
	durationSeconds?: number;
	width?: number;
	height?: number;
	posterUrl?: string;
	metadataStatus?: "ready" | "failed" | string;
	metadataError?: string;
	metadataUpdatedAt?: string;
	storageStatus?: "ready" | "missing" | string;
	storageError?: string;
	createdAt: string;
	updatedAt: string;
}

export interface MediaAssetsResponse {
	assets: MediaAsset[];
}

const mediaAssetsPath = (projectId?: string | null) => {
	const id = projectId?.trim();
	return id ? `/projects/${encodeURIComponent(id)}/media-assets` : "/media-assets";
};

export const mediaAssetsKey = mediaAssetsPath();

export interface MediaAssetFilters {
	kind?: "all" | MediaAssetKind;
	projectId?: string;
	q?: string;
}

export const getMediaAssets = async (filters: MediaAssetFilters = {}) => {
	const response = await httpClient.get<MediaAssetsResponse>(mediaAssetsPath(filters.projectId), {
		params: {
			kind: filters.kind,
			q: filters.q,
		},
	});
	return response.data;
};

export const uploadMediaAsset = async (file: File, projectId?: string | null) => {
	const formData = new FormData();
	formData.append("file", file);

	const response = await httpClient.post<MediaAsset>(mediaAssetsPath(projectId), formData, {
		headers: {
			"Content-Type": "multipart/form-data",
		},
	});
	return response.data;
};

export const deleteMediaAsset = async (id: string, projectId?: string) => {
	const response = await httpClient.delete<MediaAssetsResponse>(
		`${mediaAssetsPath(projectId)}/${encodeURIComponent(id)}`,
	);
	return response.data;
};

export const updateMediaAsset = async (id: string, filename: string, projectId?: string | null) => {
	const response = await httpClient.put<MediaAsset>(
		`${mediaAssetsPath(projectId)}/${encodeURIComponent(id)}`,
		{ filename },
	);
	return response.data;
};
