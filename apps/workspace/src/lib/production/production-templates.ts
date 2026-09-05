import type { DocumentCategory } from "@/domains/documents/stores";

export type ProductionTemplateId =
	| "commercial-film"
	| "comic-drama"
	| "short-film"
	| "social-content"
	| "mini-experiment"
	| "custom";
export type ProductionStageState =
	| "NOT_STARTED"
	| "IN_PROGRESS"
	| "REVIEW"
	| "PASS"
	| "NEEDS_FIX"
	| "BLOCKED";

export const productionStageStateLabels: Record<ProductionStageState, string> = {
	NOT_STARTED: "未开始",
	IN_PROGRESS: "进行中",
	REVIEW: "待审核",
	PASS: "已通过",
	NEEDS_FIX: "需修改",
	BLOCKED: "被阻塞",
};

export interface ProductionTemplateStage {
	id: string;
	order: number;
	title: string;
	subtitle: string;
	purpose: string;
	outputs: string[];
	gate: string;
	category: DocumentCategory;
}
export interface ProductionTemplateDocument {
	id: string;
	title: string;
	category: DocumentCategory;
	content: string;
	stageId?: string;
	sortOrder: number;
}
export interface ProductionTemplate {
	id: ProductionTemplateId;
	name: string;
	label: string;
	description: string;
	category: string;
	complexityLabel: string;
	stages: ProductionTemplateStage[];
}
export interface ProductionTemplateSnapshot {
	id: ProductionTemplateId;
	name: string;
	description: string;
	category: string;
	version: number;
	stages: ProductionTemplateStage[];
}
export interface ProductionStageRuntimeState {
	status: ProductionStageState;
	/** New projects store the user's explicit annotation separately from derived facts. */
	manualStatus?: ProductionStageState | "";
	/** Derived from documents, assets, shots and generation tasks. */
	autoStatus?: ProductionStageState;
	documentId: string;
	completion?: number;
	updatedAt?: string;
	blocker?: string;
}

type StageSeed = Omit<ProductionTemplateStage, "id" | "order">;
const stage = (
	title: string,
	subtitle: string,
	purpose: string,
	outputs: string[],
	gate: string,
	category: DocumentCategory,
): StageSeed => ({ title, subtitle, purpose, outputs, gate, category });
const identify = (stages: StageSeed[]): ProductionTemplateStage[] =>
	stages.map((item, index) => ({ ...item, id: `stage-${index + 1}`, order: index + 1 }));

