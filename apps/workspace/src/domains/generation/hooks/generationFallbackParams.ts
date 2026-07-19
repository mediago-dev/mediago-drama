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

type GenerationRouteOption = (route: GenerationRoute) => GenerationRoute;

export function withReferenceUrlLimit(maxReferenceUrls: number): GenerationRouteOption {
	return (route) => {
		if (maxReferenceUrls <= 0) return route;

		return {
			...route,
			supportsReferenceUrls: true,
			maxReferenceUrls,
		};
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
	...options: GenerationRouteOption[]
): GenerationRoute {
	const groupedParams = params.map(withParamGroup);
	const item: GenerationRoute = {
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

	return options.reduce((current, option) => option(current), item);
}

export function gatedRoute(item: GenerationRoute, statusReason: string): GenerationRoute {
	return {
		...item,
		status: "gated",
		statusReason,
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
			{ label: "3:4", value: "3:4" },
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
				["3:4", "2K"],
				["3:4", "3K"],
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

const libTVImageOptions = (values: string[]) =>
	values.map((value) => ({ label: value === "adaptive" ? "Adaptive" : value, value }));

export function libTVGPTImageParams(): GenerationParam[] {
	return [
		selectParam(
			"aspectRatio",
			"Aspect ratio",
			"16:9",
			libTVImageOptions([
				"1:1",
				"9:16",
				"16:9",
				"3:4",
				"4:3",
				"3:2",
				"2:3",
				"5:4",
				"4:5",
				"21:9",
				"9:21",
			]),
		),
		selectParam("resolution", "Resolution", "2K", libTVImageOptions(["1K", "2K", "4K"])),
		selectParam("quality", "Quality", "medium", [
			{ label: "Low", value: "low" },
			{ label: "Medium", value: "medium" },
			{ label: "High", value: "high" },
		]),
	];
}

export function libTVNanoBananaParams(): GenerationParam[] {
	return [
		selectParam(
			"aspectRatio",
			"Aspect ratio",
			"16:9",
			libTVImageOptions([
				"adaptive",
				"1:1",
				"9:16",
				"16:9",
				"3:4",
				"4:3",
				"3:2",
				"2:3",
				"4:5",
				"5:4",
				"8:1",
				"1:8",
				"4:1",
				"1:4",
				"21:9",
			]),
		),
		selectParam("resolution", "Resolution", "2K", libTVImageOptions(["1K", "2K", "4K"])),
	];
}

export function libTVSeedreamParams(): GenerationParam[] {
	return [
		selectParam(
			"aspectRatio",
			"Aspect ratio",
			"16:9",
			libTVImageOptions(["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3"]),
		),
		selectParam("resolution", "Resolution", "2K", libTVImageOptions(["2K", "3K"])),
	];
}

export function officialGPTImageParams(): GenerationParam[] {
	return gptImageParamsWithBackground();
}

function gptImageParamsWithBackground(): GenerationParam[] {
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

export function mediagoGPTImageParams(): GenerationParam[] {
	return gptImageParamsWithBackground();
}

export function mediagoNanoBanana31Params(): GenerationParam[] {
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
			{ label: "9:16", value: "9:16" },
			{ label: "16:9", value: "16:9" },
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

export function mediagoNanoBanana31ParamCombos(): GenerationParamCombo[] {
	const ratios = [
		"1:1",
		"1:4",
		"1:8",
		"2:3",
		"3:2",
		"3:4",
		"4:1",
		"4:3",
		"4:5",
		"5:4",
		"8:1",
		"9:16",
		"16:9",
		"21:9",
	];
	const resolutions = ["1K", "2K", "4K"];
	return [
		{
			params: ["aspectRatio", "resolution"],
			allowed: ratios.flatMap((ratio) => resolutions.map((resolution) => [ratio, resolution])),
			outputs: {
				"1:1|1K": "1024x1024",
				"1:4|1K": "512x2048",
				"1:8|1K": "384x3072",
				"2:3|1K": "848x1264",
				"3:2|1K": "1264x848",
				"3:4|1K": "896x1200",
				"4:1|1K": "2048x512",
				"4:3|1K": "1200x896",
				"4:5|1K": "928x1152",
				"5:4|1K": "1152x928",
				"8:1|1K": "3072x384",
				"9:16|1K": "768x1376",
				"16:9|1K": "1376x768",
				"21:9|1K": "1584x672",
				"1:1|2K": "2048x2048",
				"1:4|2K": "1024x4096",
				"1:8|2K": "768x6144",
				"2:3|2K": "1696x2528",
				"3:2|2K": "2528x1696",
				"3:4|2K": "1792x2400",
				"4:1|2K": "4096x1024",
				"4:3|2K": "2400x1792",
				"4:5|2K": "1856x2304",
				"5:4|2K": "2304x1856",
				"8:1|2K": "6144x768",
				"9:16|2K": "1536x2752",
				"16:9|2K": "2752x1536",
				"21:9|2K": "3168x1344",
				"1:1|4K": "4096x4096",
				"1:4|4K": "2048x8192",
				"1:8|4K": "1536x12288",
				"2:3|4K": "3392x5056",
				"3:2|4K": "5056x3392",
				"3:4|4K": "3584x4800",
				"4:1|4K": "8192x2048",
				"4:3|4K": "4800x3584",
				"4:5|4K": "3712x4608",
				"5:4|4K": "4608x3712",
				"8:1|4K": "12288x1536",
				"9:16|4K": "3072x5504",
				"16:9|4K": "5504x3072",
				"21:9|4K": "6336x2688",
			},
		},
	];
}

export function mediagoNanoBananaProParams(): GenerationParam[] {
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
		numberParam("n", "图像数量", 1, 1, 4),
	];
}

export function mediagoNanoBananaProParamCombos(): GenerationParamCombo[] {
	const ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
	const resolutions = ["1K", "2K", "4K"];
	return [
		{
			params: ["aspectRatio", "resolution"],
			allowed: ratios.flatMap((ratio) => resolutions.map((resolution) => [ratio, resolution])),
			outputs: {
				"1:1|1K": "1024x1024",
				"2:3|1K": "848x1264",
				"3:2|1K": "1264x848",
				"3:4|1K": "896x1200",
				"4:3|1K": "1200x896",
				"4:5|1K": "928x1152",
				"5:4|1K": "1152x928",
				"9:16|1K": "768x1376",
				"16:9|1K": "1376x768",
				"21:9|1K": "1584x672",
				"1:1|2K": "2048x2048",
				"2:3|2K": "1696x2528",
				"3:2|2K": "2528x1696",
				"3:4|2K": "1792x2400",
				"4:3|2K": "2400x1792",
				"4:5|2K": "1856x2304",
				"5:4|2K": "2304x1856",
				"9:16|2K": "1536x2752",
				"16:9|2K": "2752x1536",
				"21:9|2K": "3168x1344",
				"1:1|4K": "4096x4096",
				"2:3|4K": "3392x5056",
				"3:2|4K": "5056x3392",
				"3:4|4K": "3584x4800",
				"4:3|4K": "4800x3584",
				"4:5|4K": "3712x4608",
				"5:4|4K": "4608x3712",
				"9:16|4K": "3072x5504",
				"16:9|4K": "5504x3072",
				"21:9|4K": "6336x2688",
			},
		},
	];
}

export function mediagoNanoBanana25Params(): GenerationParam[] {
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
		selectParam("resolution", "分辨率", "1K", [{ label: "1K", value: "1K" }]),
		numberParam("n", "图像数量", 1, 1, 4),
	];
}

export function mediagoNanoBanana25ParamCombos(): GenerationParamCombo[] {
	return nano25ParamCombos();
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
		selectParam("quality", "质量", "auto", [
			{ label: "自动", value: "auto" },
			{ label: "高", value: "high" },
			{ label: "中", value: "medium" },
			{ label: "低", value: "low" },
		]),
		selectParam("outputFormat", "输出格式", "png", [
			{ label: "PNG", value: "png" },
			{ label: "JPEG", value: "jpeg" },
			{ label: "WEBP", value: "webp" },
		]),
		selectParam("moderation", "内容审核", "auto", [
			{ label: "自动", value: "auto" },
			{ label: "低", value: "low" },
		]),
		optionalNumberParam("outputCompression", "输出压缩", 0, 100),
		numberParam("n", "图像数量", 1, 1, 10),
	];
}

export function gptImageParamCombos(): GenerationParamCombo[] {
	return [gptImageParamCombo(true)];
}

export function mediagoGPTImageParamCombos(): GenerationParamCombo[] {
	return [gptImageParamCombo(true)];
}

function gptImageParamCombo(includeAdaptive: boolean): GenerationParamCombo {
	const allowed = [
		["1:1", "1K"],
		["1:1", "2K"],
		["3:2", "1K"],
		["2:3", "1K"],
		["16:9", "2K"],
		["16:9", "4K"],
		["9:16", "4K"],
	];
	if (includeAdaptive) {
		allowed.unshift(["adaptive", "1K"]);
	}
	const outputs: Record<string, string> = {
		"1:1|1K": "1024x1024",
		"1:1|2K": "2048x2048",
		"3:2|1K": "1536x1024",
		"2:3|1K": "1024x1536",
		"16:9|2K": "2048x1152",
		"16:9|4K": "3840x2160",
		"9:16|4K": "2160x3840",
	};
	if (includeAdaptive) {
		outputs["adaptive|1K"] = "auto";
	}
	return {
		params: ["aspectRatio", "resolution"],
		allowed,
		outputs,
	};
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
			{ label: "9:21", value: "9:21" },
		]),
		selectParam("resolution", "分辨率", "1K", [
			{ label: "512px", value: "512px" },
			{ label: "1K", value: "1K" },
			{ label: "2K", value: "2K" },
			{ label: "4K", value: "4K" },
		]),
		numberParam("n", "图像数量", 1, 1, 4),
	];
}

