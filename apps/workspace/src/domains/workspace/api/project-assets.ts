import httpClient from "@/shared/lib/http";
import type { ProjectAssetRecord } from "@/api/types/documents";

export type ProjectAssetKind = "image" | "video" | "audio" | "text" | "binary";

export type ProjectAsset = Omit<ProjectAssetRecord, "folderId" | "kind" | "parentId"> & {
	kind: ProjectAssetKind;
	parentId?: string | null;
	folderId?: string | null;
};

export interface ProjectAssetsResponse {
	assets: ProjectAsset[];
}

export interface ProjectAssetUpdateRequest {
	filename?: string;
	parentId?: string | null;
	folderId?: string | null;
	sortOrder?: number;
}

export const projectAssetsKey = (projectId: string) =>
	`/projects/${encodeURIComponent(projectId)}/assets`;

export const getProjectAssets = async (projectId: string) => {
	const response = await httpClient.get<ProjectAssetsResponse>(projectAssetsKey(projectId));
	return response.data;
};

export const uploadProjectAsset = async (
	projectId: string,
	file: File,
	options: { parentId?: string | null; folderId?: string | null; sortOrder?: number } = {},
) => {
	const formData = new FormData();
	formData.append("file", file);
	if (options.parentId) formData.append("parentId", options.parentId);
	if (options.folderId) formData.append("folderId", options.folderId);
	if (options.sortOrder !== undefined) formData.append("sortOrder", String(options.sortOrder));

	const response = await httpClient.post<ProjectAsset>(projectAssetsKey(projectId), formData, {
		headers: {
			"Content-Type": "multipart/form-data",
		},
	});
	return response.data;
};

export const updateProjectAsset = async (
	projectId: string,
	assetId: string,
	payload: ProjectAssetUpdateRequest,
) => {
	const response = await httpClient.put<ProjectAsset>(
		`${projectAssetsKey(projectId)}/${encodeURIComponent(assetId)}`,
		payload,
	);
	return response.data;
};

export const deleteProjectAsset = async (projectId: string, assetId: string) => {
	const response = await httpClient.delete<ProjectAssetsResponse>(
		`${projectAssetsKey(projectId)}/${encodeURIComponent(assetId)}`,
	);
	return response.data;
};
