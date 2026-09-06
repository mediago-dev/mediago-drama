import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	Check,
	Clapperboard,
	ClipboardCheck,
	Crop,
	Image,
	Layers3,
	LockKeyhole,
	PencilLine,
	Plus,
	RefreshCcw,
	Trash2,
	Upload,
	Video,
	WandSparkles,
	Workflow,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GenerationQueue } from "../lib/generation-queue";
import type { ProductionPipeline } from "@/lib/overview/production-pipeline";
import type { ProjectProductionContext } from "@/lib/production/project-context";
import type { ProductionWorkbenchExecutionState } from "@/domains/projects/api/projects";
import type { ProjectProductionState, ProjectShotRecord } from "@/domains/projects/api/projects";
import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import {
	sendProjectGenerationMessage,
	updateSelectedGenerationAsset,
	waitForGenerationResult,
} from "@/domains/generation/api/generation";
import {
	generationAssetSelectionKey,
	generationAssetSource,
} from "@/domains/generation/hooks/generationCatalog";
import { refreshSelectedGenerationAssetDependents } from "@/domains/generation/lib/refresh-selected-assets";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";
import {
	getProjectAssets,
	uploadProjectAsset,
	type ProjectAsset,
} from "@/domains/workspace/api/project-assets";
import { uploadMediaAsset } from "@/domains/workspace/api/media";
import {
	productionStageStateLabels,
	type ProductionStageState,
} from "@/lib/production/production-templates";
import type { ProductionStageCapability } from "@/lib/production/production-stage-capability";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { ProductionPromptAssistant } from "@/domains/production/components/ProductionPromptAssistant";
import { runAgentPrompt } from "@/domains/agent/lib/controller";
import { getAgentChatState, listAgentSessions } from "@/domains/agent/api/agent";
import { selectAgentMessages } from "@/domains/agent/stores/selectors";
import { useAgentStore } from "@/domains/agent/stores/store";
import { useDocumentsStore } from "@/domains/documents/stores";
import {
	isStageOneScriptLocked,
	isStageOneStoryboardLocked,
	stageOneScriptApproval,
	stageOneStoryboardApproval,
} from "@/domains/production/lib/stage-one-deliverables";
import { useStoryboardPromptGeneration } from "@/domains/production/hooks/useStoryboardPromptGeneration";
import { selectLatestChatScriptDocument } from "@/domains/production/lib/latest-script-document";
import { apiResourceURL } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/utils";
import {
	promptWithContinuityRules,
	storyboardGridCrop,
} from "@/domains/production/lib/prompt-continuity";

type WorkbenchStep = "analysis" | "confirm" | "execute" | "review";

const defaultExecutionState = (): ProductionWorkbenchExecutionState => ({
	phase: "analysis",
	analysis: { facts: [], unknowns: [], risks: [] },
	note: "",
	updatedAt: "",
});

export const isUsableAssetPlan = (value: string) => {
	const text = value.trim();
	return (
		text.length >= 80 &&
		(/资产\s*(?:ID|编号)|资产清单|\b(?:CHR|SCN|PROP|FX|ASSET)[-_]?\d{1,3}\b/iu.test(text) ||
			/角色|人物|场景|道具|产品|特效|风格/u.test(text)) &&
		/使用镜头|镜头覆盖|\b(?:S|P)\d{2}\b/iu.test(text) &&
		!/reconnecting|request timed out|运行失败|连接失败|falling back from websocket/iu.test(text)
	);
};

export const assetPlanStoryboardCount = (value: string) => {
	const shotNumbers = [...value.matchAll(/\b(?:S|P)(\d{2})\b/giu)].map((match) => Number(match[1]));
	return shotNumbers.length > 0 ? Math.max(...shotNumbers) : 0;
};

export const assetPlanMatchesStoryboardCount = (value: string, count: number) =>
	isUsableAssetPlan(value) && assetPlanStoryboardCount(value) === count;

export const completedAssetPlanFromRun = (
	conversations: Array<{
		status: string;
		messages: Array<{
			id: string;
			role: string;
			content: string;
			kind?: string;
			status?: string;
			createdAt?: string;
		}>;
	}>,
	messagesBeforeRun: ReadonlySet<string>,
) => {
	const completed = conversations.some(
		(conversation) =>
			conversation.status === "completed" &&
			conversation.messages.some((message) => !messagesBeforeRun.has(message.id)),
	);
	if (!completed) return null;
	return (
		conversations
			.flatMap((conversation) => conversation.messages)
			.filter((message) => !messagesBeforeRun.has(message.id))
			.sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""))
			.find(
				(message) =>
					message.role === "assistant" &&
					(message.kind === "message" || !message.kind) &&
					message.status !== "error" &&
					isUsableAssetPlan(message.content),
			)?.content ?? null
	);
};

export const latestUsableAssetPlan = (
	conversations: Array<{
		messages: Array<{
			role: string;
			content: string;
			kind?: string;
			status?: string;
			createdAt?: string;
		}>;
	}>,
) =>
	conversations
		.flatMap((conversation) => conversation.messages)
		.sort((left, right) => {
			const assetCount = (value: string) =>
				new Set(value.match(/\b(?:CHR|CHAR|LOOK|SCN|PROP|FX|ASSET)-\d{1,3}\b/giu) ?? []).size;
			const coverageBonus = (value: string) => (/\b(?:S|P)24\b/iu.test(value) ? 100 : 0);
			const score = (value: string) => coverageBonus(value) + assetCount(value);
			return (
				score(right.content) - score(left.content) ||
				right.content.length - left.content.length ||
				(right.createdAt || "").localeCompare(left.createdAt || "")
			);
		})
		.find(
			(message) =>
				message.role === "assistant" &&
				(message.kind === "message" || !message.kind) &&
				message.status !== "error" &&
				isUsableAssetPlan(message.content),
		)?.content ?? null;

const imageMimeTypeForUpload = (file: File) => {
	if (file.type.startsWith("image/")) return file.type;
	const extension = file.name.split(".").pop()?.toLowerCase();
	return (
		{
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			png: "image/png",
			webp: "image/webp",
			gif: "image/gif",
			bmp: "image/bmp",
			tif: "image/tiff",
			tiff: "image/tiff",
		}[extension ?? ""] ?? ""
	);
};

type PlannedAssetCategory = "character" | "scene" | "prop" | "style";

interface PlannedAssetItem {
	id: string;
	category: PlannedAssetCategory;
	name: string;
	shotIds: string[];
	prompt: string;
	variant: string;
	requiredViews: string;
	referenceRequirement: string;
	immutable: string;
	priority: string;
}

const buildPlannedAssetPrompt = (item: PlannedAssetItem) =>
	[
		`【商业制作资产 Prompt｜${item.id}｜${item.name}】`,
		`制作目标：为镜头 ${item.shotIds.join("、") || "待绑定"} 建立可复用的${plannedAssetCategoryMeta[item.category].label}标准资产，不是概念草图。`,
		`主体与设定：${item.prompt}。必要变体：${item.variant || "标准版本"}。`,
		`交付视图：${item.requiredViews || "按镜头需求提供标准视图"}；同一画布内比例统一、无遮挡、不裁切关键结构。`,
		`视觉连续性：${item.referenceRequirement || "严格沿用项目已锁定 Visual DNA、人物比例、材质、色彩与渲染语言"}。`,
		`商业质量：造型和结构准确，轮廓清晰，材质物理逻辑可信，光影层次完整，细节可支撑 2K 成片与后续图生视频；避免廉价塑料感、过度磨皮、随机纹样和不可执行结构。`,
		`构图与背景：主体完整居中，保留合理安全边距；中性干净背景，不添加无关人物、道具、文字、水印或装饰。`,
		`锁定项：${item.immutable || "人物身份、脸型、发型、体型比例、核心造型、材质、产品结构和项目统一风格不得漂移"}。`,
		`负面约束：禁止身份漂移、五官变形、比例错误、多余肢体、重复物件、结构穿插、透视错误、材质混乱、低清晰度、伪文字、Logo 变形、画面脏乱。`,
		`输出：只生成 ${item.id} 这一项资产，高质量单图，横向 16:9，2K，便于作为后续镜头固定参考与版本母版。`,
	].join("\n");

const assetVisualBible = (item: PlannedAssetItem) => `【视觉生产标准｜锁定层】
造型一致性：锁死身份、脸型、眉眼、发型、年龄感、身材比例、服装版型与配色、鞋履、随身标识、道具/产品/Logo/建筑结构；角色换角度、动作和表情时不得重设计。角色交付必须兼容正面、左右侧面、背面、半身、全身、表情与手部。
材质：逐物体明确真实材质与粗糙度、反光、透明度、磨损；积木统一为 ABS plastic texture, subtle molded plastic sheen, not glossy CGI toy render。禁止用“高级质感”代替材质定义。
表面细节：${item.category === "style" ? "中等且受控" : "干净到中等"}，禁止随机划痕、污渍、纹路与过量褶皱。
灯光与曝光：明确光源类型、主光方向和光比；dark yet readable, open shadows, lifted blacks, preserved shadow detail, restrained highlights, wide dynamic range, soft highlight roll-off, no blown highlights。
色温与色彩：沿用项目母图的主色、辅色、点缀色、饱和度、肤色与黑位；no oversaturated neon；环境反射必须匹配所在场景。
渲染：严格沿用母图对应的写实摄影/实体模型摄影/广告 CG 等路径，不混用风格；完成度默认 Level B 普通广告 CG，只有镜头明确要求时才提升 Level C。
摄影机：服从关联镜头的焦段、机位、透视、景深、运动模糊与运镜；近景资产保留高细节，广角资产保留结构和尺度。
构图与比例：generous negative space, no cropped limbs, clear silhouette separation；锁定主体占比、头顶/脚底空间、物件尺寸关系及微缩尺度，给推拉摇移、转场和重构留安全区。
物理接触：轮廓干净无 halo/溶边；脚底、杯底和桌面物体有合理 contact shadow；AO 只增强结构，不得脏污；空气感和环境洁净度服从原镜头。
年代地域：建筑、路牌、车辆、插座、家具与服装必须服从项目设定。
复用与运动：结构可换角度、换动作、换镜头；头发、衣物、机械结构和手持物在视频运动中不得形变或增生。
一致性锚点：${item.immutable || "核心身份、造型、材质、颜色、比例、结构和标识永不改变"}。
参考图范围：只继承明确需要的身份、造型、材质、光线、色调、构图、尺度和摄影质感，不复制无关人物、文字或背景元素。
禁止项：no extra accessories, no added text, no logo changes, no redesign, no excessive surface details, no cyberpunk neon, no crushed blacks, no random props, no character duplication。`;

const shotNumber = (value: string) => Number(value.match(/\d+/u)?.[0] ?? 0);

const scriptShotExcerpt = (script: string, code: string) => {
	const number = shotNumber(code);
	if (!number) return "";
	const marker = new RegExp(`(?:^|\\n)#{0,3}\\s*[PS]0*${number}\\b`, "iu");
	const start = script.search(marker);
	if (start < 0) return "";
	const tail = script.slice(start);
	const next = tail.slice(1).search(/\n#{0,3}\s*[PS]\d{1,3}\b/iu);
	return (next >= 0 ? tail.slice(0, next + 1) : tail).trim().slice(0, 900);
};

const buildLockedAssetGenerationPrompt = (
	item: PlannedAssetItem,
	assetPrompt: string,
	shots: ProjectShotRecord[],
	script: string,
) => {
	const styleSignals = `${script}\n${assetPrompt}`.match(
		/(乐高|lego|积木|写实摄影|定格动画|3d|三维|产品广告|商业广告|实体模型|插画|动漫|水彩|低模|pbr|电影级)/giu,
	);
	const projectStyleLock = styleSignals?.length
		? `【项目级风格母版｜最高优先级】\n项目已明确的风格信号：${[...new Set(styleSignals.map((value) => value.toLowerCase()))].join("、")}。所有资产必须沿用这些风格信号；分镜参考图只按明确用途读取，不得覆盖项目风格。若项目包含乐高/积木信号，强制使用 LEGO-style brick-built miniature、LEGO minifigure、ABS plastic、toy-scale proportions，禁止真人比例和真人皮肤。若项目为其他风格，严格以该项目自身风格信号为准，不得套用乐高或其他项目规则。\n`
		: "【项目级风格母版｜最高优先级】\n未检测到明确风格信号，请先以项目母图与已锁定 Visual DNA 为准，不得自行改变渲染路径。\n";
	assetPrompt = `${projectStyleLock}${assetPrompt}`;
	const ordered = [...shots].sort((left, right) => left.sequence - right.sequence);
	const contexts = item.shotIds.map((code) => {
		const number = shotNumber(code);
		const index = ordered.findIndex((shot) => shotNumber(shot.shotCode) === number);
		const shot = ordered[index];
		const previous = index > 0 ? ordered[index - 1]?.shotCode : "片头";
		const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1]?.shotCode : "片尾";
		return `${code}｜${shot?.title || "镜头"}｜${shot?.description || "按锁定分镜画面"}｜承接 ${previous}，交给 ${next}\n${scriptShotExcerpt(script, code)}`;
	});
	return `${assetPrompt.trim()}\n\n${assetVisualBible(item)}\n\n【镜头、运镜与转场兼容层】\n${contexts.join("\n\n") || "按锁定分镜母图与项目镜头关系执行。"}\n同一资产必须同时满足上述全部镜头；构图需为后续推、拉、摇、移、跟拍、擦镜、遮挡转场和首尾帧延展保留空间。不得为某一镜头擅自改变锁定身份、结构、材质、Logo、比例或视觉锚点。\n\n【生成前强制自检】\n逐项对照：造型锁定、材质、细节密度、光源与方向、光比、色温、曝光、渲染级别、摄影机、景深、比例尺度、色彩、黑位、高光、边缘、环境反射、接触阴影、AO、空气感、洁净度、年代地域、复用性、近景细节、运动兼容、一致性锚点、禁止项。任何一项冲突时以锁定层和已归档母版为最高优先级。`;
};

const plannedAssetCategoryMeta: Record<
	PlannedAssetCategory,
	{ label: string; description: string }
> = {
	character: { label: "角色与造型", description: "人物三视图、服装、妆发与必要造型变体" },
	scene: { label: "场景与背景", description: "可复用场景、时段、天气与空间变体" },
	prop: { label: "道具与产品", description: "产品、关键道具、包装与交互物件" },
	style: { label: "特效与风格", description: "特效、灯光、材质与统一风格基准" },
};

const inferPlannedAssetCategory = (value: string): PlannedAssetCategory => {
	if (/角色|人物|主角|配角|造型|服装|妆发|三视图|character|look/iu.test(value)) return "character";
	if (/场景|背景|环境|空间|室内|室外|街道|屋顶|scene|background/iu.test(value)) return "scene";
	if (/特效|风格|灯光|材质|粒子|光效|氛围|fx|style|lighting/iu.test(value)) return "style";
	return "prop";
};

const PlannedAssetPreview: React.FC<{
	generatedSource?: string;
	item: PlannedAssetItem;
	storyboardCrop?: { x: number; y: number; width: number; height: number };
	storyboardSource?: string;
	previewShotId?: string;
}> = ({ generatedSource, item, storyboardCrop, storyboardSource, previewShotId }) => {
	const sourceShot = previewShotId || item.shotIds[0] || "";
	const gridCrop = storyboardGridCrop(sourceShot);
	return (
		<div className="relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted">
			{generatedSource ? (
				<img
					src={generatedSource}
					alt={`${item.name} 已生成资产`}
					className="size-full object-cover"
				/>
			) : storyboardSource ? (
				<img
					src={storyboardSource}
					alt={`${item.name} 分镜参考 ${sourceShot}`}
					className="absolute max-w-none object-cover"
					style={{
						height: storyboardCrop ? `${(1 / storyboardCrop.height) * 100}%` : "400%",
						left: storyboardCrop
							? `${(-storyboardCrop.x / storyboardCrop.width) * 100}%`
							: `${-gridCrop.column * 100}%`,
						top: storyboardCrop
							? `${(-storyboardCrop.y / storyboardCrop.height) * 100}%`
							: `${-gridCrop.row * 100}%`,
						width: storyboardCrop ? `${(1 / storyboardCrop.width) * 100}%` : "500%",
					}}
				/>
			) : (
				<div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
					<Image className="size-5" />
					<span className="text-[10px]">等待分镜参考</span>
				</div>
			)}
			<span className="absolute bottom-1.5 left-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[9px] font-medium text-foreground shadow-sm">
				{generatedSource ? "正式资产" : sourceShot ? `分镜参考 · ${sourceShot}` : "分镜参考"}
			</span>
		</div>
	);
};

export const parsePlannedAssets = (plan: string): PlannedAssetItem[] => {
	const consolidatedStart = plan.search(/#{1,6}\s*(?:最少但足够的)?资产清单/u);
	const afterStart = consolidatedStart >= 0 ? plan.slice(consolidatedStart) : plan;
	const consolidatedEnd = afterStart.search(/\n#{1,6}\s*(?:数量汇总|镜头覆盖|覆盖检查)/u);
	const source = consolidatedEnd > 0 ? afterStart.slice(0, consolidatedEnd) : afterStart;
	const rows = source
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const items: PlannedAssetItem[] = [];
	const seen = new Set<string>();
	let currentCategory: PlannedAssetCategory | null = null;
	for (const row of rows) {
		if (/^#{1,6}\s/.test(row)) {
			currentCategory = inferPlannedAssetCategory(row);
			continue;
		}
		const cells = row.startsWith("|")
			? row
					.split("|")
					.map((cell) => cell.trim())
					.filter(Boolean)
			: row
					.replace(/^[-*+]\s+/, "")
					.split(/\s*[｜|]\s*/)
					.map((cell) => cell.trim());
		if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
		const joined = cells.join("｜");
		if (/资产ID.*分类.*资产名称|必要变体.*使用镜头.*必须生成/u.test(joined)) continue;
		if (/^镜头(?:｜|$)|^人物身份与造型(?:｜|$)/u.test(joined)) continue;
		if (/^(?:S|P)\d{2}$/iu.test(cells[0] ?? "")) continue;
		const explicitId = joined.match(
			/\b(?:CHR|CHAR|LOOK|SCN|SCENE|BG|PRD|PRP|PROP|PRODUCT|FX|STYLE|ASSET)[-_]?\d{1,3}\b/i,
		)?.[0];
		const looksLikeAsset = Boolean(
			explicitId ||
			/^\d{1,3}[.)、]/.test(cells[0] ?? "") ||
			(/资产|三视图|造型|服装|场景|背景|道具|产品|特效|风格/.test(joined) &&
				!/逐镜|镜头记录|结论|原则|版本冲突|第一遍|第二遍/.test(joined)),
		);
		if (!looksLikeAsset) continue;
		const shotIds = Array.from(new Set(joined.match(/\b(?:S|P)\d{2}\b/gi) ?? [])).map((id) =>
			id.toUpperCase(),
		);
		const idIndex = explicitId
			? cells.findIndex((cell) => cell.toUpperCase().includes(explicitId.toUpperCase()))
			: -1;
		const category =
			idIndex >= 0
				? inferPlannedAssetCategory(cells[idIndex + 1] ?? joined)
				: (currentCategory ?? inferPlannedAssetCategory(joined));
		const nameCell =
			cells.find(
				(cell) =>
					!/^\d{1,3}[.)、]?$/.test(cell) &&
					!/^\b(?:CHR|CHAR|LOOK|SCN|SCENE|BG|PRD|PRP|PROP|PRODUCT|FX|STYLE|ASSET)[-_]?\d{1,3}\b$/i.test(
						cell,
					) &&
					!/^\b(?:S|P)\d{2}(?:[,，、\s]+(?:S|P)\d{2})*\b$/i.test(cell),
			) ?? `${plannedAssetCategoryMeta[category].label}资产`;
		const name = (idIndex >= 0 ? (cells[idIndex + 2] ?? nameCell) : nameCell)
			.replace(/\*\*/g, "")
			.replace(/^\d{1,3}[.)、]\s*/, "")
			.trim();
		const key = `${category}:${name.toLowerCase()}`;
		if (!name || seen.has(key)) continue;
		seen.add(key);
		items.push({
			id:
				explicitId?.toUpperCase() ??
				`${category.toUpperCase()}-${String(items.length + 1).padStart(2, "0")}`,
			category,
			name,
			shotIds,
			prompt: idIndex >= 0 ? (cells[idIndex + 7] ?? joined) : joined,
			variant:
				idIndex >= 0
					? (cells[idIndex + 3] ?? "标准版本")
					: (cells.find((cell) => /三视图|造型|服装|变体|时段|天气|首尾帧/.test(cell)) ??
						"标准版本"),
			requiredViews: idIndex >= 0 ? (cells[idIndex + 5] ?? "") : "",
			referenceRequirement: idIndex >= 0 ? (cells[idIndex + 6] ?? "") : "",
			immutable: idIndex >= 0 ? (cells[idIndex + 8] ?? "") : "",
			priority: idIndex >= 0 ? (cells[idIndex + 9] ?? "") : "",
		});
	}
	return items.slice(0, 80);
};

interface StageWorkspaceDefinition {
	title: string;
	summary: string;
	inputs: string[];
	outputs: string[];
}

/**
 * 01—10 是十种不同的制作任务，不是同一份表单的十个副本。
 * 这些定义只描述当前工作面；模板的名称、Gate 和状态仍来自项目快照。
 */
const stageWorkspaceDefinitions: Record<ProductionStageCapability, StageWorkspaceDefinition> = {
	brief: {
		title: "需求、脚本与分镜定稿",
		summary: "先让制作助理证据化理解需求，你确认后再生成脚本和分镜总览。",
		inputs: ["原始需求与规格", "参考图及用途", "不可改变的规则"],
		outputs: ["已确认 Brief", "脚本版本", "分镜示意图"],
	},
	script: {
		title: "故事、剧情与脚本定稿",
		summary: "把已确认设定变成可审核、可拆镜的脚本，并保留修改意见与版本。",
		inputs: ["已确认设定", "故事目标", "人物和世界规则"],
		outputs: ["脚本版本", "审核意见", "可拆镜剧情结构"],
	},
	reference: {
		title: "参考图、Visual DNA 与生成准备",
		summary: "先做证据化拆解，再明确哪些特征可迁移、哪些不能照搬。",
		inputs: ["多张参考图", "每张图的用途", "目标角色与项目资产"],
		outputs: ["证据化拆解", "可迁移 Visual DNA", "生成提示词"],
	},
	"shot-breakdown": {
		title: "分镜内容与资产关系拆解",
		summary: "逐镜识别人、景、物、产品和特效，再跨镜合并复用项，决定最少但够用的资产数量。",
		inputs: ["已确认脚本", "分镜总览图", "镜头数量与顺序"],
		outputs: ["Shot List", "分镜—资产关系", "已确认资产清单"],
	},
	"asset-plan": {
		title: "整理、修改并确认资产 Prompt",
		summary:
			"这一阶段只管理提示词，不生成图片；可以修改、保存、复制到外部平台，确认后再交给第 04 步。",
		inputs: ["已确认资产清单", "资产 Prompt", "参考图 / Visual DNA"],
		outputs: ["已确认资产 Prompt", "禁止改变项", "镜头用途与生成规格"],
	},
	"asset-production": {
		title: "资产制作：Prompt、版本与镜头关系",
		summary: "在同一处修改或复制 Prompt，再生成、上传和查看版本；所有版本自动保留并绑定镜头。",
		inputs: ["已确认资产清单", "资产 Prompt", "参考图 / Visual DNA"],
		outputs: ["可编辑 Prompt", "资产版本", "镜头绑定关系"],
	},
	"image-generation": {
		title: "图片生成与版本管理",
		summary: "用已确认 Prompt 生成图片，或导入外部结果；每个版本自动归档并绑定镜头。",
		inputs: ["资产 Prompt", "多张参考图", "模型与输出规格"],
		outputs: ["V01+ 生成结果", "外部导入记录", "资产库归档"],
	},
	"asset-qc": {
		title: "资产覆盖与一致性审核",
		summary: "不是给阶段改个状态，而是找出缺失、错误和无法支撑镜头的具体资产。",
		inputs: ["待审资产版本", "镜头资产需求", "一致性规则"],
		outputs: ["通过版本", "需修改项", "缺失资产清单"],
	},
	"shot-execution": {
		title: "单镜执行图与首尾帧",
		summary: "以镜头为单位调用已审核资产，完成可直接用于动态制作的画面。",
		inputs: ["镜头卡", "已通过资产", "构图与连续性规则"],
		outputs: ["单镜执行图", "首帧 / 尾帧", "镜头资产绑定"],
	},
	"motion-design": {
		title: "动作、运镜与动态 Prompt",
		summary: "为每个已确认单镜设计动作节拍、运动方向、运镜和不可改变项。",
		inputs: ["单镜执行图", "首尾帧", "动作与镜头连续性"],
		outputs: ["动作 Prompt", "运镜 Prompt", "图生视频 Prompt"],
	},
	"video-qc": {
		title: "视频版本导入与镜头 QC",
		summary: "按镜头管理内部或外部生成视频，替换当前版本但绝不覆盖历史。",
		inputs: ["动态 Prompt", "镜头视频版本", "QC 标准"],
		outputs: ["视频版本链", "通过 / 失败原因", "可用镜头清单"],
	},
	"final-qc": {
		title: "成片审查与交付",
		summary: "统一检查画面、配音、音乐、字幕、调色和导出规格，明确是否真的可交付。",
		inputs: ["通过的镜头视频", "声音与字幕", "交付规格"],
		outputs: ["Final Master", "最终 QC", "交付文件"],
	},
	retrospective: {
		title: "经验、规则与案例沉淀",
		summary: "自动汇总成功版本、失败原因和可复用规则，让下一个项目直接继承。",
		inputs: ["全部 Prompt 与版本", "QC 与返工记录", "最终通过产物"],
		outputs: ["复盘报告", "可复用 Prompt / 规则", "新项目模板资料"],
	},
	custom: {
		title: "自定义项目总控",
		summary: "自由记录目标、规格、资产、镜头、版本和 QC，需要时再新增阶段。",
		inputs: ["项目目标", "制作规格", "已有素材"],
		outputs: ["项目总控", "自定义阶段", "可追溯产物"],
	},
};

