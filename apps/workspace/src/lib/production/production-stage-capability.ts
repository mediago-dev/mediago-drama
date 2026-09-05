import type { ProductionTemplateId } from "@/lib/production/production-templates";

/**
 * Capability describes what the user actually does in a stage. UI and evidence
 * rules depend on this semantic value instead of assuming that every template's
 * third or sixth stage means the same thing.
 */
export type ProductionStageCapability =
	| "brief"
	| "script"
	| "reference"
	| "shot-breakdown"
	| "asset-plan"
	| "asset-production"
	| "image-generation"
	| "asset-qc"
	| "shot-execution"
	| "motion-design"
	| "video-qc"
	| "final-qc"
	| "retrospective"
	| "custom";

const capabilityByTemplateTitle: Partial<
	Record<ProductionTemplateId, Record<string, ProductionStageCapability>>
> = {
	"commercial-film": {
		创意与分镜定稿: "brief",
		分镜与资产关系: "shot-breakdown",
		资产制作: "asset-production",
		资产审核: "asset-qc",
		单镜执行设计: "shot-execution",
		视频生成: "video-qc",
		视频归档与粗剪: "video-qc",
		成片审查: "final-qc",
		项目复盘: "retrospective",
	},
	"comic-drama": {
		世界观设定: "brief",
		剧情拆解: "script",
		资产拆解: "asset-plan",
		资产生成: "image-generation",
		资产审核: "asset-qc",
		分镜制作: "shot-execution",
		动态制作: "motion-design",
		单集粗剪: "video-qc",
		Final制作: "final-qc",
		连载复盘: "retrospective",
	},
	"short-film": {
		创意设定: "brief",
		故事脚本: "script",
		镜头拆解: "shot-breakdown",
		资产拆解: "asset-plan",
		资产生成: "image-generation",
		单镜制作: "shot-execution",
		动态制作: "motion-design",
		粗剪审核: "video-qc",
		Final制作: "final-qc",
		项目复盘: "retrospective",
	},
	"social-content": {
		内容定位: "brief",
		内容脚本: "script",
		资产准备: "asset-plan",
		关键画面: "image-generation",
		内容制作: "shot-execution",
		动态剪辑: "motion-design",
		发布检查: "final-qc",
		版本复盘: "retrospective",
	},
	"mini-experiment": {
		实验目标: "brief",
		参考准备: "reference",
		生成测试: "image-generation",
		动态测试: "motion-design",
		实验结论: "retrospective",
	},
	custom: {
		项目总控: "custom",
	},
};

export const resolveProductionStageCapability = (
	templateId: ProductionTemplateId | undefined,
	title: string,
): ProductionStageCapability => {
	const normalizedTitle = title.replace(/^\s*\d+\s*[.\-_｜|]? ?/, "").trim();
	const exact = templateId ? capabilityByTemplateTitle[templateId]?.[normalizedTitle] : undefined;
	if (exact) return exact;
	if (/复盘|结论/i.test(normalizedTitle)) return "retrospective";
	if (/Final|成片|发布检查/i.test(normalizedTitle)) return "final-qc";
	if (/视频管理|粗剪/i.test(normalizedTitle)) return "video-qc";
	if (/动态|动画|运镜/i.test(normalizedTitle)) return "motion-design";
	if (/单镜|镜头画面|分镜制作|内容制作/i.test(normalizedTitle)) return "shot-execution";
	if (/资产审核|Asset QC/i.test(normalizedTitle)) return "asset-qc";
	if (/分镜图|图片生成|资产生成|生成测试|关键画面/i.test(normalizedTitle))
		return "image-generation";
	if (/资产拆解|资产准备/i.test(normalizedTitle)) return "asset-plan";
	if (/文字分镜|拆解制作|镜头拆解/i.test(normalizedTitle)) return "shot-breakdown";
	if (/参考/i.test(normalizedTitle)) return "reference";
	if (/故事推导|脚本|剧情拆解/i.test(normalizedTitle)) return "script";
	if (/序章|设定|实验目标|内容定位/i.test(normalizedTitle)) return "brief";
	return "custom";
};
