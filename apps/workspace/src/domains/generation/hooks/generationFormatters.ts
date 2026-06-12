import type {
	GenerationKind,
	GenerationParam,
	GenerationProviderInfo,
	GenerationProviderType,
	GenerationRoute,
	GenerationTask,
} from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { providerTypeOf } from "./generationCatalog";
import type { ChatMessageDetail } from "./generationTypes";

export const generationRequestDetailsParamKey = "_mediago_request_details";

export const formatBytes = (value: number) => {
	if (!Number.isFinite(value) || value <= 0) return "0 B";
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;

	return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export const filterMediaAssets = (
	assets: MediaAsset[],
	kind: "all" | "image" | "video",
	query: string,
) => {
	const normalizedQuery = query.trim().toLowerCase();
	return assets.filter((asset) => {
		if (kind !== "all" && asset.kind !== kind) return false;
		if (!normalizedQuery) return true;

		return (
			asset.filename.toLowerCase().includes(normalizedQuery) ||
			asset.mimeType.toLowerCase().includes(normalizedQuery) ||
			(asset.sourceUrl ?? "").toLowerCase().includes(normalizedQuery)
		);
	});
};

export const userRequestDetails = (
	route: GenerationRoute,
	params: Record<string, unknown>,
): ChatMessageDetail[] => [
	{ label: "供应商", value: `${routeProviderLabel(route)} · ${route.model}` },
	...paramDetails(params, route.params),
];

export const userTaskDetails = (
	task: GenerationTask,
	catalog: { providers?: GenerationProviderInfo[]; routes: GenerationRoute[] },
): ChatMessageDetail[] => {
	const route = catalog.routes.find((item) => item.id === task.routeId);
	return [
		...requestDetailsFromTaskParams(task.params ?? {}),
		{
			label: "供应商",
			value: route
				? `${routeProviderLabel(route, catalog.providers)} · ${route.model}`
				: task.model,
		},
		...paramDetails(task.params ?? {}, route?.params ?? []),
	];
};

export const assistantGenerationDetails = (item: {
	createdAt?: string;
	durationMs?: number;
	status?: string;
}): ChatMessageDetail[] => {
	const details: ChatMessageDetail[] = [];

	if (typeof item.durationMs === "number" && item.durationMs >= 0) {
		details.push({
			label: isTerminalTaskStatus(item.status) ? "生成耗时" : "已用时间",
			value: formatDuration(item.durationMs),
		});
	}

	const createdAtDetail = generationCreatedAtDetail(item.createdAt);
	if (createdAtDetail) details.push(createdAtDetail);

	return details;
};

export const assistantTaskDetails = (task: GenerationTask): ChatMessageDetail[] =>
	assistantGenerationDetails(task);

export const generationCreatedAtDetail = (createdAt?: string): ChatMessageDetail | null => {
	const createdTime = formatGenerationTime(createdAt);
	if (!createdTime) return null;

	return { label: "生成时间", value: createdTime };
};

export const paramDetails = (
	params: Record<string, unknown>,
	paramSpecs: GenerationParam[],
): ChatMessageDetail[] => {
	const entries = Object.entries(params).filter(
		([name, value]) => name !== generationRequestDetailsParamKey && shouldShowParamValue(value),
	);
	if (entries.length === 0) return [];

	const specIndexes = new Map(paramSpecs.map((param, index) => [param.name, index]));
	const specLabels = new Map(paramSpecs.map((param) => [param.name, paramLabel(param.label)]));
	return entries
		.sort(([leftName], [rightName]) => {
			const leftIndex = specIndexes.get(leftName) ?? Number.MAX_SAFE_INTEGER;
			const rightIndex = specIndexes.get(rightName) ?? Number.MAX_SAFE_INTEGER;
			if (leftIndex !== rightIndex) return leftIndex - rightIndex;

			return leftName.localeCompare(rightName);
		})
		.map(([name, value]) => ({
			label: specLabels.get(name) ?? name,
			value: formatParamValue(value),
		}));
};

const requestDetailsFromTaskParams = (params: Record<string, unknown>): ChatMessageDetail[] => {
	const value = params[generationRequestDetailsParamKey];
	if (!Array.isArray(value)) return [];

	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const detail = item as Partial<ChatMessageDetail>;
		if (typeof detail.label !== "string" || typeof detail.value !== "string") return [];
		if (!detail.label.trim() || !detail.value.trim()) return [];

		return [{ label: detail.label, value: detail.value }];
	});
};

const shouldShowParamValue = (value: unknown) =>
	value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");

