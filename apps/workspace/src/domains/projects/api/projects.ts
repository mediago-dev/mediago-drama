import httpClient from "@/shared/lib/http";
import type { PromptPresetCategory } from "@/domains/generation/api/prompt-presets";
import type {
	CreateWorkspaceProjectRequest as GeneratedCreateWorkspaceProjectRequest,
	ProjectBrief,
	ProjectBriefPatch,
} from "@/api/types/documents";
import {
	productionTemplateById,
	productionStageStates,
	productionTemplateSnapshot,
	type ProductionTemplateSnapshot,
} from "@/lib/production/production-templates";
import type {
	ProductionStageRuntimeState,
	ProductionStageState,
} from "@/lib/production/production-templates";

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
	production?: ProjectProductionState;
	coverAssetId?: string;
	sortOrder?: number;
	/** 用户指定的项目最终输出目录；为空时使用项目默认媒体目录。 */
	outputDirectory?: string;
}

export interface WorkspaceProjectsPayload {
	workspaceDir: string;
	databasePath: string;
	projects: WorkspaceProject[];
}

export interface ProjectOverviewConfig {
	categoryDefaults?: ProjectCategoryDefaults;
	production?: ProjectProductionState;
	coverAssetId?: string;
	sortOrder?: number;
	outputDirectory?: string;
}

export interface ProjectProductionState {
	template: ProductionTemplateSnapshot;
	stageStates?: Record<string, ProductionStageRuntimeState>;
	currentStageId?: string;
	overallProgress: number;
	aspectRatio?: string;
	resolution?: string;
	targetDuration?: string;
	coreAssetCount: number;
	shotCount: number;
	completedShotCount: number;
	reviewShotCount: number;
	version: string;
	updatedAt: string;
	blockers?: string[];
	nextAction?: string;
	/** Durable stage execution gates shared by the workbench, generation and review views. */
	workbenchStates?: Record<string, ProductionWorkbenchExecutionState>;
	/** Structured QC records. Kept separate from stage state so one stage can have many checks. */
	qcResults?: Record<string, ProjectQCResult>;
	/** Immutable-ish production versions for assets, shots, tasks and outputs. */
	versions?: ProjectVersionRecord[];
	/** Durable copy/archive index for files written to the user-selected output directory. */
	outputArchives?: ProjectOutputArchiveRecord[];
	/** Project-level retrospective that can be reused by later projects. */
	retrospective?: ProjectRetrospective;
	/** Shared production memory; every stage can read/write these fields. */
	sharedContext?: ProjectSharedContext;
	referenceTransfer?: {
		draft: unknown;
		references: Array<{ id: string; name: string; purposes: string[]; url?: string }>;
		/** 证据、Visual DNA、映射与输出 Prompt 的可追溯文档。 */
		styleTransferDocumentId?: string;
		updatedAt?: string;
	};
	/**
	 * 项目生产关系图：把参考图、文档、资产、镜头、生成任务和输出串起来。
	 * 关系图是追加式记录，替换资产或视频时不覆盖历史节点。
	 */
	productionGraph?: ProjectProductionGraph;
	/**
	 * 已确认分镜拆出的独立镜头。与分镜示意图保持来源关系，供资产、单镜和动态阶段复用。
	 */
	shots?: ProjectShotRecord[];
}

export interface ProjectShotRecord {
	id: string;
	sequence: number;
	shotCode: string;
	title: string;
	storyboardAssetId?: string;
	/** 归一化裁切区域，便于前端无损预览分镜格。 */
	storyboardCrop?: { x: number; y: number; width: number; height: number };
	storyboardImagePath?: string;
	description?: string;
	prompt?: string;
	assetIds?: string[];
	status: ProductionStageState;
	completion: number;
	firstFrameAssetId?: string;
	lastFrameAssetId?: string;
	/** 第 06 步的画面意图，和生成 Prompt 分开保存，便于审核与返工。 */
	visualLogic?: string;
	/** 景别、机位、构图、焦点和镜头运动意图。 */
	cameraLanguage?: string;
	/** 从上一镜接入及交给下一镜的显式规则。 */
	continuityIn?: string;
	continuityOut?: string;
	/** 已确认的单镜执行图 Prompt；不能用通用资产 Prompt 替代。 */
	executionPrompt?: string;
	motionPrompt?: string;
	updatedAt: string;
}