const commercialWorkspaceDefinitions: Record<string, StageWorkspaceDefinition> = {
	创意与分镜定稿: {
		title: "从聊天提取或上传脚本，生成或上传分镜母图",
		summary:
			"脚本既可由制作助理在对话中生成并自动锁定，也可粘贴网页 GPT 的版本后手动锁定；分镜母图既可在站内快速生成，也可上传外部成图，确认后统一解析镜头与资产。",
		inputs: ["项目目标与规格", "对话生成或外部粘贴的脚本", "站内生成或外部上传的分镜母图"],
		outputs: ["已锁定脚本", "已锁定24格分镜母图", "可拆分的镜头母版"],
	},
	分镜与资产关系: {
		title: "把已确认分镜图拆成独立镜头",
		summary: "按格建立 S01、S02…镜头卡，不重写故事，并保留每个镜头的构图和连续性。",
		inputs: ["已确认分镜图", "文字分镜", "镜头数量与顺序"],
		outputs: ["Shot List", "独立镜头卡", "镜头封面"],
	},
	参考与需求: {
		title: "上传参考图，让助理先理解你要做什么",
		summary: "先锁定需求和视觉方向；这一阶段不写脚本，也不生成分镜图。",
		inputs: ["项目目标与规格", "一张或多张参考图", "每张参考图的用途"],
		outputs: ["已确认需求", "Visual DNA", "不可照搬项"],
	},
	故事推导: {
		title: "根据已确认需求推导故事",
		summary: "只讨论故事梗概、人物、冲突和情绪曲线；你确认方向后再写完整脚本。",
		inputs: ["已确认需求", "Visual DNA", "品牌或主题目标"],
		outputs: ["故事方案", "人物关系", "情绪曲线"],
	},
	剧情脚本: {
		title: "把故事方案写成完整剧情脚本",
		summary: "明确场景、动作、对白、旁白和时长，经过审核后才能进入分镜设计。",
		inputs: ["已确认故事方案", "人物与世界规则", "时长与品牌要求"],
		outputs: ["剧情脚本", "对白与旁白", "脚本审核记录"],
	},
	文字分镜: {
		title: "把脚本拆成逐镜文字分镜",
		summary: "逐镜设计景别、构图、动作、运镜、声音和时长；这一步只写专业分镜文章。",
		inputs: ["已确认剧情脚本", "画幅与时长", "连续性规则"],
		outputs: ["Shot List", "逐镜文字分镜", "镜头连续性"],
	},
	分镜图: {
		title: "根据文字分镜生成并审核分镜图",
		summary: "生成后按格拆成 S01、S02…镜头卡，并保留文字分镜与图片之间的来源关系。",
		inputs: ["已确认文字分镜", "视觉方向", "镜头数量与顺序"],
		outputs: ["分镜示意图", "独立镜头卡", "镜头封面"],
	},
	资产制作: stageWorkspaceDefinitions["asset-production"],
	单镜执行设计: {
		title: "逐镜生成可执行方案与视频 Prompt",
		summary: "自动带入该镜头已通过的资产，设计时长、动作、运镜、首尾帧和前后镜连续性。",
		inputs: ["分镜图与镜头卡", "已通过资产", "前后镜连续性"],
		outputs: ["单镜执行稿", "动作与运镜 Prompt", "首尾帧关系"],
	},
	视频生成: {
		title: "逐镜提交视频生成并自动归档",
		summary: "调用 LibTV、TapNow 等视频接口，自动绑定镜头、执行稿、使用资产、Prompt 和版本。",
		inputs: ["单镜执行稿", "视频 Prompt", "参考资产 / 首尾帧"],
		outputs: ["视频任务", "镜头视频版本", "失败与重试记录"],
	},
	视频归档与粗剪: stageWorkspaceDefinitions["video-qc"],
	成片审查: stageWorkspaceDefinitions["final-qc"],
	项目复盘: stageWorkspaceDefinitions.retrospective,
};

const stageWorkspaceDefinition = (capability: ProductionStageCapability, stageLabel?: string) =>
	(stageLabel ? commercialWorkspaceDefinitions[stageLabel] : undefined) ??
	stageWorkspaceDefinitions[capability];

const productionStageDisplayLabel = (stage: {
	order: number;
	label: string;
	capability: ProductionStageCapability;
}) => {
	if (stage.order === 2 && stage.capability === "shot-breakdown") return "分镜与资产拆解";
	if (stage.order === 3 && stage.capability === "asset-production") return "资产制作";
	return stage.label;
};

/**
 * 分镜示意图通常是多格排版，而不是一张长图竖切。
 * 常用分镜母图使用明确的列数，避免用平方根猜测后把 20/24 格误切为 4×5/5×5。
 * 裁切区域保存在镜头记录中，所以刷新、换页面后仍能恢复同一格。
 */
const storyboardCropForSequence = (sequence: number, count: number) => {
	const safeCount = Math.max(1, count);
	const columns =
		safeCount === 6
			? 3
			: safeCount === 12
				? 4
				: safeCount === 20
					? 5
					: safeCount === 21
						? 7
						: safeCount === 24
							? 6
							: safeCount === 36
								? 6
								: Math.max(1, Math.ceil(Math.sqrt(safeCount)));
	const rows = Math.max(1, Math.ceil(safeCount / columns));
	const index = Math.max(0, sequence - 1);
	const column = index % columns;
	const row = Math.floor(index / columns);

	// 当前测试分镜是 3×2 网格，按实际画面边界裁切：
	// 左右约 2.8% 边距、上下两行分别从 9.1% 和 56.6% 开始。
	// 这样不会把纸张白边、编号或相邻画格混进镜头卡。
	if (safeCount === 6) {
		const columnStarts = [0.028, 0.347, 0.667];
		const rowStarts = [0.091, 0.566];
		const cellWidth = 0.306;
		const cellHeight = 0.316;
		return {
			x: columnStarts[column] ?? column * (1 / columns),
			y: rowStarts[row] ?? row * (1 / rows),
			width: cellWidth,
			height: cellHeight,
		};
	}

	const insetX = 0;
	const insetY = 0;
	const cellWidth = 1 / columns;
	const cellHeight = 1 / rows;
	return {
		x: column * cellWidth + insetX,
		y: row * cellHeight + insetY,
		width: Math.max(0.01, cellWidth - insetX * 2),
		height: Math.max(0.01, cellHeight - insetY * 2),
	};
};

const displayedStoryboardCrop = (shot: ProjectShotRecord, count: number) => {
	const crop = shot.storyboardCrop;
	if (!crop) return storyboardCropForSequence(shot.sequence, count);
	const isLegacyTwentyGrid =
		count === 20 && Math.abs(crop.width - 0.25) < 0.001 && Math.abs(crop.height - 0.2) < 0.001;
	const isLegacyTwentyFourGrid =
		count === 24 && Math.abs(crop.width - 0.2) < 0.001 && Math.abs(crop.height - 0.2) < 0.001;
	return isLegacyTwentyGrid || isLegacyTwentyFourGrid
		? storyboardCropForSequence(shot.sequence, count)
		: crop;
};

type SharedDraftField =
	| "storyOutline"
	| "script"
	| "storyboardBrief"
	| "shotBreakdown"
	| "assetPlan"
	| "motionPlan"
	| "finalReviewNotes";

const stageDraftConfig = (
	capability: ProductionStageCapability,
	stageLabel?: string,
): {
	field: SharedDraftField;
	label: string;
	placeholder: string;
	description: string;
} | null => {
	switch (capability) {
		case "script":
			if (/故事推导/.test(stageLabel ?? ""))
				return {
					field: "storyOutline",
					label: "故事方案",
					placeholder:
						"写清故事梗概、主角、核心冲突、情绪曲线、品牌落点，以及为什么适合当前参考图调性。",
					description: "这里只确认故事方向，不提前写完整脚本，也不生成分镜图。",
				};
			if (/文字分镜/.test(stageLabel ?? ""))
				return {
					field: "shotBreakdown",
					label: "逐镜文字分镜",
					placeholder:
						"按 S01、S02…逐镜写景别、构图、人物动作、对白/旁白、运镜、时长、转场和连续性要求。",
					description: "文字分镜确认后，下一阶段才把它生成为分镜示意图。",
				};
			return {
				field: "script",
				label: "剧情脚本",
				placeholder: "写清人物、冲突、情绪曲线、对白、结尾和不能改变的故事事实。",
				description: "脚本会被下游分镜、资产和镜头阶段自动读取。",
			};
		case "asset-plan":
			return {
				field: "assetPlan",
				label: "第 02 步确认的资产生成清单",
				placeholder: "请先在第 02 步分析并确认资产清单。这里按清单逐项生成，不重新拆解分镜。",
				description: "每个资产都必须保留资产 ID、使用镜头、Prompt、参考图和版本。",
			};
		case "motion-design":
			return {
				field: "motionPlan",
				label: "单镜画面 → 动作与动态图 Prompt",
				placeholder:
					"写清首帧、尾帧、主体动作、运动方向、镜头运动、速度、物理限制和不可改变的角色/产品信息。",
				description: "确认动作设计后，再提交到图生视频或外部平台；每次结果都保留版本。",
			};
		case "final-qc":
			return {
				field: "finalReviewNotes",
				label: "Final 成片审查记录",
				placeholder: "记录配音、音乐、字幕、调色、画幅、分辨率、错字、AI 穿帮和最终交付结论。",
				description: "Final 不是导出按钮，而是对成片是否能交付的最后一次审查。",
			};
		default:
			return null;
	}
};

export interface ProductionWorkbenchProps {
	name: string;
	projectId: string;
	pipeline: ProductionPipeline;
	/** 路由指定的阶段；新建项目默认是 stage-1，继续制作可由项目当前阶段决定。 */
	initialStageId?: string | null;
	resourceCount: number;
	selectedAssetCount: number;
	shotCount: number;
	savingStageId: string | null;
	onStateChange: (stageId: string, status: ProductionStageState | null) => void;
	onCompletionChange: (stageId: string, completion: number) => void;
	onOpenStage: (stage: ProductionPipeline["stages"][number]) => void;
	onOpenWorkspace: (workspace: "reference" | "assets" | "shots") => void;
	executionStates?: Record<string, ProductionWorkbenchExecutionState>;
	onExecutionStateChange: (stageId: string, state: ProductionWorkbenchExecutionState) => void;
	onProductionPatch?: (patch: Partial<ProjectProductionState>) => void;
	/** 项目资产库中已归档的媒体，用于将分镜示意图作为镜头拆解上游。 */
	catalogAssets?: SelectedGenerationAsset[];
	context?: ProjectProductionContext;
}