export function nanoParamCombos(): GenerationParamCombo[] {
	const ratios = [
		"1:1",
		"1:4",
		"1:8",
		"2:3",
		"3:2",
		"3:4",
		"4:1",
		"4:3",
		"4:5",
		"5:4",
		"8:1",
		"16:9",
		"9:16",
		"21:9",
		"9:21",
	];
	const resolutions = ["512px", "1K", "2K", "4K"];
	return [
		{
			params: ["aspectRatio", "resolution"],
			allowed: ratios.flatMap((ratio) => resolutions.map((resolution) => [ratio, resolution])),
			outputs: {
				"1:1|512px": "512x512",
				"1:4|512px": "256x1024",
				"1:8|512px": "192x1536",
				"2:3|512px": "424x632",
				"3:2|512px": "632x424",
				"3:4|512px": "448x600",
				"4:1|512px": "1024x256",
				"4:3|512px": "600x448",
				"4:5|512px": "464x576",
				"5:4|512px": "576x464",
				"8:1|512px": "1536x192",
				"16:9|512px": "688x384",
				"9:16|512px": "384x688",
				"21:9|512px": "792x168",
				"9:21|512px": "168x792",
				"1:1|1K": "1024x1024",
				"1:4|1K": "512x2048",
				"1:8|1K": "384x3072",
				"2:3|1K": "848x1264",
				"3:2|1K": "1264x848",
				"3:4|1K": "896x1200",
				"4:1|1K": "2048x512",
				"4:3|1K": "1200x896",
				"4:5|1K": "928x1152",
				"5:4|1K": "1152x928",
				"8:1|1K": "3072x384",
				"16:9|1K": "1376x768",
				"9:16|1K": "768x1376",
				"21:9|1K": "1584x672",
				"9:21|1K": "672x1584",
				"1:1|2K": "2048x2048",
				"1:4|2K": "1024x4096",
				"1:8|2K": "768x6144",
				"2:3|2K": "1696x2528",
				"3:2|2K": "2528x1696",
				"3:4|2K": "1792x2400",
				"4:1|2K": "4096x1024",
				"4:3|2K": "2400x1792",
				"4:5|2K": "1856x2304",
				"5:4|2K": "2304x1856",
				"8:1|2K": "6144x768",
				"16:9|2K": "2752x1536",
				"9:16|2K": "1536x2752",
				"21:9|2K": "3168x1344",
				"9:21|2K": "1344x3168",
				"1:1|4K": "4096x4096",
				"1:4|4K": "2048x8192",
				"1:8|4K": "1536x12288",
				"2:3|4K": "3392x5056",
				"3:2|4K": "5056x3392",
				"3:4|4K": "3584x4800",
				"4:1|4K": "8192x2048",
				"4:3|4K": "4800x3584",
				"4:5|4K": "3712x4608",
				"5:4|4K": "4608x3712",
				"8:1|4K": "12288x1536",
				"16:9|4K": "5504x3072",
				"9:16|4K": "3072x5504",
				"21:9|4K": "6336x2688",
				"9:21|4K": "2688x6336",
			},
		},
	];
}

