import { describe, expect, it } from "vitest";
import {
	buildProductionTemplateDocuments,
	defaultProductionTemplate,
	productionTemplateById,
	productionTemplateIdFromDocuments,
	productionTemplates,
	productionTemplateSnapshot,
	productionStageStates,
} from "./production-templates";

describe("production templates", () => {
	it("provides six configuration-driven workflows with the requested complexity", () => {
		expect(productionTemplates.map((template) => template.id)).toEqual([
			"commercial-film",
			"comic-drama",
			"short-film",
			"social-content",
			"mini-experiment",
			"custom",
		]);
		expect(productionTemplates.map((template) => template.stages.length)).toEqual([
			9, 10, 10, 8, 5, 1,
		]);
	});

	it("keeps template-specific ordered stage names", () => {
		expect(productionTemplateById("commercial-film").stages.map((stage) => stage.title)).toEqual([
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
		expect(productionTemplateById("comic-drama").stages.map((stage) => stage.title)).toEqual([
			"世界观设定",
			"剧情拆解",
			"资产拆解",
			"资产生成",
			"资产审核",
			"分镜制作",
			"动态制作",
			"单集粗剪",
			"Final制作",
			"连载复盘",
		]);
		expect(productionTemplateById("social-content").stages[6]?.gate).toContain("字幕");
		expect(productionTemplateById("mini-experiment").stages[2]?.outputs).toEqual(
			expect.arrayContaining(["V01", "V02", "V03"]),
		);
	});

	it("creates one control document plus one document per formal stage", () => {
		for (const template of productionTemplates.filter((item) => item.id !== "custom")) {
			const documents = buildProductionTemplateDocuments(template, `TEST_${template.id}`);
			expect(documents).toHaveLength(template.stages.length + 1);
			expect(documents[0]?.title).toContain("00 项目总控");
			expect(documents.slice(1).map((document) => document.title)).toEqual(
				template.stages.map(
					(stage) => `${String(stage.order).padStart(2, "0")} ${stage.title}｜${stage.subtitle}`,
				),
			);
		}
	});

	it("creates only the master control document for custom projects", () => {
		const documents = buildProductionTemplateDocuments(
			productionTemplateById("custom"),
			"TEST_CUSTOM",
		);
		expect(documents).toHaveLength(1);
		expect(documents[0]?.content).toContain("自行增加阶段");
	});

	it("separates immutable template definitions from mutable stage states", () => {
		const template = productionTemplateById("short-film");
		const snapshot = productionTemplateSnapshot(template);
		const states = productionStageStates(template);
		expect(snapshot.version).toBe(5);
		expect(snapshot.stages[0]).toMatchObject({ order: 1 });
		expect(snapshot.stages[0]).not.toHaveProperty("status");
		expect(states["stage-1"]).toMatchObject({ status: "NOT_STARTED" });
		expect(states["stage-1"]?.documentId).toContain("short-film-stage-01");
		expect(snapshot.stages[0]?.gate).toBeTruthy();
	});

	it("reads new and legacy projects without changing the legacy fallback", () => {
		expect(
			productionTemplateIdFromDocuments([{ content: "<!-- production-template: comic-drama -->" }]),
		).toBe("comic-drama");
		expect(productionTemplateIdFromDocuments([{ content: "# Legacy project" }])).toBe(
			defaultProductionTemplate.id,
		);
	});
});
