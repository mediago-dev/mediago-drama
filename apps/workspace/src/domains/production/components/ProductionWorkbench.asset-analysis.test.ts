import { describe, expect, it } from "vitest";
import {
	assetPlanMatchesStoryboardCount,
	assetPlanStoryboardCount,
	completedAssetPlanFromRun,
	isUsableAssetPlan,
	latestUsableAssetPlan,
	parsePlannedAssets,
} from "./ProductionWorkbench";

const validPlan = `资产ID｜分类｜资产名称｜必要变体｜使用镜头｜必须生成的视图｜参考图要求｜结构化Prompt摘要｜不能改变项｜优先级
CHR-01｜角色｜17岁日本女高中生｜电话亭与花海｜S08-S17、S21｜正侧背与面部近景｜锁定定妆参考｜短发水手服少女｜年龄、五官、发型不变｜P0
SCN-01｜场景｜雨夜城市｜湿地低机位｜S01-S06｜全景与街道平视｜沿用母图｜日本城市雨夜与冷蓝反光｜建筑和主色温不变｜P0
SCN-02｜场景｜电话亭与向日葵｜女孩入镜版｜S07-S17｜正面、侧面、亭内视角｜沿用母图｜透明电话亭与向日葵装置｜结构和花朵色相不变｜P0
SCN-03｜场景｜剧院红幕｜舞台与空镜｜S22-S24｜舞台正面和观众席全景｜沿用母图｜红幕剧院与追光｜舞台尺度和灯位不变｜P0`;

describe("第02步资产分析结果", () => {
	it("接受真实的结构化资产清单", () => {
		expect(isUsableAssetPlan(validPlan)).toBe(true);
		expect(assetPlanStoryboardCount(validPlan)).toBe(24);
		expect(assetPlanMatchesStoryboardCount(validPlan, 24)).toBe(true);
		expect(assetPlanMatchesStoryboardCount(validPlan, 12)).toBe(false);
		expect(assetPlanMatchesStoryboardCount(validPlan, 36)).toBe(false);
	});

	it("12P、24P、36P 切换后只接受与当前格数一致的清单", () => {
		const planFor = (count: number) =>
			`资产ID｜分类｜资产名称｜必要变体｜使用镜头｜必须生成的视图｜参考图要求｜结构化Prompt摘要｜不能改变项｜优先级
CHR-01｜角色｜女主角｜湿发与日常｜S01-S${String(count).padStart(2, "0")}｜正侧背与面部近景｜锁定分镜母图｜17岁短发水手服少女，真实电影摄影｜年龄、五官、发型和服装不变｜P0
SCN-01｜场景｜完整故事场景｜雨夜与白日｜S01-S${String(count).padStart(2, "0")}｜全景与平视｜沿用母图｜覆盖当前全部分镜的场景资产｜建筑结构与主色温不变｜P0`;
		expect(assetPlanMatchesStoryboardCount(planFor(12), 12)).toBe(true);
		expect(assetPlanMatchesStoryboardCount(planFor(24), 24)).toBe(true);
		expect(assetPlanMatchesStoryboardCount(planFor(36), 36)).toBe(true);
		expect(assetPlanMatchesStoryboardCount(planFor(24), 12)).toBe(false);
	});

	it("忽略旧失败运行和过程消息，读取本次完成运行的最终清单", () => {
		const result = completedAssetPlanFromRun(
			[
				{
					status: "failed",
					messages: [
						{
							id: "old-error",
							role: "assistant",
							kind: "runtime",
							status: "error",
							content: "codex-acp executable not found",
						},
					],
				},
				{
					status: "completed",
					messages: [
						{
							id: "new-commentary",
							role: "assistant",
							kind: "message",
							createdAt: "2026-08-31T08:00:00Z",
							content: "正在分析镜头。",
						},
						{
							id: "new-final",
							role: "assistant",
							kind: "message",
							status: "complete",
							createdAt: "2026-08-31T08:01:00Z",
							content: validPlan,
						},
					],
				},
			],
			new Set(["old-error"]),
		);

		expect(result).toBe(validPlan);
	});

	it("会话残留 running 时仍可恢复已经完整返回的资产清单", () => {
		const result = latestUsableAssetPlan([
			{
				messages: [
					{
						role: "assistant",
						kind: "message",
						status: "complete",
						createdAt: "2026-08-31T08:01:00Z",
						content: validPlan,
					},
				],
			},
		]);

		expect(result).toBe(validPlan);
	});

	it("优先恢复覆盖更完整的旧清单，而不是较新但被截断的回答", () => {
		const partial = `资产清单\nCHAR-01｜角色｜女孩｜雨夜｜S08、S24｜正侧背｜参考图｜短发水手服｜身份不变｜P0`;
		const result = latestUsableAssetPlan([
			{
				messages: [
					{
						role: "assistant",
						kind: "message",
						createdAt: "2026-08-31T08:00:00Z",
						content: validPlan,
					},
					{
						role: "assistant",
						kind: "message",
						createdAt: "2026-08-31T09:00:00Z",
						content: partial,
					},
				],
			},
		]);

		expect(result).toBe(validPlan);
	});

	it("不把逐镜表格误当资产，并保留 PRP 道具编号", () => {
		const plan = `## 第一遍：逐镜识别
| 镜头 | 人物身份与造型 | 场景／时间／灯光 | 道具／产品 |
|---|---|---|---|
| S01 | 上班族 | 办公室 | 咖啡杯 |

## 第二遍：资产清单
| 资产ID | 分类 | 资产名称 | 必要变体 | 使用镜头 | 必须生成的视图 | 参考图要求 | 结构化Prompt摘要 | 不能改变项 | 优先级 |
|---|---|---|---|---|---|---|---|---|---|
| CHR-01 | 角色 | 上班族 | 标准 | S01 | 正侧背 | 分镜 | 固定人物 | 脸型不变 | P0 |
| PRP-01 | 道具/产品 | 咖啡杯 | 标准 | S01 | 六面 | 分镜 | 固定杯型 | Logo不变 | P0 |`;
		const assets = parsePlannedAssets(plan);
		expect(assets.map((asset) => asset.id)).toEqual(["CHR-01", "PRP-01"]);
		expect(assets.some((asset) => asset.name === "镜头")).toBe(false);
	});
});
