import type { MarkdownDocument } from "@/domains/documents/stores";
import type { GenerationTaskRecord } from "@/api/types/generation";
import type {
	WorkspaceDocumentResource,
	WorkspaceStoryboardVideoDocumentGroup,
} from "@/domains/workspace/api/workspace";
import {
	normalizeProjectProductionState,
	projectProductionStages,
	type ProjectProductionState,
} from "@/domains/projects/api/projects";
import {
	productionTemplateById,
	productionTemplateIdFromDocuments,
	type ProductionStageState,
} from "@/lib/production/production-templates";
import {
	resolveProductionStageCapability,
	type ProductionStageCapability,
} from "@/lib/production/production-stage-capability";

export type ProductionStageStatus = "completed" | "current" | "waiting";

export interface ProductionStage {
	id: string;
	order: number;
	label: string;
	capability: ProductionStageCapability;
	description: string;
	purpose: string;
	gate: string;
	status: ProductionStageStatus;
	state: ProductionStageState;
	/** 阶段是否已经有可继续工作的内容，用于空状态和风险提示。 */
	hasContent: boolean;
	/** 用户可以点击进入的阶段。创作流程允许提前查看和规划下游阶段。 */
	canEnter: boolean;
	documentId?: string;
	autoState: ProductionStageState;
	manualState?: ProductionStageState;
	/** 只反映已经有依据的完成度；没有依据时保持 0，不用状态硬凑百分比。 */
	completion: number;
	riskWarning?: string;
}

interface StageGateEvidence {
	complete: boolean;
	gate: string;
}

export interface ProductionPipeline {
	completed: number;
	percent: number;
	/** 旧版本只保存总百分比时保留原值，避免升级后悄悄丢掉历史记录。 */
	legacyPercent?: number;
	stages: ProductionStage[];
	templateDescription: string;
	templateLabel: string;
	total: number;
}

/**
 * 创建模板时会同时生成空白 Stage 文档。空白文档只是工作容器，不能
 * 被当成“用户已经完成了这一阶段”。只有用户填入正文、勾选交付项，
 * 或在运行状态中明确确认后，阶段才会获得真实进度。
 */
