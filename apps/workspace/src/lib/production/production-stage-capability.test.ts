import { describe, expect, it } from "vitest";
import { productionTemplates } from "@/lib/production/production-templates";
import { resolveProductionStageCapability } from "./production-stage-capability";

describe("resolveProductionStageCapability", () => {
	it("maps every configured template stage to a semantic work surface", () => {
		for (const template of productionTemplates) {
			for (const stage of template.stages) {
				const capability = resolveProductionStageCapability(template.id, stage.title);
				if (template.id === "custom") {
					expect(capability).toBe("custom");
				} else {
					expect(capability, `${template.id}: ${stage.title}`).not.toBe("custom");
				}
			}
		}
	});

	it("uses the stage meaning instead of the numeric order", () => {
		expect(resolveProductionStageCapability("commercial-film", "01 创意与分镜定稿")).toBe("brief");
		expect(resolveProductionStageCapability("commercial-film", "02 分镜与资产关系")).toBe(
			"shot-breakdown",
		);
		expect(resolveProductionStageCapability("comic-drama", "02 剧情拆解")).toBe("script");
		expect(resolveProductionStageCapability("mini-experiment", "02 参考准备")).toBe("reference");
	});
});
