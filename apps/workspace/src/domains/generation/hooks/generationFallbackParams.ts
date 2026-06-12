import type {
	GenerationKind,
	GenerationParam,
	GenerationRoute,
	GenerationVersion,
} from "@/domains/generation/api/generation";

export function version(
	id: string,
	familyId: string,
	label: string,
	kind: GenerationKind,
	canonicalModel: string,
	async: boolean,
	supportsReferenceUrls: boolean,
): GenerationVersion {
	return {
		id,
		familyId,
		label,
		kind,
		canonicalModel,
		capabilities: {
			async,
			supportsReferenceUrls,
		},
	};
}

export function route(
	id: string,
	familyId: string,
	versionId: string,
	label: string,
	kind: GenerationKind,
	provider: string,
	model: string,
	adapter: string,
	docUrl: string,
	params: GenerationParam[],
	async: boolean,
	supportsReferenceUrls: boolean,
	legacyModelId?: string,
): GenerationRoute {
	return {
		id,
		familyId,
		versionId,
		label,
		kind,
		provider,
		model,
		adapter,
		docUrl,
		async,
		supportsReferenceUrls,
		status: "available",
		params,
		legacyModelId,
	};
}

export function plannedRoute(
	id: string,
	familyId: string,
	versionId: string,
	label: string,
	kind: GenerationKind,
	provider: string,
	model: string,
	docUrl: string,
	params: GenerationParam[],
): GenerationRoute {
	return {
		id,
		familyId,
		versionId,
		label,
		kind,
		provider,
		model,
		adapter: "official.planned",
		docUrl,
		async: kind === "video",
		supportsReferenceUrls: false,
		status: "planned",
		statusReason: "此官方供应商已收录，但当前构建尚未实现。",
		params,
	};
}

function selectParam(
	name: string,
	label: string,
	defaultValue: string,
	options: { label: string; value: string }[],
): GenerationParam {
	return {
		name,
		label,
		type: "select",
		default: defaultValue,
		options,
	};
}

function numberParam(
	name: string,
	label: string,
	defaultValue: number,
	min: number,
	max: number,
): GenerationParam {
	return {
		name,
		label,
		type: "number",
		default: defaultValue,
		min,
		max,
	};
}

function optionalNumberParam(
	name: string,
	label: string,
	min: number,
	max: number,
): GenerationParam {
	return {
		name,
		label,
		type: "number",
		min,
		max,
	};
}

function boolParam(name: string, label: string, defaultValue: boolean): GenerationParam {
	return {
		name,
		label,
		type: "boolean",
		default: defaultValue,
	};
}

function textParam(name: string, label: string, defaultValue: string): GenerationParam {
	return {
		name,
		label,
		type: "text",
		default: defaultValue,
	};
}

export function seedreamParams(): GenerationParam[] {
	return [
		selectParam("size", "尺寸", "2K", [
			{ label: "2K", value: "2K" },
			{ label: "3K", value: "3K" },
			{ label: "2048x2048", value: "2048x2048" },
			{ label: "16:9 2K", value: "2848x1600" },
			{ label: "9:16 2K", value: "1600x2848" },
		]),
		selectParam("outputFormat", "输出格式", "png", [
			{ label: "PNG", value: "png" },
			{ label: "JPEG", value: "jpeg" },
		]),
		boolParam("watermark", "水印", false),
		numberParam("n", "图像数量", 1, 1, 4),
	];
}

export function jimengSeedreamParams(): GenerationParam[] {
	return [
		selectParam("ratio", "画幅比例", "1:1", [
			{ label: "1:1", value: "1:1" },
			{ label: "16:9", value: "16:9" },
			{ label: "9:16", value: "9:16" },
			{ label: "4:3", value: "4:3" },
			{ label: "3:4", value: "3:4" },
			{ label: "21:9", value: "21:9" },
		]),
		selectParam("resolutionType", "分辨率", "2k", [
			{ label: "2K", value: "2k" },
			{ label: "4K", value: "4k" },
		]),
		numberParam("poll", "等待秒数", 30, 30, 600),
	];
}

export function officialGPTImageParams(): GenerationParam[] {
	return [
		...gptImageParams(),
		selectParam("background", "背景", "auto", [
			{ label: "自动", value: "auto" },
			{ label: "不透明", value: "opaque" },
		]),
	];
}

export function dmxGPTImageParams(): GenerationParam[] {
	return gptImageParams();
}

function gptImageParams(): GenerationParam[] {
	return [
		selectParam("size", "尺寸", "1024x1024", [
			{ label: "自动", value: "auto" },
			{ label: "1024x1024", value: "1024x1024" },
			{ label: "1536x1024", value: "1536x1024" },
			{ label: "1024x1536", value: "1024x1536" },
			{ label: "2048x2048", value: "2048x2048" },
			{ label: "2048x1152", value: "2048x1152" },
			{ label: "3840x2160", value: "3840x2160" },
			{ label: "2160x3840", value: "2160x3840" },
		]),
		selectParam("quality", "质量", "low", [
			{ label: "自动", value: "auto" },
			{ label: "高", value: "high" },
			{ label: "中", value: "medium" },
			{ label: "低", value: "low" },
		]),
		selectParam("outputFormat", "输出格式", "jpeg", [
			{ label: "PNG", value: "png" },
			{ label: "JPEG", value: "jpeg" },
			{ label: "WEBP", value: "webp" },
		]),
		selectParam("moderation", "内容审核", "auto", [
			{ label: "自动", value: "auto" },
			{ label: "低", value: "low" },
		]),
		numberParam("outputCompression", "输出压缩", 100, 0, 100),
		numberParam("n", "图像数量", 1, 1, 10),
	];
}

