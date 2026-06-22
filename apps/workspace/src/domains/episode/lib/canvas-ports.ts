import type { EpisodeCanvasNodeType } from "@/domains/episode/lib/canvas-graph";

export type EpisodeCanvasMediaType = "image" | "script" | "video";

export type EpisodeCanvasPortSide = "input" | "output";

export interface EpisodeCanvasPort {
	id: string;
	label: string;
	mediaType: EpisodeCanvasMediaType;
	side: EpisodeCanvasPortSide;
}

export interface EpisodeCanvasNodePorts {
	inputs: EpisodeCanvasPort[];
	outputs: EpisodeCanvasPort[];
}

export const referencePromptOutputPort = "output-reference-prompt";
export const referenceGenerationPromptInputPort = "input-reference-prompt";
export const referenceImageInputPort = "input-reference-image";
export const referenceAssetImageOutputPort = "output-asset-image";
export const performanceAssetImageInputPort = "input-asset-image";
export const performanceScriptOutputPort = "output-performance-script";
export const textStoryboardScriptInputPort = "input-performance-script";
export const textStoryboardScriptOutputPort = "output-storyboard-script";
export const storyboardImageScriptInputPort = "input-storyboard-script";
export const storyboardImageAssetInputPort = "input-asset-image";
export const storyboardImageOutputPort = "output-storyboard-image";
export const videoPromptOutputPort = "output-video-prompt";
export const videoImageInputPort = "input-video-reference-image";
export const videoScriptInputPort = "input-video-prompt";
export const videoOutputPort = "output-video";

export const episodeCanvasNodePorts: Record<EpisodeCanvasNodeType, EpisodeCanvasNodePorts> = {
	performance: {
		inputs: [
			{
				id: performanceAssetImageInputPort,
				label: "素材",
				mediaType: "image",
				side: "input",
			},
		],
		outputs: [
			{
				id: performanceScriptOutputPort,
				label: "表演脚本",
				mediaType: "script",
				side: "output",
			},
		],
	},
	"reference-image": {
		inputs: [
			{
				id: referenceGenerationPromptInputPort,
				label: "提示词",
				mediaType: "script",
				side: "input",
			},
			{
				id: referenceImageInputPort,
				label: "参考图",
				mediaType: "image",
				side: "input",
			},
		],
		outputs: [
			{
				id: referenceAssetImageOutputPort,
				label: "素材图",
				mediaType: "image",
				side: "output",
			},
		],
	},
	"reference-prompt": {
		inputs: [],
		outputs: [
			{
				id: referencePromptOutputPort,
				label: "提示词",
				mediaType: "script",
				side: "output",
			},
		],
	},
	"storyboard-image": {
		inputs: [
			{
				id: storyboardImageScriptInputPort,
				label: "分镜脚本",
				mediaType: "script",
				side: "input",
			},
			{
				id: storyboardImageAssetInputPort,
				label: "素材图",
				mediaType: "image",
				side: "input",
			},
		],
		outputs: [
			{
				id: storyboardImageOutputPort,
				label: "分镜图",
				mediaType: "image",
				side: "output",
			},
		],
	},
	"text-storyboard": {
		inputs: [
			{
				id: textStoryboardScriptInputPort,
				label: "表演脚本",
				mediaType: "script",
				side: "input",
			},
		],
		outputs: [
			{
				id: textStoryboardScriptOutputPort,
				label: "分镜脚本",
				mediaType: "script",
				side: "output",
			},
		],
	},
	"video-output": {
		inputs: [
			{
				id: videoScriptInputPort,
				label: "提示词",
				mediaType: "script",
				side: "input",
			},
			{
				id: videoImageInputPort,
				label: "参考图",
				mediaType: "image",
				side: "input",
			},
		],
		outputs: [
			{
				id: videoOutputPort,
				label: "视频",
				mediaType: "video",
				side: "output",
			},
		],
	},
	"video-prompt": {
		inputs: [],
		outputs: [
			{
				id: videoPromptOutputPort,
				label: "提示词",
				mediaType: "script",
				side: "output",
			},
		],
	},
};

export const episodeCanvasMediaTypeTokens: Record<
	EpisodeCanvasMediaType,
	{
		border: string;
		foreground: string;
		surface: string;
	}
> = {
	image: {
		border: "var(--success-border)",
		foreground: "var(--success-foreground)",
		surface: "var(--success-surface)",
	},
	script: {
		border: "var(--warning-border)",
		foreground: "var(--warning-foreground)",
		surface: "var(--warning-surface)",
	},
	video: {
		border: "var(--info-border)",
		foreground: "var(--info-foreground)",
		surface: "var(--info-surface)",
	},
};

export const getCanvasNodePorts = (nodeType: EpisodeCanvasNodeType): EpisodeCanvasNodePorts =>
	episodeCanvasNodePorts[nodeType];

export const findCanvasPort = (
	nodeType: EpisodeCanvasNodeType,
	handleId: string | null | undefined,
	side: EpisodeCanvasPortSide,
) => {
	if (!handleId) return null;

	const ports =
		side === "input" ? getCanvasNodePorts(nodeType).inputs : getCanvasNodePorts(nodeType).outputs;
	return ports.find((port) => port.id === handleId) ?? null;
};

export const canConnectPorts = (
	output: EpisodeCanvasPort | null | undefined,
	input: EpisodeCanvasPort | null | undefined,
) =>
	Boolean(
		output &&
		input &&
		output.side === "output" &&
		input.side === "input" &&
		output.mediaType === input.mediaType,
	);
