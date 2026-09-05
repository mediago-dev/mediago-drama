import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	archiveProject,
	getProjects,
	normalizeProjectProductionState,
	projectProductionStages,
	permanentlyDeleteProject,
	projectsKey,
	projectsKeyForStatus,
	restoreProject,
} from "@/domains/projects/api/projects";
import httpClient from "@/shared/lib/http";
import type { ApiResponse } from "@/types/api";
import {
	productionTemplateById,
	productionTemplateSnapshot,
} from "@/lib/production/production-templates";

vi.mock("@/shared/lib/http", () => ({
	default: {
		delete: vi.fn(),
		get: vi.fn(),
		post: vi.fn(),
	},
}));

describe("project api", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds stable SWR keys for project status filters", () => {
		expect(projectsKeyForStatus()).toBe(projectsKey);
		expect(projectsKeyForStatus("active")).toBe(projectsKey);
		expect(projectsKeyForStatus("archived")).toBe("/projects?status=archived");
		expect(projectsKeyForStatus("trashed")).toBe("/projects?status=trashed");
	});

	it("fetches active projects without status params", async () => {
		vi.mocked(httpClient.get).mockResolvedValueOnce(
			apiResponse({ databasePath: "", projects: [], workspaceDir: "" }),
		);

		await getProjects();

		expect(httpClient.get).toHaveBeenCalledWith(projectsKey);
	});

	it("fetches archived and trashed projects with status params", async () => {
		vi.mocked(httpClient.get).mockResolvedValue(
			apiResponse({ databasePath: "", projects: [], workspaceDir: "" }),
		);

		await getProjects("archived");
		await getProjects("trashed");

		expect(httpClient.get).toHaveBeenNthCalledWith(1, projectsKey, {
			params: { status: "archived" },
		});
		expect(httpClient.get).toHaveBeenNthCalledWith(2, projectsKey, {
			params: { status: "trashed" },
		});
	});

	it("calls project lifecycle endpoints", async () => {
		const project = {
			createdAt: "",
			description: "",
			documentCount: 0,
			id: "project one",
			name: "Project One",
			relativeDir: "",
			updatedAt: "",
		};
		vi.mocked(httpClient.post).mockResolvedValue(apiResponse(project));
		vi.mocked(httpClient.delete).mockResolvedValue(apiResponse(project));

		await archiveProject("project one");
		await restoreProject("project one");
		await permanentlyDeleteProject("project one");

		expect(httpClient.post).toHaveBeenNthCalledWith(1, "/projects/project%20one/archive");
		expect(httpClient.post).toHaveBeenNthCalledWith(2, "/projects/project%20one/restore");
		expect(httpClient.delete).toHaveBeenCalledWith("/projects/project%20one/permanent");
	});

	it("normalizes legacy stage status without changing the saved template definition", () => {
		const production = normalizeProjectProductionState({
			template: {
				id: "commercial-film",
				name: "商业广告",
				description: "完整生产流程",
				category: "commercial",
				version: 1,
				stages: [
					{
						id: "stage-1",
						order: 1,
						title: "序章",
						subtitle: "锁故事",
						purpose: "锁定故事",
						outputs: [],
						gate: "故事通过",
						category: "screenplay",
						status: "REVIEW",
						documentId: "legacy-stage-1",
					} as never,
				],
			},
			currentStageId: "stage-1",
			overallProgress: 0,
			coreAssetCount: 0,
			shotCount: 0,
			completedShotCount: 0,
			reviewShotCount: 0,
			version: "V01",
			updatedAt: "",
		});

		expect(production?.template.stages[0]).not.toHaveProperty("status");
		expect(production?.stageStates?.["stage-1"]).toEqual({
			status: "REVIEW",
			documentId: "legacy-stage-1",
		});
		expect(projectProductionStages(production)[0]?.status).toBe("REVIEW");
	});

	it("upgrades an untouched commercial workflow to the reference-first v3 sequence", () => {
		const production = normalizeProjectProductionState({
			template: {
				id: "commercial-film",
				name: "商业广告",
				description: "完整生产流程",
				category: "commercial",
				version: 2,
				stages: [
					{
						id: "stage-1",
						order: 1,
						title: "序章",
						subtitle: "旧流程",
						purpose: "旧流程",
						outputs: [],
						gate: "旧流程",
						category: "screenplay",
					},
				],
			},
			stageStates: { "stage-1": { status: "NOT_STARTED", documentId: "legacy-stage-1" } },
			overallProgress: 0,
			coreAssetCount: 0,
			shotCount: 0,
			completedShotCount: 0,
			reviewShotCount: 0,
			version: "V01",
			updatedAt: "",
		});

		expect(production?.template.version).toBe(5);
		expect(production?.template.stages.map((stage) => stage.title)).toEqual([
			"创意与分镜定稿",
			"分镜与资产关系",
			"资产制作",
			"资产审核",
			"单镜执行设计",
			"视频生成",
			"视频归档与粗剪",
			"成片审查",
			"项目复盘",
		]);
		expect(production?.stageStates?.["stage-1"]?.documentId).toBe(
			"production-commercial-film-v5-stage-01",
		);
	});

	it("merges a live commercial v4 asset prompt and generation workflow without losing progress", () => {
		const v4Stages = [
			"创意与分镜定稿",
			"分镜与资产关系",
			"资产提示词",
			"资产生成",
			"资产审核",
			"单镜执行设计",
			"视频生成",
			"视频归档与粗剪",
			"成片审查",
			"项目复盘",
		].map((title, index) => ({
			...productionTemplateById("commercial-film").stages[Math.min(index, 8)]!,
			id: `stage-${index + 1}`,
			order: index + 1,
			title,
		}));
		const production = normalizeProjectProductionState({
			template: {
				id: "commercial-film",
				name: "商业广告",
				description: "完整生产流程",
				category: "commercial",
				version: 4,
				stages: v4Stages,
			},
			stageStates: {
				"stage-3": { status: "REVIEW", documentId: "prompt-doc" },
				"stage-4": { status: "PASS", documentId: "generation-doc" },
				"stage-6": { status: "IN_PROGRESS", documentId: "shot-doc" },
			},
			currentStageId: "stage-6",
			workbenchStates: {
				"stage-6": { phase: "execute", note: "单镜执行中", updatedAt: "2026-08-27" },
			},
			overallProgress: 40,
			coreAssetCount: 1,
			shotCount: 20,
			completedShotCount: 0,
			reviewShotCount: 0,
			version: "V01",
			updatedAt: "2026-08-27",
		});

		expect(production?.template.version).toBe(5);
		expect(production?.template.stages.map((stage) => stage.title)).toContain("资产制作");
		expect(production?.stageStates?.["stage-3"]?.status).toBe("PASS");
		expect(production?.currentStageId).toBe("stage-5");
		expect(production?.workbenchStates?.["stage-5"]?.phase).toBe("execute");
	});

	it("rolls the temporary v6 workflow back to the familiar commercial operation order", () => {
		const legacyTemplate = {
			...productionTemplateSnapshot(productionTemplateById("commercial-film")),
			version: 6,
			stages: [
				"商业 Brief 与验收标准",
				"创意脚本与传播节拍",
				"品牌与产品资产锁定",
				"场景空间与连续性设计",
				"分镜与镜头契约",
				"关键帧制作与资产 QC",
				"视频生成与迭代账本",
				"选片、连续性与粗剪",
				"后期、版本与商业交付",
				"效果复盘与品牌知识沉淀",
			].map((title, index) => ({
				...productionTemplateById("commercial-film").stages[Math.min(index, 8)]!,
				id: `stage-${index + 1}`,
				order: index + 1,
				title,
			})),
		};
		const production = normalizeProjectProductionState({
			template: legacyTemplate,
			stageStates: {
				"stage-1": { status: "IN_PROGRESS", documentId: "creative-doc" },
				"stage-3": { status: "PASS", documentId: "asset-doc" },
				"stage-6": { status: "REVIEW", documentId: "video-doc" },
			},
			currentStageId: "stage-6",
			workbenchStates: {
				"stage-6": { phase: "review", note: "视频待审", updatedAt: "2026-08-30" },
			},
			overallProgress: 40,
			coreAssetCount: 2,
			shotCount: 6,
			completedShotCount: 0,
			reviewShotCount: 1,
			version: "V01",
			updatedAt: "2026-08-30",
		});

		expect(production?.template.version).toBe(5);
		expect(production?.template.stages).toHaveLength(9);
		expect(production?.stageStates?.["stage-3"]?.status).toBe("PASS");
		expect(production?.stageStates?.["stage-4"]?.status).toBe("REVIEW");
		expect(production?.currentStageId).toBe("stage-4");
		expect(production?.workbenchStates?.["stage-4"]?.note).toBe("视频待审");
	});
});

const apiResponse = <T>(data: T): ApiResponse<T> => ({
	code: 0,
	data,
	message: "ok",
	success: true,
});
