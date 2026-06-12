import httpClient from "@/shared/lib/http";

export type MediaAssetKind = "image" | "video";

export interface MediaAsset {
	id: string;
	kind: MediaAssetKind;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	url: string;
	sourceUrl?: string;
	projectId?: string;
	durationSeconds?: number;
	width?: number;
	height?: number;
	posterUrl?: string;
	metadataStatus?: "ready" | "failed" | string;
	metadataError?: string;
	metadataUpdatedAt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface MediaAssetsResponse {
	assets: MediaAsset[];
}

export interface GeneratedMediaFileSaveRequest {
	directory: string;
	filename: string;
	assetId?: string;
	kind: MediaAssetKind;
	mimeType?: string;
	sourceUrl?: string;
}

export interface GeneratedMediaFileSaveResponse {
	path: string;
	filename: string;
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

export const saveGeneratedMediaFile = async (payload: GeneratedMediaFileSaveRequest) => {
	const response = await httpClient.post<GeneratedMediaFileSaveResponse>(
		"/media-assets/save-generated-file",
		payload,
		{ timeout: 1_000_000 },
	);
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