const commercialStages = identify([
	stage(
		"创意与分镜定稿",
		"多参考图 → Visual DNA → 脚本 → 文字分镜 → 分镜图",
		"上传一张或多张参考图，分别指定人物形象、比例、姿势、构图、渲染、材质、灯光和风格用途。AI 先证据化拆解，再推导故事与脚本、文字分镜和分镜图；每一步汇报并等待用户确认。",
		["参考图与用途", "Visual DNA", "锁定脚本", "文字分镜", "已确认分镜图"],
		"需求、视觉方向、脚本、文字分镜和分镜图均已确认。",
		"reference",
	),
	stage(
		"分镜与资产关系",
		"分镜图 → 镜头 → 所需资产",
		"把已确认分镜图拆成 S01、S02…独立镜头，再分析每镜所需人物、造型、场景、背景、道具、产品、特效和首尾帧，建立可编辑的关系树；本阶段不生图。",
		["独立镜头卡", "镜头封面", "镜头—资产关系树", "待制作资产清单"],
		"每个分镜都已拆成镜头，并明确需要哪些资产。",
		"storyboard",
	),
	stage(
		"资产制作",
		"Prompt 编辑 + 生成 / 上传 + 版本归档",
		"按资产清单逐项编辑、复制 Prompt，并在同一工作区生成或上传角色、场景、道具和特效。每个结果自动保留版本、Prompt 与镜头关系；下一步才集中审核。",
		["资产 Prompt", "资产版本", "外部导入记录", "镜头绑定关系"],
		"每项需要的资产均已有可用版本，且 Prompt、版本和镜头用途可追溯。",
		"reference",
	),
	stage(
		"资产审核",
		"一致性 + 镜头覆盖 + 缺失检查",
		"逐项审核角色、场景、道具和风格资产是否一致、可用并覆盖全部镜头；未通过时保留问题与返修版本。",
		["资产 QC", "通过版本", "需修改项", "缺失资产清单"],
		"关键资产全部通过审核且不存在未处理的镜头缺口。",
		"reference",
	),
	stage(
		"单镜执行设计",
		"逐镜调用资产 + 时长 + 动作 + 连续性 + Prompt",
		"按 S01、S02…自动调取已通过资产，结合分镜设计镜头时长、人物动作、景别构图、运镜、首尾帧、前后镜衔接、运动方向和图生视频 Prompt。",
		["单镜执行稿", "首尾帧关系", "动作与运镜 Prompt", "连续性规则"],
		"每个待制作镜头都有经过确认的执行方案和视频 Prompt。",
		"storyboard",
	),
	stage(
		"视频生成",
		"将单镜执行方案提交到视频模型",
		"把已确认的执行图、资产和视频 Prompt 提交给 LibTV、TapNow 等接口，结果自动绑定镜头、资产、Prompt 和版本。",
		["视频生成任务", "V01+ 视频版本", "模型与参数记录", "镜头绑定"],
		"需要制作的镜头均已有可审核的视频版本。",
		"storyboard",
	),
	stage(
		"视频归档与粗剪",
		"视频版本管理 + 外部导入 + 粗剪衔接",
		"统一管理所有镜头视频版本、外部导入和替换记录；可使用内置粗剪，或导出到 Premiere 后再把成片与修改版本导回项目。",
		["视频版本库", "外部导入记录", "粗剪版本", "缺失镜头清单"],
		"视频版本归档完整，并形成可审查的粗剪或外部剪辑版本。",
		"storyboard",
	),
	stage(
		"成片审查",
		"配音 + 音乐 + 字幕 + 调色 + Final QC",
		"完成声音、字幕、调色、剪辑和最终技术/内容审查，输出可交付成片。",
		["Final Master", "声音版本", "字幕与调色", "最终 QC"],
		"内容、画面、声音和导出规格全部通过。",
		"reference",
	),
	stage(
		"项目复盘",
		"规则 + 案例 + Prompt + 资产复用",
		"汇总成功版本、失败原因、Prompt、Visual DNA、资产和制作规则，让下一个项目直接复用。",
		["复盘报告", "可复用 Prompt", "规则与案例", "可复用资产"],
		"经验、失败原因和可复用结论已经归档。",
		"reference",
	),
]);
const comicStages = identify([
	stage(
		"世界观设定",
		"题材 + 核心冲突 + 故事规则",
		"锁定系列题材、冲突、人设与世界规则。",
		["世界观", "角色关系", "故事规则"],
		"世界规则与核心人物不再互相冲突。",
		"reference",
	),
	stage(
		"剧情拆解",
		"故事大纲 + 分集规划 + 单集钩子",
		"把连续故事拆成可生产的分集结构。",
		["总纲", "分集规划", "单集 Hook"],
		"每集目标、冲突和结尾钩子明确。",
		"screenplay",
	),
	stage(
		"资产拆解",
		"角色 + 服装 + 场景 + 道具 + 表情动作",
		"列出跨集复用资产和状态变化。",
		["角色表", "服装表", "场景/道具表", "表情动作表"],
		"主配角、常驻场景和剧情道具无缺失。",
		"reference",
	),
	stage(
		"资产生成",
		"角色库 + 场景库 + 版本迭代",
		"建立稳定可复用的系列资产库。",
		["角色库", "场景库", "表情动作版本"],
		"关键角色与场景存在稳定通过版本。",
		"character",
	),
	stage(
		"资产审核",
		"角色一致性 + 场景统一 + 缺失资产检查",
		"避免人物漂移和跨集空间冲突。",
		["一致性 QC", "缺失资产表"],
		"角色身份和常驻场景均 PASS。",
		"reference",
	),
	stage(
		"分镜制作",
		"对白拆镜 + 构图 + 镜头连续性",
		"围绕对白、情绪和冲突完成剧情关键帧。",
		["对白分镜", "剧情关键帧", "连续性说明"],
		"对白归属、视线和空间关系正确。",
		"storyboard",
	),
	stage(
		"动态制作",
		"人物动作 + 口型 + 运镜 + 转场Prompt",
		"生成适配对白和情绪的动态镜头。",
		["动作 Prompt", "口型方案", "动态镜头"],
		"表演、口型、运镜与情绪一致。",
		"storyboard",
	),
	stage(
		"单集粗剪",
		"对白节奏 + 情绪推进 + 补镜头 + QC",
		"验证单集节奏、信息和钩子效果。",
		["单集粗剪", "补镜头表", "QC"],
		"情绪推进清楚且结尾 Hook 成立。",
		"storyboard",
	),
	stage(
		"Final制作",
		"配音 + 字幕 + BGM + 音效 + 输出",
		"完成单集声音、字幕与平台输出。",
		["配音", "字幕", "混音", "Final"],
		"对白清晰、字幕无误、规格通过。",
		"reference",
	),
	stage(
		"连载复盘",
		"资产复用 + 人设一致性 + 下集衔接",
		"维护连载资产和下一集连续性。",
		["复用资产表", "人设偏差记录", "下集衔接"],
		"本集变更已同步到系列规则。",
		"reference",
	),
]);
const shortFilmStages = identify([
	stage(
		"创意设定",
		"主题 + 核心概念 + 视觉方向",
		"锁定作品主题与表达方式。",
		["创意 Brief", "主题陈述", "视觉方向"],
		"主题、形式和排除项已确认。",
		"reference",
	),
	stage(
		"故事脚本",
		"人物 + 情节 + 情绪曲线",
		"建立完整叙事和情绪变化。",
		["锁定脚本", "人物弧光", "情绪曲线"],
		"故事因果、人物动机和结尾成立。",
		"screenplay",
	),
	stage(
		"镜头拆解",
		"场次 + Shot List + 镜头需求",
		"把脚本转换为可执行镜头计划。",
		["场次表", "Shot List", "镜头需求"],
		"故事信息均有镜头承载。",
		"storyboard",
	),
	stage(
		"资产拆解",
		"人物 + 场景 + 道具 + 特效",
		"列出镜头需要的复用与专用资产。",
		["资产清单", "Visual Bible", "特效需求"],
		"每个镜头的关键资产可追溯。",
		"reference",
	),
	stage(
		"资产生成",
		"核心资产 + 版本迭代 + QC",
		"生成并审核核心视觉资产。",
		["核心资产", "版本记录", "资产 QC"],
		"正式镜头所需资产均有通过版本。",
		"character",
	),
	stage(
		"单镜制作",
		"资产调用 + 构图 + 关键帧",
		"完成每个镜头的可控静态设计。",
		["关键帧", "资产引用", "构图说明"],
		"镜头目的与上下镜连续性明确。",
		"storyboard",
	),
	stage(
		"动态制作",
		"首尾帧 + 人物动作 + 运镜Prompt",
		"把通过关键帧转换为动态镜头。",
		["首尾帧", "动作/运镜 Prompt", "动态版本"],
		"动作、镜头和物理逻辑明确。",
		"storyboard",
	),
	stage(
		"粗剪审核",
		"节奏 + 连续性 + 补镜头",
		"通过剪辑验证整体叙事。",
		["粗剪", "连续性 QC", "补镜头表"],
		"叙事完整且关键问题已解决。",
		"storyboard",
	),
	stage(
		"Final制作",
		"精修 + 声音 + 调色 + 输出",
		"完成最终视听与交付。",
		["Final Master", "声音", "调色", "交付文件"],
		"最终技术和艺术检查通过。",
		"reference",
	),
	stage(
		"项目复盘",
		"镜头经验 + Prompt + 工作流沉淀",
		"记录本片可复用经验。",
		["镜头复盘", "Prompt 库", "工作流结论"],
		"重要结论可被下个项目直接使用。",
		"reference",
	),
]);
const socialStages = identify([
	stage(
		"内容定位",
		"平台 + 受众 + 内容目标",
		"明确平台语境、受众与指标。",
		["平台规格", "受众画像", "内容目标"],
		"平台、受众、目标和限制明确。",
		"reference",
	),
	stage(
		"内容脚本",
		"Hook + 核心信息 + CTA",
		"组织首屏吸引力和核心表达。",
		["Hook", "内容脚本", "CTA"],
		"前三秒、核心信息和行动引导明确。",
		"screenplay",
	),
	stage(
		"资产准备",
		"人物 + 产品 + 场景 + 图文素材",
		"准备轻量但完整的内容资产。",
		["人物/产品资产", "场景素材", "图文素材"],
		"核心信息所需素材齐备。",
		"reference",
	),
	stage(
		"关键画面",
		"封面 + 首屏 + 核心视觉",
		"锁定影响点击和停留的关键画面。",
		["封面", "首屏", "核心视觉"],
		"封面可读、首屏 Hook 清楚。",
		"storyboard",
	),
	stage(
		"内容制作",
		"镜头 + 图文 + 素材组合",
		"组合镜头、素材与文案。",
		["内容镜头", "图文版式", "组合版本"],
		"信息顺序和素材引用正确。",
		"storyboard",
	),
	stage(
		"动态剪辑",
		"节奏 + 运镜 + 转场 + 字幕",
		"完成适配平台观看习惯的动态剪辑。",
		["动态版本", "字幕", "转场"],
		"节奏、字幕和转场不影响理解。",
		"storyboard",
	),
	stage(
		"发布检查",
		"比例 + 安全区 + 封面 + 字幕 + CTA + QC",
		"在导出前排查平台和内容错误。",
		["发布 QC", "最终导出"],
		"画面比例、字幕安全区、封面、首屏 Hook、视频时长、CTA、Logo / 品牌信息、错字、AI 穿帮和最终导出规格全部通过。",
		"reference",
	),
	stage(
		"版本复盘",
		"不同版本 + 可复用资产 + 后续迭代",
		"比较版本表现并沉淀复用素材。",
		["版本对比", "复用资产表", "迭代建议"],
		"最佳版本和下一轮修改方向已记录。",
		"reference",
	),
]);
const experimentStages = identify([
	stage(
		"实验目标",
		"想验证什么 + 成功标准",
		"把练习变成可判断的实验。",
		["实验目标", "成功标准"],
		"目标与 PASS/FAIL 标准可判断。",
		"reference",
	),
	stage(
		"参考准备",
		"参考图 + Prompt + 模型 + 参数",
		"记录全部输入条件。",
		["参考图", "Prompt", "模型与参数"],
		"输入资产、模型和参数完整。",
		"reference",
	),
	stage(
		"生成测试",
		"静帧 / 素材 + 多版本生成",
		"生成不覆盖历史的候选版本。",
		["V01", "V02", "V03", "版本结果"],
		"每个版本均记录输入、结果与状态。",
		"reference",
	),
	stage(
		"动态测试",
		"动作 + 运镜 + 首尾帧测试",
		"测试动作、镜头和首尾帧组合。",
		["动态 Prompt", "首尾帧", "动态版本"],
		"动态结果可以按同一标准比较。",
		"storyboard",
	),
	stage(
		"实验结论",
		"版本对比 + QC + 最优方案 + 归档",
		"选出最佳版本并记录经验。",
		["版本对比", "PASS/FAIL", "最佳版本", "经验结论"],
		"最佳版本、失败原因和复用结论已归档。",
		"reference",
	),
]);
const customStages = identify([
	stage(
		"项目总控",
		"目标 + 规格 + 资产 + 镜头 + 版本 + QC",
		"提供空白、可扩展的统一项目状态。",
		["项目总控"],
		"由用户自行定义。",
		"overview",
	),
]);

