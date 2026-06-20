import type {
	GenerationKind,
	GenerationParam,
	GenerationParamCombo,
	GenerationRoute,
	GenerationRouteParamGroup,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import {
	defaultMiniMaxVoiceId,
	minimaxSystemVoiceOptions,
} from "@/domains/generation/hooks/minimaxSystemVoiceOptions";

const paramGroupByName: Record<string, NonNullable<GenerationParam["group"]>> = {
	aspectRatio: "size",
	ratio: "size",
	resolution: "size",
	resolutionType: "size",
	imageSize: "size",
	duration: "duration",
	n: "count",
	quality: "other",
	outputFormat: "other",
	outputCompression: "other",
	moderation: "other",
	background: "other",
	watermark: "other",
	negativePrompt: "other",
	seed: "other",
	returnLastFrame: "other",
	executionExpiresAfter: "other",
	maxTokens: "other",
	generateAudio: "other",
	temperature: "other",
	voiceId: "voice",
};

const paramGroupSpecsByKind: Record<GenerationKind, Array<{ id: string; label: string }>> = {
	image: [
		{ id: "size", label: "大小" },
		{ id: "count", label: "数量" },
		{ id: "other", label: "其他" },
	],
	video: [
		{ id: "size", label: "大小" },
		{ id: "duration", label: "秒数" },
		{ id: "other", label: "其他" },
	],
	text: [{ id: "other", label: "其他" }],
	audio: [
		{ id: "voice", label: "音色" },
		{ id: "audio", label: "音频" },
		{ id: "other", label: "其他" },
	],
};

const withParamGroup = (param: GenerationParam): GenerationParam => {
	const group = param.group ?? paramGroupByName[param.name] ?? "other";
	return {
		...param,
		group,
		menu: group === "other" ? "secondary" : "primary",
	};
};

const fallbackParamGroups = (
	kind: GenerationKind,
	params: GenerationParam[],
): GenerationRouteParamGroup[] => {
	const paramsByGroup = new Map<string, string[]>();
	for (const param of params) {
		const group = param.group ?? paramGroupByName[param.name] ?? "other";
		paramsByGroup.set(group, [...(paramsByGroup.get(group) ?? []), param.name]);
	}

	const groupSpecs = paramGroupSpecsByKind[kind] ?? paramGroupSpecsByKind.image;
	const extraGroups = Array.from(paramsByGroup.keys()).filter(
		(group) => !groupSpecs.some((groupSpec) => groupSpec.id === group),
	);
	return [...groupSpecs, ...extraGroups.map((group) => ({ id: group, label: "其他" }))].flatMap(
		(group) => {
			const groupParams = paramsByGroup.get(group.id) ?? [];
			if (groupParams.length === 0) return [];

			return [{ ...group, params: groupParams }];
		},
	);
};

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
	paramCombos?: GenerationParamCombo[],
): GenerationRoute {
	const groupedParams = params.map(withParamGroup);
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
		params: groupedParams,
		paramGroups: fallbackParamGroups(kind, groupedParams),
		paramCombos,
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
	paramCombos?: GenerationParamCombo[],
): GenerationRoute {
	const groupedParams = params.map(withParamGroup);
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
		params: groupedParams,
		paramGroups: fallbackParamGroups(kind, groupedParams),
		paramCombos,
	};
}

function selectParam(
	name: string,
	label: string,
	defaultValue: string,
	options: { label: string; value: string }[],
): GenerationParam {
	return withParamGroup({
		name,
		label,
		type: "select",
		default: defaultValue,
		options,
	});
}

function numberParam(
	name: string,
	label: string,
	defaultValue: number,
	min: number,
	max: number,
): GenerationParam {
	return withParamGroup({
		name,
		label,
		type: "number",
		default: defaultValue,
		min,
		max,
	});
}

function optionalNumberParam(
	name: string,
	label: string,
	min: number,
	max: number,
): GenerationParam {
	return withParamGroup({
		name,
		label,
		type: "number",
		min,
		max,
	});
}

function boolParam(name: string, label: string, defaultValue: boolean): GenerationParam {
	return withParamGroup({
		name,
		label,
		type: "boolean",
		default: defaultValue,
	});
}

function textParam(name: string, label: string, defaultValue: string): GenerationParam {
	return withParamGroup({
		name,
		label,
		type: "text",
		default: defaultValue,
	});
}

export function seedreamParams(): GenerationParam[] {
	return [
		selectParam("aspectRatio", "画幅比例", "adaptive", [
			{ label: "自适应", value: "adaptive" },
			{ label: "1:1", value: "1:1" },
			{ label: "16:9", value: "16:9" },
			{ label: "9:16", value: "9:16" },
		]),
		selectParam("resolution", "分辨率", "2K", [
			{ label: "2K", value: "2K" },
			{ label: "3K", value: "3K" },
		]),
		selectParam("outputFormat", "输出格式", "png", [
			{ label: "PNG", value: "png" },
			{ label: "JPEG", value: "jpeg" },
		]),
		boolParam("watermark", "水印", false),
		numberParam("n", "图像数量", 1, 1, 4),
	];
}

