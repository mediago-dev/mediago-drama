import { describe, expect, it } from "vitest";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { buildProductionPipeline } from "./production-pipeline";
import type { GenerationTaskRecord } from "@/api/types/generation";

const document = (category: MarkdownDocument["category"]): MarkdownDocument => ({
	id: category ?? "unknown",
	title: category ?? "unknown",
	content: "# content\n\n正文内容",
	category,
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-08-20T00:00:00Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});

describe("buildProductionPipeline", () => {
	it("does not treat template stage documents as completed work", () => {
		const pipeline = buildProductionPipeline({
			documents: [
				{
					...document("overview"),
					id: "production-commercial-film-stage-10",
					title: "10 项目复盘｜工作流沉淀 + SKILL",
					content:
						'# 10 项目复盘｜工作流沉淀 + SKILL\n\n<!-- production-stage: {"templateId":"commercial-film","stageId":"stage-10","status":"NOT_STARTED"} -->\n\n## 本阶段目的\n\n记录可复用结论。',
				},
			],
			resources: [],
			storyboardGroups: [],
			selectedImageCount: 0,
		});

		expect(pipeline.completed).toBe(0);
		expect(pipeline.percent).toBe(0);
		expect(pipeline.stages[8]?.state).toBe("NOT_STARTED");
	});

	it("does not count the default control document as experiment reference evidence", () => {
		const templateDocuments = [
			{
				...document("reference"),
				id: "production-mini-experiment-control",
				title: "00 项目总控｜TEST_EXPERIMENT",
				content:
					"# 00 项目总控｜TEST_EXPERIMENT\n\n<!-- production-template: mini-experiment -->\n\n## 项目信息\n\n- 整体进度：0%",
			},
			...Array.from({ length: 5 }, (_, index) => ({
				...document("reference"),
				id: `production-mini-experiment-stage-0${index + 1}`,
				title: `${String(index + 1).padStart(2, "0")} 阶段 ${index + 1}`,
				content: `# 阶段 ${index + 1}\n\n<!-- production-stage: {"templateId":"mini-experiment","stageId":"stage-${index + 1}","status":"NOT_STARTED"} -->\n\n## 应交付内容\n\n- [ ] 待完成`,
			})),
		];
		const pipeline = buildProductionPipeline({
			documents: templateDocuments,
			resources: [],
			storyboardGroups: [],
			selectedImageCount: 0,
			production: {
				template: {
					id: "mini-experiment",
					name: "快速实验",
					description: "实验型生产",
					category: "experiment",
					version: 2,
					stages: Array.from({ length: 5 }, (_, index) => ({
						id: `stage-${index + 1}`,
						order: index + 1,
						title: `阶段 ${index + 1}`,
						subtitle: "测试",
						purpose: "测试",
						outputs: [],
						gate: "测试",
						category: "reference" as const,
					})),
				},
				stageStates: Object.fromEntries(
					Array.from({ length: 5 }, (_, index) => [
						`stage-${index + 1}`,
						{ status: "NOT_STARTED", documentId: `production-mini-experiment-stage-0${index + 1}` },
					]),
				),
				currentStageId: "stage-1",
				overallProgress: 0,
				coreAssetCount: 0,
				shotCount: 0,
				completedShotCount: 0,
				reviewShotCount: 0,
				version: "V01",
				updatedAt: "2026-08-21T00:00:00Z",
			},
		});
		expect(pipeline.percent).toBe(0);
		expect(pipeline.stages[1]?.state).toBe("NOT_STARTED");
	});

	it("keeps a script-only first stage in progress until the project brief is confirmed", () => {
		const pipeline = buildProductionPipeline({
			documents: [document("screenplay")],
			resources: [],
			storyboardGroups: [],
			selectedImageCount: 0,
		});

		expect(pipeline.stages[0]?.status).toBe("current");
		// 新流程第一阶段必须有 Brief 或参考图；单独存在旧脚本文档不能冒充需求已理解。
		expect(pipeline.stages[0]?.state).toBe("NOT_STARTED");
		expect(pipeline.stages[1]?.status).toBe("waiting");
		expect(pipeline.stages[2]?.status).toBe("waiting");
		expect(pipeline.completed).toBe(0);
		expect(pipeline.percent).toBe(0);
	});

	it("does not let broad assets and videos falsely complete later production stages", () => {
		const resources = ["character", "scene", "prop"].map((type, index) => ({
			blockId: `block-${index}`,
			canGenerate: true,
			documentId: `document-${index}`,
			documentTitle: type,
			generatedImageCount: 1,
			headingLevel: 2,
			headingOccurrence: 1,
			id: `resource-${index}`,
			markdown: `## ${type}`,
			sectionId: `section-${index}`,
			sourceCategory: type as "character",
			title: type,
			type: type as "character" | "scene" | "prop",
		}));
		const pipeline = buildProductionPipeline({
			documents: [
				document("reference"),
				document("screenplay"),
				document("character"),
				document("scene"),
				document("prop"),
				{ ...document("overview"), id: "review", title: "10 Review｜项目复盘" },
			],
			resources,
			storyboardGroups: [
				{
					documentId: "storyboard",
					documentTitle: "第一集",
					reels: [
						{
							id: "reel-1",
							blockId: "block-reel-1",
							sectionId: "section-reel-1",
							title: "镜头 1",
							headingLevel: 2,
							headingOccurrence: 1,
							markdown: "## 镜头 1",
							canGenerate: true,
							generatedVideoCount: 1,
							videos: [],
						},
					],
				},
			],
			selectedImageCount: 3,
		});

		expect(pipeline.completed).toBe(3);
		// 普通图片不能冒充分镜图；必须建立正式镜头卡后才算进入该阶段。
		expect(pipeline.stages[4]?.state).toBe("NOT_STARTED");
		// 泛化素材最多只能让后续阶段显示“已有候选内容”，不能伪装为审核通过。
		for (const index of [5, 6, 8]) {
			expect(pipeline.stages[index]?.state).not.toBe("PASS");
		}
	});

	it("allows planning every stage while warning about missing upstream gates", () => {
		const pipeline = buildProductionPipeline({
			documents: [],
			resources: [],
			storyboardGroups: [],
			selectedImageCount: 0,
		});

		expect(pipeline.stages.every((stage) => stage.canEnter)).toBe(true);
		expect(pipeline.stages[1]?.riskWarning).toContain("尚未通过");
	});

	it("uses saved stage states as the production source of truth", () => {
		const stages = Array.from({ length: 5 }, (_, index) => ({
			id: `stage-${index + 1}`,
			order: index + 1,
			title: `阶段 ${index + 1}`,
			subtitle: "测试",
			purpose: "测试",
			outputs: [],
			gate: "人工确认",
			category: "reference" as const,
		}));
		const pipeline = buildProductionPipeline({
			documents: [],
			resources: [],
			storyboardGroups: [],
			selectedImageCount: 0,
			production: {
				template: {
					id: "mini-experiment",
					name: "快速实验",
					description: "实验型生产",
					category: "experiment",
					version: 2,
					stages,
				},
				stageStates: Object.fromEntries(
					stages.map((stage, index) => [
						stage.id,
						{ status: index < 2 ? "PASS" : "NOT_STARTED", documentId: `doc-${index}` },
					]),
				),
				currentStageId: "stage-3",
				overallProgress: 40,
				coreAssetCount: 0,
				shotCount: 0,
				completedShotCount: 0,
				reviewShotCount: 0,
				version: "V01",
				updatedAt: "2026-08-20T00:00:00Z",
			},
		});

		expect(pipeline.total).toBe(5);
		expect(pipeline.completed).toBe(2);
		expect(pipeline.percent).toBe(40);
		expect(pipeline.stages[2]?.status).toBe("current");
	});

	it("uses generation tasks as stage content and reports failed work", () => {
		const task = {
			id: "task-1",
			kind: "image",
			documentId: "stage-doc",
			status: "failed",
			assets: [],
		} as unknown as GenerationTaskRecord;
		const pipeline = buildProductionPipeline({
			documents: [{ ...document("screenplay"), id: "stage-doc", title: "01 序章" }],
			resources: [],
			storyboardGroups: [],
			selectedImageCount: 0,
			generationTasks: [task],
		});

		expect(pipeline.stages[0]?.hasContent).toBe(true);
		expect(pipeline.stages[0]?.autoState).toBe("NEEDS_FIX");
		expect(pipeline.stages[0]?.riskWarning).toContain("生成任务失败");
	});

	it("does not resurrect a cleared manual status from the legacy status field", () => {
		const stages = Array.from({ length: 5 }, (_, index) => ({
			id: `stage-${index + 1}`,
			order: index + 1,
			title: `阶段 ${index + 1}`,
			subtitle: "测试",
			purpose: "测试",
			outputs: [],
			gate: "人工确认",
			category: "reference" as const,
		}));
		const pipeline = buildProductionPipeline({
			documents: [],
			resources: [],
			storyboardGroups: [],
			selectedImageCount: 0,
			production: {
				template: {
					id: "mini-experiment",
					name: "快速实验",
					description: "实验型生产",
					category: "experiment",
					version: 2,
					stages,
				},
				stageStates: {
					"stage-1": {
						status: "PASS",
						manualStatus: "",
						autoStatus: "IN_PROGRESS",
						documentId: "stage-doc",
					},
				},
				currentStageId: "stage-1",
				overallProgress: 0,
				coreAssetCount: 0,
				shotCount: 0,
				completedShotCount: 0,
				reviewShotCount: 0,
				version: "V01",
				updatedAt: "2026-08-20T00:00:00Z",
			},
		});

		expect(pipeline.stages[0]?.state).toBe("IN_PROGRESS");
		expect(pipeline.stages[0]?.manualState).toBeUndefined();
	});

	it("surfaces a persisted blocker as a blocked automatic state", () => {
		const pipeline = buildProductionPipeline({
			documents: [],
			resources: [],
			storyboardGroups: [],
			selectedImageCount: 0,
			production: {
				template: {
					id: "mini-experiment",
					name: "快速实验",
					description: "实验型生产",
					category: "experiment",
					version: 2,
					stages: [
						{
							id: "stage-1",
							order: 1,
							title: "实验",
							subtitle: "测试",
							purpose: "测试",
							outputs: [],
							gate: "测试",
							category: "reference",
						},
					],
				},
				stageStates: {
					"stage-1": {
						status: "IN_PROGRESS",
						autoStatus: "IN_PROGRESS",
						documentId: "",
						blocker: "等待参考图确认",
					},
				},
				currentStageId: "stage-1",
				overallProgress: 0,
				coreAssetCount: 0,
				shotCount: 0,
				completedShotCount: 0,
				reviewShotCount: 0,
				version: "V01",
				updatedAt: "2026-08-20T00:00:00Z",
			},
		});

		expect(pipeline.stages[0]?.autoState).toBe("BLOCKED");
		expect(pipeline.stages[0]?.riskWarning).toContain("等待参考图确认");
	});

	it("把阶段 QC 的失败和阻塞纳入自动状态", () => {
		const pipeline = buildProductionPipeline({
			documents: [document("screenplay")],
			resources: [],
			storyboardGroups: [],
			selectedImageCount: 0,
			production: {
				template: {
					id: "mini-experiment",
					name: "快速实验",
					description: "实验型生产",
					category: "experiment",
					version: 2,
					stages: [
						{
							id: "stage-1",
							order: 1,
							title: "实验目标",
							subtitle: "测试",
							purpose: "测试",
							outputs: [],
							gate: "测试",
							category: "screenplay",
						},
					],
				},
				stageStates: { "stage-1": { status: "IN_PROGRESS", documentId: "" } },
				qcResults: {
					"qc-1": {
						id: "qc-1",
						entityType: "stage",
						entityId: "stage-1",
						stageId: "stage-1",
						status: "NEEDS_FIX",
						checks: [],
						reviewedAt: "2026-08-21T00:00:00Z",
					},
				},
				overallProgress: 0,
				coreAssetCount: 0,
				shotCount: 0,
				completedShotCount: 0,
				reviewShotCount: 0,
				version: "V01",
				updatedAt: "2026-08-21T00:00:00Z",
			},
		});

		expect(pipeline.stages[0]?.autoState).toBe("NEEDS_FIX");
		expect(pipeline.stages[0]?.riskWarning).toContain("QC");
	});
});