export function officialNanoBanana25Params(): GenerationParam[] {
	return nano25Params();
}

export function officialNanoBanana25ParamCombos(): GenerationParamCombo[] {
	return nano25ParamCombos();
}

export function nano25Params(): GenerationParam[] {
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
		selectParam("resolution", "分辨率", "1K", [{ label: "1K", value: "1K" }]),
		numberParam("n", "图像数量", 1, 1, 4),
	];
}

export function nano25ParamCombos(): GenerationParamCombo[] {
	const ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
	return [
		{
			params: ["aspectRatio", "resolution"],
			allowed: ratios.map((ratio) => [ratio, "1K"]),
			outputs: {
				"1:1|1K": "1024x1024",
				"2:3|1K": "832x1248",
				"3:2|1K": "1248x832",
				"3:4|1K": "864x1184",
				"4:3|1K": "1184x864",
				"4:5|1K": "896x1152",
				"5:4|1K": "1152x896",
				"9:16|1K": "768x1344",
				"16:9|1K": "1344x768",
				"21:9|1K": "1536x672",
			},
		},
	];
}

function chatImageParams(): GenerationParam[] {
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

export function mediagoChatImageParams(): GenerationParam[] {
	return chatImageParams();
}

export function openRouterImageParams(): GenerationParam[] {
	return chatImageParams();
}

export function dmxSeedanceParams(): GenerationParam[] {
	return seedanceParams();
}

export function officialSeedanceParams(): GenerationParam[] {
	return [...seedanceParams(), textParam("negativePrompt", "负向提示词", "")];
}

export function jimengSeedanceParams(): GenerationParam[] {
	return jimengSeedanceParamSet(false);
}

export function jimengSeedanceVIPParams(): GenerationParam[] {
	return jimengSeedanceParamSet(true);
}

export function pippitSeedanceParams(): GenerationParam[] {
	return pippitSeedanceParamSet(false);
}

export function pippitSeedanceStandardParams(): GenerationParam[] {
	return pippitSeedanceParamSet(true);
}

function pippitSeedanceParamSet(allow1080p: boolean): GenerationParam[] {
	return [
		selectParam("aspectRatio", "比例", "16:9", [
			{ label: "16:9", value: "16:9" },
			{ label: "4:3", value: "4:3" },
			{ label: "1:1", value: "1:1" },
			{ label: "3:4", value: "3:4" },
			{ label: "9:16", value: "9:16" },
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

export function libTVSeedanceParams(): GenerationParam[] {
	return libTVSeedanceParamSet(false);
}

export function libTVSeedanceStandardParams(): GenerationParam[] {
	return libTVSeedanceParamSet(true);
}

function libTVSeedanceParamSet(allowHighRes: boolean): GenerationParam[] {
	return [
		selectParam("aspectRatio", "比例", "16:9", [
			{ label: "Auto", value: "adaptive" },
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
			allowHighRes
				? [
						{ label: "480p", value: "480p" },
						{ label: "720p", value: "720p" },
						{ label: "1080p", value: "1080p" },
						{ label: "4K", value: "4k" },
					]
				: [
						{ label: "480p", value: "480p" },
						{ label: "720p", value: "720p" },
					],
		),
		selectParam("duration", "时长", "5", jimengSeedanceDurationOptions()),
		boolParam("generateAudio", "生成音频", true),
	];
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
