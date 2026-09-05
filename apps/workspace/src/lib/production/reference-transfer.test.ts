import { describe, expect, it } from "vitest";
import { buildReferenceTransferPrompts } from "./reference-transfer";

describe("buildReferenceTransferPrompts", () => {
	it("uses confirmed evidence and target assets without promoting low confidence guesses", () => {
		const result = buildReferenceTransferPrompts({
			targetCharacter: "Female_Look02",
			targetEnvironment: "Moon_Scene03",
			targetProps: "Blue_Thread01",
			targetProduct: "Bag_Hero01",
			rendering: "细腻写实",
			style: "冷暖对照",
			doNotCopy: "参考人物面孔与品牌标识",
			evidence: [
				{
					dimension: "composition",
					observation: "低机位居中构图",
					confidence: "high",
					unknowns: "镜头焦距未知",
				},
				{
					dimension: "action",
					observation: "可能正在奔跑",
					confidence: "low",
					unknowns: "单帧无法判断速度",
				},
			],
		});

		expect(result.image).toContain("目标角色：Female_Look02");
		expect(result.image).toContain("构图：低机位居中构图");
		expect(result.image).not.toContain("可能正在奔跑");
		expect(result.imageToVideo).toContain("主体身份与产品结构全程锁定");
	});
});
