import httpClient from "@/shared/lib/http";
import type { PromptPresetCategory } from "@/domains/generation/api/prompt-presets";
import type {
	CreateWorkspaceProjectRequest as GeneratedCreateWorkspaceProjectRequest,
	ProjectBrief,
	ProjectBriefPatch,
} from "@/api/types/documents";

// 项目每个提示词分类的默认预设：分类 → 预设 id。
export type ProjectCategoryDefaults = Partial<Record<PromptPresetCategory, string>>;

export const projectsKey = "/projects";

export type ProjectStatus = "active" | "archived" | "trashed";
export type ProjectStatusFilter = ProjectStatus | "all";

export interface WorkspaceProject {
	id: string;
	name: string;
	description: string;
	status?: ProjectStatus;
	projectDir?: string;
	relativeDir: string;
	documentCount: number;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	trashedAt?: string;
	originalProjectDir?: string;
	trashProjectDir?: string;
}

export interface WorkspaceProjectsPayload {
	workspaceDir: string;
	databasePath: string;
	projects: WorkspaceProject[];
}

export interface ProjectOverviewConfig {
	style: string;
	categoryDefaults?: ProjectCategoryDefaults;
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
	categoryDefaults?: ProjectCategoryDefaults | null;
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

export const projectsKeyForStatus = (status: ProjectStatusFilter = "active") =>
	status === "active" ? projectsKey : `${projectsKey}?status=${encodeURIComponent(status)}`;

export const getProjects = async (status: ProjectStatusFilter = "active") => {
	const response =
		status === "active"
			? await httpClient.get<WorkspaceProjectsPayload>(projectsKey)
			: await httpClient.get<WorkspaceProjectsPayload>(projectsKey, { params: { status } });
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

export const archiveProject = async (projectId: string) => {
	const response = await httpClient.post<WorkspaceProject>(
		`${projectsKey}/${encodeURIComponent(projectId)}/archive`,
	);
	return response.data;
};

export const restoreProject = async (projectId: string) => {
	const response = await httpClient.post<WorkspaceProject>(
		`${projectsKey}/${encodeURIComponent(projectId)}/restore`,
	);
	return response.data;
};

export const permanentlyDeleteProject = async (projectId: string) => {
	const response = await httpClient.delete<WorkspaceProject>(
		`${projectsKey}/${encodeURIComponent(projectId)}/permanent`,
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
		categoryDefaults: config?.overview?.categoryDefaults ?? {},
	},
	createdAt: config?.createdAt ?? "",
});