export type ProjectProductionGraphNodeType =
	| "reference"
	| "document"
	| "visual-dna"
	| "asset"
	| "shot"
	| "frame"
	| "generation-task"
	| "video"
	| "output";

export interface ProjectProductionGraphNode {
	id: string;
	type: ProjectProductionGraphNodeType;
	title: string;
	assetId?: string;
	documentId?: string;
	shotId?: string;
	taskId?: string;
	versionId?: string;
	status?: string;
	path?: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface ProjectProductionGraphEdge {
	from: string;
	to: string;
	relation:
		| "derived-from"
		| "uses"
		| "generated-by"
		| "belongs-to"
		| "replaced-by"
		| "reviewed-in"
		| "continues-to"
		| "archived-in";
	createdAt: string;
}

export interface ProjectProductionGraph {
	nodes: ProjectProductionGraphNode[];
	edges: ProjectProductionGraphEdge[];
	updatedAt: string;
}

export type ProjectQCEntityType = "asset" | "shot" | "video" | "stage" | "output";
export type ProjectQCStatus = "PASS" | "NEEDS_FIX" | "BLOCKED" | "MISSING";

export interface ProjectQCCheck {
	id: string;
	label: string;
	status: ProjectQCStatus | "NOT_CHECKED";
	severity?: "P0" | "P1" | "P2";
	note?: string;
}

export interface ProjectQCResult {
	id: string;
	entityType: ProjectQCEntityType;
	entityId: string;
	stageId?: string;
	status: ProjectQCStatus;
	checks: ProjectQCCheck[];
	issues?: string[];
	reviewer?: string;
	reviewedAt: string;
	versionId?: string;
}

export interface ProjectVersionRecord {
	id: string;
	entityType: "asset" | "shot" | "task" | "output";
	entityId: string;
	version: string;
	status: "DRAFT" | "PASS" | "FAIL" | "REGEN" | "MISSING";
	label?: string;
	prompt?: string;
	negativePrompt?: string;
	model?: string;
	provider?: string;
	params?: Record<string, unknown>;
	referenceIds?: string[];
	outputPath?: string;
	note?: string;
	createdAt: string;
	updatedAt?: string;
}

/**
 * 生成结果复制到用户指定目录后的持久化索引。
 * 不能只放在 React 内存里，否则重启 App 后会再次复制同一版本，
 * 也无法追溯文件来自哪个任务、版本和输出目录。
 */
export interface ProjectOutputArchiveRecord {
	id: string;
	taskId: string;
	assetId?: string;
	/** 生成结果所属镜头；外部归档后仍可回到镜头链路。 */
	shotId?: string;
	/** 归档时使用的语义版本，例如 V02。 */
	version?: string;
	versionId?: string;
	outputDirectory: string;
	outputPath: string;
	filename: string;
	kind: "image" | "video" | "audio" | "other";
	createdAt: string;
}

export interface ProjectRetrospective {
	status: "DRAFT" | "READY" | "ARCHIVED";
	conclusion?: string;
	successes: string[];
	failures: string[];
	reusablePrompts: string[];
	reusableRules: string[];
	nextProjectNotes: string[];
	updatedAt: string;
}

export interface ProjectSharedContext {
	projectBrief?: string;
	/** 已确认的故事梗概，独立于完整剧情脚本。 */
	storyOutline?: string;
	script?: string;
	/** 阶段工作台产生的、可被下游阶段直接读取的结构化工作稿。 */
	storyboardBrief?: string;
	shotBreakdown?: string;
	assetPlan?: string;
	motionPlan?: string;
	finalReviewNotes?: string;
	approvedContent?: string[];
	rejectedContent?: string[];
	visualDNA?: Record<string, unknown>;
	characters?: string[];
	scenes?: string[];
	props?: string[];
	shotRules?: string[];
	references?: string[];
	approvedAssets?: string[];
	prompts?: Record<string, string>;
	negativePrompts?: Record<string, string>;
	generationHistory?: string[];
	blockers?: string[];
	reviewNotes?: string[];
	/** 来自已标记“可复用”的历史项目，创建新项目时只做参考预填，不覆盖本项目内容。 */
	reusablePrompts?: string[];
	reusableRules?: string[];
	reusableCases?: string[];
	reusableVisualDNA?: Array<Record<string, unknown>>;
	outputDirectory?: string;
	updatedAt?: string;
}

export type ProductionWorkbenchPhase = "analysis" | "confirm" | "execute" | "review";

export interface ProductionWorkbenchExecutionState {
	phase: ProductionWorkbenchPhase;
	analysis?: {
		facts: string[];
		unknowns: string[];
		risks: string[];
	};
	confirmation?: {
		confirmed: boolean;
		confirmedAt?: string;
	};
	execution?: {
		taskIds: string[];
		startedAt?: string;
	};
	review?: {
		status: Extract<ProductionStageState, "PASS" | "NEEDS_FIX" | "BLOCKED">;
		notes: string;
		reviewedAt?: string;
	};
	note: string;
	updatedAt: string;
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
	categoryDefaults?: ProjectCategoryDefaults | null;
	production?: ProjectProductionState;
	coverAssetId?: string;
	sortOrder?: number;
	outputDirectory?: string | null;
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

export interface UpdateWorkspaceProjectRequest {
	name: string;
}

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

export const updateProject = async (projectId: string, payload: UpdateWorkspaceProjectRequest) => {
	const response = await httpClient.patch<WorkspaceProject>(
		`${projectsKey}/${encodeURIComponent(projectId)}`,
		payload,
	);
	return response.data;
};

export const projectConfigKey = (projectId: string) =>
	`${projectsKey}/${encodeURIComponent(projectId)}/config`;

export const getProjectConfig = async (projectId: string) => {
	const response = await httpClient.get<ProjectConfig>(projectConfigKey(projectId));
	return normalizeProjectConfig(response.data);
};

export interface ReusableProductionMemory {
	reusablePrompts: string[];
	reusableRules: string[];
	reusableCases: string[];
	reusableVisualDNA: Array<Record<string, unknown>>;
}

/**
 * 只负责合并已审核通过的复盘记忆，便于测试，也避免新项目创建逻辑
 * 把“复用什么”与“怎么读取项目配置”混在一起。
 */
export const mergeReusableProductionMemory = (
	memories: Array<Partial<ReusableProductionMemory>>,
): ReusableProductionMemory => {
	const unique = (values: string[]) =>
		[...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
	return {
		reusablePrompts: unique(memories.flatMap((memory) => memory.reusablePrompts ?? [])),
		reusableRules: unique(memories.flatMap((memory) => memory.reusableRules ?? [])),
		reusableCases: unique(memories.flatMap((memory) => memory.reusableCases ?? [])),
		reusableVisualDNA: memories
			.flatMap((memory) => memory.reusableVisualDNA ?? [])
			.filter((value): value is Record<string, unknown> =>
				Boolean(value && typeof value === "object"),
			)
			.slice(0, 20),
	};
};

/**
 * 从已经明确标记为“可复用”的项目中汇总制作经验。
 * 失败的旧项目、未完成复盘的项目不会偷偷污染新项目上下文；读取失败的项目
 * 也会被跳过，保证“新建项目”主流程仍然可用。
 */
export const collectReusableProductionMemory = async (
	projects: WorkspaceProject[],
	excludeProjectId?: string,
): Promise<ReusableProductionMemory> => {
	const candidates = projects.filter((project) => project.id !== excludeProjectId);
	const configs = await Promise.all(
		candidates.map(async (project) => {
			try {
				return await getProjectConfig(project.id);
			} catch {
				return null;
			}
		}),
	);
	const ready = configs
		.filter((config): config is ProjectConfig =>
			Boolean(config?.overview.production?.retrospective),
		)
		.filter((config) => config.overview.production?.retrospective?.status === "READY")
		.sort((left, right) =>
			(right.overview.production?.retrospective?.updatedAt ?? "").localeCompare(
				left.overview.production?.retrospective?.updatedAt ?? "",
			),
		);
	return mergeReusableProductionMemory(
		ready.map((config) => ({
			reusablePrompts: config.overview.production?.retrospective?.reusablePrompts ?? [],
			reusableRules: config.overview.production?.retrospective?.reusableRules ?? [],
			reusableCases: [
				...(config.overview.production?.retrospective?.failures ?? []),
				...(config.overview.production?.retrospective?.nextProjectNotes ?? []),
			],
			reusableVisualDNA: config.overview.production?.sharedContext?.visualDNA
				? [config.overview.production.sharedContext.visualDNA]
				: [],
		})),
	);
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

type ProjectProductionMutation = (
	production: ProjectProductionState,
) => ProjectProductionState | null | Promise<ProjectProductionState | null>;

// The server stores production as one JSON object. Keep all feature-level
// production writes for a project in one client-side queue so reference
// autosave, workbench memory, stage state and output archiving cannot overwrite
// one another with stale snapshots.
const productionMutationQueues = new Map<string, Promise<void>>();

export const updateProjectProduction = (projectId: string, mutator: ProjectProductionMutation) => {
	const previous = productionMutationQueues.get(projectId) ?? Promise.resolve();
	const run = async () => {
		const latest = await getProjectConfig(projectId);
		const production =
			normalizeProjectProductionState(latest.overview.production) ??
			createInitialCommercialProductionState();
		const next = await mutator(production);
		if (!next) return;
		await updateProjectConfig(projectId, {
			overview: { production: next },
		});
	};
	const queued = previous.then(run, run);
	productionMutationQueues.set(
		projectId,
		queued.catch(() => undefined),
	);
	return queued;
};

const createInitialCommercialProductionState = (): ProjectProductionState => {
	const template = productionTemplateById("commercial-film");
	const now = new Date().toISOString();
	return {
		template: productionTemplateSnapshot(template),
		stageStates: productionStageStates(template),
		currentStageId: template.stages[0]?.id,
		overallProgress: 0,
		coreAssetCount: 0,
		shotCount: 0,
		completedShotCount: 0,
		reviewShotCount: 0,
		version: "V01",
		updatedAt: now,
		blockers: [],
		nextAction: `完成“${template.stages[0]?.title ?? "创意与分镜定稿"}”并提交审核。`,
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
		categoryDefaults: config?.overview?.categoryDefaults ?? {},
		production: normalizeProjectProductionState(config?.overview?.production),
		coverAssetId: config?.overview?.coverAssetId ?? "",
		sortOrder: config?.overview?.sortOrder,
		outputDirectory: config?.overview?.outputDirectory ?? "",
	},
	createdAt: config?.createdAt ?? "",
});

export const normalizeProjectProductionState = (
	production: ProjectProductionState | undefined,
): ProjectProductionState | undefined => {
	if (!production) return undefined;
	const canUpgradeUntouchedCommercialWorkflow =
		production.template?.id === "commercial-film" &&
		(production.template.version ?? 0) < 4 &&
		Object.values(production.stageStates ?? {}).every(
			(state) => !state.status || state.status === "NOT_STARTED",
		) &&
		production.template.stages.every((stage) => {
			const legacy = stage as typeof stage & { status?: ProductionStageState };
			return !legacy.status || legacy.status === "NOT_STARTED";
		});
	// V2 把需求、脚本和分镜塞在同一个“序章”里。只自动升级尚未推进状态的项目；
	// 已经正式推进过的旧项目继续使用创建时快照，避免阶段状态错位和历史数据丢失。
	const needsCommercialAssetStageMerge =
		production.template?.id === "commercial-film" &&
		(production.template.version ?? 0) >= 4 &&
		(production.template.version ?? 0) < 5;
	// V6 曾短暂替换过用户熟悉的商业广告操作顺序。读取到该快照时回到 V5，
	// 同时把已经产生的阶段状态和工作台记录映射回原流程。
	const needsCommercialWorkflowV6Rollback =
		production.template?.id === "commercial-film" && (production.template.version ?? 0) === 6;
	const template =
		canUpgradeUntouchedCommercialWorkflow ||
		needsCommercialAssetStageMerge ||
		needsCommercialWorkflowV6Rollback
			? productionTemplateSnapshot(productionTemplateById("commercial-film"))
			: production.template;
	const legacyStages = template?.stages ?? [];
	const mergeStageStatus = (
		left?: ProductionStageRuntimeState,
		right?: ProductionStageRuntimeState,
	) => {
		const rank: Record<ProductionStageState, number> = {
			NOT_STARTED: 0,
			IN_PROGRESS: 1,
			NEEDS_FIX: 2,
			BLOCKED: 3,
			REVIEW: 4,
			PASS: 5,
		};
		const selected =
			(rank[left?.status ?? "NOT_STARTED"] >= rank[right?.status ?? "NOT_STARTED"]
				? left
				: right) ??
			left ??
			right;
		return selected ?? { status: "NOT_STARTED" as const, documentId: "" };
	};
	const stageStates = canUpgradeUntouchedCommercialWorkflow
		? Object.fromEntries(
				legacyStages.map((stage) => [
					stage.id,
					{
						status: "NOT_STARTED" as const,
						documentId: `production-commercial-film-v5-stage-${String(stage.order).padStart(2, "0")}`,
					},
				]),
			)
		: needsCommercialAssetStageMerge
			? (() => {
					const old = production.stageStates ?? {};
					const remap: Record<string, string[]> = {
						"stage-1": ["stage-1"],
						"stage-2": ["stage-2"],
						"stage-3": ["stage-3", "stage-4"],
						"stage-4": ["stage-5"],
						"stage-5": ["stage-6"],
						"stage-6": ["stage-7"],
						"stage-7": ["stage-8"],
						"stage-8": ["stage-9"],
						"stage-9": ["stage-10"],
					};
					return Object.fromEntries(
						Object.entries(remap).map(([nextId, previousIds]) => [
							nextId,
							previousIds.length === 1
								? (old[previousIds[0]] ?? { status: "NOT_STARTED" as const, documentId: "" })
								: mergeStageStatus(old[previousIds[0]], old[previousIds[1]]),
						]),
					);
				})()
			: needsCommercialWorkflowV6Rollback
				? (() => {
						const old = production.stageStates ?? {};
						const remap: Record<string, string[]> = {
							"stage-1": ["stage-1", "stage-2"],
							"stage-2": ["stage-4", "stage-5"],
							"stage-3": ["stage-3"],
							"stage-4": ["stage-6"],
							"stage-5": ["stage-5"],
							"stage-6": ["stage-7"],
							"stage-7": ["stage-8"],
							"stage-8": ["stage-9"],
							"stage-9": ["stage-10"],
						};
						return Object.fromEntries(
							Object.entries(remap).map(([nextId, previousIds]) => [
								nextId,
								previousIds.length === 1
									? (old[previousIds[0]] ?? {
											status: "NOT_STARTED" as const,
											documentId: "",
										})
									: mergeStageStatus(old[previousIds[0]], old[previousIds[1]]),
							]),
						);
					})()
				: { ...production.stageStates };
	const stages = legacyStages.map((stage) => {
		const legacy = stage as typeof stage & {
			status?: ProductionStageState;
			documentId?: string;
		};
		if (!stageStates[stage.id]) {
			stageStates[stage.id] = {
				status: legacy.status ?? "NOT_STARTED",
				documentId: legacy.documentId ?? "",
			};
		}
		const { status: _status, documentId: _documentId, ...definition } = legacy;
		return definition;
	});
	return {
		...production,
		template: { ...template, stages },
		stageStates,
		...(canUpgradeUntouchedCommercialWorkflow
			? {
					currentStageId: "stage-1",
					overallProgress: 0,
					nextAction: "上传参考图并说明项目目标，让制作助理先理解需求。",
					workbenchStates: {},
				}
			: {}),
		...(needsCommercialAssetStageMerge
			? {
					currentStageId:
						(
							{
								"stage-1": "stage-1",
								"stage-2": "stage-2",
								"stage-3": "stage-3",
								"stage-4": "stage-3",
								"stage-5": "stage-4",
								"stage-6": "stage-5",
								"stage-7": "stage-6",
								"stage-8": "stage-7",
								"stage-9": "stage-8",
								"stage-10": "stage-9",
							} as Record<string, string>
						)[production.currentStageId ?? "stage-1"] ?? "stage-1",
					workbenchStates: Object.fromEntries(
						Object.entries(production.workbenchStates ?? {}).map(([stageId, value]) => [
							(
								{
									"stage-4": "stage-3",
									"stage-5": "stage-4",
									"stage-6": "stage-5",
									"stage-7": "stage-6",
									"stage-8": "stage-7",
									"stage-9": "stage-8",
									"stage-10": "stage-9",
								} as Record<string, string>
							)[stageId] ?? stageId,
							value,
						]),
					),
				}
			: {}),
		...(needsCommercialWorkflowV6Rollback
			? {
					currentStageId:
						(
							{
								"stage-1": "stage-1",
								"stage-2": "stage-1",
								"stage-3": "stage-3",
								"stage-4": "stage-2",
								"stage-5": "stage-5",
								"stage-6": "stage-4",
								"stage-7": "stage-6",
								"stage-8": "stage-7",
								"stage-9": "stage-8",
								"stage-10": "stage-9",
							} as Record<string, string>
						)[production.currentStageId ?? "stage-1"] ?? "stage-1",
					workbenchStates: Object.fromEntries(
						Object.entries(production.workbenchStates ?? {}).map(([stageId, value]) => [
							(
								{
									"stage-2": "stage-1",
									"stage-4": "stage-2",
									"stage-6": "stage-4",
									"stage-7": "stage-6",
									"stage-8": "stage-7",
									"stage-9": "stage-8",
									"stage-10": "stage-9",
								} as Record<string, string>
							)[stageId] ?? stageId,
							value,
						]),
					),
				}
			: {}),
		shots: Array.isArray(production.shots)
			? production.shots
					.filter((shot) => shot && typeof shot.id === "string")
					.map((shot, index) => ({
						...shot,
						sequence: Number.isFinite(shot.sequence) ? shot.sequence : index + 1,
						shotCode: shot.shotCode || `S${String(index + 1).padStart(2, "0")}`,
						status: shot.status || "NOT_STARTED",
						completion: Number.isFinite(shot.completion) ? shot.completion : 0,
						updatedAt: shot.updatedAt || production.updatedAt,
					}))
					.sort((left, right) => left.sequence - right.sequence)
			: undefined,
		productionGraph: production.productionGraph
			? {
					nodes: Array.isArray(production.productionGraph.nodes)
						? production.productionGraph.nodes
						: [],
					edges: Array.isArray(production.productionGraph.edges)
						? production.productionGraph.edges
						: [],
					updatedAt: production.productionGraph.updatedAt ?? production.updatedAt,
				}
			: undefined,
	};
};

export const projectProductionStages = (production: ProjectProductionState | undefined) =>
	[...(production?.template.stages ?? [])]
		.map((stage) => ({
			...stage,
			...(production?.stageStates?.[stage.id] ?? {
				status: "NOT_STARTED" as const,
				documentId: "",
			}),
		}))
		.sort((left, right) => left.order - right.order);