export const productionTemplates: ProductionTemplate[] = [
	{
		id: "commercial-film",
		name: "商业广告",
		label: "商业广告",
		description: "完整生产流程",
		category: "commercial",
		complexityLabel: "10 Stage",
		stages: commercialStages,
	},
	{
		id: "comic-drama",
		name: "漫剧",
		label: "漫剧",
		description: "连续叙事生产流程",
		category: "serialized-story",
		complexityLabel: "10 Stage",
		stages: comicStages,
	},
	{
		id: "short-film",
		name: "短片",
		label: "短片",
		description: "完整影视流程",
		category: "narrative-film",
		complexityLabel: "10 Stage",
		stages: shortFilmStages,
	},
	{
		id: "social-content",
		name: "社交媒体内容",
		label: "社交媒体内容",
		description: "轻量内容生产",
		category: "social",
		complexityLabel: "8 Stage",
		stages: socialStages,
	},
	{
		id: "mini-experiment",
		name: "快速实验",
		label: "快速实验",
		description: "实验型生产",
		category: "experiment",
		complexityLabel: "5 Stage",
		stages: experimentStages,
	},
	{
		id: "custom",
		name: "自定义项目",
		label: "自定义项目",
		description: "空白模式",
		category: "custom",
		complexityLabel: "1 个总控文档",
		stages: customStages,
	},
];