export const ProductionWorkbench: React.FC<ProductionWorkbenchProps> = ({
	name,
	projectId,
	pipeline,
	initialStageId,
	resourceCount,
	selectedAssetCount,
	shotCount,
	savingStageId,
	onStateChange,
	onCompletionChange,
	onOpenStage,
	onOpenWorkspace,
	executionStates,
	onExecutionStateChange,
	onProductionPatch,
	catalogAssets = [],
	context,
}) => {
	const setAgentLayoutTab = useAgentLayoutStore((state) => state.setTab);
	const setAgentPanelSize = useAgentLayoutStore((state) => state.setPanelSize);
	const openAgent = () => {
		setAgentPanelSize("expanded");
		setAgentLayoutTab("agent");
	};
	const openGenerationDialog = useMediaGenerationStore((state) => state.open);
	const activeStage =
		pipeline.stages.find((stage) => stage.status === "current") ??
		pipeline.stages.find((stage) => stage.state !== "PASS") ??
		pipeline.stages.at(-1);
	const [selectedStageId, setSelectedStageId] = useState(
		initialStageId && pipeline.stages.some((stage) => stage.id === initialStageId)
			? initialStageId
			: (activeStage?.id ?? ""),
	);
	const [legacyMemory, setLegacyMemory] =
		useState<ProductionWorkbenchExecutionState>(defaultExecutionState);
	// Keep a local optimistic copy for the current stage. The parent persists this
	// asynchronously; without the override, the next render can still receive the
	// previous execution state and make the confirmation button look unchanged.
	const [localMemoryOverrides, setLocalMemoryOverrides] = useState<
		Record<string, ProductionWorkbenchExecutionState>
	>({});
	const memory =
		localMemoryOverrides[selectedStageId] ?? executionStates?.[selectedStageId] ?? legacyMemory;
	const [scriptDraft, setScriptDraft] = useState(context?.production?.sharedContext?.script ?? "");
	const [storyboardDraft, setStoryboardDraft] = useState(
		context?.production?.sharedContext?.storyboardBrief ?? "",
	);
	const [styleMasterDraft, setStyleMasterDraft] = useState(() => {
		const value = context?.production?.sharedContext?.visualDNA;
		if (!value) return "";
		const master = value as { styleBible?: string; referenceImages?: Array<{ url: string }> };
		return [
			master.styleBible ?? "",
			...(master.referenceImages ?? []).map((image) => `项目母图：${image.url}`),
		]
			.filter(Boolean)
			.join("\n");
	});
	const [styleMasterImage, setStyleMasterImage] = useState<string>("");
	const [styleMasterUsages, setStyleMasterUsages] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			(
				(
					context?.production?.sharedContext?.visualDNA as {
						referenceImages?: Array<{ url: string; usage?: string }>;
					}
				)?.referenceImages ?? []
			).map((image) => [image.url, image.usage ?? ""]),
		),
	);
	const [styleMasterLocked, setStyleMasterLocked] = useState(() =>
		Boolean(
			context?.production?.sharedContext?.visualDNA &&
			((context.production.sharedContext.visualDNA as { locked?: boolean; source?: string })
				.locked ??
				(context.production.sharedContext.visualDNA as { source?: string }).source ===
					"project-master"),
		),
	);
	const styleMasterImages = Array.from(
		new Set(
			(styleMasterDraft.match(/https?:\/\/[^\s\n"<>]+/giu) ?? []).map((url) =>
				url.replace(/[，。；;）)]+$/u, ""),
			),
		),
	);
	const [stageDraft, setStageDraft] = useState("");
	const [assetPlanDraft, setAssetPlanDraft] = useState(
		context?.production?.sharedContext?.assetPlan ?? "",
	);
	const [assetPromptDrafts, setAssetPromptDrafts] = useState<Record<string, string>>(
		context?.production?.sharedContext?.prompts ?? {},
	);
	const [isAnalyzingAssets, setIsAnalyzingAssets] = useState(false);
	const [assetAnalysisError, setAssetAnalysisError] = useState("");
	const [assetUploadTarget, setAssetUploadTarget] = useState<PlannedAssetItem | null>(null);
	const [assetUploadError, setAssetUploadError] = useState("");
	const [copiedAssetId, setCopiedAssetId] = useState<string | null>(null);
	const [previewShotOverrides, setPreviewShotOverrides] = useState<Record<string, string>>({});
	const [assetVersionOverrides, setAssetVersionOverrides] = useState<Record<string, string>>({});
	const [assistantAssetRequest, setAssistantAssetRequest] = useState<{
		id: string;
		field?: "tree" | "generation";
		requestId: number;
	} | null>(null);
	const [generationFocusAssetId, setGenerationFocusAssetId] = useState("");
	const [codexGeneratingAssetIds, setCodexGeneratingAssetIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [codexGenerationError, setCodexGenerationError] = useState("");
	const [apiGeneratingAssetIds, setAPIGeneratingAssetIds] = useState<Set<string>>(() => new Set());
	const apiGenerationInFlightRef = useRef(new Set<string>());
	const codexGenerationInFlightRef = useRef(new Set<string>());
	const generationQueue = useRef(new GenerationQueue());
	const generationReferenceUploads = useRef(new Map<string, Promise<string>>());
	const [queueRunning, setQueueRunning] = useState(false);
	const [queueCancelled, setQueueCancelled] = useState(false);
	useEffect(
		() => () => {
			generationQueue.current.cancel();
		},
		[projectId],
	);
	const [isBatchGeneratingAPI, setIsBatchGeneratingAPI] = useState(false);
	const [isBatchGeneratingCodex, setIsBatchGeneratingCodex] = useState(false);
	const [apiGenerationError, setAPIGenerationError] = useState("");
	const [generationPromptEditor, setGenerationPromptEditor] = useState<{
		item: PlannedAssetItem;
		mode: "codex" | "api";
		prompt: string;
	} | null>(null);
	const [shotCountDraft, setShotCountDraft] = useState(24);
	const [storyboardAssetId, setStoryboardAssetId] = useState("");
	const [storyboardUploadState, setStoryboardUploadState] = useState<
		"idle" | "uploading" | "error"
	>("idle");
	const [storyboardUploadError, setStoryboardUploadError] = useState("");
	const [uploadingShotId, setUploadingShotId] = useState<string | null>(null);
	const [shotUploadError, setShotUploadError] = useState("");
	const [activeExecutionShotId, setActiveExecutionShotId] = useState("");
	const [referencePreviewAsset, setReferencePreviewAsset] =
		useState<SelectedGenerationAsset | null>(null);
	const [editingShotPrompt, setEditingShotPrompt] = useState<{
		kind: "execution" | "video";
		value: string;
	} | null>(null);
	const [optimisticShots, setOptimisticShots] = useState<Record<string, ProjectShotRecord>>({});
	const [stageNavigationSlot, setStageNavigationSlot] = useState<HTMLElement | null>(null);
	const scriptTextareaRef = useRef<HTMLTextAreaElement>(null);
	const scriptUploadInputRef = useRef<HTMLInputElement>(null);
	const storyboardUploadInputRef = useRef<HTMLInputElement>(null);
	const styleMasterUploadInputRef = useRef<HTMLInputElement>(null);
	const assetUploadInputRef = useRef<HTMLInputElement>(null);
	const incomingScriptRef = useRef(context?.production?.sharedContext?.script ?? "");
	const autoShotInitializationRef = useRef(false);
	const autoAssetAnalysisRef = useRef("");

	const selectedStage =
		pipeline.stages.find((stage) => stage.id === selectedStageId) ?? activeStage;
	const workspaceDefinition = stageWorkspaceDefinition(
		selectedStage?.capability ?? "custom",
		selectedStage?.label,
	);
	const scriptLocked = isStageOneScriptLocked(context?.production?.sharedContext?.approvedContent);
	const storyboardLocked = isStageOneStoryboardLocked(
		context?.production?.sharedContext?.approvedContent,
	);
	const agentMessages = useAgentStore(selectAgentMessages);
	const agentIsRunning = useAgentStore((state) => state.isRunning);
	const addAgentAssistantMessage = useAgentStore((state) => state.addAssistantMessage);
	const workspaceDocuments = useDocumentsStore((state) => state.documents);
	const storyboardPromptGeneration = useStoryboardPromptGeneration(projectId);
	const stageIncludesAssetQC = Boolean(
		selectedStage &&
		(selectedStage.capability === "asset-qc" ||
			(context?.templateId === "commercial-film" && selectedStage.order === 3) ||
			(selectedStage.capability === "image-generation" &&
				/QC|审核/i.test(`${selectedStage.description} ${selectedStage.purpose}`))),
	);
	const productionStageAssets = useMemo(
		() =>
			stageIncludesAssetQC
				? catalogAssets.filter((asset) => asset.resourceType !== "storyboard")
				: catalogAssets,
		[catalogAssets, stageIncludesAssetQC],
	);
	const openProjectGeneration = (
		kind: "image" | "video",
		options: {
			prompt?: string;
			shotIds?: string[];
			heading?: string;
			resourceId?: string;
			resourceType?: "character" | "scene" | "prop" | "storyboard";
			selectedAssetKeys?: string[];
		} = {},
	) => {
		const heading = options.heading ?? (kind === "image" ? "项目图片生成" : "项目视频生成");
		const prompt = options.prompt?.trim() ?? "";
		openGenerationDialog({
			forceSingleOutput: options.heading?.includes("24格分镜母图") ?? false,
			kind,
			projectId,
			resolveLatestSection: false,
			selectedAssetResourceType:
				options.resourceType ??
				(options.heading?.includes("24格分镜母图") ? "storyboard" : undefined),
			statusResourceKey: options.resourceId,
			shotIds: options.shotIds,
			selectedAssetKeys: options.selectedAssetKeys,
			section: {
				blockId: options.resourceId ?? "",
				documentId: "",
				headingLevel: 2,
				headingOccurrence: 0,
				headingText: heading,
				markdown: prompt,
				plainText: prompt,
				prompt,
			},
		});
	};
	const saveSingleAssetPrompt = (item: PlannedAssetItem, prompt: string) => {
		const prompts = { ...assetPromptDrafts, [item.id]: prompt.trim() };
		setAssetPromptDrafts(prompts);
		onProductionPatch?.({
			sharedContext: {
				...context?.production?.sharedContext,
				prompts,
				updatedAt: new Date().toISOString(),
			},
		});
	};
	const saveSingleGenerationPrompt = (item: PlannedAssetItem, prompt: string) => {
		const prompts = { ...assetPromptDrafts, [`${item.id}::generation`]: prompt.trim() };
		setAssetPromptDrafts(prompts);
		onProductionPatch?.({
			sharedContext: {
				...context?.production?.sharedContext,
				prompts,
				updatedAt: new Date().toISOString(),
			},
		});
	};
	const cancelAssetGeneration = () => {
		generationQueue.current.cancel();
		setQueueCancelled(true);
	};
	const ensureGenerationReference = async (rawURL: string) => {
		const url = apiResourceURL(rawURL).trim();
		if (!url || /\/media-assets\/[^/?#]+\/content(?:[?#]|$)/iu.test(url)) return url;
		if (!/\/api\/v1\/projects\/[^/]+\/assets\/[^/]+\/content(?:[?#]|$)/iu.test(url)) return url;
		const existing = generationReferenceUploads.current.get(url);
		if (existing) return existing;
		const upload = (async () => {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`读取本地参考图失败：HTTP ${response.status}`);
			const blob = await response.blob();
			const filename = decodeURIComponent(url.split("/").at(-2) || "reference") + ".png";
			const mediaAsset = await uploadMediaAsset(
				new File([blob], filename, { type: blob.type || "image/png" }),
				projectId,
			);
			return apiResourceURL(mediaAsset.url);
		})();
		generationReferenceUploads.current.set(url, upload);
		try {
			return await upload;
		} catch (error) {
			generationReferenceUploads.current.delete(url);
			throw error;
		}
	};
	const generatePlannedAssetWithCodex = async (
		item: PlannedAssetItem,
		prompt: string,
		targetShotId?: string,
	) => {
		const generationKey = `${item.id}::${targetShotId ?? "all"}`;
		const persistedResourceId = `${item.id}::${targetShotId ?? "shared"}::${crypto.randomUUID()}`;
		if (codexGenerationInFlightRef.current.has(generationKey)) return false;
		codexGenerationInFlightRef.current.add(generationKey);
		setCodexGeneratingAssetIds((current) => new Set(current).add(item.id));
		setCodexGenerationError("");
		try {
			if (generationQueue.current.cancelled) return false;
			const enforcedPrompt = prompt.includes("【视觉生产标准｜锁定层】")
				? prompt
				: buildLockedAssetGenerationPrompt(
						item,
						prompt,
						savedShots,
						`${styleMasterDraft}\n${scriptDraft}`,
					);
			saveSingleGenerationPrompt(item, enforcedPrompt);
			const referenceUrls = await Promise.all(
				Array.from(
					new Set(
						[
							...(
								(
									context?.production?.sharedContext?.visualDNA as
										| { referenceImages?: Array<{ url?: string }> }
										| undefined
								)?.referenceImages ?? []
							).map((image) => image.url ?? ""),
							...(styleMasterDraft.match(/https?:\/\/[^\s\n"<>]+/giu) ?? []),
							...(selectedStoryboardSource ? [selectedStoryboardSource] : []),
						].filter(Boolean),
					),
				)
					.slice(0, 5)
					.map(ensureGenerationReference),
			);
			const startedAt = Date.now();
			setAgentPanelSize("expanded");
			setAgentLayoutTab("agent");
			await runAgentPrompt(
				`请使用本机 Codex Image generation 只生成一张完整资产图，不要调用 MediaGo 或其他 API。必须严格遵循下方 Prompt 和所附参考图。完成后将图片显示在本对话并自动归档到当前项目资产库。\n\n${enforcedPrompt}`,
				{
					displayPrompt: `Codex 生成 ${item.id} · ${item.name}${targetShotId ? ` · ${targetShotId}` : ""}`,
					references: referenceUrls.map((url, index) => ({
						kind: "asset" as const,
						documentId: `${item.id}-reference-${index + 1}`,
						assetKind: "image" as const,
						mimeType: "image/png",
						title: `参考图 ${index + 1}`,
						url,
					})),
				},
			);
			const generatedProjectAsset = await registerCodexGeneratedAsset(startedAt);
			if (!generatedProjectAsset) throw new Error("Codex 已结束，但没有找到本次生成的图片。");
			const generatedURL = apiResourceURL(generatedProjectAsset.url);
			const mediaURL = await ensureGenerationReference(generatedURL);
			const mediaAssetID = decodeURIComponent(
				mediaURL.match(/\/media-assets\/([^/?#]+)\/content/iu)?.[1] || "",
			);
			const response = await updateSelectedGenerationAsset(projectId, {
				kind: "image",
				mediaAssetId: mediaAssetID,
				mimeType: generatedProjectAsset.mimeType,
				resourceId: persistedResourceId,
				resourceTitle: `${item.id} · ${item.name}${targetShotId ? ` · ${targetShotId}` : ""}`,
				resourceType: item.category === "style" ? "prop" : item.category,
				selected: true,
				sourceKey: generatedProjectAsset.id,
				sourceType: "generated",
				title: `${item.id} · ${item.name}`,
				url: mediaURL,
				shotIds: targetShotId ? [targetShotId] : item.shotIds,
			});
			refreshSelectedGenerationAssetDependents(projectId, response.asset);
			setGenerationFocusAssetId(item.id);
			return true;
		} catch (error) {
			setCodexGenerationError(
				error instanceof Error ? error.message : "Codex 生图失败，请检查本机 Codex 图像技能。",
			);
			return false;
		} finally {
			codexGenerationInFlightRef.current.delete(generationKey);
			setCodexGeneratingAssetIds((current) => {
				const next = new Set(current);
				next.delete(item.id);
				return next;
			});
		}
	};
	const generatePlannedAssetWithAPI = async (
		item: PlannedAssetItem,
		prompt: string,
		targetShotId?: string,
	) => {
		const generationKey = `${item.id}::${targetShotId ?? "all"}`;
		const persistedResourceId = `${item.id}::${targetShotId ?? "shared"}::${crypto.randomUUID()}`;
		if (apiGenerationInFlightRef.current.has(generationKey)) return false;
		apiGenerationInFlightRef.current.add(generationKey);
		setAPIGeneratingAssetIds((current) => new Set(current).add(item.id));
		setAPIGenerationError("");
		try {
			if (generationQueue.current.cancelled) return false;
			const enforcedPrompt = prompt.includes("【视觉生产标准｜锁定层】")
				? prompt
				: buildLockedAssetGenerationPrompt(
						item,
						prompt,
						savedShots,
						`${styleMasterDraft}\n${scriptDraft}`,
					);
			saveSingleGenerationPrompt(item, enforcedPrompt);
			const lockedReference = catalogAssets.find(
				(asset) =>
					asset.resourceId === item.id ||
					asset.resourceId?.startsWith(`${item.id}::`) ||
					asset.resourceTitle === item.name,
			);
			const lockedReferenceURL = lockedReference
				? generationAssetSource(lockedReference)
				: selectedStoryboardSource;
			const visualDNA = context?.production?.sharedContext?.visualDNA as
				| { styleBible?: string; referenceImages?: Array<{ url?: string; usage?: string }> }
				| undefined;
			const projectMasterURLs = Array.from(
				new Set(
					[
						...(visualDNA?.referenceImages ?? []).map((image) => image.url ?? ""),
						...(styleMasterDraft.match(/https?:\/\/[^\s\n"<>]+/giu) ?? []),
					].filter(Boolean),
				),
			);
			const prioritizedReferenceURLs = lockedReferenceURL
				? [...projectMasterURLs.slice(0, 3), lockedReferenceURL]
				: projectMasterURLs.slice(0, 4);
			const orderedReferenceURLs = await Promise.all(
				prioritizedReferenceURLs
					.filter((url, index, all) => all.indexOf(url) === index)
					.map(ensureGenerationReference),
			);
			const submitted = await sendProjectGenerationMessage({
				kind: "image",
				projectId,
				projectName: name,
				routeId: "whereslow-image.nano-banana-2",
				familyId: "whereslow-image",
				versionId: "nano-banana-2",
				provider: "whereslow-image",
				modelId: "nano-banana-2",
				model: "nano-banana-2",
				prompt: `【参考优先级】项目母版图片及其用途为最高优先级；当前分镜图只参考构图、机位、运镜和转场，不得覆盖项目母版风格。\n【项目母版规则】${visualDNA?.styleBible || styleMasterDraft || "未提供文字规则，请严格遵循母版参考图的材质、渲染、灯光、色彩与比例。"}\n【母版参考图用途】${(visualDNA?.referenceImages ?? []).map((image, index) => `图${index + 1}：${image.usage || "仅用于项目整体风格、材质与渲染一致性"}`).join("；")}\n\n${enforcedPrompt}`,
				assetTitle: `${item.id} · ${item.name}`,
				params: { aspectRatio: "16:9", resolution: "2K", n: 1 },
				referenceUrls: orderedReferenceURLs,
				referenceAssetIds: lockedReference?.mediaAssetId ? [lockedReference.mediaAssetId] : [],
				referenceBindings: [],
				shotIds: targetShotId ? [targetShotId] : item.shotIds,
			});
			const response = await waitForGenerationResult(submitted);
			if (response.status === "failed") {
				throw new Error(response.error || "API 生图失败，请稍后重试。");
			}
			const asset = response.assets?.find(
				(candidate) => candidate.kind === "image" && Boolean(candidate.assetId?.trim()),
			);
			if (!asset?.assetId?.trim()) throw new Error(response.error || "API 未返回可归档图片。");
			const selected = await updateSelectedGenerationAsset(projectId, {
				assetIndex: asset.slotIndex,
				kind: "image",
				mediaAssetId: asset.assetId,
				mimeType: asset.mimeType,
				resourceId: persistedResourceId,
				resourceTitle: `${item.id} · ${item.name}${targetShotId ? ` · ${targetShotId}` : ""}`,
				resourceType: item.category === "style" ? "prop" : item.category,
				selected: true,
				sourceAssetIndex: asset.slotIndex,
				sourceTaskId: response.id || asset.taskId,
				sourceType: "generated",
				taskId: response.id || asset.taskId,
				title: asset.title || `${item.id} · ${item.name}`,
				url: asset.url,
				shotIds: targetShotId ? [targetShotId] : item.shotIds,
			});
			refreshSelectedGenerationAssetDependents(projectId, selected.asset);
			setGenerationFocusAssetId(item.id);
			return true;
		} catch (error) {
			setAPIGenerationError(error instanceof Error ? error.message : "API 生图失败，请重试。");
			return false;
		} finally {
			apiGenerationInFlightRef.current.delete(generationKey);
			setAPIGeneratingAssetIds((current) => {
				const next = new Set(current);
				next.delete(item.id);
				return next;
			});
		}
	};
	const openGenerationPromptEditor = (item: PlannedAssetItem, mode: "codex" | "api") =>
		setGenerationPromptEditor({ item, mode, prompt: resolvedAssetGenerationPrompt(item) });
	const confirmGenerationPrompt = async () => {
		if (!generationPromptEditor) return;
		const { item, mode, prompt } = generationPromptEditor;
		const normalizedPrompt = prompt.trim();
		if (!normalizedPrompt) return;
		saveSingleAssetPrompt(item, normalizedPrompt);
		setGenerationPromptEditor(null);
		await runAssetGeneration(mode, [item], normalizedPrompt);
	};

	useEffect(() => {
		setStageNavigationSlot(document.getElementById("project-production-stage-slot"));
	}, []);

	useEffect(() => {
		const incomingScript = context?.production?.sharedContext?.script ?? "";
		setScriptDraft(incomingScript);
		setStoryboardDraft(context?.production?.sharedContext?.storyboardBrief ?? "");
		const incomingAssetPlan = context?.production?.sharedContext?.assetPlan ?? "";
		setAssetPlanDraft(isUsableAssetPlan(incomingAssetPlan) ? incomingAssetPlan : "");
		setAssetPromptDrafts(context?.production?.sharedContext?.prompts ?? {});
		setAssetAnalysisError(
			incomingAssetPlan.trim() && !isUsableAssetPlan(incomingAssetPlan)
				? "上次资产分析因连接中断，没有产生有效清单。请重新分析。"
				: "",
		);
		incomingScriptRef.current = incomingScript;
	}, [
		context?.production?.sharedContext?.script,
		context?.production?.sharedContext?.storyboardBrief,
		context?.production?.sharedContext?.assetPlan,
		context?.production?.sharedContext?.approvedContent,
		context?.production?.sharedContext,
		onProductionPatch,
	]);

	const currentStageDraftConfig = stageDraftConfig(
		selectedStage?.capability ?? "custom",
		selectedStage?.label,
	);
	useEffect(() => {
		if (!currentStageDraftConfig) {
			setStageDraft("");
			return;
		}
		setStageDraft(
			String(context?.production?.sharedContext?.[currentStageDraftConfig.field] ?? ""),
		);
	}, [context?.production?.sharedContext, currentStageDraftConfig]);

	useEffect(() => {
		setShotCountDraft(Math.max(1, Math.min(36, context?.production?.shots?.length || 24)));
	}, [context?.production?.shots?.length]);

	useEffect(() => {
		if (initialStageId && pipeline.stages.some((stage) => stage.id === initialStageId)) {
			setSelectedStageId(initialStageId);
			return;
		}
		if (!activeStage) return;
		setSelectedStageId((current) => current || activeStage.id);
	}, [activeStage, initialStageId, pipeline.stages]);

	useEffect(() => {
		if (executionStates?.[selectedStageId] || !projectId) return;
		try {
			const saved = localStorage.getItem(`production-workbench.v1:${projectId}`);
			if (!saved) return;
			const parsed = JSON.parse(saved) as Partial<ProductionWorkbenchExecutionState> & {
				step?: WorkbenchStep;
				lastUpdatedAt?: string;
			};
			setLegacyMemory({
				...defaultExecutionState(),
				phase: parsed.phase ?? parsed.step ?? "analysis",
				note: parsed.note ?? "",
				updatedAt: parsed.updatedAt ?? parsed.lastUpdatedAt ?? "",
			});
		} catch {
			setLegacyMemory(defaultExecutionState());
		}
	}, [executionStates, projectId, selectedStageId]);

	const persistMemory = (patch: Partial<ProductionWorkbenchExecutionState>) => {
		const next = { ...memory, ...patch, updatedAt: new Date().toISOString() };
		setLegacyMemory(next);
		if (selectedStage?.id) {
			setLocalMemoryOverrides((current) => ({ ...current, [selectedStage.id]: next }));
		}
		onExecutionStateChange(selectedStage?.id ?? "", next);
	};

	const selectedStageIndex = Math.max(
		0,
		pipeline.stages.findIndex((stage) => stage.id === selectedStage?.id),
	);
	const contextRows = useMemo(
		() => [
			["已锁定资产", `${context?.selectedAssetCount ?? selectedAssetCount} 个`],
			["需求资源", `${context?.resourceCount ?? resourceCount} 项`],
			["正式镜头", `${context?.shotCount ?? shotCount} 个`],
			["阶段状态", selectedStage ? productionStageStateLabels[selectedStage.state] : "未开始"],
		],
		[context, resourceCount, selectedAssetCount, selectedStage, shotCount],
	);
	// 后端/旧项目可能只保存了部分分析字段。这里统一补齐数组，避免
	// 保存 Brief、脚本或阶段状态后，渲染分析面板时直接读取 undefined.length
	// 导致整个项目工作区被错误边界接管。
	const analysis = {
		facts: Array.isArray(memory.analysis?.facts) ? memory.analysis.facts : [],
		unknowns: Array.isArray(memory.analysis?.unknowns) ? memory.analysis.unknowns : [],
		risks: Array.isArray(memory.analysis?.risks) ? memory.analysis.risks : [],
	};
	const hasConfirmed = Boolean(memory.confirmation?.confirmed);
	const inferredFacts = [
		`当前阶段：${selectedStage?.label ?? "未选择"}`,
		`已有 ${resourceCount} 项需求资源、${selectedAssetCount} 个已锁定资产、${shotCount} 个正式镜头`,
		selectedStage?.description || "阶段交付要求尚未补充",
	];
	const inferredUnknowns = [
		selectedAssetCount === 0
			? "还没有锁定本阶段要使用的参考或资产"
			: "部分参考与资产的用途仍需人工确认",
		selectedStage?.state !== "PASS" ? "本阶段尚未通过质量门槛" : "暂无明显缺口",
	];
	const inferredRisks = [
		selectedStage?.riskWarning || selectedStage?.gate || "执行前请确认输出规格和版本命名",
		"未确认前不会批量生成，避免产生无法使用的结果",
	];
	const stageActionButtons = (() => {
		switch (selectedStage?.capability ?? "custom") {
			case "brief":
				if (selectedStage?.label === "创意与分镜定稿")
					return [
						{
							label: "上传并标注参考图",
							action: () => onOpenWorkspace("reference"),
						},
					];
				return [
					{
						label: "让制作助理理解需求",
						action: () => {
							persistMemory({
								phase: "analysis",
								analysis: {
									facts: inferredFacts,
									unknowns: inferredUnknowns,
									risks: inferredRisks,
								},
							});
							openAgent();
						},
					},
					{
						label: /参考与需求|创意与分镜/.test(selectedStage?.label ?? "")
							? "上传并标注参考图"
							: "打开对话继续制作",
						action: () => {
							if (/参考与需求|创意与分镜/.test(selectedStage?.label ?? "")) {
								onOpenWorkspace("reference");
								return;
							}
							persistMemory({ phase: "execute" });
							openAgent();
						},
						disabled: !/参考与需求|创意与分镜/.test(selectedStage?.label ?? "") && !hasConfirmed,
					},
				];
			case "shot-breakdown":
				return [
					{
						label: "分析分镜并精简资产数量",
						action: () => {
							document
								.querySelector('[aria-label="分镜资产清单"]')
								?.scrollIntoView({ behavior: "smooth", block: "center" });
						},
					},
					{ label: "查看镜头卡与关系", action: () => onOpenWorkspace("shots") },
				];
			case "asset-plan":
				return [
					{
						label: "按清单逐项生成资产",
						action: () => {
							openProjectGeneration("image", {
								prompt: context?.production?.sharedContext?.assetPlan,
								heading: "03 按清单逐项生成资产",
							});
						},
						disabled: !context?.production?.sharedContext?.assetPlan?.trim(),
					},
					{ label: "导入或查看资产版本", action: () => onOpenWorkspace("assets") },
				];
			case "asset-production":
				return [{ label: "导入或查看资产版本", action: () => onOpenWorkspace("assets") }];
			case "image-generation":
				return [
					{
						label: /资产制作/.test(selectedStage?.label ?? "")
							? "按资产清单开始制作"
							: "开始图片生成",
						action: () =>
							openProjectGeneration("image", {
								prompt: context?.production?.sharedContext?.assetPlan,
								heading: `${String(selectedStage?.order ?? 0).padStart(2, "0")} ${selectedStage?.label ?? "图片生成"}`,
							}),
					},
					{
						label: "导入外部结果 / 查看版本",
						action: () => onOpenWorkspace("assets"),
					},
				];
			case "asset-qc":
				return [
					{
						label: "开始逐项审核资产",
						action: () => {
							persistMemory({ phase: "review" });
							openAgent();
						},
					},
					{ label: "打开资产库查看版本", action: () => onOpenWorkspace("assets") },
				];
			case "shot-execution":
				return [
					{ label: "选择镜头制作执行图", action: () => onOpenWorkspace("shots") },
					{ label: "打开镜头资产关系", action: () => onOpenWorkspace("assets") },
				];
			case "motion-design":
				return [
					{ label: "逐镜设计动作 Prompt", action: openAgent },
					{ label: "查看首尾帧", action: () => onOpenWorkspace("shots") },
				];
			case "video-qc":
				return [
					{ label: "选择镜头生成 / 导入视频", action: () => onOpenWorkspace("shots") },
					{ label: "开始视频 QC", action: () => persistMemory({ phase: "review" }) },
				];
			case "final-qc":
				return [
					{
						label: "开始成片交付检查",
						action: () => {
							persistMemory({ phase: "review" });
							openAgent();
						},
					},
					{ label: "查看镜头视频", action: () => onOpenWorkspace("shots") },
				];
			case "retrospective":
				return [
					{
						label: "汇总项目经验",
						action: () => {
							persistMemory({ phase: "analysis" });
							openAgent();
						},
					},
					{ label: "查看资产与版本", action: () => onOpenWorkspace("assets") },
				];
			default:
				return [
					{ label: "开始本阶段分析", action: () => persistMemory({ phase: "analysis" }) },
					{
						label: "打开相关资产与镜头",
						action: () =>
							onOpenWorkspace(
								["shot-execution", "motion-design", "video-qc", "final-qc"].includes(
									selectedStage?.capability ?? "",
								)
									? "shots"
									: "assets",
							),
					},
				];
		}
	})();
	const recordReview = (
		status: Extract<ProductionStageState, "PASS" | "NEEDS_FIX" | "BLOCKED">,
	) => {
		if (
			status === "PASS" &&
			selectedStage &&
			!selectedStage.hasContent &&
			selectedStage.completion === 0
		) {
			persistMemory({
				phase: "review",
				note:
					memory.note || "当前阶段还没有可审核的内容。请先完成本阶段的主要产出，再标记为已通过。",
			});
			return;
		}
		const review = {
			status,
			notes: memory.note,
			reviewedAt: new Date().toISOString(),
		};
		persistMemory({ phase: "review", review });
		if (selectedStage) onStateChange(selectedStage.id, status);
	};
	const saveSharedDraft = (field: SharedDraftField, value: string, note: string) => {
		onProductionPatch?.({
			sharedContext: {
				...context?.production?.sharedContext,
				[field]: value.trim(),
				updatedAt: new Date().toISOString(),
			},
		});
		persistMemory({ note });
		if (selectedStage) {
			const evidenceCompletion: Record<SharedDraftField, number> = {
				storyOutline: 35,
				script: 40,
				storyboardBrief: 70,
				shotBreakdown: 55,
				assetPlan: 55,
				motionPlan: 60,
				finalReviewNotes: 70,
			};
			if (value.trim())
				onCompletionChange(
					selectedStage.id,
					Math.max(selectedStage.completion, evidenceCompletion[field]),
				);
		}
	};
	const updateScriptLock = (locked: boolean) => {
		const nextScript = scriptDraft.trim();
		if (locked && !nextScript) return;
		onProductionPatch?.({
			sharedContext: {
				...context?.production?.sharedContext,
				script: nextScript,
				approvedContent: stageOneScriptApproval(
					context?.production?.sharedContext?.approvedContent,
					locked,
				),
				updatedAt: new Date().toISOString(),
			},
		});
		persistMemory({
			note: locked
				? "剧本已锁定；分镜母图将固定读取这一版本。"
				: "剧本已解锁，可从对话同步或粘贴外部版本后重新锁定。",
		});
		if (locked && selectedStage)
			onCompletionChange(selectedStage.id, Math.max(selectedStage.completion, 40));
	};
	const extractScriptFromChat = () => {
		const latestScript = selectLatestChatScriptDocument(agentMessages, workspaceDocuments);
		if (!latestScript) {
			persistMemory({ note: "没有找到对话中最后定稿的脚本文档，请先让助理保存脚本或上传脚本。" });
			return;
		}
		setScriptDraft(latestScript.content.trim());
		persistMemory({
			note: `已提取最后定稿脚本《${latestScript.title}》（V${latestScript.version}），等待你确认锁定。`,
		});
	};
	const uploadScript = async (file: File) => {
		try {
			const text = await file.text();
			if (!text.trim()) throw new Error("脚本文件没有可读取的文字内容。");
			setScriptDraft(text.trim());
			persistMemory({ note: `已上传脚本 ${file.name}，等待人工检查和锁定。` });
		} catch (error) {
			persistMemory({
				note: error instanceof Error ? error.message : "脚本上传失败，请改用 TXT 或 Markdown。",
			});
		} finally {
			if (scriptUploadInputRef.current) scriptUploadInputRef.current.value = "";
		}
	};
	const updateStoryboardLock = (locked: boolean) => {
		if (locked && !selectedStoryboardAsset) return;
		onProductionPatch?.({
			sharedContext: {
				...context?.production?.sharedContext,
				approvedContent: stageOneStoryboardApproval(
					context?.production?.sharedContext?.approvedContent,
					locked,
				),
				updatedAt: new Date().toISOString(),
			},
		});
		persistMemory({
			note: locked
				? "分镜母图已锁定为当前正式版本，可以拆分镜头。"
				: "分镜母图已解锁；替换图片后需要重新锁定。",
		});
		if (locked && selectedStage)
			onCompletionChange(selectedStage.id, Math.max(selectedStage.completion, 80));
	};
	const uploadStoryboardMaster = async (file: File) => {
		const storyboardMimeType = imageMimeTypeForUpload(file);
		if (!storyboardMimeType) {
			setStoryboardUploadState("error");
			setStoryboardUploadError("请选择 JPG、PNG、WebP、GIF、BMP 或 TIFF 图片。");
			if (storyboardUploadInputRef.current) storyboardUploadInputRef.current.value = "";
			return;
		}
		setStoryboardUploadState("uploading");
		setStoryboardUploadError("");
		try {
			const uploaded = await uploadMediaAsset(file, projectId);
			const response = await updateSelectedGenerationAsset(projectId, {
				kind: "image",
				mediaAssetId: uploaded.id,
				mimeType: storyboardMimeType,
				resourceId: "stage-one-storyboard-master",
				resourceTitle: "24格分镜母图",
				resourceType: "storyboard",
				selected: true,
				sourceDocumentId:
					selectLatestChatScriptDocument(agentMessages, workspaceDocuments)?.id ?? "",
				sourceKey: uploaded.id,
				sourceType: "uploaded",
				title: file.name,
				url: apiResourceURL(uploaded.url),
			});
			refreshSelectedGenerationAssetDependents(projectId, response.asset);
			if (response.asset) setStoryboardAssetId(response.asset.id);
			onProductionPatch?.({
				sharedContext: {
					...context?.production?.sharedContext,
					approvedContent: stageOneStoryboardApproval(
						context?.production?.sharedContext?.approvedContent,
						false,
					),
					updatedAt: new Date().toISOString(),
				},
			});
			setStoryboardUploadState("idle");
			persistMemory({ note: "外部分镜母图已上传，等待人工确认和锁定。" });
			if (selectedStage)
				onCompletionChange(selectedStage.id, Math.max(selectedStage.completion, 70));
		} catch (error) {
			setStoryboardUploadState("error");
			setStoryboardUploadError(
				error instanceof Error ? error.message : "分镜母图上传失败，请重试。",
			);
		} finally {
			if (storyboardUploadInputRef.current) storyboardUploadInputRef.current.value = "";
		}
	};
	const uploadStyleMaster = async (file: File) => {
		const mime = imageMimeTypeForUpload(file);
		if (!mime) return;
		try {
			const uploaded = await uploadMediaAsset(file, projectId);
			const url = apiResourceURL(uploaded.url);
			setStyleMasterImage(url);
			setStyleMasterDraft((current) => `${current.trim()}\n项目母图：${url}`.trim());
		} catch {
			setStyleMasterDraft((current) => `${current}\n（风格参考图上传失败，请重试）`.trim());
		}
		if (styleMasterUploadInputRef.current) styleMasterUploadInputRef.current.value = "";
	};
	const uploadStyleMasterFiles = async (files: File[]) => {
		for (const file of files) await uploadStyleMaster(file);
	};
	const removeStyleMasterImage = (url: string) => {
		setStyleMasterDraft((current) =>
			current
				.split("\n")
				.filter((line) => !line.includes(url))
				.join("\n")
				.trim(),
		);
		setStyleMasterImage((current) => (current === url ? "" : current));
		setStyleMasterUsages((current) => {
			const next = { ...current };
			delete next[url];
			return next;
		});
	};
	const registerCodexGeneratedAsset = async (startedAt: number): Promise<ProjectAsset | null> => {
		const findGeneratedAsset = async () => {
			const response = await getProjectAssets(projectId);
			return (
				response.assets
					.filter(
						(asset) =>
							asset.kind === "image" &&
							asset.filename.startsWith("codex-generated-") &&
							new Date(asset.createdAt).getTime() >= startedAt - 2_000,
					)
					.sort(
						(left, right) =>
							new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
					)[0] ?? null
			);
		};
		let generatedAsset: ProjectAsset | null = null;
		for (let attempt = 0; attempt < 8 && !generatedAsset; attempt += 1) {
			generatedAsset = await findGeneratedAsset();
			if (!generatedAsset) await new Promise((resolve) => window.setTimeout(resolve, 750));
		}
		return generatedAsset;
	};
	const registerCodexStoryboardMaster = async (startedAt: number): Promise<ProjectAsset | null> => {
		const generatedAsset = await registerCodexGeneratedAsset(startedAt);
		if (!generatedAsset) return null;
		const mediaURL = await ensureGenerationReference(apiResourceURL(generatedAsset.url));
		const mediaAssetID = decodeURIComponent(
			mediaURL.match(/\/media-assets\/([^/?#]+)\/content/iu)?.[1] || "",
		);
		const response = await updateSelectedGenerationAsset(projectId, {
			kind: "image",
			mediaAssetId: mediaAssetID,
			mimeType: generatedAsset.mimeType,
			resourceId: "stage-one-storyboard-master",
			resourceTitle: "24格分镜母图",
			resourceType: "storyboard",
			selected: true,
			sourceDocumentId: selectLatestChatScriptDocument(agentMessages, workspaceDocuments)?.id ?? "",
			sourceKey: generatedAsset.id,
			sourceType: "generated",
			title: "24格分镜母图 · Codex V01",
			url: mediaURL,
		});
		refreshSelectedGenerationAssetDependents(projectId, response.asset);
		if (response.asset) setStoryboardAssetId(response.asset.id);
		if (selectedStage) onCompletionChange(selectedStage.id, Math.max(selectedStage.completion, 70));
		return generatedAsset;
	};
	const storyboardAssets = useMemo(
		() =>
			catalogAssets.filter(
				(asset) => asset.kind === "image" && asset.resourceType === "storyboard",
			),
		[catalogAssets],
	);
	useEffect(() => {
		if (
			storyboardAssets.length > 0 &&
			!storyboardAssets.some((asset) => asset.id === storyboardAssetId)
		) {
			setStoryboardAssetId(storyboardAssets[0].id);
		}
	}, [storyboardAssetId, storyboardAssets]);
	const persistedShots = context?.production?.shots ?? [];
	const savedShots = useMemo(() => {
		const graphShotMetadata = new Map(
			(context?.production?.productionGraph?.nodes ?? [])
				.filter((node) => node.type === "shot")
				.map((node) => [node.shotId ?? node.id, node.metadata ?? {}]),
		);
		const hydrateShot = (shot: ProjectShotRecord): ProjectShotRecord => {
			const metadata = graphShotMetadata.get(shot.id);
			const text = (key: string) =>
				typeof metadata?.[key] === "string" ? metadata[key] : undefined;
			return {
				...shot,
				visualLogic: shot.visualLogic ?? text("visualLogic"),
				cameraLanguage: shot.cameraLanguage ?? text("cameraLanguage"),
				continuityIn: shot.continuityIn ?? text("continuityIn"),
				continuityOut: shot.continuityOut ?? text("continuityOut"),
				executionPrompt: shot.executionPrompt ?? text("executionPrompt"),
				motionPrompt: shot.motionPrompt ?? text("motionPrompt"),
			};
		};
		const persistedIds = new Set(persistedShots.map((shot) => shot.id));
		const merged = persistedShots.map((shot) => {
			const local = optimisticShots[shot.id];
			return hydrateShot(local && local.updatedAt > shot.updatedAt ? local : shot);
		});
		return [
			...merged,
			...Object.values(optimisticShots)
				.filter((shot) => !persistedIds.has(shot.id))
				.map(hydrateShot),
		].sort((left, right) => left.sequence - right.sequence);
	}, [context?.production?.productionGraph?.nodes, optimisticShots, persistedShots]);
	const activeExecutionShot =
		savedShots.find((shot) => shot.id === activeExecutionShotId) ?? savedShots[0];
	const executionShotIndex = activeExecutionShot
		? savedShots.findIndex((shot) => shot.id === activeExecutionShot.id)
		: -1;
	const previousExecutionShot =
		executionShotIndex > 0 ? savedShots[executionShotIndex - 1] : undefined;
	const nextExecutionShot =
		executionShotIndex >= 0 && executionShotIndex < savedShots.length - 1
			? savedShots[executionShotIndex + 1]
			: undefined;
	const executionAssets = activeExecutionShot
		? catalogAssets.filter((asset) =>
				(asset.shotIds ?? []).some(
					(shotId) => shotId === activeExecutionShot.id || shotId === activeExecutionShot.shotCode,
				),
			)
		: [];
	const assetLinkedShotCount = savedShots.filter(
		(shot) =>
			(shot.assetIds?.length ?? 0) > 0 ||
			catalogAssets.some((asset) =>
				(asset.shotIds ?? []).some((shotId) => shotId === shot.id || shotId === shot.shotCode),
			),
	).length;
	const executionPromptReadyCount = savedShots.filter((shot) =>
		Boolean(
			shot.visualLogic?.trim() &&
			shot.cameraLanguage?.trim() &&
			shot.executionPrompt?.trim() &&
			shot.motionPrompt?.trim(),
		),
	).length;
	const executionImageReadyCount = savedShots.filter((shot) =>
		Boolean(shot.firstFrameAssetId),
	).length;
	const videoReadyShotIds = new Set(
		(context?.production?.productionGraph?.nodes ?? [])
			.filter((node) => node.type === "video" && node.shotId)
			.map((node) => node.shotId as string),
	);
	const roughCutArchivedShotIds = new Set(
		(context?.production?.productionGraph?.edges ?? [])
			.filter((edge) => edge.relation === "archived-in")
			.map(
				(edge) =>
					(context?.production?.productionGraph?.nodes ?? []).find((node) => node.id === edge.from)
						?.shotId,
			)
			.filter((shotId): shotId is string => Boolean(shotId)),
	);
	useEffect(() => {
		if (activeExecutionShotId && savedShots.some((shot) => shot.id === activeExecutionShotId))
			return;
		setActiveExecutionShotId(savedShots[0]?.id ?? "");
	}, [activeExecutionShotId, savedShots]);
	const assetQCById = useMemo(() => {
		const entries = Object.values(context?.production?.qcResults ?? {})
			.filter((result) => result.entityType === "asset")
			.sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt));
		return new Map(entries.map((result) => [result.entityId, result]));
	}, [context?.production?.qcResults]);
	const updateAssetQC = (assetId: string, status: "PASS" | "NEEDS_FIX" | "BLOCKED" | "MISSING") => {
		const id = `qc:asset:${assetId}`;
		onProductionPatch?.({
			qcResults: {
				...context?.production?.qcResults,
				[id]: {
					id,
					entityType: "asset",
					entityId: assetId,
					stageId: selectedStage?.id,
					status,
					checks: [],
					issues:
						status === "PASS"
							? []
							: [status === "MISSING" ? "镜头需求缺少可用资产" : "需要补充具体修改说明"],
					reviewedAt: new Date().toISOString(),
				},
			},
			updatedAt: new Date().toISOString(),
		});
	};
	const selectedStoryboardAsset =
		storyboardAssets.find((asset) => asset.id === storyboardAssetId) ?? storyboardAssets[0];
	const selectedStoryboardSource = selectedStoryboardAsset
		? generationAssetSource(selectedStoryboardAsset)
		: "";
	const plannedAssets = useMemo(() => parsePlannedAssets(assetPlanDraft), [assetPlanDraft]);
	const plannedAssetsByCategory = useMemo(
		() =>
			(Object.keys(plannedAssetCategoryMeta) as PlannedAssetCategory[]).map((category) => ({
				category,
				items: plannedAssets.filter((item) => item.category === category),
			})),
		[plannedAssets],
	);
	useEffect(() => {
		if (
			selectedStage?.capability !== "image-generation" &&
			selectedStage?.capability !== "asset-production"
		)
			return;
		const storageKey = `production:generation-focus:${projectId}`;
		const assetId = window.sessionStorage.getItem(storageKey);
		if (!assetId || !plannedAssets.some((item) => item.id === assetId)) return;
		setGenerationFocusAssetId(assetId);
		window.sessionStorage.removeItem(storageKey);
		window.requestAnimationFrame(() =>
			window.requestAnimationFrame(() =>
				document
					.getElementById(`generation-asset-card-${assetId}`)
					?.scrollIntoView({ behavior: "smooth", block: "center" }),
			),
		);
	}, [plannedAssets, projectId, selectedStage?.capability]);
	const resolvedAssetPrompt = (item: PlannedAssetItem) =>
		assetPromptDrafts[item.id]?.trim() || buildPlannedAssetPrompt(item);
	const resolvedAssetGenerationPrompt = (item: PlannedAssetItem) =>
		assetPromptDrafts[`${item.id}::generation`]?.trim() ||
		buildLockedAssetGenerationPrompt(
			item,
			resolvedAssetPrompt(item),
			savedShots,
			`${styleMasterDraft}\n${scriptDraft}`,
		);
	const saveAssetPrompts = (note = "资产 Prompt 已保存。") => {
		const prompts = {
			...assetPromptDrafts,
			...Object.fromEntries(
				plannedAssets.flatMap((item) => [
					[item.id, resolvedAssetPrompt(item)],
					[`${item.id}::generation`, resolvedAssetGenerationPrompt(item)],
				]),
			),
		};
		setAssetPromptDrafts(prompts);
		onProductionPatch?.({
			sharedContext: {
				...context?.production?.sharedContext,
				prompts,
				updatedAt: new Date().toISOString(),
			},
		});
		persistMemory({ note });
	};
	const parseAllAssetGenerationPrompts = () => {
		const prompts = { ...assetPromptDrafts };
		for (const item of plannedAssets) {
			prompts[item.id] = resolvedAssetPrompt(item);
			prompts[`${item.id}::generation`] = buildLockedAssetGenerationPrompt(
				item,
				resolvedAssetPrompt(item),
				savedShots,
				scriptDraft,
			);
		}
		setAssetPromptDrafts(prompts);
		onProductionPatch?.({
			sharedContext: {
				...context?.production?.sharedContext,
				prompts,
				updatedAt: new Date().toISOString(),
			},
		});
		persistMemory({ note: "已按视觉圣经、镜头运镜和前后转场生成全部资产执行 Prompt。" });
	};
	const runAssetGeneration = async (
		mode: "api" | "codex",
		items: PlannedAssetItem[],
		editedPrompt?: string,
	) => {
		if (generationQueue.current.busy) return;
		setQueueRunning(true);
		setQueueCancelled(false);
		try {
			await generationQueue.current.run(items, async (item) => {
				const shotId = previewShotOverrides[item.id] ?? item.shotIds[0];
				const prompt = editedPrompt ?? resolvedAssetGenerationPrompt(item);
				return Boolean(
					await (mode === "api"
						? generatePlannedAssetWithAPI(item, prompt, shotId)
						: generatePlannedAssetWithCodex(item, prompt, shotId)),
				);
			});
		} finally {
			setQueueRunning(false);
		}
	};
	const generateAllPlannedAssets = async (mode: "api" | "codex") => {
		if (!plannedAssets.length || generationQueue.current.busy) return;
		const confirmed = await confirmDialog({
			confirmLabel: `生成 ${plannedAssets.length} 张`,
			title: `逐张生成 ${plannedAssets.length} 张资产？`,
			description:
				"每项资产只生成一张。上一张完成归档后才提交下一张；可随时取消后续生成。已提交的当前图片仍可能计费。",
		});
		if (!confirmed) return;
		const setBusy = mode === "api" ? setIsBatchGeneratingAPI : setIsBatchGeneratingCodex;
		setBusy(true);
		try {
			await runAssetGeneration(mode, plannedAssets);
		} finally {
			setBusy(false);
		}
	};
	const generateAllPlannedAssetsWithAPI = () => generateAllPlannedAssets("api");
	const generateAllPlannedAssetsWithCodex = () => generateAllPlannedAssets("codex");
	const enterImageGenerationStage = (note: string, assetId?: string) => {
		saveAssetPrompts(note);
		const imageGenerationStage = pipeline.stages.find(
			(stage) => stage.capability === "image-generation" || stage.capability === "asset-production",
		);
		if (!imageGenerationStage) return;
		if (assetId) {
			setGenerationFocusAssetId(assetId);
			window.sessionStorage.setItem(`production:generation-focus:${projectId}`, assetId);
		}
		setSelectedStageId(imageGenerationStage.id);
		onOpenStage(imageGenerationStage);
	};
	const savePromptContinuityRules = (shotRules: string[]) => {
		onProductionPatch?.({
			sharedContext: {
				...context?.production?.sharedContext,
				shotRules,
				updatedAt: new Date().toISOString(),
			},
		});
		persistMemory({
			note:
				shotRules.length > 0
					? `已保存 ${shotRules.length} 条跨镜 Prompt 连续性规则。`
					: "已清空跨镜 Prompt 连续性规则。",
		});
	};
	const uploadPlannedAsset = async (file: File) => {
		const target = assetUploadTarget;
		if (!target) return;
		setAssetUploadError("");
		try {
			const uploaded = await uploadMediaAsset(file, projectId);
			const response = await updateSelectedGenerationAsset(projectId, {
				kind: file.type.startsWith("video/") ? "video" : "image",
				mediaAssetId: uploaded.id,
				mimeType: file.type,
				resourceId: target.id,
				resourceTitle: target.name,
				resourceType: target.category === "style" ? "prop" : target.category,
				selected: true,
				sourceDocumentId: "",
				sourceKey: uploaded.id,
				sourceType: "uploaded",
				title: `${target.id} · ${target.name}`,
				url: apiResourceURL(uploaded.url),
				shotIds: target.shotIds,
			});
			refreshSelectedGenerationAssetDependents(projectId, response.asset);
			persistMemory({ note: `${target.name} 已上传并关联 ${target.shotIds.length} 个镜头。` });
		} catch (error) {
			setAssetUploadError(error instanceof Error ? error.message : "资产上传失败，请重试。");
		} finally {
			setAssetUploadTarget(null);
			if (assetUploadInputRef.current) assetUploadInputRef.current.value = "";
		}
	};
	const analyzeStoryboardAssets = async (recoverExisting = false) => {
		if (!selectedStoryboardAsset || isAnalyzingAssets) return;
		if (recoverExisting) {
			const recoveryConversations: Array<{
				messages: Array<{
					role: string;
					content: string;
					kind?: string;
					status?: string;
					createdAt?: string;
				}>;
			}> = Object.values(useAgentStore.getState().conversations);
			try {
				const sessions = await listAgentSessions(projectId);
				for (const session of sessions) {
					const chat = await getAgentChatState(projectId, session.sessionId);
					recoveryConversations.push(chat);
				}
			} catch {
				// History recovery is opportunistic; a fresh analysis remains available.
			}
			const recovered = latestUsableAssetPlan(recoveryConversations);
			if (recovered && assetPlanMatchesStoryboardCount(recovered, shotCountDraft)) {
				setAssetAnalysisError("");
				setAssetPlanDraft(recovered.trim());
				saveSharedDraft("assetPlan", recovered, "已恢复 Agent 返回的完整资产清单，等待人工确认。");
				return;
			}
		}
		const messagesBeforeRun = new Set(
			Object.values(useAgentStore.getState().conversations).flatMap((conversation) =>
				conversation.messages.map((message) => message.id),
			),
		);
		setIsAnalyzingAssets(true);
		setAssetAnalysisError("");
		addAgentAssistantMessage(
			"已开始第 02 步资产拆解：先逐镜识别，再跨镜合并复用。这里只计算资产需求，不会生成图片。",
		);
		// “预计镜头数”是拆分、识别和资产分析的唯一数量来源。
		// 用户从 24P 切换到 12P/36P 后，即使还没先点“重新排列”，
		// 识别按钮也必须先同步当前格数，不能继续分析旧的 6 张快照。
		const analysisShots =
			savedShots.length === shotCountDraft
				? savedShots
				: buildShotRecords(selectedStoryboardAsset, shotCountDraft);
		if (analysisShots !== savedShots) persistShotRecords(analysisShots, selectedStoryboardAsset);
		const shotEvidence = analysisShots
			.map((shot) => `${shot.shotCode}｜${shot.title}｜${shot.description || "待从分镜画面识别"}`)
			.join("\n");
		const prompt = `你正在执行 AIGC 制作项目第 02 步：分镜与资产关系拆解。不要生图，不要改故事。

这是一次只读分析。禁止调用任何工具，禁止读取、创建或修改项目文件，禁止加载 Skill；不要汇报过程。只在最终回答中直接输出资产清单，前端会负责校验和保存。

请读取当前项目已经锁定的分镜母图与镜头记录，完成两遍分析：
第一遍逐镜列出每格出现的人物身份与造型、场景/时间/灯光、道具/产品、特效/风格、首尾帧特殊需求。
第二遍跨镜合并能够复用的项目；只有人物造型、场景时段、产品结构或材质发生实质变化时才拆成不同资产。

最终必须直接在回复中输出一份“最少但足够完成全部镜头”的资产清单。每项字段固定为：
资产ID｜分类｜资产名称｜必要变体｜使用镜头｜必须生成的视图｜参考图要求｜结构化Prompt摘要｜不能改变项｜优先级。
分类只使用：角色、造型、场景、道具/产品、特效/风格。
最后汇总各类数量、总资产数、每个镜头是否已被覆盖，以及可以复用而无需重复生成的依据。
不要只给建议，不要创建一堆无镜头用途的资产，不要进入图片生成。

当前分镜母图：${selectedStoryboardAsset.title || "已锁定分镜母图"}
当前用户选择的分镜格数：${shotCountDraft}P；必须逐格覆盖 S01—S${String(shotCountDraft).padStart(2, "0")}，不得沿用旧的 6P/12P/24P/36P 数量。
当前镜头记录（共 ${analysisShots.length} 条）：
${shotEvidence || "尚未建立镜头卡，请直接按分镜母图 P01—P24 识别。"}

已锁定的完整剧本（这是镜头内容与资产判断的主要文字证据）：
${scriptDraft.trim() || "未提供剧本文字，请结合分镜母图完成识别。"}`;
		try {
			await runAgentPrompt(prompt, {
				displayPrompt: "分析分镜并计算最精简资产清单",
				references: [
					{
						kind: "asset",
						documentId: selectedStoryboardAsset.id,
						assetId: selectedStoryboardAsset.id,
						assetKind: "image",
						mimeType: selectedStoryboardAsset.mimeType || "image/png",
						title: selectedStoryboardAsset.title || "已锁定分镜母图",
						url: selectedStoryboardAsset.url,
					},
				],
			});
			const agentState = useAgentStore.getState();
			const conversations = Object.values(agentState.conversations);
			const newMessages = conversations
				.flatMap((conversation) => conversation.messages)
				.filter((message) => !messagesBeforeRun.has(message.id));
			const completedRun = conversations.some(
				(conversation) =>
					conversation.status === "completed" &&
					conversation.messages.some((message) => !messagesBeforeRun.has(message.id)),
			);
			let latest = completedAssetPlanFromRun(conversations, messagesBeforeRun);
			// The ACP stream can finish before its final answer is reconciled into the
			// in-memory conversation. The persisted chat is authoritative, so read it
			// back before declaring a successful analysis to be a failure.
			if (!latest || !assetPlanMatchesStoryboardCount(latest, shotCountDraft)) {
				try {
					const persistedConversations = await Promise.all(
						(await listAgentSessions(projectId)).map((session) =>
							getAgentChatState(projectId, session.sessionId),
						),
					);
					const persisted = latestUsableAssetPlan(persistedConversations);
					if (persisted && assetPlanMatchesStoryboardCount(persisted, shotCountDraft)) {
						latest = persisted;
					}
				} catch {
					// Keep the live-store result/error below when history cannot be refreshed.
				}
			}
			if (!latest && !completedRun) {
				const failureMessage =
					newMessages
						.slice()
						.reverse()
						.find((message) => message.status === "error" || message.kind === "runtime")?.content ||
					"连接中断，资产分析没有完成。";
				setAssetAnalysisError(failureMessage);
				addAgentAssistantMessage(
					"资产分析失败，没有保存清单，也不会推进阶段。请检查连接后点击“重新分析”。",
				);
				return;
			}
			if (!latest) {
				setAssetAnalysisError("返回内容没有达到资产清单标准，未保存。请重新分析。");
				addAgentAssistantMessage("资产拆解没有返回可保存的清单，请重试。本次不会伪装成成功。");
				return;
			}
			if (!assetPlanMatchesStoryboardCount(latest, shotCountDraft)) {
				setAssetAnalysisError(
					`资产清单未完整覆盖当前 ${shotCountDraft}P 分镜，未保存。请重新分析。`,
				);
				return;
			}
			setAssetPlanDraft(latest.trim());
			saveSharedDraft("assetPlan", latest, "已完成逐镜识别与跨镜去重，资产清单等待人工确认。");
			addAgentAssistantMessage(
				"资产清单已同步到第 02 步下方。请检查数量和镜头覆盖；确认后，第 03 步将严格按清单逐项生成。",
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : "资产分析连接失败。";
			setAssetAnalysisError(message);
			addAgentAssistantMessage("资产分析失败，没有保存清单，也不会推进阶段。请重试。");
		} finally {
			setIsAnalyzingAssets(false);
		}
	};
	useEffect(() => {
		if (
			selectedStage?.capability !== "shot-breakdown" ||
			!selectedStoryboardAsset ||
			savedShots.length === 0 ||
			assetPlanMatchesStoryboardCount(assetPlanDraft, shotCountDraft) ||
			assetAnalysisError ||
			isAnalyzingAssets
		)
			return;
		const analysisKey = `v2:${selectedStage.id}:${selectedStoryboardAsset.id}:${savedShots.length}`;
		if (autoAssetAnalysisRef.current === analysisKey) return;
		autoAssetAnalysisRef.current = analysisKey;
		void analyzeStoryboardAssets(true);
	}, [
		assetAnalysisError,
		assetPlanDraft,
		isAnalyzingAssets,
		savedShots.length,
		selectedStage?.capability,
		selectedStage?.id,
		selectedStoryboardAsset?.id,
	]);
	const buildShotRecords = (
		storyboard: SelectedGenerationAsset,
		count: number,
	): ProjectShotRecord[] => {
		const now = new Date().toISOString();
		const existingBySequence = new Map(savedShots.map((shot) => [shot.sequence, shot]));
		return Array.from({ length: count }, (_, index) => {
			const sequence = index + 1;
			const existing = existingBySequence.get(sequence);
			return {
				id: existing?.id ?? `shot:S${String(sequence).padStart(2, "0")}`,
				sequence,
				shotCode: existing?.shotCode ?? `S${String(sequence).padStart(2, "0")}`,
				title: existing?.title ?? `镜头 ${String(sequence).padStart(2, "0")}`,
				storyboardAssetId: storyboard.id,
				storyboardCrop: storyboardCropForSequence(sequence, count),
				storyboardImagePath: storyboard.url,
				description: existing?.description ?? "",
				prompt: existing?.prompt ?? "",
				assetIds: existing?.assetIds ?? [],
				status: existing?.status ?? "NOT_STARTED",
				completion: existing?.completion ?? 0,
				firstFrameAssetId: existing?.firstFrameAssetId,
				lastFrameAssetId: existing?.lastFrameAssetId,
				visualLogic: existing?.visualLogic,
				cameraLanguage: existing?.cameraLanguage,
				continuityIn: existing?.continuityIn,
				continuityOut: existing?.continuityOut,
				executionPrompt: existing?.executionPrompt,
				motionPrompt: existing?.motionPrompt,
				updatedAt: now,
			};
		});
	};
	const persistShotRecords = (
		records: ProjectShotRecord[],
		storyboard?: SelectedGenerationAsset,
	) => {
		const now = new Date().toISOString();
		setOptimisticShots(Object.fromEntries(records.map((shot) => [shot.id, shot])));
		const oldGraph = context?.production?.productionGraph;
		const fallbackStoryboardId =
			records.find((shot) => shot.storyboardAssetId)?.storyboardAssetId ??
			"stage-one-storyboard-master";
		const storyboardNodeId =
			(storyboard
				? oldGraph?.nodes.find(
						(node) =>
							node.assetId === storyboard.id ||
							node.id === storyboard.id ||
							node.id === `asset:${storyboard.id}`,
					)?.id
				: undefined) ?? `asset:${storyboard?.id ?? fallbackStoryboardId}`;
		const shotNodes = records.map((shot) => ({
			id: shot.id,
			type: "shot" as const,
			title: shot.title,
			shotId: shot.id,
			status: shot.status,
			metadata: {
				sequence: shot.sequence,
				shotCode: shot.shotCode,
				storyboardAssetId: storyboard?.id ?? shot.storyboardAssetId ?? fallbackStoryboardId,
				storyboardCrop: shot.storyboardCrop,
				assetIds: shot.assetIds ?? [],
				visualLogic: shot.visualLogic,
				cameraLanguage: shot.cameraLanguage,
				continuityIn: shot.continuityIn,
				continuityOut: shot.continuityOut,
				executionPrompt: shot.executionPrompt,
				motionPrompt: shot.motionPrompt,
			},
			createdAt: shot.updatedAt,
		}));
		const edges = [...(oldGraph?.edges ?? [])];
		for (const shot of records) {
			if (
				!edges.some(
					(edge) =>
						edge.from === storyboardNodeId &&
						edge.to === shot.id &&
						edge.relation === "derived-from",
				)
			) {
				edges.push({
					from: storyboardNodeId,
					to: shot.id,
					relation: "derived-from",
					createdAt: now,
				});
			}
		}
		for (let index = 0; index < records.length - 1; index += 1) {
			const from = records[index];
			const to = records[index + 1];
			if (
				!edges.some(
					(edge) => edge.from === from.id && edge.to === to.id && edge.relation === "continues-to",
				)
			) {
				edges.push({ from: from.id, to: to.id, relation: "continues-to", createdAt: now });
			}
		}
		onProductionPatch?.({
			shots: records,
			sharedContext: {
				...context?.production?.sharedContext,
				shotBreakdown: records.map((shot) => `${shot.shotCode}｜${shot.title}`).join("\n"),
				updatedAt: now,
			},
			productionGraph: {
				nodes: [...(oldGraph?.nodes ?? []).filter((node) => node.type !== "shot"), ...shotNodes],
				edges,
				updatedAt: now,
			},
		});
		if (selectedStage) onCompletionChange(selectedStage.id, Math.max(selectedStage.completion, 35));
	};
	const commitShotRecords = (records: ProjectShotRecord[]) => {
		persistShotRecords(records, selectedStoryboardAsset);
	};
	const confirmStoryboardAndParse = () => {
		if (!selectedStoryboardAsset || !storyboardLocked) return;
		persistShotRecords(buildShotRecords(selectedStoryboardAsset, 24), selectedStoryboardAsset);
		persistMemory({ note: "已从锁定的分镜母图自动建立 24 个待校验镜头，进入第 02 阶段。" });
		if (selectedStage) onCompletionChange(selectedStage.id, Math.max(selectedStage.completion, 90));
		const nextStage = pipeline.stages.find((stage) => stage.order === 2);
		if (nextStage) onOpenStage(nextStage);
	};
	const updateShotRecord = (shotId: string, patch: Partial<ProjectShotRecord>) => {
		const now = new Date().toISOString();
		commitShotRecords(
			savedShots.map((shot) => (shot.id === shotId ? { ...shot, ...patch, updatedAt: now } : shot)),
		);
	};
	const generateShotPromptDraft = () => {
		if (!activeExecutionShot) return;
		const assetNames = executionAssets
			.map((asset) => asset.title || asset.resourceTitle || asset.resourceId)
			.filter((value): value is string => Boolean(value?.trim()))
			.join("、");
		const subject =
			activeExecutionShot.description?.trim() || `${activeExecutionShot.shotCode} 的核心叙事动作`;
		const visualLogic =
			activeExecutionShot.visualLogic?.trim() ||
			`以“${subject}”为画面核心，明确起势、关键动作与收势；资产在画内的关系必须可读。`;
		const cameraLanguage =
			activeExecutionShot.cameraLanguage?.trim() ||
			"按分镜母图确定景别与主体位置；保持明确视线、运动方向和可衔接的尾帧构图。";
		const continuityIn =
			activeExecutionShot.continuityIn?.trim() ||
			(previousExecutionShot
				? `承接 ${previousExecutionShot.shotCode} 的人物状态、运动方向、光线和关键物体位置。`
				: "首镜建立人物、空间、光线与主要道具的初始状态。");
		const continuityOut =
			activeExecutionShot.continuityOut?.trim() ||
			(nextExecutionShot
				? `尾帧为 ${nextExecutionShot.shotCode} 留出一致的运动方向、状态与构图接点。`
				: "尾帧稳定收束，保留项目统一的光线、色彩和主体状态。");
		const executionPrompt = [
			`【${activeExecutionShot.shotCode} 单镜执行图】`,
			`已锁定参考资产：${assetNames || "请先关联第 04 步已通过资产"}。`,
			`图片逻辑：${visualLogic}`,
			`镜头语言：${cameraLanguage}`,
			`上镜衔接：${continuityIn}`,
			`下镜交接：${continuityOut}`,
			"输出一张可用于图生视频的单镜执行参考图：主体结构、人物身份、服装、道具和环境材质不得漂移；无文字、水印、无关人物、重复肢体和结构穿插。",
		].join("\n");
		const motionPrompt = [
			`【${activeExecutionShot.shotCode} 视频 Prompt】`,
			`首帧锁定：使用已确认的 ${activeExecutionShot.shotCode} 单镜执行图与参考资产。`,
			`主体动作：${visualLogic}`,
			`镜头运动：${cameraLanguage}`,
			`起始连续性：${continuityIn}`,
			`尾帧目标：${continuityOut}`,
			"保持人物身份、服装、道具结构、空间方向和光线连续；禁止变脸、换装、物体漂移、运动反向、穿模、忽快忽慢、伪文字与画面闪烁。",
		].join("\n");
		updateShotRecord(activeExecutionShot.id, {
			visualLogic,
			cameraLanguage,
			continuityIn,
			continuityOut,
			executionPrompt,
			motionPrompt,
			completion: Math.max(activeExecutionShot.completion, 35),
			status: "IN_PROGRESS",
		});
		persistMemory({
			note: `${activeExecutionShot.shotCode} 已依据已关联参考资产生成可编辑的执行图与视频 Prompt。`,
		});
	};
	const copyActiveShotPrompt = async (kind: "execution" | "video") => {
		if (!activeExecutionShot) return;
		const content =
			kind === "execution" ? activeExecutionShot.executionPrompt : activeExecutionShot.motionPrompt;
		if (!content?.trim()) return;
		await navigator.clipboard.writeText(content);
		setCopiedAssetId(`${activeExecutionShot.id}:${kind}`);
	};
	const optimizeActiveShotPrompts = async () => {
		if (!activeExecutionShot) return;
		if (!activeExecutionShot.executionPrompt?.trim()) generateShotPromptDraft();
		setAgentPanelSize("expanded");
		setAgentLayoutTab("agent");
		const shot = activeExecutionShot;
		const assets = executionAssets
			.map((asset) => asset.title || asset.resourceTitle || asset.resourceId)
			.filter(Boolean)
			.join("、");
		const prompt = [
			`请优化 ${shot.shotCode} 的单镜执行图与视频提示词。`,
			`镜头剧情：${shot.description || shot.title}。`,
			`已锁定资产：${assets || "无"}。`,
			`上镜衔接：${shot.continuityIn || "首镜建立状态"}。`,
			`下镜交接：${shot.continuityOut || "末镜收束"}。`,
			`当前执行图提示词：${shot.executionPrompt || "请先基于以上信息生成"}。`,
			`当前视频提示词：${shot.motionPrompt || "请先基于以上信息生成"}。`,
			"请直接给出可复制的两段结果，标题必须为“执行图提示词”和“视频提示词”。保持人物、资产、方向、光线和首尾帧连续，不要解释原理。",
		].join("\n\n");
		try {
			await runAgentPrompt(prompt, { displayPrompt: `优化 ${shot.shotCode} 的执行图与视频提示词` });
		} catch (error) {
			addAgentAssistantMessage(
				`无法启动 ${shot.shotCode} 的提示词优化：${error instanceof Error ? error.message : "请检查助理连接后重试。"}`,
			);
		}
	};
	const saveEditedShotPrompt = () => {
		if (!activeExecutionShot || !editingShotPrompt) return;
		updateShotRecord(
			activeExecutionShot.id,
			editingShotPrompt.kind === "execution"
				? { executionPrompt: editingShotPrompt.value.trim() }
				: { motionPrompt: editingShotPrompt.value.trim() },
		);
		setEditingShotPrompt(null);
	};
	const uploadShotImage = async (shot: ProjectShotRecord, file: File) => {
		if (!file.type.startsWith("image/")) {
			setShotUploadError("请选择 PNG、JPG 或其他图片文件。");
			return;
		}
		setUploadingShotId(shot.id);
		setShotUploadError("");
		try {
			const uploaded = await uploadProjectAsset(projectId, file);
			updateShotRecord(shot.id, {
				storyboardAssetId: uploaded.id,
				storyboardImagePath: apiResourceURL(uploaded.url),
				storyboardCrop: { x: 0, y: 0, width: 1, height: 1 },
				firstFrameAssetId: uploaded.id,
			});
			persistMemory({ note: `${shot.shotCode} 已替换为本地上传图片。` });
		} catch (error) {
			setShotUploadError(error instanceof Error ? error.message : "镜头图片上传失败，请重试。");
		} finally {
			setUploadingShotId(null);
		}
	};
	const moveShotRecord = (shotId: string, offset: -1 | 1) => {
		const from = savedShots.findIndex((shot) => shot.id === shotId);
		const to = from + offset;
		if (from < 0 || to < 0 || to >= savedShots.length) return;
		const reordered = [...savedShots];
		[reordered[from], reordered[to]] = [reordered[to], reordered[from]];
		commitShotRecords(
			reordered.map((shot, index) => ({
				...shot,
				sequence: index + 1,
				shotCode: `S${String(index + 1).padStart(2, "0")}`,
				updatedAt: new Date().toISOString(),
			})),
		);
	};
	const addShotRecord = () => {
		if (!selectedStoryboardAsset) return;
		const sequence = savedShots.length + 1;
		const now = new Date().toISOString();
		commitShotRecords([
			...savedShots,
			{
				id: `shot:${crypto.randomUUID()}`,
				sequence,
				shotCode: `S${String(sequence).padStart(2, "0")}`,
				title: `镜头 ${String(sequence).padStart(2, "0")}`,
				storyboardAssetId: selectedStoryboardAsset.id,
				storyboardImagePath: selectedStoryboardAsset.url,
				storyboardCrop: storyboardCropForSequence(sequence, sequence),
				description: "",
				prompt: "",
				assetIds: [],
				status: "NOT_STARTED",
				completion: 0,
				updatedAt: now,
			},
		]);
	};
	const deleteShotRecord = (shotId: string) => {
		const target = savedShots.find((shot) => shot.id === shotId);
		if (!target || !window.confirm(`删除 ${target.shotCode}？已归档资产不会被删除。`)) return;
		commitShotRecords(
			savedShots
				.filter((shot) => shot.id !== shotId)
				.map((shot, index) => ({
					...shot,
					sequence: index + 1,
					shotCode: `S${String(index + 1).padStart(2, "0")}`,
					updatedAt: new Date().toISOString(),
				})),
		);
	};
	useEffect(() => {
		// 已经拆出的镜头数量才是当前项目的真实数量。旧项目即使母图标题仍写着
		// “20格”，只要实际已有 24 镜，这里也自动显示 24，无需用户再次填写。
		if (savedShots.length > 0) setShotCountDraft(Math.min(36, savedShots.length));
	}, [savedShots.length]);
	useEffect(() => {
		// 进入“镜头拆解”阶段时，如果已有确认的分镜但还没有 shots，
		// 直接建立可追溯的镜头序列。用户仍可调整数量并重新排列，
		// 但不会再停留在“一张六格图”的不可执行状态。
		if (
			autoShotInitializationRef.current ||
			selectedStage?.capability !== "shot-breakdown" ||
			!selectedStoryboardAsset ||
			savedShots.length > 0 ||
			!onProductionPatch
		)
			return;
		autoShotInitializationRef.current = true;
		persistShotRecords(
			buildShotRecords(selectedStoryboardAsset, shotCountDraft),
			selectedStoryboardAsset,
		);
	}, [
		onProductionPatch,
		savedShots.length,
		selectedStage?.capability,
		selectedStage?.id,
		selectedStoryboardAsset,
		shotCountDraft,
	]);
	const mergesCommercialAssetReview = context?.templateId === "commercial-film";
	const visiblePipelineStages = pipeline.stages.filter(
		(stage) => !(mergesCommercialAssetReview && stage.order === 4),
	);
	const nextStage = pipeline.stages.find(
		(stage, index) =>
			index > selectedStageIndex && !(mergesCommercialAssetReview && stage.order === 4),
	);

	if (!selectedStage) {
		return (
			<section className="grid min-h-96 place-items-center rounded-xl border border-border bg-card p-8">
				<div className="text-center">
					<Workflow className="mx-auto size-8 text-muted-foreground" />
					<h2 className="mt-3 text-base font-semibold">还没有可工作的阶段</h2>
					<p className="mt-2 text-sm text-muted-foreground">请先创建项目内容，再从第一阶段开始。</p>
				</div>
			</section>
		);
	}

	return (
		<section className="min-h-[680px] min-w-0">
			{stageNavigationSlot
				? createPortal(
						<aside className="px-3 pb-2">
							<div className="flex items-center justify-between gap-4 pb-2">
								<div>
									<p className="text-sm font-semibold text-foreground">{name}</p>
									<p className="mt-1 text-[11px] text-muted-foreground">商业广告制作流程</p>
								</div>
								<p className="text-[10px] text-muted-foreground">
									{visiblePipelineStages.filter((stage) => stage.state === "PASS").length} 项已完成
								</p>
							</div>
							<nav className="grid grid-cols-1 gap-1" aria-label="项目工作阶段">
								{visiblePipelineStages.map((stage, index) => {
									const isSelected = stage.id === selectedStage.id;
									return (
										<button
											key={stage.id}
											type="button"
											onClick={() => {
												setSelectedStageId(stage.id);
												onOpenStage(stage);
											}}
											className={cn(
												"h-9 min-w-0 overflow-hidden border-l-2 px-2.5 py-1.5 text-left text-[11px] transition-colors",
												isSelected
													? "border-primary bg-primary/10 text-foreground"
													: "border-transparent text-muted-foreground hover:bg-muted/55 hover:text-foreground",
											)}
										>
											<span className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
												<span className="flex min-w-0 items-center gap-1.5 font-medium leading-4">
													<span
														className={cn(
															"size-1.5 shrink-0 rounded-full",
															stage.state === "PASS"
																? "bg-emerald-500"
																: isSelected
																	? "bg-primary"
																	: "bg-muted-foreground/35",
														)}
													/>
													<span className="truncate">
														{String(index + 1).padStart(2, "0")} ·{" "}
														{mergesCommercialAssetReview && stage.order === 3
															? "资产制作与审核"
															: productionStageDisplayLabel(stage)}
													</span>
												</span>
												{stage.state === "BLOCKED" || stage.state === "NEEDS_FIX" ? (
													<span className="shrink-0 text-[9px] text-warning-foreground">
														需处理
													</span>
												) : null}
											</span>
										</button>
									);
								})}
							</nav>
							{pipeline.legacyPercent !== undefined ? (
								<div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-5 text-foreground">
									旧版项目曾记录总进度 {pipeline.legacyPercent}
									%。该数值已保留，但不会伪装成已通过阶段； 当前进度按可追溯的阶段、资产、镜头和 QC
									重新计算。
								</div>
							) : null}
						</aside>,
						stageNavigationSlot,
					)
				: null}

			<main className="min-w-0 border border-border/70 bg-card p-4 sm:p-5">
				<div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
					<div className="min-w-0">
						<p className="text-xs font-medium text-primary">
							第 {visiblePipelineStages.findIndex((stage) => stage.id === selectedStage.id) +
								1}{" "}
							阶段 / 共 {visiblePipelineStages.length} 阶段
						</p>
						<h1 className="mt-0.5 truncate text-lg font-semibold text-foreground">
							{mergesCommercialAssetReview && selectedStage.order === 3
								? "资产制作与审核"
								: selectedStage.label}
						</h1>
						<p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
							{workspaceDefinition.summary}
						</p>
					</div>
					<div className="flex items-center gap-2">
						{selectedStage.order === 5 || selectedStage.order === 6 ? (
							<Button size="sm" onClick={() => onOpenWorkspace("shots")}>
								<Clapperboard className="mr-1.5 size-4" />
								打开镜头工作台
							</Button>
						) : null}
						<Badge
							variant={
								selectedStage.state === "BLOCKED" || selectedStage.state === "NEEDS_FIX"
									? "destructive"
									: "secondary"
							}
						>
							{productionStageStateLabels[selectedStage.state]}
						</Badge>
					</div>
				</div>

				{!(selectedStage.capability === "brief" && selectedStage.order === 1) ? (
					<div className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2.5">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="min-w-0">
								<p className="text-xs font-medium text-primary">当前任务</p>
								<h2 className="mt-0.5 text-sm font-semibold text-foreground">
									{workspaceDefinition.title}
								</h2>
								<p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
									{selectedStage.riskWarning || "输入齐全后再执行；生成结果会归档到同一项目。"}
								</p>
							</div>
							<div className="flex shrink-0 flex-wrap gap-2">
								{queueRunning && (
									<Button
										variant="destructive"
										disabled={queueCancelled}
										onClick={cancelAssetGeneration}
									>
										{queueCancelled ? "已取消后续任务，等待当前图完成" : "取消后续生成"}
									</Button>
								)}
								{selectedStage.capability === "asset-production" ? (
									<>
										<Button
											size="sm"
											variant="outline"
											disabled={!plannedAssets.length}
											onClick={parseAllAssetGenerationPrompts}
										>
											<WandSparkles className="size-3.5" /> 一键解析提示词
										</Button>
										<Button
											size="sm"
											disabled={
												!plannedAssets.length ||
												queueRunning ||
												isBatchGeneratingAPI ||
												isBatchGeneratingCodex
											}
											onClick={() => void generateAllPlannedAssetsWithAPI()}
										>
											<Image className="size-3.5" />
											{isBatchGeneratingAPI ? "API 批量生成中…" : "API 一键生图"}
										</Button>
										<Button
											size="sm"
											disabled={
												!plannedAssets.length ||
												queueRunning ||
												isBatchGeneratingAPI ||
												isBatchGeneratingCodex
											}
											onClick={() => void generateAllPlannedAssetsWithCodex()}
										>
											<WandSparkles className="size-3.5" />
											{isBatchGeneratingCodex ? "Codex 批量生成中…" : "Codex 一键生图"}
										</Button>
										<Button
											size="sm"
											variant="secondary"
											disabled={
												!plannedAssets.length ||
												queueRunning ||
												isBatchGeneratingAPI ||
												isBatchGeneratingCodex
											}
											onClick={() => {
												parseAllAssetGenerationPrompts();
												void generateAllPlannedAssetsWithAPI();
											}}
										>
											<Workflow className="size-3.5" /> 一键生成提示词及资产
										</Button>
									</>
								) : null}
								{stageActionButtons.map((item, index) => (
									<Button
										key={item.label}
										size="sm"
										variant={index === 0 ? "default" : "outline"}
										disabled={item.disabled}
										onClick={item.action}
									>
										{item.label}
										{index === 0 ? <ArrowRight className="size-3.5" /> : null}
									</Button>
								))}
							</div>
						</div>
					</div>
				) : null}

				{selectedStage.capability === "brief" &&
				(selectedStage.label === "序章" || selectedStage.label === "创意与分镜定稿") ? (
					<details
						open={selectedStage.label === "创意与分镜定稿"}
						className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-background"
					>
						<summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-muted/35 px-4 py-2.5 text-xs font-medium text-foreground">
							<span>第 01 阶段产物：锁定剧本与确认分镜母图</span>
							<span className="text-[11px] font-normal text-muted-foreground">
								系统内生成或外部导入，最终进入同一解析流程
							</span>
						</summary>
						<div className="border-t border-border/70 bg-muted/20 p-4">
							<div className="flex items-center justify-between gap-3">
								<div>
									<p className="text-sm font-semibold text-foreground">项目母图与风格母版</p>
									<p className="mt-1 text-xs text-muted-foreground">
										先写明或粘贴本项目的风格规则；后续脚本、分镜、资产和生图都会优先继承。
									</p>
								</div>
								<Badge variant={styleMasterDraft.trim() ? "secondary" : "outline"}>
									{styleMasterDraft.trim() ? "已配置" : "未配置"}
								</Badge>
							</div>
							<Textarea
								disabled={styleMasterLocked}
								value={styleMasterDraft}
								onChange={(event) => setStyleMasterDraft(event.target.value)}
								onPaste={(event) => {
									const files = Array.from(event.clipboardData.files ?? []).filter((file) =>
										file.type.startsWith("image/"),
									);
									if (files.length) {
										event.preventDefault();
										void uploadStyleMasterFiles(files);
									}
								}}
								placeholder="例如：LEGO 积木实体模型摄影；或写实摄影、定格动画、产品 CG 等项目专属风格规则。也可粘贴母图分析结果。支持直接粘贴图片。"
								className="mt-3 min-h-24 resize-y bg-background text-xs leading-5"
								aria-label="项目风格母版"
							/>
							{styleMasterImages.length > 0 ? (
								<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
									{styleMasterImages.map((url, index) => (
										<div
											key={`${url}-${index}`}
											className="rounded-md border border-border bg-background p-1.5"
										>
											<div className="relative">
												<img
													src={url}
													alt={`项目风格参考图 ${index + 1}`}
													className="h-24 w-full rounded-md bg-muted object-contain"
												/>
												<button
													type="button"
													disabled={styleMasterLocked}
													onClick={() => removeStyleMasterImage(url)}
													className="absolute right-1 top-1 rounded bg-background/90 px-1.5 py-0.5 text-xs text-destructive shadow"
													aria-label={`删除参考图 ${index + 1}`}
												>
													删除
												</button>
											</div>
											<input
												disabled={styleMasterLocked}
												list={`style-reference-options-${index}`}
												value={styleMasterUsages[url] ?? ""}
												onChange={(event) =>
													setStyleMasterUsages((current) => ({
														...current,
														[url]: event.target.value,
													}))
												}
												placeholder="参考此图的什么内容？"
												className="mt-1 h-7 w-full rounded border border-border bg-background px-2 text-[11px]"
												aria-label={`参考图 ${index + 1} 用途`}
											/>
											<datalist id={`style-reference-options-${index}`}>
												<option value="材质" />
												<option value="光线" />
												<option value="色调" />
												<option value="构图" />
												<option value="摄影质感" />
												<option value="比例与尺度" />
												<option value="人物造型" />
												<option value="场景结构" />
												<option value="Logo/品牌" />
												<option value="其他" />
											</datalist>
										</div>
									))}
								</div>
							) : styleMasterImage ? (
								<img
									src={styleMasterImage}
									alt="项目风格参考图"
									className="mt-3 h-24 w-40 rounded-md border border-border object-cover"
								/>
							) : null}
							<input
								ref={styleMasterUploadInputRef}
								type="file"
								accept="image/*"
								multiple
								className="hidden"
								aria-label="上传风格参考图"
								onChange={(event) => {
									const files = Array.from(event.target.files ?? []);
									if (files.length) void uploadStyleMasterFiles(files);
								}}
							/>
							<div className="mt-2 flex justify-end gap-2">
								<Button
									size="sm"
									variant="outline"
									disabled={styleMasterLocked}
									onClick={() => styleMasterUploadInputRef.current?.click()}
								>
									上传风格参考图
								</Button>
								<Button
									size="sm"
									variant={styleMasterLocked ? "outline" : "default"}
									disabled={!styleMasterLocked && !styleMasterDraft.trim()}
									onClick={() => {
										if (styleMasterLocked) {
											onProductionPatch?.({
												sharedContext: {
													...context?.production?.sharedContext,
													visualDNA: {
														...context?.production?.sharedContext?.visualDNA,
														locked: false,
													},
												},
											});
											setStyleMasterLocked(false);
											return;
										}
										onProductionPatch?.({
											sharedContext: {
												...context?.production?.sharedContext,
												visualDNA: {
													styleBible: styleMasterDraft.trim(),
													referenceImages: styleMasterImages.map((url) => ({
														url,
														usage: styleMasterUsages[url] ?? "",
													})),
													source: "project-master",
													locked: true,
												},
												updatedAt: new Date().toISOString(),
											},
										});
										setStyleMasterLocked(true);
										persistMemory({ note: "项目母图与风格母版已保存，后续流程将优先继承。" });
									}}
								>
									{styleMasterLocked ? "已锁定（点击解锁）" : "锁定并保存项目风格母版"}
								</Button>
							</div>
						</div>
						<div className="grid items-stretch gap-4 border-t border-border/70 p-4 lg:grid-cols-2">
							<div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-card p-4 shadow-sm">
								<div className="flex items-start justify-between gap-3">
									<div>
										<p className="text-sm font-semibold text-foreground">01-A · 确认并锁定脚本</p>
										<p className="mt-1 text-xs leading-5 text-muted-foreground">
											从当前聊天提取助理给出的脚本，或上传已有脚本；检查无误后手动锁定版本。
										</p>
									</div>
									<Badge variant={scriptLocked ? "secondary" : "outline"}>
										{scriptLocked ? "已锁定" : scriptDraft.trim() ? "待锁定" : "未开始"}
									</Badge>
								</div>
								<div className="mt-3 grid grid-cols-2 gap-2">
									<Button
										size="sm"
										variant="outline"
										disabled={scriptLocked}
										onClick={extractScriptFromChat}
									>
										<WandSparkles className="size-3.5" />
										提取最后定稿脚本
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={scriptLocked}
										onClick={() => scriptUploadInputRef.current?.click()}
									>
										<Upload className="size-3.5" />
										上传脚本
									</Button>
								</div>
								<input
									ref={scriptUploadInputRef}
									type="file"
									accept=".txt,.md,.markdown,.rtf,text/plain,text/markdown"
									aria-label="上传脚本"
									className="hidden"
									onChange={(event) => {
										const file = event.target.files?.[0];
										if (file) void uploadScript(file);
									}}
								/>
								<Textarea
									ref={scriptTextareaRef}
									aria-label="脚本工作稿"
									value={scriptDraft}
									onChange={(event) => setScriptDraft(event.target.value)}
									readOnly={scriptLocked}
									placeholder="与制作助理完成剧本，或将网页 GPT 生成的完整剧本粘贴到这里。"
									className="mt-3 min-h-[28rem] flex-1 resize-y bg-background text-sm lg:min-h-0"
								/>
								<div className="mt-3 grid gap-2">
									<Button
										size="sm"
										variant={scriptLocked ? "outline" : "default"}
										disabled={!onProductionPatch || (!scriptLocked && !scriptDraft.trim())}
										onClick={() => updateScriptLock(!scriptLocked)}
									>
										{scriptLocked ? (
											<PencilLine className="size-3.5" />
										) : (
											<LockKeyhole className="size-3.5" />
										)}
										{scriptLocked ? "解锁并创建新版本" : "确认并锁定脚本"}
									</Button>
									<span className="text-[10px] leading-4 text-muted-foreground">
										{scriptLocked ? "已锁定版本不会被后续聊天覆盖。" : "锁定后才开放正式分镜生成。"}
									</span>
								</div>
							</div>
							<div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-card p-4 shadow-sm">
								<div className="flex items-start justify-between gap-3">
									<div>
										<p className="text-sm font-semibold text-foreground">
											01-B · 确认并锁定分镜母图
										</p>
										<p className="mt-1 text-xs leading-5 text-muted-foreground">
											先根据已锁定脚本整理并确认分镜提示词，再进行生图；也可以上传已有分镜图。
										</p>
									</div>
									<Badge variant={storyboardLocked ? "secondary" : "outline"}>
										{storyboardLocked
											? "已锁定"
											: selectedStoryboardAsset
												? "待锁定"
												: scriptLocked
													? "可以生成／上传"
													: "等待锁定剧本"}
									</Badge>
								</div>
								<div className="mt-3 min-h-36 overflow-hidden rounded-lg border border-dashed border-border bg-card">
									{selectedStoryboardSource ? (
										<div className="grid gap-3 p-3">
											<div className="relative aspect-video overflow-hidden rounded-md bg-muted">
												<img
													src={selectedStoryboardSource}
													alt={selectedStoryboardAsset?.title || "当前分镜母图"}
													className="size-full object-contain"
												/>
											</div>
											<p className="truncate text-[11px] text-muted-foreground">
												当前版本：{selectedStoryboardAsset?.title || "24格分镜母图"}
											</p>
										</div>
									) : (
										<div className="grid min-h-36 place-items-center p-4 text-center">
											<div>
												<Image className="mx-auto size-5 text-muted-foreground" />
												<p className="mt-2 text-xs font-medium text-foreground">等待分镜母图</p>
												<p className="mt-1 text-[11px] leading-5 text-muted-foreground">
													根据锁定脚本生成，或上传一张完整的分镜母图。
												</p>
											</div>
										</div>
									)}
								</div>
								<div className="mt-3 rounded-lg bg-background p-3 ring-1 ring-border/70">
									<div className="flex items-center justify-between gap-3">
										<div>
											<p className="text-xs font-semibold text-foreground">分镜母图提示词</p>
											<p className="mt-1 text-[11px] leading-5 text-muted-foreground">
												从锁定脚本生成后可继续修改，确认内容无误再打开生图窗口。
											</p>
										</div>
										<Badge variant={storyboardDraft.trim() ? "secondary" : "outline"}>
											{storyboardDraft.trim() ? "提示词已准备" : "等待生成"}
										</Badge>
									</div>
									<Textarea
										value={storyboardDraft}
										disabled={!scriptLocked || storyboardLocked}
										onChange={(event) => setStoryboardDraft(event.target.value)}
										placeholder="先点击“根据脚本生成分镜提示词”。这里会出现完整 20 格母图的构图、镜头顺序、人物一致性、灯光和风格要求。"
										className="mt-3 min-h-44 resize-y text-xs leading-5"
									/>
									<div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-3">
										<Button
											size="sm"
											variant="outline"
											disabled={
												!onProductionPatch ||
												!scriptLocked ||
												storyboardLocked ||
												storyboardPromptGeneration.isGenerating
											}
											onClick={async () => {
												const authoritativeScript =
													selectLatestChatScriptDocument(agentMessages, workspaceDocuments)
														?.content ?? scriptDraft;
												addAgentAssistantMessage(
													"已开始专业分镜拆解：正在分析剧情节拍、转折和高潮。结果会实时写入下方“分镜母图提示词”，完成 P01—P24 校验后再开放生图。",
												);
												const generatedPrompt = await storyboardPromptGeneration.generate(
													authoritativeScript,
													context?.production?.sharedContext?.visualDNA
														? JSON.stringify(context.production.sharedContext.visualDNA, null, 2)
														: "",
													(content) => setStoryboardDraft(content),
												);
												if (!generatedPrompt) {
													addAgentAssistantMessage(
														"分镜拆解没有通过完整性检查，未进入生图。请查看下方红色原因后重试。",
													);
													return;
												}
												setStoryboardDraft(generatedPrompt);
												saveSharedDraft(
													"storyboardBrief",
													generatedPrompt,
													"已根据锁定脚本生成分镜提示词，等待人工检查后生图。",
												);
												addAgentAssistantMessage(
													"P01—P24 已全部拆解并通过完整性检查。分镜提示词已写入下方，可先审核修改，再点击生图。",
												);
											}}
										>
											<WandSparkles className="size-3.5" />
											{storyboardPromptGeneration.isGenerating
												? "正在导演拆镜…"
												: "AI 拆解24格分镜提示词"}
										</Button>
										<Button
											size="sm"
											variant="outline"
											disabled={
												!onProductionPatch ||
												!scriptLocked ||
												!storyboardDraft.trim() ||
												storyboardLocked
											}
											onClick={() => {
												saveSharedDraft(
													"storyboardBrief",
													storyboardDraft,
													"分镜提示词已确认，准备使用 Banana API 生图。",
												);
												openProjectGeneration("image", {
													prompt: storyboardDraft,
													heading: "24格分镜母图 · Banana API",
													resourceId: "stage-one-storyboard-master",
													resourceType: "storyboard",
												});
											}}
										>
											<Image className="size-3.5" />
											使用 Banana API 生图
										</Button>
										<Button
											size="sm"
											disabled={
												!onProductionPatch ||
												!scriptLocked ||
												!storyboardDraft.trim() ||
												storyboardLocked ||
												agentIsRunning
											}
											onClick={async () => {
												saveSharedDraft(
													"storyboardBrief",
													storyboardDraft,
													"分镜提示词已确认，已交给本机 Codex 生图。",
												);
												const codexPrompt = `请使用本机 Codex Image generation 直接生成一张完整分镜母图，不要调用 MediaGo，不要拆成多个任务。完成后把图片显示在本对话，并自动归档到当前项目资产库。\n\n${storyboardDraft}`;
												const startedAt = Date.now();
												setAgentPanelSize("expanded");
												setAgentLayoutTab("agent");
												addAgentAssistantMessage(
													"已提交给 Codex，正在生成一张完整分镜母图。完成后会自动显示在这里、写入右侧预览并归档到资产库。",
												);
												await runAgentPrompt(codexPrompt, {
													displayPrompt: "使用已确认提示词生成一张完整分镜母图",
												});
												try {
													const generatedAsset = await registerCodexStoryboardMaster(startedAt);
													if (!generatedAsset) {
														addAgentAssistantMessage(
															"Codex 已结束任务，但没有找到这次生成的图片文件。没有伪装成成功，请重新生成或上传分镜图。",
														);
														return;
													}
													const imageURL = apiResourceURL(generatedAsset.url);
													addAgentAssistantMessage(
														`分镜母图已生成并归档。\n\n![24格分镜母图](${imageURL})\n\n已同步到右侧预览和资产库「分镜」。请确认画面后锁定。`,
													);
													persistMemory({ note: "Codex 分镜母图已生成、回显并归档到分镜资产。" });
												} catch (error) {
													addAgentAssistantMessage(
														`图片已生成，但自动归档失败：${error instanceof Error ? error.message : "未知错误"}。文件仍保留在项目 work 目录。`,
													);
												}
											}}
										>
											<Image className="size-3.5" />
											{agentIsRunning ? "Codex 正在生成…" : "交给 Codex 生成分镜图"}
										</Button>
										{storyboardPromptGeneration.error ? (
											<p className="w-full text-xs text-destructive">
												{storyboardPromptGeneration.error}
											</p>
										) : null}
									</div>
								</div>
								<input
									ref={storyboardUploadInputRef}
									type="file"
									accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff"
									aria-label="上传分镜母图"
									className="hidden"
									onChange={(event) => {
										const file = event.target.files?.[0];
										if (file) void uploadStoryboardMaster(file);
									}}
								/>
								<div className="mt-3 grid grid-cols-3 gap-2">
									<Button
										size="sm"
										variant="outline"
										disabled={
											!scriptLocked || storyboardLocked || storyboardUploadState === "uploading"
										}
										onClick={() => storyboardUploadInputRef.current?.click()}
									>
										<Upload className="size-3.5" />
										{storyboardUploadState === "uploading"
											? "正在上传…"
											: selectedStoryboardAsset
												? "替换分镜母图"
												: "上传分镜图"}
									</Button>
									<Button
										size="sm"
										variant={storyboardLocked ? "outline" : "default"}
										disabled={!selectedStoryboardAsset || !onProductionPatch}
										onClick={() => updateStoryboardLock(!storyboardLocked)}
									>
										{storyboardLocked ? (
											<PencilLine className="size-3.5" />
										) : (
											<LockKeyhole className="size-3.5" />
										)}
										{storyboardLocked ? "解锁并创建新版本" : "确认并锁定分镜图"}
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={!selectedStoryboardAsset || !storyboardLocked}
										onClick={confirmStoryboardAndParse}
									>
										<Crop className="size-3.5" />
										拆分分镜并进入第 02 阶段
									</Button>
								</div>
								{storyboardUploadError ? (
									<p className="mt-2 text-[11px] leading-5 text-destructive">
										{storyboardUploadError}
									</p>
								) : null}
							</div>
						</div>
					</details>
				) : selectedStage.capability === "shot-breakdown" ? (
					<div className="mt-3 bg-background">
						<div className="flex justify-end">
							<Badge variant={savedShots.length > 0 ? "secondary" : "outline"}>
								{savedShots.length > 0 ? `已拆 ${savedShots.length} 镜` : "尚未拆解"}
							</Badge>
						</div>
						{storyboardAssets.length === 0 ? (
							<div className="mt-4 rounded-lg border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">
								还没有归档的分镜示意图。请先回到 01
								阶段生成并确认分镜图，生成结果会自动进入资产库后才能拆解。
							</div>
						) : (
							<>
								<div className="mt-3 flex flex-wrap items-end gap-3 border-b border-border bg-card pb-3 max-[1400px]:gap-2">
									<label className="grid gap-1.5 text-xs font-medium text-foreground max-[1400px]:text-[10px]">
										<span>分镜来源</span>
										<select
											aria-label="分镜来源"
											className="h-9 rounded-md border border-input bg-background px-2 text-sm max-[1400px]:h-8 max-[1400px]:text-[11px]"
											value={selectedStoryboardAsset?.id ?? ""}
											onChange={(event) => setStoryboardAssetId(event.target.value)}
										>
											{storyboardAssets.map((asset) => (
												<option key={asset.id} value={asset.id}>
													{asset.id === selectedStoryboardAsset?.id
														? (asset.title || asset.resourceTitle || asset.id).match(/\d+格/u)
															? (asset.title || asset.resourceTitle || asset.id).replace(
																	/\d+格/u,
																	`${shotCountDraft}格`,
																)
															: `${shotCountDraft}格 · ${asset.title || asset.resourceTitle || asset.id}`
														: asset.title || asset.resourceTitle || asset.id}
												</option>
											))}
										</select>
									</label>
									<label className="grid gap-1.5 text-xs font-medium text-foreground max-[1400px]:text-[10px]">
										<span>预计镜头数</span>
										<input
											aria-label="预计镜头数"
											type="number"
											min={1}
											max={36}
											value={shotCountDraft}
											onChange={(event) =>
												setShotCountDraft(
													Math.max(1, Math.min(36, Number(event.target.value) || 1)),
												)
											}
											className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm max-[1400px]:h-8 max-[1400px]:w-20 max-[1400px]:text-[11px]"
										/>
									</label>
									<Button
										className="max-[1400px]:h-8 max-[1400px]:px-2 max-[1400px]:text-[10px]"
										size="sm"
										disabled={!selectedStoryboardAsset}
										onClick={() =>
											selectedStoryboardAsset &&
											persistShotRecords(
												buildShotRecords(selectedStoryboardAsset, shotCountDraft),
												selectedStoryboardAsset,
											)
										}
									>
										<Plus className="size-4" />
										{savedShots.length > 0 ? "重新排列镜头" : "从分镜生成镜头卡"}
									</Button>
									<Button
										className="max-[1400px]:h-8 max-[1400px]:px-2 max-[1400px]:text-[10px]"
										size="sm"
										variant="outline"
										disabled={!selectedStoryboardAsset}
										onClick={addShotRecord}
									>
										<Plus className="size-4" />
										新增空镜头
									</Button>
								</div>
								{shotUploadError ? (
									<p className="mt-2 text-xs text-destructive">{shotUploadError}</p>
								) : null}
								<div className="mt-3 grid grid-cols-2 gap-2.5 min-[1100px]:grid-cols-4 max-[1400px]:gap-2">
									{savedShots.map((shot) => {
										const sourceAsset =
											storyboardAssets.find((asset) => asset.id === shot.storyboardAssetId) ??
											storyboardAssets[0];
										const source = shot.storyboardImagePath
											? apiResourceURL(shot.storyboardImagePath)
											: generationAssetSource(sourceAsset);
										const crop = displayedStoryboardCrop(shot, savedShots.length);
										return (
											<article
												key={shot.id}
												className="overflow-hidden rounded-lg border border-border bg-card"
											>
												<div className="relative aspect-video overflow-hidden bg-muted">
													{source ? (
														<img
															src={source}
															alt={shot.title}
															className="absolute max-w-none"
															style={{
																width: `${(1 / crop.width) * 100}%`,
																height: `${(1 / crop.height) * 100}%`,
																left: `${(-crop.x / crop.width) * 100}%`,
																top: `${(-crop.y / crop.height) * 100}%`,
															}}
														/>
													) : (
														<div className="grid size-full place-items-center text-xs text-muted-foreground">
															无分镜预览
														</div>
													)}
													<span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-1 text-[11px] font-semibold text-foreground shadow-sm">
														{shot.shotCode}
													</span>
													<div className="absolute right-2 top-2 flex gap-1 rounded-md bg-background/90 p-1 shadow-sm">
														<label
															className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
															title={`上传本地图替换 ${shot.shotCode}`}
														>
															{uploadingShotId === shot.id ? (
																<RefreshCcw className="size-3.5 animate-spin" />
															) : (
																<Upload className="size-3.5" />
															)}
															<span className="sr-only">上传本地图替换 {shot.shotCode}</span>
															<input
																type="file"
																accept="image/*"
																className="hidden"
																disabled={Boolean(uploadingShotId)}
																onChange={(event) => {
																	const file = event.target.files?.[0];
																	if (file) void uploadShotImage(shot, file);
																	event.currentTarget.value = "";
																}}
															/>
														</label>
														<button
															type="button"
															aria-label={`${shot.shotCode} 前移`}
															disabled={shot.sequence === 1}
															onClick={() => moveShotRecord(shot.id, -1)}
															className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
														>
															<ArrowUp className="size-3.5" />
														</button>
														<button
															type="button"
															aria-label={`${shot.shotCode} 后移`}
															disabled={shot.sequence === savedShots.length}
															onClick={() => moveShotRecord(shot.id, 1)}
															className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
														>
															<ArrowDown className="size-3.5" />
														</button>
														<button
															type="button"
															aria-label={`删除 ${shot.shotCode}`}
															onClick={() => deleteShotRecord(shot.id)}
															className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
														>
															<Trash2 className="size-3.5" />
														</button>
													</div>
												</div>
												<div className="grid gap-2 p-3 max-[1400px]:gap-1.5 max-[1400px]:p-2">
													<div className="flex items-center justify-between gap-2">
														<input
															aria-label={`${shot.shotCode} 标题`}
															defaultValue={shot.title}
															onBlur={(event) =>
																updateShotRecord(shot.id, { title: event.target.value.trim() })
															}
															className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold outline-none max-[1400px]:text-[11px]"
														/>
														<Badge variant="outline">{shot.completion}%</Badge>
													</div>
													<details className="min-w-0 overflow-hidden rounded-md border border-border bg-background">
														<summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-[11px] font-medium text-foreground">
															<Crop className="size-3.5 text-primary" />
															调整分镜裁切
														</summary>
														<div className="grid min-w-0 gap-2 border-t border-border p-2.5 max-[1400px]:gap-1.5 max-[1400px]:p-2">
															{(["x", "y", "width", "height"] as const).map((field) => (
																<label
																	key={field}
																	className="grid min-w-0 grid-cols-[42px_minmax(0,1fr)_40px] items-center gap-2 text-[10px] text-muted-foreground max-[1400px]:grid-cols-[28px_minmax(0,1fr)_28px] max-[1400px]:gap-1 max-[1400px]:text-[9px]"
																>
																	<span>
																		{field === "x"
																			? "左右"
																			: field === "y"
																				? "上下"
																				: field === "width"
																					? "宽度"
																					: "高度"}
																	</span>
																	<input
																		className="min-w-0"
																		type="range"
																		min={0.01}
																		max={1}
																		step={0.01}
																		value={crop[field]}
																		onChange={(event) =>
																			updateShotRecord(shot.id, {
																				storyboardCrop: {
																					...crop,
																					[field]: Number(event.target.value),
																				},
																			})
																		}
																	/>
																	<span className="text-right tabular-nums">
																		{Math.round(crop[field] * 100)}%
																	</span>
																</label>
															))}
														</div>
													</details>
													<div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground max-[1400px]:text-[9px]">
														<span>{shot.assetIds?.length ?? 0} 个绑定资产</span>
														<span>{productionStageStateLabels[shot.status]}</span>
													</div>
													<div className="grid grid-cols-2 gap-2 max-[1400px]:gap-1.5">
														<Button
															className="min-w-0 whitespace-nowrap px-2 text-xs max-[1400px]:h-7 max-[1400px]:px-1 max-[1400px]:text-[9px]"
															size="sm"
															variant="outline"
															onClick={() =>
																openProjectGeneration("image", {
																	heading: `${shot.shotCode} 分镜执行图`,
																	prompt: `${shot.title}\n${shot.description ?? ""}`,
																	resourceId: shot.id,
																	resourceType: "storyboard",
																	shotIds: [shot.shotCode],
																})
															}
														>
															生成分镜图
														</Button>
														<Button
															className="min-w-0 whitespace-nowrap px-2 text-xs max-[1400px]:h-7 max-[1400px]:px-1 max-[1400px]:text-[9px]"
															size="sm"
															variant="outline"
															onClick={() => onOpenWorkspace("shots")}
														>
															进入单镜制作
														</Button>
													</div>
												</div>
											</article>
										);
									})}
								</div>
								<section className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.025] p-3">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<p className="text-sm font-semibold text-foreground">
												分析全部分镜，决定需要多少资产
											</p>
											<p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
												先逐镜识别人、景、物、产品和特效，再合并可复用项。此处只形成资产清单和镜头关系，不生图。
											</p>
										</div>
										<Badge
											variant={
												assetPlanMatchesStoryboardCount(assetPlanDraft, shotCountDraft)
													? "secondary"
													: "outline"
											}
										>
											{isAnalyzingAssets
												? "正在分析"
												: assetPlanMatchesStoryboardCount(assetPlanDraft, shotCountDraft)
													? "清单已生成"
													: isUsableAssetPlan(assetPlanDraft)
														? `清单与当前 ${shotCountDraft}P 不匹配`
														: "尚未生成"}
										</Badge>
									</div>
									<Textarea
										aria-label="分镜资产清单"
										value={assetPlanDraft}
										onChange={(event) => {
											setAssetPlanDraft(event.target.value);
											if (assetAnalysisError) setAssetAnalysisError("");
										}}
										placeholder="AI 分析后，这里会出现去重后的资产清单：资产 ID、类别、必要变体、使用镜头、需要生成的视图、Prompt 摘要与优先级。"
										className="mt-3 min-h-36 resize-y bg-background text-xs leading-6"
									/>
									{assetAnalysisError ? (
										<div className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
											本次结果未形成有效资产清单：{assetAnalysisError}
										</div>
									) : null}
									<div className="mt-3 grid grid-cols-2 gap-2">
										<Button
											size="sm"
											variant="outline"
											disabled={!selectedStoryboardAsset || isAnalyzingAssets}
											onClick={() => void analyzeStoryboardAssets()}
										>
											<WandSparkles className="size-3.5" />
											{isAnalyzingAssets
												? "正在逐镜分析…"
												: assetAnalysisError
													? "重新分析资产"
													: "AI 分析并精简资产数量"}
										</Button>
										<Button
											size="sm"
											disabled={
												!assetPlanMatchesStoryboardCount(assetPlanDraft, shotCountDraft) ||
												!onProductionPatch
											}
											onClick={() => {
												saveSharedDraft(
													"assetPlan",
													assetPlanDraft,
													"资产数量与镜头覆盖已确认，第 03 步可逐项生成。",
												);
												const nextStage = pipeline.stages.find(
													(stage) => stage.order === selectedStage.order + 1,
												);
												if (nextStage) {
													setSelectedStageId(nextStage.id);
													onOpenStage(nextStage);
													window.requestAnimationFrame(() =>
														window.scrollTo({ top: 0, behavior: "smooth" }),
													);
												}
											}}
										>
											<Check className="size-3.5" />
											确认清单并交给第 03 步
										</Button>
									</div>
								</section>
							</>
						)}
					</div>
				) : currentStageDraftConfig &&
				  selectedStage.capability !== "asset-plan" &&
				  selectedStage.capability !== "asset-production" ? (
					<div className="mt-4 rounded-lg border border-border bg-background p-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-sm font-semibold text-foreground">本阶段核心工作稿</p>
								<h2 className="mt-1 text-base font-semibold text-foreground">
									{currentStageDraftConfig.label}
								</h2>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									{currentStageDraftConfig.description}
								</p>
							</div>
							<Badge variant={stageDraft.trim() ? "secondary" : "outline"}>
								{stageDraft.trim() ? "已写入项目记忆" : "等待输入"}
							</Badge>
						</div>
						<Textarea
							aria-label={currentStageDraftConfig.label}
							value={stageDraft}
							onChange={(event) => setStageDraft(event.target.value)}
							placeholder={currentStageDraftConfig.placeholder}
							className="mt-3 min-h-36 bg-card text-sm"
						/>
						<div className="mt-3 flex flex-wrap items-center justify-between gap-3">
							<p className="text-[11px] leading-4 text-muted-foreground">
								保存后下游阶段和制作助理都会自动读取，不用重复粘贴。
							</p>
							<Button
								size="sm"
								variant="outline"
								disabled={!onProductionPatch}
								onClick={() =>
									saveSharedDraft(
										currentStageDraftConfig.field,
										stageDraft,
										`${currentStageDraftConfig.label}已写入项目记忆。`,
									)
								}
							>
								保存本阶段工作稿
							</Button>
						</div>
					</div>
				) : null}

				{selectedStage.capability === "asset-plan" ||
				selectedStage.capability === "asset-production" ? (
					<div className="mt-4 rounded-lg border border-border bg-background p-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-sm font-semibold text-foreground">
									{selectedStage.capability === "asset-production"
										? "资产制作：编辑 Prompt、生成 / 上传与版本"
										: "整理、确认并管理资产 Prompt"}
								</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									{selectedStage.capability === "asset-production"
										? "先修改或复制 Prompt，再直接用 Codex 或 API 生图。结果会替换预览并自动归档、保留版本和镜头关系；下一步只做审核。"
										: "第 03 步只准备提示词，不生成图片。你可以复制到其他平台使用，确认后再进入第 04 步生图。"}
								</p>
							</div>
							<div className="flex items-center gap-2">
								<Badge variant={isUsableAssetPlan(assetPlanDraft) ? "secondary" : "outline"}>
									{isUsableAssetPlan(assetPlanDraft)
										? `${plannedAssets.length} 条 Prompt`
										: "等待第 02 步确认"}
								</Badge>
								<Button
									size="sm"
									variant="outline"
									disabled={plannedAssets.length === 0}
									onClick={async () => {
										await navigator.clipboard.writeText(
											plannedAssets.map(resolvedAssetPrompt).join("\n\n---\n\n"),
										);
										setCopiedAssetId("all");
									}}
								>
									<ClipboardCheck className="size-3.5" />
									{copiedAssetId === "all" ? "已复制全部" : "复制全部 Prompt"}
								</Button>
							</div>
						</div>
						{plannedAssets.length === 0 ? (
							<div className="mt-4 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center">
								<p className="text-sm font-medium text-foreground">清单还没有拆成可执行资产</p>
								<p className="mt-1 text-xs text-muted-foreground">
									请回到第 02 步重新分析，清单必须包含资产名称、类别和使用镜头。
								</p>
								<Button
									className="mt-3"
									size="sm"
									variant="outline"
									onClick={() => {
										const previousStage = pipeline.stages.find(
											(stage) => stage.order === selectedStage.order - 1,
										);
										if (previousStage) onOpenStage(previousStage);
									}}
								>
									返回第 02 步补全清单
								</Button>
							</div>
						) : (
							<div className="mt-4 grid gap-4">
								{plannedAssetsByCategory.map(({ category, items }) => {
									if (items.length === 0) return null;
									const meta = plannedAssetCategoryMeta[category];
									return (
										<section key={category} className="rounded-lg border border-border bg-card p-3">
											<div className="flex items-start justify-between gap-3">
												<div>
													<h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
													<p className="mt-1 text-[11px] text-muted-foreground">
														{meta.description}
													</p>
												</div>
												<div className="flex items-center gap-2">
													<Button
														size="sm"
														variant="outline"
														disabled={items.length === 0}
														onClick={() =>
															openProjectGeneration("image", {
																heading: `${meta.label} · 资产用途示意图`,
																prompt: `请生成一张“${meta.label}”制作资产用途示意图，采用整洁的商业设定板排版，清楚展示以下资产在后续镜头中的标准形态与用途。不要把不同人物身份或产品结构混在一起。\n\n${items.map((item) => resolvedAssetGenerationPrompt(item)).join("\n\n---\n\n")}`,
																resourceId: `CATEGORY-DEMO-${category}`,
																resourceType: category === "style" ? "prop" : category,
																shotIds: [...new Set(items.flatMap((item) => item.shotIds))],
															})
														}
													>
														<WandSparkles className="size-3.5" /> 生成类别示意图（1 张）
													</Button>
													<Badge variant="outline">{items.length} 项</Badge>
												</div>
											</div>
											<div className="mt-3 grid gap-2">
												{items.map((item) => {
													const generatedAssets = catalogAssets.filter(
														(asset) =>
															asset.resourceId === item.id ||
															asset.resourceId?.startsWith(`${item.id}::`) ||
															asset.resourceTitle === item.name ||
															asset.resourceTitle?.startsWith(`${item.id} ·`),
													);
													const selectedShotId = previewShotOverrides[item.id] ?? item.shotIds[0];
													const normalizeShotId = (value: string | undefined) => {
														const text = value?.trim().toUpperCase() ?? "";
														const number = text.match(/(?:S|P)(\d{1,3})/u)?.[1];
														return number ? `S${number.padStart(2, "0")}` : text;
													};
													const selectedShotKey = normalizeShotId(selectedShotId);
													const shotGeneratedAssets = generatedAssets.filter((asset) =>
														(asset.shotIds ?? []).some(
															(shotId) => normalizeShotId(shotId) === selectedShotKey,
														),
													);
													// Do not silently show another scene's image. A missing scene binding must be visible.
													const visibleGeneratedAssets = shotGeneratedAssets;
													const generatedAsset =
														visibleGeneratedAssets.find(
															(asset) =>
																asset.id ===
																(assetVersionOverrides[`${item.id}::${selectedShotId}`] ??
																	assetPromptDrafts[
																		`${item.id}::${selectedShotId}::lockedVersion`
																	]),
														) ?? visibleGeneratedAssets[visibleGeneratedAssets.length - 1];
													const generatedSource = generatedAsset
														? generationAssetSource(generatedAsset)
														: "";
													const sourceShotCode = selectedShotId?.match(/(?:S|P)(\d{1,3})/iu)?.[1];
													const sourceShot = sourceShotCode
														? savedShots.find(
																(shot) =>
																	Number(shot.shotCode.match(/\d+/u)?.[0]) ===
																	Number(sourceShotCode),
															)
														: undefined;
													return (
														<article
															key={`${item.category}:${item.id}:${item.name}`}
															id={`asset-prompt-card-${item.id}`}
															className="grid gap-3 rounded-md border border-border bg-background p-3 md:grid-cols-[minmax(180px,0.6fr)_minmax(260px,1fr)_minmax(260px,1fr)_132px] md:items-start"
														>
															<div className="min-w-0 space-y-2">
																<PlannedAssetPreview
																	generatedSource={generatedSource}
																	item={item}
																	previewShotId={previewShotOverrides[item.id]}
																	storyboardCrop={
																		sourceShot
																			? displayedStoryboardCrop(sourceShot, savedShots.length)
																			: undefined
																	}
																	storyboardSource={selectedStoryboardSource}
																/>
																{item.shotIds.length > 1 ? (
																	<select
																		value={previewShotOverrides[item.id] ?? item.shotIds[0]}
																		onChange={(event) =>
																			setPreviewShotOverrides((current) => ({
																				...current,
																				[item.id]: event.target.value,
																			}))
																		}
																		className="h-7 w-full rounded border border-border bg-background px-2 text-[11px]"
																		aria-label={`${item.name} 切换关联镜头资产`}
																	>
																		{item.shotIds.map((shotId) => (
																			<option key={shotId} value={shotId}>
																				查看 {shotId} 关联资产
																			</option>
																		))}
																	</select>
																) : null}
																{visibleGeneratedAssets.length > 1 ? (
																	<select
																		value={generatedAsset?.id ?? ""}
																		onChange={(event) =>
																			setAssetVersionOverrides((current) => ({
																				...current,
																				[`${item.id}::${selectedShotId}`]: event.target.value,
																			}))
																		}
																		className="h-7 w-full rounded border border-border bg-background px-2 text-[11px]"
																		aria-label={`${item.name} 切换已生成资产版本`}
																	>
																		{visibleGeneratedAssets.map((asset, index) => (
																			<option key={asset.id} value={asset.id}>
																				查看已生成版本 {index + 1}
																			</option>
																		))}
																	</select>
																) : null}
																<p className="text-xs font-semibold text-foreground">
																	{item.id} · {item.name}
																</p>
																<p className="mt-1 text-[11px] text-muted-foreground">
																	{item.variant}
																</p>
															</div>
															<div className="min-w-0">
																<div className="mb-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto">
																	<Badge className="h-7 rounded-md px-2 text-[11px]">
																		资产神经树
																	</Badge>
																	<Button
																		className="h-7 rounded-md px-2 text-[11px]"
																		size="sm"
																		variant="outline"
																		onClick={() =>
																			setAssistantAssetRequest({
																				id: item.id,
																				field: "tree",
																				requestId: Date.now(),
																			})
																		}
																	>
																		<PencilLine className="size-3.5" /> 智能调整
																	</Button>
																	<Button
																		className="h-7 rounded-md px-2 text-[11px]"
																		size="sm"
																		variant="outline"
																		onClick={async () => {
																			await navigator.clipboard.writeText(
																				resolvedAssetPrompt(item),
																			);
																			setCopiedAssetId(`${item.id}-tree`);
																		}}
																	>
																		<ClipboardCheck className="size-3.5" />{" "}
																		{copiedAssetId === `${item.id}-tree` ? "已复制" : "复制 Prompt"}
																	</Button>
																</div>
																<Textarea
																	value={
																		assetPromptDrafts[item.id] ?? buildPlannedAssetPrompt(item)
																	}
																	onChange={(event) =>
																		setAssetPromptDrafts((current) => {
																			const next = { ...current, [item.id]: event.target.value };
																			delete next[`${item.id}::generation`];
																			return next;
																		})
																	}
																	className="min-h-40 resize-y text-[11px] leading-5"
																	aria-label={`${item.name} Prompt`}
																/>
																{item.shotIds.length > 0 ? (
																	<div className="mt-2 flex flex-wrap gap-1">
																		{item.shotIds.map((shotId) => (
																			<span
																				key={shotId}
																				className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
																			>
																				{shotId}
																			</span>
																		))}
																	</div>
																) : (
																	<p className="mt-2 text-[10px] text-warning-foreground">
																		尚未绑定镜头，请补充后再确认。
																	</p>
																)}
															</div>
															<div className="min-w-0">
																<div className="mb-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto">
																	<Badge className="h-7 rounded-md px-2 text-[11px]">资产</Badge>
																	<Button
																		className="h-7 rounded-md px-2 text-[11px]"
																		size="sm"
																		variant="outline"
																		onClick={() =>
																			setAssistantAssetRequest({
																				id: item.id,
																				field: "generation",
																				requestId: Date.now(),
																			})
																		}
																	>
																		<PencilLine className="size-3.5" /> 智能调整
																	</Button>
																	<Button
																		className="h-7 rounded-md px-2 text-[11px]"
																		size="sm"
																		variant="outline"
																		onClick={() =>
																			saveSingleGenerationPrompt(
																				item,
																				buildLockedAssetGenerationPrompt(
																					item,
																					resolvedAssetPrompt(item),
																					savedShots,
																					`${styleMasterDraft}\n${scriptDraft}`,
																				),
																			)
																		}
																	>
																		<WandSparkles className="size-3.5" /> 生成提示词
																	</Button>
																	<Button
																		className="h-7 rounded-md px-2 text-[11px]"
																		size="sm"
																		variant="outline"
																		onClick={async () => {
																			await navigator.clipboard.writeText(
																				resolvedAssetGenerationPrompt(item),
																			);
																			setCopiedAssetId(item.id);
																		}}
																	>
																		<ClipboardCheck className="size-3.5" />{" "}
																		{copiedAssetId === item.id ? "已复制" : "复制 Prompt"}
																	</Button>
																</div>
																<Textarea
																	value={resolvedAssetGenerationPrompt(item)}
																	onChange={(event) =>
																		setAssetPromptDrafts((current) => ({
																			...current,
																			[`${item.id}::generation`]: event.target.value,
																		}))
																	}
																	className="min-h-40 resize-y text-[11px] leading-5"
																	aria-label={`${item.name} 资产生成 Prompt`}
																/>
															</div>
															<div className="flex flex-wrap gap-2 md:w-28 md:flex-col">
																<Button
																	className="h-8 w-full rounded-md px-2 text-xs"
																	size="sm"
																	variant="outline"
																	onClick={() =>
																		setAssistantAssetRequest({
																			id: item.id,
																			field: "generation",
																			requestId: Date.now(),
																		})
																	}
																>
																	<Upload className="size-3.5" /> 上传参考图
																</Button>
																<Button
																	size="sm"
																	variant="outline"
																	disabled={
																		queueRunning ||
																		apiGeneratingAssetIds.has(item.id) ||
																		codexGeneratingAssetIds.has(item.id)
																	}
																	onClick={() => {
																		const prompt = resolvedAssetGenerationPrompt(item);
																		saveSingleAssetPrompt(item, prompt);
																		void runAssetGeneration("codex", [item]);
																	}}
																>
																	<WandSparkles className="size-3.5" />
																	{codexGeneratingAssetIds.has(item.id)
																		? "Codex 生图中…"
																		: "Codex 生图"}
																</Button>
																<Button
																	size="sm"
																	disabled={
																		queueRunning ||
																		apiGeneratingAssetIds.has(item.id) ||
																		codexGeneratingAssetIds.has(item.id)
																	}
																	onClick={() => {
																		const prompt = resolvedAssetGenerationPrompt(item);
																		saveSingleAssetPrompt(item, prompt);
																		void runAssetGeneration("api", [item]);
																	}}
																>
																	<Image className="size-3.5" />
																	{apiGeneratingAssetIds.has(item.id) ? "API 生图中…" : "API 生图"}
																</Button>
																<Button
																	size="sm"
																	variant="outline"
																	onClick={() => {
																		setAssetUploadTarget(item);
																		window.requestAnimationFrame(() =>
																			assetUploadInputRef.current?.click(),
																		);
																	}}
																>
																	<Upload className="size-3.5" /> 自定义上传
																</Button>
																<Button
																	size="sm"
																	variant={generatedAsset ? "default" : "outline"}
																	disabled={!generatedAsset}
																	onClick={() => {
																		const prompts = {
																			...assetPromptDrafts,
																			[`${item.id}::${selectedShotId}::lockedVersion`]:
																				generatedAsset!.id,
																		};
																		setAssetPromptDrafts(prompts);
																		onProductionPatch?.({
																			sharedContext: {
																				...context?.production?.sharedContext,
																				prompts,
																				updatedAt: new Date().toISOString(),
																			},
																		});
																		updateAssetQC(item.id, "PASS");
																	}}
																>
																	<LockKeyhole className="size-3.5" /> 锁定保存
																</Button>
															</div>
														</article>
													);
												})}
											</div>
										</section>
									);
								})}
							</div>
						)}
						<div className="mt-4 flex flex-wrap gap-2">
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setAssetPlanDraft(
										(current) =>
											`${current.trim()}\n\n- ASSET-${String(plannedAssets.length + 1).padStart(2, "0")}｜补充资产名称｜类别｜使用镜头 S01｜需要生成的视图与 Prompt`,
									);
								}}
							>
								<Plus className="size-3.5" />
								补充缺失资产
							</Button>
							<Button
								size="sm"
								disabled={plannedAssets.length === 0}
								onClick={() => {
									saveSharedDraft(
										"assetPlan",
										assetPlanDraft,
										selectedStage.capability === "asset-production"
											? "资产 Prompt 已确认。请逐项生成或上传资产版本。"
											: "资产 Prompt 已确认，进入第 04 步生成图片。",
									);
									if (selectedStage.capability !== "asset-production")
										enterImageGenerationStage("资产 Prompt 已确认并同步到第 04 步。");
								}}
							>
								{selectedStage.capability === "asset-production"
									? "确认全部 Prompt"
									: "确认 Prompt 并进入第 04 步"}{" "}
								<ArrowRight className="size-3.5" />
							</Button>
						</div>
						{selectedStage.capability === "asset-production" ? (
							<input
								ref={assetUploadInputRef}
								className="hidden"
								type="file"
								accept="image/*"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) void uploadPlannedAsset(file);
								}}
							/>
						) : null}
						<ProductionPromptAssistant
							assets={plannedAssets.map((item) => ({
								id: item.id,
								name: item.name,
								prompt:
									assistantAssetRequest?.field === "tree"
										? resolvedAssetPrompt(item)
										: resolvedAssetGenerationPrompt(item),
								shotIds: item.shotIds,
							}))}
							onClose={() => setAssistantAssetRequest(null)}
							onPromptChange={(assetId, prompt) =>
								setAssetPromptDrafts((current) => {
									const next = {
										...current,
										[assistantAssetRequest?.field === "tree" ? assetId : `${assetId}::generation`]:
											prompt,
									};
									if (assistantAssetRequest?.field === "tree")
										delete next[`${assetId}::generation`];
									return next;
								})
							}
							onRulesChange={savePromptContinuityRules}
							projectId={projectId}
							projectName={name}
							requestedAsset={assistantAssetRequest}
							rules={context?.production?.sharedContext?.shotRules ?? []}
							shotCodes={savedShots.map((shot) => shot.shotCode)}
						/>
					</div>
				) : null}

				{selectedStage.capability === "image-generation" ? (
					<div className="mt-4 rounded-lg border border-border bg-background p-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-sm font-semibold text-foreground">
									按第 03 步 Prompt 逐项生成图片
								</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									每项资产独占一整行。左侧显示当前版本缩略图；生成或上传替换后保留历史版本和镜头关系。
								</p>
							</div>
							<Badge variant="secondary">{plannedAssets.length} 项待生成资产</Badge>
						</div>
						<div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
							<span className="px-1 text-[11px] font-medium text-muted-foreground">快速跳转</span>
							{plannedAssetsByCategory.map(({ category, items }) =>
								items.length > 0 ? (
									<Button
										key={category}
										size="sm"
										variant="outline"
										onClick={() =>
											document
												.getElementById(`generation-category-${category}`)
												?.scrollIntoView({ behavior: "smooth", block: "start" })
										}
									>
										{plannedAssetCategoryMeta[category].label} · {items.length}
									</Button>
								) : null,
							)}
						</div>
						{plannedAssets.length === 0 ? (
							<div className="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center">
								<p className="text-sm font-medium text-foreground">还没有可执行 Prompt</p>
								<p className="mt-1 text-xs text-muted-foreground">
									先在第 03 步整理并确认资产提示词。
								</p>
							</div>
						) : (
							<div className="mt-4 grid gap-5">
								{plannedAssetsByCategory.map(({ category, items }) => {
									if (items.length === 0) return null;
									const meta = plannedAssetCategoryMeta[category];
									return (
										<section
											key={category}
											id={`generation-category-${category}`}
											className="scroll-mt-24"
										>
											<div className="mb-2 flex items-end justify-between gap-3 border-b border-border pb-2">
												<div>
													<p className="text-sm font-semibold text-foreground">{meta.label}</p>
													<p className="mt-0.5 text-[11px] text-muted-foreground">
														{meta.description}
													</p>
												</div>
												<Badge variant="secondary">{items.length} 项</Badge>
											</div>
											<div className="grid gap-3">
												{items.map((item) => {
													const archived = catalogAssets.find(
														(asset) =>
															asset.resourceId === item.id ||
															asset.resourceId?.startsWith(`${item.id}::`) ||
															asset.resourceTitle === item.name,
													);
													const source = archived ? generationAssetSource(archived) : "";
													return (
														<article
															key={`${item.category}:${item.id}:${item.name}`}
															id={`generation-asset-card-${item.id}`}
															className={cn(
																"grid gap-3 rounded-lg border bg-card p-3 transition md:grid-cols-[128px_minmax(0,1fr)_auto] md:items-center",
																generationFocusAssetId === item.id
																	? "border-primary bg-primary/[0.08] shadow-md ring-2 ring-primary/35"
																	: "border-border",
															)}
														>
															<div className="aspect-video overflow-hidden rounded-md border border-border bg-muted">
																{source ? (
																	<img
																		src={source}
																		alt={item.name}
																		className="size-full object-cover"
																	/>
																) : (
																	<div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
																		<Image className="size-5" />
																		<span className="text-[10px]">待生成</span>
																	</div>
																)}
															</div>
															<div className="min-w-0">
																<div className="flex flex-wrap items-center gap-2">
																	<p className="text-xs font-semibold text-foreground">
																		{item.id} · {item.name}
																	</p>
																	<Badge variant={archived ? "secondary" : "outline"}>
																		{archived ? "已有版本" : "待生成"}
																	</Badge>
																	{generationFocusAssetId === item.id ? (
																		<Badge className="bg-primary text-primary-foreground">
																			已定位
																		</Badge>
																	) : null}
																</div>
																<p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
																	{resolvedAssetGenerationPrompt(item)}
																</p>
																<div className="mt-2 flex flex-wrap gap-1">
																	{item.shotIds.map((shotId) => (
																		<span
																			key={shotId}
																			className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
																		>
																			{shotId}
																		</span>
																	))}
																</div>
															</div>
															<div className="flex flex-wrap gap-2 md:w-32 md:flex-col">
																<Button
																	size="sm"
																	disabled={codexGeneratingAssetIds.has(item.id)}
																	onClick={() => openGenerationPromptEditor(item, "codex")}
																>
																	<Image className="size-3.5" />{" "}
																	{codexGeneratingAssetIds.has(item.id)
																		? "Codex 生图中…"
																		: "Codex 生成并归档"}
																</Button>
																<Button
																	size="sm"
																	variant="outline"
																	disabled={codexGeneratingAssetIds.has(item.id)}
																	onClick={() => openGenerationPromptEditor(item, "api")}
																>
																	<Image className="size-3.5" /> API 生图
																</Button>
																<Button
																	size="sm"
																	variant="outline"
																	onClick={() => {
																		setAssetUploadTarget(item);
																		window.requestAnimationFrame(() =>
																			assetUploadInputRef.current?.click(),
																		);
																	}}
																>
																	<Upload className="size-3.5" />{" "}
																	{archived ? "替换图片" : "上传图片"}
																</Button>
																<Button
																	size="sm"
																	variant="ghost"
																	onClick={() => onOpenWorkspace("assets")}
																>
																	查看版本
																</Button>
															</div>
														</article>
													);
												})}
											</div>
										</section>
									);
								})}
							</div>
						)}
						<input
							ref={assetUploadInputRef}
							className="hidden"
							type="file"
							accept="image/*"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (file) void uploadPlannedAsset(file);
							}}
						/>
						{assetUploadError ? (
							<p className="mt-3 text-xs text-destructive">{assetUploadError}</p>
						) : null}
						{codexGenerationError ? (
							<p className="mt-3 text-xs text-destructive">{codexGenerationError}</p>
						) : null}
						{apiGenerationError ? (
							<p className="mt-3 text-xs text-destructive">{apiGenerationError}</p>
						) : null}
					</div>
				) : null}

				{selectedStage.capability === "asset-qc" ? (
					<div className="mt-4 rounded-lg border border-border bg-background p-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-sm font-semibold text-foreground">待审资产与镜头覆盖</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									审核结论要落到具体资产和镜头，不是只修改阶段状态。
								</p>
							</div>
							<Button size="sm" variant="outline" onClick={() => onOpenWorkspace("assets")}>
								打开完整资产库
								<ArrowRight className="size-3.5" />
							</Button>
						</div>
						{productionStageAssets.length === 0 ? (
							<div className="mt-4 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center">
								<Image className="mx-auto size-6 text-muted-foreground" />
								<p className="mt-2 text-sm font-medium text-foreground">还没有归档图片</p>
								<p className="mt-1 text-xs text-muted-foreground">
									先生成或导入第一个版本，结果会自动出现在这里。
								</p>
							</div>
						) : (
							<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
								{productionStageAssets.slice(0, 8).map((asset) => {
									const source = generationAssetSource(asset);
									const qc = assetQCById.get(asset.id);
									return (
										<article
											key={asset.id}
											className="overflow-hidden rounded-lg border border-border bg-card"
										>
											<div className="aspect-video overflow-hidden bg-muted">
												{source ? (
													<img
														src={source}
														alt={asset.title || asset.resourceTitle || "项目资产"}
														className="size-full object-cover"
													/>
												) : null}
											</div>
											<div className="p-3">
												<div className="flex items-center justify-between gap-2">
													<p className="truncate text-xs font-medium text-foreground">
														{asset.title || asset.resourceTitle || "未命名资产"}
													</p>
													{stageIncludesAssetQC ? (
														<Badge
															variant={
																qc?.status === "NEEDS_FIX" || qc?.status === "BLOCKED"
																	? "destructive"
																	: "outline"
															}
														>
															{qc?.status === "PASS"
																? "已通过"
																: qc?.status === "NEEDS_FIX"
																	? "需修改"
																	: qc?.status === "BLOCKED"
																		? "被阻塞"
																		: qc?.status === "MISSING"
																			? "缺失"
																			: "待审核"}
														</Badge>
													) : null}
												</div>
												<p className="mt-1 text-[11px] text-muted-foreground">
													{asset.shotIds?.length ?? 0} 个镜头使用 · {asset.resourceType}
												</p>
												{stageIncludesAssetQC ? (
													<div className="mt-3 grid grid-cols-2 gap-1.5">
														<Button size="sm" onClick={() => updateAssetQC(asset.id, "PASS")}>
															通过
														</Button>
														<Button
															size="sm"
															variant="outline"
															onClick={() => updateAssetQC(asset.id, "NEEDS_FIX")}
														>
															需修改
														</Button>
													</div>
												) : null}
											</div>
										</article>
									);
								})}
							</div>
						)}
					</div>
				) : null}

				{selectedStage.capability === "shot-execution" ? (
					<div
						className="mt-4 rounded-lg border border-border bg-background p-4"
						aria-label="单镜执行设计器"
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-sm font-semibold text-foreground">单镜执行设计器</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									先确认资产与前后镜交接，再保存单镜 Prompt；点击生成前仍可在弹窗内改词。
								</p>
							</div>
							<Badge variant="outline">{savedShots.length} 镜 · 第 06 步</Badge>
						</div>
						<div
							className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
							aria-label="逐镜制作进度"
						>
							{[
								["已带入资产", assetLinkedShotCount, "第 02、04 步资产"],
								["提示词已准备", executionPromptReadyCount, "可进入生成窗口改词"],
								["执行图已归档", executionImageReadyCount, "第 06 步完成"],
								["视频已进粗剪", roughCutArchivedShotIds.size, "第 07 → 08 步自动归档"],
							].map(([label, count, detail]) => (
								<div
									key={label as string}
									className="rounded-md border border-border bg-card px-3 py-2.5"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="text-xs font-medium text-foreground">{label}</span>
										<span className="text-sm font-semibold text-foreground">
											{count as number}/{savedShots.length}
										</span>
									</div>
									<p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
								</div>
							))}
						</div>
						{savedShots.length === 0 || !activeExecutionShot ? (
							<div className="mt-4 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
								还没有独立镜头。请先回到第 02 步，从锁定分镜建立镜头卡。
							</div>
						) : (
							<div className="mt-4 grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)_260px]">
								<nav
									className="max-h-[620px] space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-2"
									aria-label="镜头序列"
								>
									{savedShots.map((shot) => {
										const selected = shot.id === activeExecutionShot.id;
										const ready = Boolean(
											shot.visualLogic?.trim() &&
											shot.cameraLanguage?.trim() &&
											shot.executionPrompt?.trim(),
										);
										return (
											<button
												key={shot.id}
												type="button"
												onClick={() => setActiveExecutionShotId(shot.id)}
												className={cn(
													"flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs transition-colors",
													selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
												)}
											>
												<span className="font-semibold">{shot.shotCode}</span>
												<span
													className={cn(
														"text-[10px]",
														selected ? "text-primary-foreground/80" : "text-muted-foreground",
													)}
												>
													{shot.firstFrameAssetId ? "执行图" : ready ? "待出图" : "待设计"}
												</span>
											</button>
										);
									})}
								</nav>

								<section className="min-w-0 rounded-lg border border-border bg-card p-4">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div>
											<h3 className="text-base font-semibold text-foreground">
												{activeExecutionShot.shotCode} · {activeExecutionShot.title}
											</h3>
											<p className="mt-1 text-xs text-muted-foreground">
												{activeExecutionShot.description || "请先从分镜中补充这镜的叙事目的。"}
											</p>
										</div>
										<Badge
											variant={activeExecutionShot.firstFrameAssetId ? "secondary" : "outline"}
										>
											{activeExecutionShot.firstFrameAssetId ? "执行图已归档" : "待生成执行图"}
										</Badge>
									</div>

									<div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
										<div className="flex items-center justify-between gap-2">
											<p className="text-xs font-semibold text-foreground">自动带入的镜头资产</p>
											<span className="text-[11px] text-muted-foreground">
												{executionAssets.length} 项
											</span>
										</div>
										{executionAssets.length ? (
											<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
												{executionAssets.map((asset) => (
													<button
														key={asset.id}
														type="button"
														onClick={() => setReferencePreviewAsset(asset)}
														className="overflow-hidden rounded border border-border bg-background text-left transition hover:border-primary hover:shadow-sm"
														title="点击放大参考图"
													>
														<div className="aspect-video bg-muted">
															{generationAssetSource(asset) ? (
																<img
																	src={generationAssetSource(asset)}
																	alt={`${asset.title || asset.resourceTitle || "镜头"} 参考图`}
																	className="size-full object-cover"
																/>
															) : (
																<div className="grid size-full place-items-center text-[10px] text-muted-foreground">
																	暂无缩略图
																</div>
															)}
														</div>
														<span className="block truncate px-2 py-1.5 text-[11px] text-foreground">
															{asset.title ||
																asset.resourceTitle ||
																asset.resourceId ||
																"未命名资产"}
														</span>
													</button>
												))}
											</div>
										) : (
											<p className="mt-2 text-xs text-destructive">
												本镜没有已绑定资产；请回到第 02/04 步补齐后再生成。
											</p>
										)}
									</div>

									{activeExecutionShot.executionPrompt?.trim() ? (
										<div className="mt-4 grid gap-3 lg:grid-cols-2">
											{(
												[
													["执行图提示词", "execution", activeExecutionShot.executionPrompt],
													["视频提示词", "video", activeExecutionShot.motionPrompt],
												] as const
											).map(([label, kind, prompt]) => (
												<section
													key={kind}
													className="rounded-md border border-border bg-muted/20 p-3"
												>
													<div className="flex items-center justify-between gap-2">
														<p className="text-xs font-semibold text-foreground">{label}</p>
														<div className="flex gap-1.5">
															<Button
																size="sm"
																variant="outline"
																onClick={() => setEditingShotPrompt({ kind, value: prompt ?? "" })}
															>
																修改
															</Button>
															<Button
																size="sm"
																variant="outline"
																disabled={!prompt?.trim()}
																onClick={() => void copyActiveShotPrompt(kind)}
															>
																{copiedAssetId === `${activeExecutionShot.id}:${kind}`
																	? "已复制"
																	: "复制"}
															</Button>
														</div>
													</div>
													{prompt?.trim() ? (
														<pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px] leading-5 text-foreground">
															{prompt}
														</pre>
													) : (
														<p className="mt-2 text-[11px] text-muted-foreground">
															生成执行图后，系统会据此生成视频提示词。
														</p>
													)}
												</section>
											))}
										</div>
									) : (
										<div className="mt-4 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
											点击“一键生成提示词”后，这里会显示可复制的执行图和视频提示词；进入生成窗口前仍可改关键词。
										</div>
									)}

									<div className="mt-4 flex flex-wrap gap-2">
										<Button
											variant="outline"
											disabled={!executionAssets.length}
											onClick={generateShotPromptDraft}
										>
											<WandSparkles className="mr-1.5 size-4" />
											一键生成提示词
										</Button>
										<Button
											disabled={
												!executionAssets.length || !activeExecutionShot.executionPrompt?.trim()
											}
											onClick={() =>
												openProjectGeneration("image", {
													prompt: promptWithContinuityRules(
														activeExecutionShot.executionPrompt ?? "",
														activeExecutionShot.shotCode,
														context?.production?.sharedContext?.shotRules ?? [],
													),
													shotIds: [activeExecutionShot.id],
													selectedAssetKeys: executionAssets
														.map(generationAssetSelectionKey)
														.filter((key): key is string => Boolean(key)),
													heading: `${activeExecutionShot.shotCode} 单镜执行图`,
												})
											}
										>
											<Image className="mr-1.5 size-4" />
											打开执行图生成
										</Button>
										<Button
											variant="outline"
											disabled={
												!activeExecutionShot.firstFrameAssetId ||
												!activeExecutionShot.motionPrompt?.trim()
											}
											onClick={() =>
												openProjectGeneration("video", {
													prompt: promptWithContinuityRules(
														activeExecutionShot.motionPrompt ?? "",
														activeExecutionShot.shotCode,
														context?.production?.sharedContext?.shotRules ?? [],
													),
													shotIds: [activeExecutionShot.id],
													heading: `${activeExecutionShot.shotCode} 视频生成`,
												})
											}
										>
											<Video className="mr-1.5 size-4" />
											打开第 07 步视频生成
										</Button>
										<Button variant="ghost" onClick={() => void optimizeActiveShotPrompts()}>
											<WandSparkles className="mr-1.5 size-4" />
											交给助理优化提示词
										</Button>
									</div>
								</section>

								<aside className="space-y-3">
									<div className="rounded-lg border border-border bg-card p-3">
										<p className="text-xs font-semibold text-foreground">上镜接入</p>
										<p className="mt-1 text-[11px] text-muted-foreground">
											{previousExecutionShot
												? `${previousExecutionShot.shotCode} 尾帧 → 本镜首帧`
												: "首镜，无上镜约束"}
										</p>
										<Textarea
											key={`${activeExecutionShot.id}:in:${activeExecutionShot.continuityIn ?? ""}`}
											aria-label={`${activeExecutionShot.shotCode} 上镜衔接`}
											defaultValue={activeExecutionShot.continuityIn ?? ""}
											onBlur={(event) =>
												updateShotRecord(activeExecutionShot.id, {
													continuityIn: event.target.value.trim(),
												})
											}
											placeholder="方向、角色状态、光线、物体位置必须如何延续。"
											className="mt-2 min-h-24 bg-background text-xs"
										/>
									</div>
									<div className="rounded-lg border border-border bg-card p-3">
										<p className="text-xs font-semibold text-foreground">交给下镜</p>
										<p className="mt-1 text-[11px] text-muted-foreground">
											{nextExecutionShot
												? `${activeExecutionShot.shotCode} 尾帧 → ${nextExecutionShot.shotCode} 首帧`
												: "末镜，收束为最终状态"}
										</p>
										<Textarea
											key={`${activeExecutionShot.id}:out:${activeExecutionShot.continuityOut ?? ""}`}
											aria-label={`${activeExecutionShot.shotCode} 下镜衔接`}
											defaultValue={activeExecutionShot.continuityOut ?? ""}
											onBlur={(event) =>
												updateShotRecord(activeExecutionShot.id, {
													continuityOut: event.target.value.trim(),
												})
											}
											placeholder="尾帧构图、运动方向、状态与转场钩子。"
											className="mt-2 min-h-24 bg-background text-xs"
										/>
									</div>
									<div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
										<p className="font-semibold text-foreground">本镜验收</p>
										<ul className="mt-2 space-y-1 text-muted-foreground">
											<li>{executionAssets.length ? "✓" : "○"} 资产已关联</li>
											<li>{activeExecutionShot.visualLogic?.trim() ? "✓" : "○"} 图片逻辑已写</li>
											<li>{activeExecutionShot.cameraLanguage?.trim() ? "✓" : "○"} 镜头语言已写</li>
											<li>
												{activeExecutionShot.executionPrompt?.trim() ? "✓" : "○"} 执行 Prompt 已确认
											</li>
											<li>{activeExecutionShot.firstFrameAssetId ? "✓" : "○"} 执行图已归档</li>
										</ul>
									</div>
								</aside>
							</div>
						)}
					</div>
				) : ["motion-design", "video-qc"].includes(selectedStage.capability) ? (
					<div className="mt-4 rounded-lg border border-border bg-background p-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-sm font-semibold text-foreground">
									{/归档|粗剪/.test(selectedStage.label)
										? "第 08 步粗剪归档队列"
										: "第 07 步逐镜视频生成"}
								</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									{/归档|粗剪/.test(selectedStage.label)
										? "第 07 步完成的视频会自动进入这里，保留镜头、执行图、视频 Prompt、版本和顺序。"
										: "只提交已确认首帧和视频 Prompt 的镜头；完成后自动归档到第 08 步。"}
								</p>
							</div>
							<Badge variant="outline">{savedShots.length} 个镜头</Badge>
						</div>
						<div className="mt-4 flex flex-wrap gap-2 text-xs">
							<Badge variant="outline">
								执行图 {executionImageReadyCount}/{savedShots.length}
							</Badge>
							<Badge variant="outline">
								视频 {videoReadyShotIds.size}/{savedShots.length}
							</Badge>
							<Badge variant="outline">
								粗剪归档 {roughCutArchivedShotIds.size}/{savedShots.length}
							</Badge>
						</div>
						{savedShots.length === 0 ? (
							<div className="mt-4 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
								还没有独立镜头。可以先查看本阶段，但需回到 02 把分镜拆成镜头卡后才能执行。
							</div>
						) : (
							<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{savedShots.map((shot) => {
									const isArchiveStage = /归档|粗剪/.test(selectedStage.label);
									const videoCount =
										context?.production?.productionGraph?.nodes.filter(
											(node) => node.type === "video" && node.shotId === shot.id,
										).length ?? 0;
									const primaryLabel = isArchiveStage
										? videoCount > 0
											? "已归档到粗剪"
											: "等待第 07 步视频"
										: selectedStage.capability === "motion-design"
											? "保存动作设计"
											: videoCount > 0
												? "继续生成 / 导入视频"
												: "生成或导入首个视频";
									return (
										<article key={shot.id} className="rounded-lg border border-border bg-card p-3">
											<div className="flex items-center justify-between gap-3">
												<span className="text-sm font-semibold text-foreground">
													{shot.shotCode}
												</span>
												<Badge variant="outline">{shot.completion}%</Badge>
											</div>
											<p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
												{shot.description || "等待补充动作、构图和连续性要求。"}
											</p>
											{selectedStage.capability === "motion-design" ? (
												<Textarea
													aria-label={`${shot.shotCode} 动态 Prompt`}
													defaultValue={shot.motionPrompt ?? ""}
													placeholder="主体动作、节拍、方向、运镜、速度和不可改变项……"
													onBlur={(event) =>
														updateShotRecord(shot.id, { motionPrompt: event.target.value.trim() })
													}
													className="mt-3 min-h-20 bg-background text-xs"
												/>
											) : (
												<div className="mt-3 rounded bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
													{isArchiveStage
														? roughCutArchivedShotIds.has(shot.id) ||
															roughCutArchivedShotIds.has(shot.shotCode)
															? "已自动归档：可在镜头与动态查看粗剪顺序"
															: "尚无可归档视频"
														: `执行图 ${shot.firstFrameAssetId ? "已就绪" : "未完成"} · 视频版本 ${videoCount} 个`}
												</div>
											)}
											<Button
												size="sm"
												className="mt-3 w-full"
												onClick={() => {
													if (isArchiveStage) {
														onOpenWorkspace("shots");
													} else if (selectedStage.capability === "motion-design") {
														openAgent();
													} else {
														openProjectGeneration("video", {
															prompt: promptWithContinuityRules(
																shot.motionPrompt || shot.description || "",
																shot.shotCode,
																context?.production?.sharedContext?.shotRules ?? [],
															),
															shotIds: [shot.id],
															heading: `${shot.shotCode} 视频生成`,
														});
													}
												}}
											>
												{primaryLabel}
											</Button>
										</article>
									);
								})}
							</div>
						)}
					</div>
				) : null}

				{selectedStage.capability === "final-qc" || selectedStage.capability === "retrospective" ? (
					<div className="mt-4 rounded-lg border border-border bg-background p-4">
						<p className="text-sm font-semibold text-foreground">
							{selectedStage.capability === "final-qc" ? "成片交付检查" : "项目经验归档"}
						</p>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							{selectedStage.capability === "final-qc"
								? "将真正影响交付的项目逐项确认，不用一个笼统 PASS 掩盖细节问题。"
								: "这里最终应形成可被下一个项目直接读取的规则、Prompt 和案例。"}
						</p>
						<div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
							{(selectedStage.capability === "final-qc"
								? [
										"画面与镜头完整",
										"配音 / 音乐 / 音效",
										"字幕与错字",
										"调色与一致性",
										"AI 穿帮检查",
										"画幅 / 分辨率 / 导出",
									]
								: [
										"成功版本",
										"失败原因",
										"可复用 Prompt",
										"一致性规则",
										"可复用资产",
										"下一项目建议",
									]
							).map((item) => (
								<div
									key={item}
									className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-foreground"
								>
									<span className="size-2 rounded-full bg-muted-foreground/40" />
									{item}
								</div>
							))}
						</div>
					</div>
				) : null}

				<div className="mt-4 grid gap-2">
					<details className="rounded-lg border border-border/70 bg-background">
						<summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-[11px] font-medium text-foreground">
							<span>查看本阶段输入与交付标准</span>
							<span className="text-muted-foreground">
								{workspaceDefinition.inputs.length} 项输入 · {workspaceDefinition.outputs.length}{" "}
								项交付
							</span>
						</summary>
						<div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">
							<div>
								<p className="text-xs font-medium text-muted-foreground">开始前需要</p>
								<ul className="mt-3 grid gap-2 text-xs text-foreground">
									{workspaceDefinition.inputs.map((item) => (
										<li key={item}>• {item}</li>
									))}
								</ul>
							</div>
							<div>
								<p className="text-xs font-medium text-muted-foreground">完成后得到</p>
								<ul className="mt-3 grid gap-2 text-xs text-foreground">
									{workspaceDefinition.outputs.map((item) => (
										<li key={item}>• {item}</li>
									))}
								</ul>
							</div>
						</div>
					</details>

					<details className="rounded-lg border border-border/70 bg-background">
						<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xs font-medium text-foreground">
							<span className="flex items-center gap-2">
								<ClipboardCheck className="size-4 text-primary" />
								执行依据：事实、待确认与风险
							</span>
							<Badge variant={hasConfirmed ? "secondary" : "outline"}>
								{hasConfirmed ? "已确认" : "等待确认"}
							</Badge>
						</summary>
						<div className="border-t border-border p-4">
							<div className="grid gap-4 text-xs md:grid-cols-3">
								<div>
									<p className="font-medium text-foreground">已知事实</p>
									<ul className="mt-2 grid gap-1.5 text-muted-foreground">
										{(analysis.facts.length ? analysis.facts : inferredFacts).map((item) => (
											<li key={item}>· {item}</li>
										))}
									</ul>
								</div>
								<div>
									<p className="font-medium text-foreground">待确认信息</p>
									<ul className="mt-2 grid gap-1.5 text-muted-foreground">
										{(analysis.unknowns.length ? analysis.unknowns : inferredUnknowns).map(
											(item) => (
												<li key={item}>· {item}</li>
											),
										)}
									</ul>
								</div>
								<div>
									<p className="font-medium text-foreground">风险</p>
									<ul className="mt-2 grid gap-1.5 text-muted-foreground">
										{(analysis.risks.length ? analysis.risks : inferredRisks).map((item) => (
											<li key={item}>· {item}</li>
										))}
									</ul>
								</div>
							</div>
							<Button
								className="mt-4"
								size="sm"
								variant={hasConfirmed ? "outline" : "default"}
								onClick={() =>
									persistMemory({
										phase: "confirm",
										analysis: {
											facts: inferredFacts,
											unknowns: inferredUnknowns,
											risks: inferredRisks,
										},
										confirmation: hasConfirmed
											? { confirmed: false }
											: { confirmed: true, confirmedAt: new Date().toISOString() },
									})
								}
							>
								{hasConfirmed ? "撤销执行确认" : "确认依据，允许执行"}
							</Button>
						</div>
					</details>

					<details className="rounded-lg border border-border/70 bg-background">
						<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xs font-semibold text-foreground">
							<span>审核本阶段结果</span>
							<Badge variant="outline">
								{memory.review
									? productionStageStateLabels[memory.review.status]
									: productionStageStateLabels[selectedStage.state]}
							</Badge>
						</summary>
						<div className="border-t border-border p-4">
							<p className="text-xs text-muted-foreground">
								确认结果后再更新进度；有问题时请写清具体修改项。
							</p>
							<Textarea
								value={memory.note}
								onChange={(event) => persistMemory({ note: event.target.value })}
								placeholder="记录具体修改项、阻塞原因或给下一阶段的不可改变项……"
								className="mt-3 min-h-20 bg-card text-sm"
							/>
							<div className="mt-3 flex flex-wrap gap-2">
								<Button
									size="sm"
									disabled={!selectedStage.hasContent && selectedStage.completion === 0}
									title={
										!selectedStage.hasContent && selectedStage.completion === 0
											? "先完成本阶段的主要产出，才能审核通过"
											: undefined
									}
									onClick={() => recordReview("PASS")}
								>
									<Check className="size-3.5" />
									审核通过
								</Button>
								<Button size="sm" variant="outline" onClick={() => recordReview("NEEDS_FIX")}>
									需修改
								</Button>
								<Button size="sm" variant="destructive" onClick={() => recordReview("BLOCKED")}>
									标记阻塞
								</Button>
							</div>
						</div>
					</details>

					<details className="rounded-lg border border-border/70 bg-background">
						<summary className="cursor-pointer list-none px-4 py-2 text-[11px] font-medium text-muted-foreground">
							阶段管理（完成度与手动状态）
						</summary>
						<div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
							<label className="grid gap-2">
								<span className="flex justify-between text-xs font-medium text-foreground">
									<span>本阶段完成度</span>
									<span>{selectedStage.completion}%</span>
								</span>
								<input
									aria-label="本阶段完成度"
									type="range"
									min={0}
									max={100}
									step={5}
									value={selectedStage.completion}
									disabled={savingStageId !== null || selectedStage.state === "PASS"}
									onChange={(event) =>
										onCompletionChange(selectedStage.id, Number(event.target.value))
									}
									className="accent-primary"
								/>
							</label>
							<label className="grid gap-2">
								<span className="text-xs font-medium text-foreground">手动状态（可选）</span>
								<select
									aria-label="当前阶段状态"
									value={selectedStage.manualState ?? ""}
									disabled={savingStageId !== null}
									onChange={(event) =>
										onStateChange(
											selectedStage.id,
											event.target.value ? (event.target.value as ProductionStageState) : null,
										)
									}
									className="h-8 rounded-control border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
								>
									<option value="">
										跟随自动判断（{productionStageStateLabels[selectedStage.autoState]}）
									</option>
									{Object.entries(productionStageStateLabels).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</label>
							<Button
								className="w-fit"
								variant="outline"
								size="sm"
								onClick={() =>
									persistMemory({
										phase: "analysis",
										confirmation: undefined,
										execution: undefined,
										review: undefined,
									})
								}
							>
								<RefreshCcw className="size-3.5" />
								重置本阶段执行记录
							</Button>
						</div>
					</details>
				</div>

				<details className="mt-2 rounded-lg border border-border/70 bg-background">
					<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-[11px] font-medium text-foreground">
						<span>项目记忆与快捷入口</span>
						<span className="text-muted-foreground">所有阶段自动继承</span>
					</summary>
					<div className="border-t border-border p-4">
						<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
							{contextRows.map(([label, value]) => (
								<div key={label} className="rounded-md bg-muted/50 px-3 py-2 text-xs">
									<span className="text-muted-foreground">{label}：</span>
									<span className="font-medium text-foreground">{value}</span>
								</div>
							))}
						</div>
						<div className="mt-3 flex flex-wrap gap-2">
							<Button variant="outline" size="sm" onClick={() => onOpenWorkspace("reference")}>
								<Layers3 className="size-4" />
								参考图迁移
							</Button>
							<Button variant="outline" size="sm" onClick={() => onOpenWorkspace("assets")}>
								<Image className="size-4" />
								资产库
							</Button>
							<Button variant="outline" size="sm" onClick={() => onOpenWorkspace("shots")}>
								<Video className="size-4" />
								镜头与动态
							</Button>
						</div>
					</div>
				</details>

				<div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
					<p className="text-xs text-muted-foreground">
						已完成 {visiblePipelineStages.filter((stage) => stage.state === "PASS").length}/
						{visiblePipelineStages.length} 阶段 · 当前第
						{visiblePipelineStages.findIndex((stage) => stage.id === selectedStage.id) + 1} 阶段
					</p>
					<div className="flex flex-wrap gap-2">
						{nextStage ? (
							<Button
								size="sm"
								variant={
									selectedStage.state === "PASS" || memory.review?.status === "PASS"
										? "secondary"
										: "outline"
								}
								onClick={() => {
									setSelectedStageId(nextStage.id);
									onOpenStage(nextStage);
								}}
							>
								{selectedStage.state === "PASS" || memory.review?.status === "PASS"
									? "进入"
									: "提前查看"}
								下一阶段：{nextStage.order.toString().padStart(2, "0")} {nextStage.label}{" "}
								<ArrowRight className="size-3.5" />
							</Button>
						) : null}
					</div>
				</div>
			</main>
			{generationPromptEditor
				? createPortal(
						<div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/45 p-4 backdrop-blur-sm">
							<div className="w-full max-w-4xl rounded-xl border border-border bg-background shadow-2xl">
								<div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
									<div>
										<p className="text-sm font-semibold text-foreground">
											生成前调整 Prompt · {generationPromptEditor.item.id}{" "}
											{generationPromptEditor.item.name}
										</p>
										<p className="mt-1 text-xs text-muted-foreground">
											这里改关键词、镜头语言、负面约束；确认生成时会自动保存回第 03 步。
										</p>
									</div>
									<Button size="sm" variant="ghost" onClick={() => setGenerationPromptEditor(null)}>
										取消
									</Button>
								</div>
								<div className="p-5">
									<Textarea
										className="min-h-[360px] font-mono text-xs leading-6"
										value={generationPromptEditor.prompt}
										onChange={(event) =>
											setGenerationPromptEditor((current) =>
												current ? { ...current, prompt: event.target.value } : current,
											)
										}
									/>
									<div className="mt-4 flex justify-end gap-2">
										<Button variant="outline" onClick={() => setGenerationPromptEditor(null)}>
											暂不生成
										</Button>
										<Button onClick={() => void confirmGenerationPrompt()}>
											{generationPromptEditor.mode === "codex"
												? "确认并交给 Codex 生图"
												: "确认并进入 API 生图"}
										</Button>
									</div>
								</div>
							</div>
						</div>,
						document.body,
					)
				: null}
			{editingShotPrompt
				? createPortal(
						<div className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground/55 p-4 backdrop-blur-sm">
							<div className="w-full max-w-4xl rounded-xl border border-border bg-background shadow-2xl">
								<div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
									<div>
										<p className="text-sm font-semibold text-foreground">
											修改{editingShotPrompt.kind === "execution" ? "执行图" : "视频"}提示词
										</p>
										<p className="mt-1 text-xs text-muted-foreground">
											保存后会用于当前镜头后续的执行图或视频生成；不会立即发起生成。
										</p>
									</div>
									<Button size="sm" variant="ghost" onClick={() => setEditingShotPrompt(null)}>
										取消
									</Button>
								</div>
								<div className="p-5">
									<Textarea
										className="min-h-[360px] font-mono text-xs leading-6"
										value={editingShotPrompt.value}
										onChange={(event) =>
											setEditingShotPrompt((current) =>
												current ? { ...current, value: event.target.value } : current,
											)
										}
									/>
									<div className="mt-4 flex justify-end gap-2">
										<Button variant="outline" onClick={() => setEditingShotPrompt(null)}>
											放弃修改
										</Button>
										<Button onClick={saveEditedShotPrompt}>保存提示词</Button>
									</div>
								</div>
							</div>
						</div>,
						document.body,
					)
				: null}
			{referencePreviewAsset
				? createPortal(
						<div
							className="fixed inset-0 z-[85] flex items-center justify-center bg-foreground/55 p-6 backdrop-blur-sm"
							role="dialog"
							aria-modal="true"
							aria-label="参考图放大预览"
							onMouseDown={() => setReferencePreviewAsset(null)}
						>
							<div
								className="w-full max-w-6xl rounded-xl border border-border bg-background p-3 shadow-2xl"
								onMouseDown={(event) => event.stopPropagation()}
							>
								<div className="flex items-center justify-between gap-4 px-2 pb-3">
									<div>
										<p className="text-sm font-semibold text-foreground">
											{referencePreviewAsset.title ||
												referencePreviewAsset.resourceTitle ||
												referencePreviewAsset.resourceId ||
												"未命名资产"}
										</p>
										<p className="mt-0.5 text-xs text-muted-foreground">
											当前镜头自动带入的参考资产
										</p>
									</div>
									<Button size="sm" variant="ghost" onClick={() => setReferencePreviewAsset(null)}>
										关闭
									</Button>
								</div>
								{generationAssetSource(referencePreviewAsset) ? (
									<img
										src={generationAssetSource(referencePreviewAsset)}
										alt={
											referencePreviewAsset.title ||
											referencePreviewAsset.resourceTitle ||
											referencePreviewAsset.resourceId ||
											"参考图"
										}
										className="max-h-[78vh] w-full rounded-lg bg-muted object-contain"
									/>
								) : (
									<div className="flex h-72 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
										这项资产暂无可预览的图片文件
									</div>
								)}
							</div>
						</div>,
						document.body,
					)
				: null}
		</section>
	);
};
