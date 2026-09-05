export type ReferenceEvidenceDimension =
	| "action"
	| "environment"
	| "props"
	| "composition"
	| "lighting"
	| "material"
	| "atmosphere";

export interface ReferenceEvidenceItem {
	dimension: ReferenceEvidenceDimension;
	observation: string;
	confidence: "high" | "medium" | "low";
	unknowns: string;
}

export interface ReferenceTransferInput {
	targetCharacter: string;
	targetEnvironment: string;
	targetProps: string;
	targetProduct: string;
	evidence: ReferenceEvidenceItem[];
	rendering: string;
	style: string;
	doNotCopy: string;
}

export interface ReferenceTransferPrompts {
	image: string;
	action: string;
	setDesign: string;
	lighting: string;
	imageToVideo: string;
}

const labels: Record<ReferenceEvidenceDimension, string> = {
	action: "动作",
	environment: "环境",
	props: "道具",
	composition: "构图",
	lighting: "灯光",
	material: "材质",
	atmosphere: "氛围",
};

export const buildReferenceTransferPrompts = (
	input: ReferenceTransferInput,
): ReferenceTransferPrompts => {
	const confirmedEvidence = input.evidence
		.filter((item) => item.observation.trim() && item.confidence !== "low")
		.map((item) => `${labels[item.dimension]}：${item.observation.trim()}`)
		.join("；");
	const targets = [
		input.targetCharacter && `目标角色：${input.targetCharacter}`,
		input.targetEnvironment && `目标环境：${input.targetEnvironment}`,
		input.targetProps && `目标道具：${input.targetProps}`,
		input.targetProduct && `目标产品：${input.targetProduct}`,
	]
		.filter(Boolean)
		.join("；");
	const visual = [
		input.rendering && `渲染效果：${input.rendering}`,
		input.style && `视觉风格：${input.style}`,
	]
		.filter(Boolean)
		.join("；");
	const guardrail = `仅迁移已确认的视觉关系，不复制参考图中的人物身份、品牌标识、文字、独特设计或受保护作品。禁止照搬：${input.doNotCopy || "参考图主体身份与独特设计"}`;
	const base = [targets, confirmedEvidence, visual, guardrail].filter(Boolean).join("。\n");

	return {
		image: `${base}\n生成静帧：保持目标角色和产品身份锁定，按上述构图、材质与氛围重新设计画面；空间关系清晰、动作可执行、资产不漂移。`,
		action: `${base}\n动作设计：将参考动作的重心、肢体方向、节奏和交互关系迁移到目标角色；结合目标服装、道具尺度和空间限制，给出起势、关键姿态、收势。`,
		setDesign: `${base}\n布景设计：只迁移环境的层次、动线、空间比例和道具功能关系；全部替换为目标项目场景与资产，标明前景、中景、后景和可运动区域。`,
		lighting: `${base}\n灯光设计：输出主光方向与高度、光质、光比、色温关系、轮廓光、环境反射和曝光优先级；不得借灯光改变目标角色肤色、服装或产品材质身份。`,
		imageToVideo: `${base}\n图生视频：主体身份与产品结构全程锁定。描述起始状态、主体动作、道具反馈、环境运动、镜头运动、速度曲线和结束状态；避免形变、穿插、凭空增删资产、空间跳变和运动方向反转。`,
	};
};

export const referenceEvidenceDimensions: Array<{
	id: ReferenceEvidenceDimension;
	label: string;
	question: string;
}> = [
	{ id: "action", label: "动作", question: "可见姿态、重心、朝向和接触关系是什么？" },
	{ id: "environment", label: "环境", question: "可见空间层次、尺度、动线和背景元素是什么？" },
	{ id: "props", label: "道具", question: "可见物件、位置、尺度和使用关系是什么？" },
	{ id: "composition", label: "构图", question: "景别、机位、主体位置、视线和留白是什么？" },
	{ id: "lighting", label: "灯光", question: "光源方向、软硬、光比、色温和阴影证据是什么？" },
	{ id: "material", label: "材质", question: "表面粗糙度、反射、透光和纹理表现是什么？" },
	{ id: "atmosphere", label: "氛围", question: "由色彩、空气感、密度和节奏形成的情绪是什么？" },
];