const hasMeaningfulDocumentContent = (document: MarkdownDocument) => {
	const content = document.content ?? "";
	if (!content.trim()) return false;
	const isTemplateStage = /<!--\s*production-stage:/i.test(content);
	if (!isTemplateStage) {
		return (
			content
				.replace(/<!--([\s\S]*?)-->/g, "")
				.replace(/^\s*#.*$/gm, "")
				.trim().length > 0
		);
	}
	if (/\[[xX]\]/.test(content)) return true;
	const sections = [...content.matchAll(/^##\s+([^\n]+)\n([\s\S]*?)(?=^##\s+|$)/gm)];
	const workSections = new Set(["输入与已锁定内容", "制作过程", "问题 / Blocker", "下一步行动"]);
	return sections.some((match) => {
		const title = match[1]?.trim();
		if (!title || !workSections.has(title)) return false;
		return Boolean(match[2]?.replace(/\s+/g, " ").trim());
	});
};

interface BuildProductionPipelineInput {
	documents: MarkdownDocument[];
	resources: WorkspaceDocumentResource[];
	storyboardGroups: WorkspaceStoryboardVideoDocumentGroup[];
	selectedImageCount: number;
	production?: ProjectProductionState;
	generationTasks?: GenerationTaskRecord[];
}

export const buildProductionPipeline = ({
	documents,
	resources,
	storyboardGroups,
	selectedImageCount,
	production,
	generationTasks = [],
}: BuildProductionPipelineInput): ProductionPipeline => {
	const meaningfulDocuments = documents.filter(hasMeaningfulDocumentContent);
	const meaningfulCategories = new Set(meaningfulDocuments.map((document) => document.category));
	const resourceTypes = new Set(resources.map((resource) => resource.type));
	const generatedResources = resources.filter(
		(resource) => resource.generatedImageCount > 0,
	).length;
	const assetCoverage = resources.length > 0 ? generatedResources / resources.length : 0;
	const reels = storyboardGroups.flatMap((group) => group.reels);
	const generatedReels = reels.filter(
		(reel) => reel.generatedVideoCount > 0 || reel.videos.length > 0,
	).length;
	const videoCoverage = reels.length > 0 ? generatedReels / reels.length : 0;
	const normalizedProduction = normalizeProjectProductionState(production);
	const qcResults = Object.values(normalizedProduction?.qcResults ?? {});
	const productionShots = normalizedProduction?.shots ?? [];
	const productionGraphNodes = normalizedProduction?.productionGraph?.nodes ?? [];
	const productionVersions = normalizedProduction?.versions ?? [];
	const sharedContext = normalizedProduction?.sharedContext;
	const hasBriefEvidence = Boolean(sharedContext?.projectBrief?.trim());
	const hasStoryOutlineEvidence = Boolean(sharedContext?.storyOutline?.trim());
	const hasLockedScriptEvidence = Boolean(sharedContext?.script?.trim());
	const hasWrittenStoryboardEvidence = Boolean(sharedContext?.shotBreakdown?.trim());
	const assetPlanText = sharedContext?.assetPlan?.trim() ?? "";
	const hasAssetPlanEvidence =
		assetPlanText.length >= 200 &&
		/资产\s*(?:ID|编号)|使用镜头|镜头覆盖/u.test(assetPlanText) &&
		!/reconnecting|request timed out|运行失败|连接失败|falling back from websocket/iu.test(
			assetPlanText,
		);
	const hasAssetReviewEvidence = qcResults.some(
		(result) => result.entityType === "asset" || result.stageId === "stage-5",
	);
	const hasShotExecutionEvidence =
		productionShots.some(
			(shot) => Boolean(shot.firstFrameAssetId || shot.lastFrameAssetId) || shot.completion > 0,
		) || productionVersions.some((version) => version.entityType === "shot");
	const hasMotionEvidence =
		Boolean(sharedContext?.motionPlan?.trim()) ||
		productionShots.some((shot) => Boolean(shot.motionPrompt?.trim()));
	const hasAllShotExecutionEvidence =
		productionShots.length > 0 &&
		productionShots.every((shot) =>
			Boolean(
				shot.firstFrameAssetId &&
				shot.visualLogic?.trim() &&
				shot.cameraLanguage?.trim() &&
				shot.executionPrompt?.trim(),
			),
		);
	const hasAllMotionEvidence =
		productionShots.length > 0 &&
		productionShots.every((shot) => Boolean(shot.motionPrompt?.trim()));
	const hasVideoEvidence =
		generatedReels > 0 || productionGraphNodes.some((node) => node.type === "video");
	const hasFinalEvidence =
		Boolean(sharedContext?.finalReviewNotes?.trim()) ||
		productionGraphNodes.some((node) => node.type === "output") ||
		productionVersions.some((version) => version.entityType === "output");
	const retrospective = normalizedProduction?.retrospective;
	const hasRetrospectiveEvidence = Boolean(
		retrospective &&
		(retrospective.conclusion?.trim() ||
			retrospective.successes.length > 0 ||
			retrospective.failures.length > 0 ||
			retrospective.reusablePrompts.length > 0 ||
			retrospective.reusableRules.length > 0),
	);
	const fallbackTemplate = productionTemplateById(productionTemplateIdFromDocuments(documents));
	const templateStages = normalizedProduction
		? projectProductionStages(normalizedProduction)
		: fallbackTemplate.stages;
	const persistedStageStates = new Map<string, ProductionStageState>();
	const stageDocumentIds = new Map<string, string>();
	for (const document of documents) {
		const metadata = document.content.match(/<!--\s*production-stage:\s*(\{.*?\})\s*-->/);
		if (!metadata?.[1]) continue;
		try {
			const parsed = JSON.parse(metadata[1]) as {
				stageId?: string;
				status?: ProductionStageState;
				documentId?: string;
			};
			if (parsed.stageId && parsed.status) persistedStageStates.set(parsed.stageId, parsed.status);
			if (parsed.stageId) stageDocumentIds.set(parsed.stageId, parsed.documentId ?? document.id);
		} catch {
			// Legacy or manually edited documents continue through the compatibility path below.
		}
	}
	const visualBibleCategories = ["character", "scene", "prop"] as const;
	const hasVisualBible = visualBibleCategories.every(
		(category) => meaningfulCategories.has(category) || resourceTypes.has(category),
	);

	const hasReviewDocument = meaningfulDocuments.some((document) =>
		/(?:^|\s)(?:10|review|复盘|结论)(?:\s|｜|$)/i.test(document.title),
	);
	const hasFinalDocument = meaningfulDocuments.some((document) =>
		/(?:final|成片|发布检查|粗剪|单集)(?:\s|｜|$)/i.test(document.title),
	);
	const hasScriptEvidence =
		meaningfulCategories.has("screenplay") ||
		meaningfulDocuments.some((document) =>
			/(?:脚本|故事|剧情|创意|世界观|内容定位|实验目标)(?:\s|｜|$)/i.test(document.title),
		);
	// “00 项目总控”默认属于 reference 分类，但它只是容器，不能把
	// 快速实验的“参考准备”误判为已完成。这里要求真正的参考文档、
	// 参考资产或已选图片作为证据。
	const hasReferenceEvidence =
		selectedImageCount > 0 ||
		resources.length > 0 ||
		meaningfulDocuments.some(
			(document) =>
				document.category === "reference" &&
				!/^\s*00\s/.test(document.title) &&
				!document.content.includes("<!-- production-template:"),
		);
	const hasStoryboardEvidence =
		meaningfulCategories.has("storyboard") ||
		reels.length > 0 ||
		meaningfulDocuments.some((document) =>
			/(?:分镜|镜头|剧情拆解|故事脚本|关键画面)(?:\s|｜|$)/i.test(document.title),
		);
	const hasAssetEvidence = resources.length > 0 || selectedImageCount > 0 || hasVisualBible;
	const hasGeneratedAssetEvidence = generatedResources > 0 || selectedImageCount > 0;
	const templateId = normalizedProduction?.template.id ?? fallbackTemplate.id;
	const gatesForTemplate = (stage: (typeof templateStages)[number]): StageGateEvidence => {
		const order = stage.order;
		const defaultGate: StageGateEvidence = { complete: false, gate: stage.gate };
		if (templateId === "commercial-film" && (normalizedProduction?.template.version ?? 0) >= 6) {
			if (stage.title === "商业 Brief 与验收标准")
				return {
					complete: hasBriefEvidence && hasReferenceEvidence,
					gate: stage.gate,
				};
			if (stage.title === "创意脚本与传播节拍")
				return {
					complete: hasLockedScriptEvidence && hasWrittenStoryboardEvidence,
					gate: stage.gate,
				};
			if (stage.title === "品牌与产品资产锁定")
				return {
					complete: hasAssetPlanEvidence && hasGeneratedAssetEvidence,
					gate: stage.gate,
				};
			if (stage.title === "场景空间与连续性设计")
				return { complete: hasAssetPlanEvidence && hasVisualBible, gate: stage.gate };
			if (stage.title === "分镜与镜头契约")
				return {
					complete: productionShots.length > 0 && hasAllShotExecutionEvidence,
					gate: stage.gate,
				};
			if (stage.title === "关键帧制作与资产 QC")
				return {
					complete: hasAssetReviewEvidence && hasShotExecutionEvidence,
					gate: stage.gate,
				};
			if (stage.title === "视频生成与迭代账本")
				return { complete: hasVideoEvidence && hasAllMotionEvidence, gate: stage.gate };
			if (stage.title === "选片、连续性与粗剪")
				return {
					complete:
						productionShots.length > 0 &&
						productionShots.every((shot) =>
							productionGraphNodes.some(
								(node) =>
									node.type === "video" &&
									(node.shotId === shot.id ||
										(node.metadata?.shotIds as string[] | undefined)?.includes(shot.id)),
							),
						),
					gate: "每镜视频均已生成，并自动写入粗剪归档队列",
				};
			if (stage.title === "后期、版本与商业交付")
				return { complete: hasFinalEvidence, gate: stage.gate };
			if (stage.title === "效果复盘与品牌知识沉淀")
				return { complete: hasRetrospectiveEvidence, gate: stage.gate };
			return defaultGate;
		}
		if (templateId === "commercial-film" && (normalizedProduction?.template.version ?? 0) >= 4) {
			if (stage.title === "创意与分镜定稿")
				return {
					complete:
						hasBriefEvidence &&
						hasReferenceEvidence &&
						hasLockedScriptEvidence &&
						hasWrittenStoryboardEvidence &&
						productionShots.length > 0,
					gate: stage.gate,
				};
			if (stage.title === "分镜与资产关系")
				return {
					complete: productionShots.length > 0 && hasAssetPlanEvidence,
					gate: stage.gate,
				};
			if (stage.title === "资产制作")
				return { complete: hasGeneratedAssetEvidence, gate: stage.gate };
			if (stage.title === "资产审核") return { complete: hasAssetReviewEvidence, gate: stage.gate };
			if (stage.title === "单镜执行设计")
				return {
					complete: hasAllShotExecutionEvidence && hasAllMotionEvidence,
					gate: "每镜均已关联资产、确认图片逻辑/镜头语言、归档执行图，并锁定视频 Prompt",
				};
			if (stage.title === "视频生成") return { complete: hasVideoEvidence, gate: stage.gate };
			if (stage.title === "视频归档与粗剪")
				return {
					complete:
						productionShots.length > 0 &&
						productionShots.every((shot) =>
							productionGraphNodes.some(
								(node) =>
									node.type === "video" &&
									(node.shotId === shot.id ||
										(node.metadata?.shotIds as string[] | undefined)?.includes(shot.id)),
							),
						),
					gate: "每镜视频均已生成，并自动写入粗剪归档队列",
				};
			if (stage.title === "成片审查") return { complete: hasFinalEvidence, gate: stage.gate };
			if (stage.title === "项目复盘")
				return { complete: hasRetrospectiveEvidence, gate: stage.gate };
			return defaultGate;
		}

		if (templateId === "custom") {
			return {
				complete: meaningfulDocuments.length > 0,
				gate: "总控文档或自定义阶段已记录实际内容",
			};
		}
		if (templateId === "mini-experiment") {
			if (order === 1)
				return { complete: hasScriptEvidence, gate: "实验目标与成功标准已经写入项目记忆" };
			if (order === 2)
				return { complete: hasReferenceEvidence, gate: "参考图、Prompt、模型和参数已经记录" };
			if (order === 3)
				return {
					complete: hasGeneratedAssetEvidence,
					gate: `静帧/素材测试已有结果（${generatedResources} 项）`,
				};
			if (order === 4)
				return {
					complete: generatedReels > 0,
					gate: `动态测试已有结果（${generatedReels}/${Math.max(reels.length, 1)}）`,
				};
			if (order === 5)
				return {
					complete: hasReviewDocument || hasFinalDocument,
					gate: "版本对比、QC、最佳版本和实验结论已经归档",
				};
		}
		if (templateId === "social-content") {
			if (order <= 2)
				return {
					complete: hasScriptEvidence,
					gate: order === 1 ? "平台、受众和内容目标已经明确" : "Hook、核心信息和 CTA 已确认",
				};
			if (order === 3)
				return { complete: hasAssetEvidence, gate: "人物、产品、场景和图文素材已准备" };
			if (order === 4)
				return {
					complete: selectedImageCount > 0 || hasGeneratedAssetEvidence,
					gate: "封面、首屏和核心视觉已有可用版本",
				};
			if (order === 5)
				return { complete: hasStoryboardEvidence, gate: "镜头、图文和素材组合已形成内容版本" };
			if (order === 6)
				return {
					complete: generatedReels > 0 || hasFinalDocument,
					gate: "节奏、运镜、转场和字幕已有可审版本",
				};
			if (order === 7)
				return {
					complete: hasFinalDocument || hasReviewDocument,
					gate: "比例、安全区、封面、Hook、时长、CTA、错字和导出规格已检查",
				};
			if (order === 8)
				return { complete: hasReviewDocument, gate: "版本差异、可复用资产和后续迭代结论已归档" };
		}
		if (templateId === "comic-drama") {
			if (order === 1 || order === 2) return { complete: hasScriptEvidence, gate: stage.gate };
			if (order === 3) return { complete: hasAssetEvidence, gate: stage.gate };
			if (order === 4) return { complete: hasGeneratedAssetEvidence, gate: stage.gate };
			if (order === 5)
				return { complete: hasGeneratedAssetEvidence && hasAssetEvidence, gate: stage.gate };
			if (order === 6) return { complete: hasStoryboardEvidence, gate: stage.gate };
			if (order === 7 || order === 8)
				return { complete: generatedReels > 0 || hasFinalDocument, gate: stage.gate };
			if (order === 9) return { complete: hasFinalDocument, gate: stage.gate };
			if (order === 10) return { complete: hasReviewDocument, gate: stage.gate };
		}
		if (templateId === "short-film") {
			if (order <= 2) return { complete: hasScriptEvidence, gate: stage.gate };
			if (order === 3) return { complete: hasStoryboardEvidence, gate: stage.gate };
			if (order === 4) return { complete: hasAssetEvidence, gate: stage.gate };
			if (order === 5) return { complete: hasGeneratedAssetEvidence, gate: stage.gate };
			if (order === 6)
				return { complete: selectedImageCount > 0 || hasStoryboardEvidence, gate: stage.gate };
			if (order === 7 || order === 8)
				return { complete: generatedReels > 0 || hasFinalDocument, gate: stage.gate };
			if (order === 9) return { complete: hasFinalDocument, gate: stage.gate };
			if (order === 10) return { complete: hasReviewDocument, gate: stage.gate };
		}
		// Commercial advertising remains the complete master workflow. Each gate
		// only reads evidence produced by that stage; having image assets must not
		// make motion, video, Final and retrospective look started or completed.
		if (order === 1)
			return { complete: hasBriefEvidence && hasScriptEvidence, gate: "Brief 与脚本已确认" };
		if (order === 2)
			return {
				complete: productionShots.length > 0 || hasStoryboardEvidence,
				gate:
					productionShots.length > 0
						? `已建立 ${productionShots.length} 张镜头卡`
						: "存在已确认的分镜拆解",
			};
		if (order === 3)
			return {
				complete: hasAssetPlanEvidence && hasVisualBible,
				gate: "角色、场景、道具与镜头用途齐备",
			};
		if (order === 4)
			return {
				complete: resources.length > 0 && generatedResources === resources.length,
				gate: `生成覆盖 ${generatedResources}/${resources.length}`,
			};
		if (order === 5)
			return {
				complete: hasAssetReviewEvidence && assetCoverage >= 0.8,
				gate: "资产 QC 已完成，且生成覆盖至少 80%",
			};
		if (order === 6)
			return { complete: hasShotExecutionEvidence, gate: "镜头已有单镜执行图、首帧或尾帧" };
		if (order === 7)
			return { complete: hasMotionEvidence, gate: "镜头已记录动作、运镜和动态 Prompt" };
		if (order === 8)
			return { complete: hasVideoEvidence && videoCoverage >= 0.8, gate: "视频版本覆盖至少 80%" };
		if (order === 9) return { complete: hasFinalEvidence, gate: "Final 审查记录或交付输出已归档" };
		if (order === 10)
			return {
				complete: hasRetrospectiveEvidence || hasReviewDocument,
				gate: "复盘、失败原因和可复用结论已归档",
			};
		return defaultGate;
	};

	const hasPersistedStageState = Boolean(normalizedProduction) || persistedStageStates.size > 0;
	const ignoreLegacyStageDocuments =
		templateId === "commercial-film" &&
		(normalizedProduction?.template.version ?? 0) >= 4 &&
		Object.values(normalizedProduction?.stageStates ?? {}).some((state) =>
			state.documentId.includes("commercial-film-v4-stage"),
		);
	const legacyExplicitStates: ProductionStageState[] = templateStages.map(
		(stage) =>
			(!normalizedProduction
				? (("status" in stage ? stage.status : undefined) as ProductionStageState | undefined)
				: undefined) ??
			(ignoreLegacyStageDocuments ? undefined : persistedStageStates.get(stage.id)) ??
			"NOT_STARTED",
	);
	const stages = templateStages.map<ProductionStage>((stage, index) => {
		const gateEvidence = gatesForTemplate(stage);
		const capability = resolveProductionStageCapability(templateId, stage.title);
		const runtime = normalizedProduction?.stageStates?.[stage.id];
		const matchingDocument = documents.find(
			(document) =>
				document.id === stageDocumentIds.get(stage.id) ||
				new RegExp(`(?:^|\\s)0?${stage.order}(?:\\s|[|｜]|$)`, "i").test(document.title),
		);
		const documentId =
			runtime?.documentId || stageDocumentIds.get(stage.id) || matchingDocument?.id;
		const stageTasks = generationTasks.filter((task) => {
			if (!task.documentId || !documentId) return false;
			return task.documentId === documentId;
		});
		const hasActiveTask = stageTasks.some((task) => {
			const status = task.status.toLowerCase();
			return (
				status === "pending" ||
				status === "queued" ||
				status === "running" ||
				status === "processing"
			);
		});
		const hasFailedTask = stageTasks.some((task) => {
			const status = task.status.toLowerCase();
			return status === "failed" || status === "error" || status === "cancelled";
		});
		const stageQcResults = qcResults.filter((result) => result.stageId === stage.id);
		const hasQcBlocker = stageQcResults.some((result) => result.status === "BLOCKED");
		const hasQcIssue = stageQcResults.some(
			(result) => result.status === "NEEDS_FIX" || result.status === "MISSING",
		);
		const hasBlocker = Boolean(runtime?.blocker?.trim());
		const stageDocument = documentId
			? documents.find((document) => document.id === documentId)
			: undefined;
		const stageTitle = stage.title;
		const stageSpecificEvidence =
			(/创意与分镜|参考与需求/i.test(stageTitle) &&
				(hasBriefEvidence || hasReferenceEvidence || hasLockedScriptEvidence)) ||
			(/故事推导/i.test(stageTitle) && hasStoryOutlineEvidence) ||
			(/剧情脚本/i.test(stageTitle) && hasLockedScriptEvidence) ||
			(/文字分镜/i.test(stageTitle) && hasWrittenStoryboardEvidence) ||
			(/分镜图/i.test(stageTitle) && productionShots.length > 0) ||
			(/序章|世界观|创意设定|实验目标|内容定位/i.test(stageTitle) &&
				(hasBriefEvidence || hasScriptEvidence)) ||
			(/拆解制作|剧情拆解|故事脚本|镜头拆解|分镜制作/i.test(stageTitle) &&
				(hasStoryboardEvidence || productionShots.length > 0)) ||
			(/资产拆解|资产准备|参考准备/i.test(stageTitle) && hasAssetPlanEvidence) ||
			(/资产制作|图片生成|资产生成|生成测试|关键画面/i.test(stageTitle) &&
				hasGeneratedAssetEvidence) ||
			(/资产审核|发布检查/i.test(stageTitle) && hasAssetReviewEvidence) ||
			(/镜头画面|单镜制作|内容制作/i.test(stageTitle) && hasShotExecutionEvidence) ||
			(/动态制作|动态剪辑|动态测试/i.test(stageTitle) && hasMotionEvidence) ||
			(/视频管理|粗剪审核|单集粗剪/i.test(stageTitle) && hasVideoEvidence) ||
			(/Final制作/i.test(stageTitle) && hasFinalEvidence) ||
			(/项目复盘|连载复盘|版本复盘|实验结论/i.test(stageTitle) && hasRetrospectiveEvidence);
		const hasContent = Boolean(
			(stageDocument && hasMeaningfulDocumentContent(stageDocument)) ||
			stageTasks.length > 0 ||
			stageSpecificEvidence,
		);
		const inferredAutoState: ProductionStageState =
			hasBlocker || hasQcBlocker
				? "BLOCKED"
				: hasFailedTask
					? "NEEDS_FIX"
					: hasQcIssue
						? "NEEDS_FIX"
						: hasActiveTask
							? "IN_PROGRESS"
							: gateEvidence.complete
								? "PASS"
								: hasContent
									? "IN_PROGRESS"
									: "NOT_STARTED";
		// 进行中等运行状态可以延续，但自动 PASS 必须有当前 Gate 证据支撑；
		// 否则一次失败或被删除的产物会让阶段永久显示“已通过”。
		const persistedAutoState = runtime?.autoStatus;
		const autoState = hasBlocker
			? "BLOCKED"
			: persistedAutoState === "PASS" && !gateEvidence.complete
				? inferredAutoState
				: (persistedAutoState ?? inferredAutoState);
		const explicitManualStatus =
			runtime?.manualStatus && runtime.manualStatus.trim() ? runtime.manualStatus : undefined;
		const legacyStatus =
			explicitManualStatus ??
			// An empty manualStatus is an explicit "跟随自动判断" marker. Do not
			// fall back to the old status field in that case, otherwise the legacy
			// compatibility field would silently re-enable a manual override.
			(runtime?.manualStatus === ""
				? undefined
				: runtime?.status && runtime.status !== "NOT_STARTED"
					? runtime.status
					: undefined) ??
			(hasPersistedStageState && legacyExplicitStates[index] !== "NOT_STARTED"
				? legacyExplicitStates[index]
				: undefined);
		const effectiveState = legacyStatus ?? autoState;
		// 内容证据用于提示缺口，不用于锁死阶段。创作项目需要提前规划、
		// 预览下游要求，所有阶段都可进入；上游未通过时通过 riskWarning 提醒返工风险。
		const canEnter = true;
		const previousRuntime =
			index > 0 ? normalizedProduction?.stageStates?.[templateStages[index - 1]?.id] : undefined;
		const previousExplicitManualStatus = previousRuntime?.manualStatus?.trim()
			? previousRuntime.manualStatus
			: undefined;
		const previousState =
			index > 0
				? (previousExplicitManualStatus ??
					(previousRuntime?.manualStatus === ""
						? undefined
						: previousRuntime?.status && previousRuntime.status !== "NOT_STARTED"
							? previousRuntime.status
							: undefined) ??
					(gatesForTemplate(templateStages[index - 1]!).complete ? "PASS" : "NOT_STARTED"))
				: undefined;
		const completion =
			effectiveState === "PASS"
				? 100
				: Math.max(0, Math.min(100, Math.round(runtime?.completion ?? 0)));
		return {
			id: stage.id,
			order: stage.order,
			label: stage.title,
			capability,
			description: stage.subtitle,
			purpose: stage.purpose,
			gate: stage.gate || gateEvidence.gate || "等待上游阶段通过",
			state: effectiveState,
			autoState,
			manualState: legacyStatus,
			completion,
			hasContent,
			canEnter,
			documentId,
			status: effectiveState === "PASS" ? "completed" : "waiting",
			riskWarning: hasBlocker
				? `当前阶段被阻塞：${runtime?.blocker}`
				: hasFailedTask
					? `当前阶段有 ${stageTasks.filter((task) => ["failed", "error", "cancelled"].includes(task.status.toLowerCase())).length} 个生成任务失败，请先处理失败原因。`
					: hasQcBlocker
						? "当前阶段存在被阻塞的 QC 记录，请先处理阻塞原因。"
						: hasQcIssue
							? "当前阶段存在未通过或缺失的 QC 记录，请先修复后再交付。"
							: index > 0 && previousState !== "PASS"
								? `上一阶段“${templateStages[index - 1]?.title}”尚未通过，继续制作可能导致返工。`
								: undefined,
		};
	});
	const firstIncomplete = stages.findIndex((stage) => stage.state !== "PASS");
	if (firstIncomplete >= 0 && stages[firstIncomplete]) stages[firstIncomplete].status = "current";
	const completed = stages.filter((stage) => stage.status === "completed").length;

	const completionTotal = stages.reduce((total, stage) => total + stage.completion, 0);
	const percent = stages.length > 0 ? Math.round(completionTotal / stages.length) : 0;
	const storedOverallProgress = Math.max(
		0,
		Math.min(100, Math.round(normalizedProduction?.overallProgress ?? 0)),
	);
	return {
		completed,
		percent,
		legacyPercent: storedOverallProgress > percent ? storedOverallProgress : undefined,
		stages,
		templateDescription: normalizedProduction?.template.description ?? fallbackTemplate.description,
		templateLabel: normalizedProduction?.template.name ?? fallbackTemplate.label,
		total: stages.length,
	};
};