export function nanoParams(): GenerationParam[] {
	return [
		selectParam("aspectRatio", "画幅比例", "1:1", [
			{ label: "1:1", value: "1:1" },
			{ label: "1:4", value: "1:4" },
			{ label: "1:8", value: "1:8" },
			{ label: "2:3", value: "2:3" },
			{ label: "3:2", value: "3:2" },
			{ label: "3:4", value: "3:4" },
			{ label: "4:1", value: "4:1" },
			{ label: "4:3", value: "4:3" },
			{ label: "4:5", value: "4:5" },
			{ label: "5:4", value: "5:4" },
			{ label: "8:1", value: "8:1" },
			{ label: "16:9", value: "16:9" },
			{ label: "9:16", value: "9:16" },
			{ label: "21:9", value: "21:9" },
		]),
		selectParam("imageSize", "图像尺寸", "1K", [
			{ label: "1K", value: "1K" },
			{ label: "2K", value: "2K" },
			{ label: "4K", value: "4K" },
		]),
		numberParam("n", "图像数量", 1, 1, 4),
	];
}

export function openRouterImageParams(): GenerationParam[] {
	return [
		selectParam("aspectRatio", "画幅比例", "1:1", [
			{ label: "1:1", value: "1:1" },
			{ label: "2:3", value: "2:3" },
			{ label: "3:2", value: "3:2" },
			{ label: "3:4", value: "3:4" },
			{ label: "4:3", value: "4:3" },
			{ label: "4:5", value: "4:5" },
			{ label: "5:4", value: "5:4" },
			{ label: "9:16", value: "9:16" },
			{ label: "16:9", value: "16:9" },
			{ label: "21:9", value: "21:9" },
		]),
		selectParam("imageSize", "图像尺寸", "1K", [
			{ label: "1K", value: "1K" },
			{ label: "2K", value: "2K" },
			{ label: "4K", value: "4K" },
		]),
	];
}

export function dmxSeedanceParams(): GenerationParam[] {
	return seedanceParams();
}

export function jimengSeedanceParams(): GenerationParam[] {
	return [
		selectParam("ratio", "比例", "16:9", [
			{ label: "16:9", value: "16:9" },
			{ label: "4:3", value: "4:3" },
			{ label: "1:1", value: "1:1" },
			{ label: "3:4", value: "3:4" },
			{ label: "9:16", value: "9:16" },
			{ label: "21:9", value: "21:9" },
		]),
		selectParam("videoResolution", "分辨率", "720p", [
			{ label: "720p", value: "720p" },
			{ label: "1080p", value: "1080p" },
		]),
		selectParam("duration", "时长", "5", jimengSeedanceDurationOptions()),
		selectParam("modelVersion", "模型通道", "seedance2.0fast", [
			{ label: "Seedance 2.0 Fast", value: "seedance2.0fast" },
			{ label: "Seedance 2.0", value: "seedance2.0" },
			{ label: "Seedance 2.0 Fast VIP", value: "seedance2.0fast_vip" },
			{ label: "Seedance 2.0 VIP", value: "seedance2.0_vip" },
		]),
		numberParam("poll", "等待秒数", 0, 0, 600),
	];
}

function seedanceParams(): GenerationParam[] {
	return [
		selectParam("ratio", "比例", "16:9", [
			{ label: "16:9", value: "16:9" },
			{ label: "4:3", value: "4:3" },
			{ label: "1:1", value: "1:1" },
			{ label: "3:4", value: "3:4" },
			{ label: "9:16", value: "9:16" },
			{ label: "21:9", value: "21:9" },
			{ label: "自适应", value: "adaptive" },
		]),
		selectParam("resolution", "分辨率", "720p", [
			{ label: "480p", value: "480p" },
			{ label: "720p", value: "720p" },
		]),
		selectParam("duration", "时长", "5", seedanceDurationOptions()),
		boolParam("generateAudio", "生成音频", true),
		optionalNumberParam("seed", "种子", -1, 2147483647),
		boolParam("watermark", "水印", false),
		boolParam("returnLastFrame", "返回最后一帧", false),
		optionalNumberParam("executionExpiresAfter", "任务超时", 3600, 259200),
	];
}

function jimengSeedanceDurationOptions() {
	return Array.from({ length: 12 }, (_, index) => {
		const seconds = String(index + 4);
		return { label: `${seconds} 秒`, value: seconds };
	});
}

function seedanceDurationOptions() {
	return [
		{ label: "自动", value: "-1" },
		...Array.from({ length: 12 }, (_, index) => {
			const seconds = String(index + 4);
			return { label: `${seconds} 秒`, value: seconds };
		}),
	];
}

export function openRouterVideoParams(): GenerationParam[] {
	return [
		selectParam("aspectRatio", "画幅比例", "16:9", [
			{ label: "16:9", value: "16:9" },
			{ label: "9:16", value: "9:16" },
			{ label: "1:1", value: "1:1" },
			{ label: "4:3", value: "4:3" },
			{ label: "3:4", value: "3:4" },
			{ label: "21:9", value: "21:9" },
		]),
		selectParam("resolution", "分辨率", "720p", [
			{ label: "480p", value: "480p" },
			{ label: "720p", value: "720p" },
			{ label: "1080p", value: "1080p" },
		]),
		numberParam("duration", "时长", 5, 3, 15),
		textParam("negativePrompt", "负向提示词", ""),
		boolParam("generateAudio", "生成音频", true),
	];
}

export function textParams(): GenerationParam[] {
	return [
		numberParam("temperature", "温度", 0.7, 0, 2),
		optionalNumberParam("maxTokens", "最大令牌数", 1, 32768),
	];
}
