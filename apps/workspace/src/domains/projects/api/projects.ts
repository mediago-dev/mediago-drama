import httpClient from "@/shared/lib/http";
import type { PromptLayer } from "@/domains/generation/api/prompt-presets";
import type {
	CreateWorkspaceProjectRequest as GeneratedCreateWorkspaceProjectRequest,
	ProjectBrief,
	ProjectBriefPatch,
} from "@/api/types/documents";

// 项目每层默认预设：层 → 预设 id。
export type ProjectLayerDefaults = Partial<Record<PromptLayer, string>>;

export const projectsKey = "/projects";

export interface WorkspaceProject {
	id: string;
	name: string;
	description: string;
	projectDir?: string;
	relativeDir: string;
	documentCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface WorkspaceProjectsPayload {
	workspaceDir: string;
	databasePath: string;
	projects: WorkspaceProject[];
}

export interface ProjectOverviewConfig {
	style: string;
	layerDefaults?: ProjectLayerDefaults;
}

export interface ProjectConfig {
	schemaVersion: 1;
	projectId: string;
	name: string;
	description: string;
	overview: ProjectOverviewConfig;
	createdAt: string;
}

export interface ProjectOverviewConfigPatch {
	style?: string | null;
	layerDefaults?: ProjectLayerDefaults | null;
}

export interface ProjectConfigPatch {
	overview?: ProjectOverviewConfigPatch | null;
}

export interface ProjectConfigMutationResult {
	config: ProjectConfig;
	changed: boolean;
}

export type { ProjectBrief, ProjectBriefPatch } from "@/api/types/documents";

export type CreateWorkspaceProjectRequest = Partial<GeneratedCreateWorkspaceProjectRequest>;

export const getProjects = async () => {
	const response = await httpClient.get<WorkspaceProjectsPayload>(projectsKey);
	return response.data;
};

export const createProject = async (payload: CreateWorkspaceProjectRequest) => {
	const response = await httpClient.post<WorkspaceProject>(projectsKey, payload);
	return response.data;
};

export const projectConfigKey = (projectId: string) =>
	`${projectsKey}/${encodeURIComponent(projectId)}/config`;

export const getProjectConfig = async (projectId: string) => {
	const response = await httpClient.get<ProjectConfig>(projectConfigKey(projectId));
	return normalizeProjectConfig(response.data);
};

export const updateProjectConfig = async (projectId: string, payload: ProjectConfigPatch) => {
	const response = await httpClient.patch<ProjectConfigMutationResult>(
		projectConfigKey(projectId),
		payload,
	);
	return {
		...response.data,
		config: normalizeProjectConfig(response.data.config),
	};
};

export const projectBriefKey = (projectId: string) =>
	`${projectsKey}/${encodeURIComponent(projectId)}/brief`;

export const getProjectBrief = async (projectId: string) => {
	const response = await httpClient.get<ProjectBrief>(projectBriefKey(projectId));
	return normalizeProjectBrief(response.data);
};

export const updateProjectBrief = async (projectId: string, payload: ProjectBriefPatch) => {
	const response = await httpClient.put<ProjectBrief>(projectBriefKey(projectId), payload);
	return normalizeProjectBrief(response.data);
};

export const deleteProject = async (projectId: string) => {
	const response = await httpClient.delete<WorkspaceProject>(
		`${projectsKey}/${encodeURIComponent(projectId)}`,
	);
	return response.data;
};

const normalizeProjectBrief = (brief: Partial<ProjectBrief> | undefined): ProjectBrief => ({
	medium: brief?.medium ?? "",
	genre: brief?.genre ?? "",
	pacing: brief?.pacing ?? "",
	audience: brief?.audience ?? "",
	tone: brief?.tone ?? "",
	style: brief?.style ?? "",
	references: brief?.references ?? "",
	notes: brief?.notes ?? "",
	updatedAt: brief?.updatedAt ?? "",
});

const normalizeProjectConfig = (config: Partial<ProjectConfig> | undefined): ProjectConfig => ({
	schemaVersion: 1,
	projectId: config?.projectId ?? "",
	name: config?.name ?? "",
	description: config?.description ?? "",
	overview: {
		style: config?.overview?.style ?? "",
		layerDefaults: config?.overview?.layerDefaults ?? {},
	},
	createdAt: config?.createdAt ?? "",
});