export function seedreamParamCombos(): GenerationParamCombo[] {
	return [
		{
			params: ["aspectRatio", "resolution"],
			allowed: [
				["adaptive", "2K"],
				["adaptive", "3K"],
				["1:1", "2K"],
				["1:1", "3K"],
				["16:9", "2K"],
				["16:9", "3K"],
				["9:16", "2K"],
				["9:16", "3K"],
			],
		},
	];
}

export function jimengSeedreamParams(): GenerationParam[] {
	return [
		selectParam("aspectRatio", "画幅比例", "1:1", [
			{ label: "1:1", value: "1:1" },
			{ label: "16:9", value: "16:9" },
			{ label: "9:16", value: "9:16" },
			{ label: "4:3", value: "4:3" },
			{ label: "3:4", value: "3:4" },
			{ label: "21:9", value: "21:9" },
		]),
		selectParam("resolution", "分辨率", "2K", [
			{ label: "2K", value: "2K" },
			{ label: "4K", value: "4K" },
		]),
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
		selectParam("aspectRatio", "画幅比例", "1:1", [
			{ label: "自适应", value: "adaptive" },
			{ label: "1:1", value: "1:1" },
			{ label: "3:2", value: "3:2" },
			{ label: "2:3", value: "2:3" },
			{ label: "16:9", value: "16:9" },
			{ label: "9:16", value: "9:16" },
		]),
		selectParam("resolution", "分辨率", "1K", [
			{ label: "1K", value: "1K" },
			{ label: "2K", value: "2K" },
			{ label: "4K", value: "4K" },
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

export function gptImageParamCombos(): GenerationParamCombo[] {
	return [
		{
			params: ["aspectRatio", "resolution"],
			allowed: [
				["adaptive", "1K"],
				["1:1", "1K"],
				["1:1", "2K"],
				["3:2", "1K"],
				["2:3", "1K"],
				["16:9", "2K"],
				["16:9", "4K"],
				["9:16", "4K"],
			],
		},
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
		selectParam("resolution", "分辨率", "1K", [
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
		selectParam("resolution", "分辨率", "1K", [
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
	return jimengSeedanceParamSet(false);
}

export function jimengSeedanceVIPParams(): GenerationParam[] {
	return jimengSeedanceParamSet(true);
}

function jimengSeedanceParamSet(allow1080p: boolean): GenerationParam[] {
	return [
		selectParam("aspectRatio", "比例", "16:9", [
			{ label: "16:9", value: "16:9" },
			{ label: "4:3", value: "4:3" },
			{ label: "1:1", value: "1:1" },
			{ label: "3:4", value: "3:4" },
			{ label: "9:16", value: "9:16" },
			{ label: "21:9", value: "21:9" },
		]),
		selectParam(
			"resolution",
			"分辨率",
			"720p",
			allow1080p
				? [
						{ label: "720p", value: "720p" },
						{ label: "1080p", value: "1080p" },
					]
				: [{ label: "720p", value: "720p" }],
		),
		selectParam("duration", "时长", "5", jimengSeedanceDurationOptions()),
	];
}

function seedanceParams(): GenerationParam[] {
	return [
		selectParam("aspectRatio", "比例", "16:9", [
			{ label: "16:9", value: "16:9" },
			{ label: "4:3", value: "4:3" },
			{ label: "1:1", value: "1:1" },
			{ label: "3:4", value: "3:4" },
			{ label: "9:16", value: "9:16" },
			{ label: "21:9", value: "21:9" },
			{ label: "自适应", value: "adaptive" },
		]),
		selectParam("resolution", "分辨率", "480p", [
			{ label: "480p", value: "480p" },
			{ label: "720p", value: "720p" },
		]),
		selectParam("duration", "时长", "4", seedanceDurationOptions()),
		boolParam("generateAudio", "生成音频", false),
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
		selectParam("resolution", "分辨率", "480p", [
			{ label: "480p", value: "480p" },
			{ label: "720p", value: "720p" },
			{ label: "1080p", value: "1080p" },
		]),
		selectParam("duration", "时长", "3", openRouterDurationOptions()),
		textParam("negativePrompt", "负向提示词", ""),
		boolParam("generateAudio", "生成音频", false),
	];
}

function openRouterDurationOptions() {
	return Array.from({ length: 13 }, (_, index) => {
		const seconds = String(index + 3);
		return { label: `${seconds} 秒`, value: seconds };
	});
}

export function textParams(): GenerationParam[] {
	return [
		numberParam("temperature", "温度", 0.7, 0, 2),
		optionalNumberParam("maxTokens", "最大令牌数", 1, 32768),
	];
}

export function minimaxSpeechParams(): GenerationParam[] {
	return [
		selectParam("voiceId", "音色", defaultMiniMaxVoiceId, minimaxSystemVoiceOptions),
		numberParam("speed", "语速", 1, 0.5, 2),
		numberParam("volume", "音量", 1, 0, 10),
		numberParam("pitch", "音调", 0, -12, 12),
		withParamGroup({
			name: "outputFormat",
			label: "输出格式",
			type: "select",
			default: "mp3",
			group: "audio",
			options: [
				{ label: "MP3", value: "mp3" },
				{ label: "WAV", value: "wav" },
				{ label: "FLAC", value: "flac" },
			],
		}),
		numberParam("sampleRate", "采样率", 32000, 8000, 44100),
		numberParam("bitrate", "码率", 128000, 32000, 256000),
	];
}