export const defaultProductionTemplate = productionTemplates[0];
export const productionTemplateById = (id: string | null | undefined) =>
	productionTemplates.find((template) => template.id === id) ?? defaultProductionTemplate;
export const productionStageDocumentId = (templateId: ProductionTemplateId, order: number) =>
	`production-${templateId}-stage-${String(order).padStart(2, "0")}`;
export const productionTemplateSnapshot = (
	template: ProductionTemplate,
): ProductionTemplateSnapshot => ({
	id: template.id,
	name: template.name,
	description: template.description,
	category: template.category,
	version: 5,
	stages: template.stages.map((item) => ({ ...item })),
});

export const productionStageStates = (
	template: ProductionTemplate,
): Record<string, ProductionStageRuntimeState> =>
	Object.fromEntries(
		template.stages.map((item) => [
			item.id,
			{
				status: "NOT_STARTED" as const,
				documentId: productionStageDocumentId(template.id, item.order),
			},
		]),
	);

const stageContent = (
	template: ProductionTemplate,
	item: ProductionTemplateStage,
) => `# ${String(item.order).padStart(2, "0")} ${item.title}｜${item.subtitle}

<!-- production-stage: ${JSON.stringify({ templateId: template.id, stageId: item.id, order: item.order, status: "NOT_STARTED" })} -->

**阶段状态：** 未开始

${item.order > 1 ? "> ⚠ 上一阶段尚未标记为 PASS。你仍可继续查看和制作，但可能产生返工。\n" : ""}

## 本阶段目的

${item.purpose}

## 应交付内容

${item.outputs.map((output) => `- [ ] ${output}`).join("\n")}

## 输入与已锁定内容

## 制作过程

## 版本记录

| 版本 | 输入资产 / 模型 | Prompt / 参数 | 结果 | PASS / FAIL | 备注 |
| --- | --- | --- | --- | --- | --- |
| V01 |  |  |  |  |  |

## 问题 / Blocker

## 下一步行动

## Gate｜进入下一阶段前确认

${item.gate}
`;