const formatParamValue = (value: unknown) => {
	if (typeof value === "boolean") return value ? "是" : "否";
	if (typeof value === "number" || typeof value === "string") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

const isTerminalTaskStatus = (status?: string) =>
	["completed", "failed", "error", "cancelled", "canceled"].includes(
		String(status ?? "").toLowerCase(),
	);

const formatDuration = (valueMs: number) => {
	if (!Number.isFinite(valueMs) || valueMs <= 0) return "0 秒";
	if (valueMs < 1000) return `${Math.round(valueMs)} 毫秒`;

	const totalSeconds = Math.round(valueMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds} 秒`;

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours === 0) return `${minutes} 分 ${seconds} 秒`;

	return `${hours} 小时 ${remainingMinutes} 分 ${seconds} 秒`;
};

const formatGenerationTime = (value?: string) => {
	if (!value) return "";

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";

	const now = new Date();
	const sameDate =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	const options: Intl.DateTimeFormatOptions = sameDate
		? { hour: "2-digit", minute: "2-digit", hour12: false }
		: {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			};

	return new Intl.DateTimeFormat("zh-CN", options).format(date);
};

export const providerLabel = (provider: string) => {
	switch (provider) {
		case "openai":
			return "OpenAI";
		case "google":
			return "Google";
		case "volcengine":
			return "火山引擎";
		case "dmx":
			return "DMX";
		case "openrouter":
			return "OpenRouter";
		case "jimeng":
			return "即梦";
		default:
			return provider;
	}
};

export const providerTypeLabel = (providerType?: GenerationProviderType) => {
	switch (providerType) {
		case "official":
			return "官方";
		case "aggregator":
			return "第三方";
		case "local":
			return "本地";
		default:
			return "未知类型";
	}
};

export const routeProviderLabel = (route: GenerationRoute, providers?: GenerationProviderInfo[]) =>
	`${providerLabel(route.provider)} · ${providerTypeLabel(providerTypeOf(route.provider, providers))}`;

export const kindLabel = (kind: GenerationKind) =>
	kind === "image" ? "图像" : kind === "text" ? "文本" : "视频";

export const mediaKindLabel = (kind: MediaAsset["kind"]) => (kind === "image" ? "图像" : "视频");

export const generationStatusLabel = (status: string) => {
	const labels: Record<string, string> = {
		loading: "加载中",
		streaming: "流式生成中",
		submitting: "提交中",
		submitted: "已提交",
		running: "运行中",
		pending: "等待中",
		processing: "处理中",
		queued: "排队中",
		completed: "已完成",
		succeeded: "已成功",
		success: "已成功",
		failed: "失败",
		error: "错误",
		cancelled: "已取消",
		canceled: "已取消",
	};
	return labels[status.toLowerCase()] ?? status;
};

export const paramLabel = (label: string) => {
	const labels: Record<string, string> = {
		Size: "尺寸",
		"Output format": "输出格式",
		Temperature: "温度",
		"Max tokens": "最大令牌数",
		Watermark: "水印",
		Background: "背景",
		Quality: "质量",
		Moderation: "内容审核",
		"Output compression": "输出压缩",
		Images: "图像数量",
		"Aspect ratio": "画幅比例",
		"Image size": "图像尺寸",
		Ratio: "比例",
		Resolution: "分辨率",
		Duration: "时长",
		"Model version": "模型通道",
		"Poll seconds": "等待秒数",
		"Generate audio": "生成音频",
		Seed: "种子",
		"Return last frame": "返回最后一帧",
		"Task timeout": "任务超时",
		Mode: "模式",
		"Negative prompt": "负向提示词",
		Audio: "音频",
		"Prompt optimizer": "提示词优化",
		"Fast pretreatment": "快速预处理",
	};
	return labels[label] ?? label;
};

export const paramOptionLabel = (label: string) => {
	const labels: Record<string, string> = {
		Auto: "自动",
		Opaque: "不透明",
		High: "高",
		Medium: "中",
		Low: "低",
		Adaptive: "自适应",
		Standard: "标准",
		Pro: "专业",
		"6s": "6 秒",
		"10s": "10 秒",
	};
	return labels[label] ?? label;
};

export const paramHelp = (help: string) => {
	const labels: Record<string, string> = {
		"Seedream accepts named quality sizes and exact pixel sizes.":
			"Seedream 支持命名质量尺寸和精确像素尺寸。",
		"Use -1 to let the model choose a duration.": "使用 -1 让模型自动选择时长。",
		"Seconds before a queued or running task expires.": "排队或运行中的任务过期秒数。",
	};
	return labels[help] ?? help;
};
