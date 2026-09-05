import { describe, expect, it } from "vitest";
import { buildProjectProductionContext } from "@/lib/production/project-context";
import { mergeReusableProductionMemory } from "@/domains/projects/api/projects";
import type { ProductionPipeline } from "@/lib/overview/production-pipeline";
import type { ProjectProductionState } from "@/domains/projects/api/projects";

const pipeline: ProductionPipeline = {
	completed: 2,
	percent: 20,
	total: 10,
	templateLabel: "商业广告",
	templateDescription: "完整生产流程",
	stages: [],
};

describe("buildProjectProductionContext", () => {
	it("汇总项目风险、版本和共享记忆状态", () => {
		const production = {
			template: {
				id: "commercial-film",
				name: "商业广告",
				description: "",
				category: "",
				version: 1,
				stages: [],
			},
			overallProgress: 20,
			coreAssetCount: 2,
			shotCount: 3,
			completedShotCount: 1,
			reviewShotCount: 1,
			version: "V01",
			updatedAt: "2026-08-21T00:00:00Z",
			blockers: ["产品结构待确认"],
			stageStates: { "stage-1": { status: "BLOCKED", documentId: "", blocker: "缺少产品参考" } },
			qcResults: {
				"qc-1": {
					id: "qc-1",
					entityType: "asset",
					entityId: "a1",
					status: "NEEDS_FIX",
					checks: [],
					reviewedAt: "2026-08-21T00:00:00Z",
				},
			},
			versions: [
				{
					id: "v1",
					entityType: "asset",
					entityId: "a1",
					version: "V01",
					status: "PASS",
					createdAt: "2026-08-21T00:00:00Z",
				},
			],
			sharedContext: { script: "锁定脚本", updatedAt: "2026-08-21T00:00:00Z" },
		} satisfies ProjectProductionState;

		const context = buildProjectProductionContext({
			projectId: "p1",
			name: "测试项目",
			pipeline,
			resourceCount: 4,
			selectedAssetCount: 2,
			shotCount: 3,
			draftStoryboardCount: 6,
			production,
		});

		expect(context.blockerCount).toBe(2);
		expect(context.qcIssueCount).toBe(1);
		expect(context.versionCount).toBe(1);
		expect(context.outputArchiveCount).toBe(0);
		expect(context.qcPassCount).toBe(0);
		expect(context.sharedMemoryReady).toBe(true);
		expect(context.draftStoryboardCount).toBe(6);
	});
});

describe("mergeReusableProductionMemory", () => {
	it("只合并可复用内容、去重并限制数量", () => {
		const memory = mergeReusableProductionMemory([
			{
				reusablePrompts: ["  保持 Look02  ", "保持 Look02"],
				reusableRules: ["先锁事实"],
				reusableCases: ["不要照搬人物脸"],
				reusableVisualDNA: [{ lighting: "soft" }],
			},
			{
				reusablePrompts: ["先锁事实"],
				reusableRules: ["先锁事实"],
				reusableCases: ["不要照搬人物脸"],
			},
		]);
		expect(memory.reusablePrompts).toEqual(["保持 Look02", "先锁事实"]);
		expect(memory.reusableRules).toEqual(["先锁事实"]);
		expect(memory.reusableCases).toEqual(["不要照搬人物脸"]);
		expect(memory.reusableVisualDNA).toHaveLength(1);
	});
});