const controlContent = (template: ProductionTemplate, projectName: string) => {
	const snapshot = productionTemplateSnapshot(template);
	const now = new Date().toISOString();
	return `# 00 项目总控｜${projectName}

<!-- production-template: ${template.id} -->
<!-- production-template-snapshot: ${JSON.stringify(snapshot)} -->

## 项目信息

- 项目名称：${projectName}
- 项目类型：${template.name}
- 创建时间：${now}
- 当前阶段：${template.id === "custom" ? "00 项目总控" : `01 ${template.stages[0]?.title ?? "待定义"}`}
- 整体进度：0%

## 项目规格

- 画幅：
- 分辨率：
- 目标时长：

## 生产状态

- 核心资产：0
- Shot 数量：0
- 已完成 Shot：0
- 待审核 Shot：0
- 当前版本：V01
- 最近修改时间：${now}

## 问题 / Blocker

- 暂无

## 下一步行动

- 完成“${template.stages[0]?.title ?? "项目总控"}”并提交审核。

## 阶段总览

${template.id === "custom" ? "- 自行增加阶段并使用统一 Stage 状态。" : snapshot.stages.map((item) => `- [ ] ${String(item.order).padStart(2, "0")} ${item.title}｜${item.subtitle}｜未开始`).join("\n")}
`;
};

export const buildProductionTemplateDocuments = (
	template: ProductionTemplate,
	projectName: string,
): ProductionTemplateDocument[] => {
	const control: ProductionTemplateDocument = {
		id: `production-${template.id}-control`,
		title: "00 项目总控｜目标、规格、资产、镜头、版本与 QC",
		category: "reference",
		content: controlContent(template, projectName),
		sortOrder: 0,
	};
	if (template.id === "custom") return [control];
	return [
		control,
		...template.stages.map((item) => ({
			id: productionStageDocumentId(template.id, item.order),
			title: `${String(item.order).padStart(2, "0")} ${item.title}｜${item.subtitle}`,
			category: item.category,
			content: stageContent(template, item),
			stageId: item.id,
			sortOrder: item.order,
		})),
	];
};

export const productionTemplateIdFromDocuments = (
	documents: Array<{ content: string }>,
): ProductionTemplateId => {
	for (const document of documents) {
		const value = document.content.match(/<!--\s*production-template:\s*([a-z-]+)\s*-->/i)?.[1];
		if (productionTemplates.some((template) => template.id === value))
			return value as ProductionTemplateId;
	}
	return defaultProductionTemplate.id;
};
