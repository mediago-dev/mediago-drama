import type { AgentReference } from "@/domains/agent/api/agent";
import {
	mentionReferenceKey,
	parseMentionsFromMarkdown,
	resolveMentionPayload,
	type ResolvedMention,
} from "@/domains/documents/lib/mention-resolver";
import type { DocumentCategory, MarkdownDocument } from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import type { Episode, TimelineClip, TimelineClipStatus } from "@/domains/episode/lib/sample";
import {
	readStoryboardLaneSources,
	type StoryboardLaneSource,
	type StoryboardShotSummary,
} from "@/domains/episode/lib/storyboard-shots";
import {
	type EpisodeCanvasMediaType,
	referenceAssetImageOutputPort,
	referenceGenerationPromptInputPort,
	referencePromptOutputPort,
	videoImageInputPort,
	videoPromptOutputPort,
	videoScriptInputPort,
} from "@/domains/episode/lib/canvas-ports";

export type EpisodeCanvasNodeType =
	| "reference-image"
	| "reference-prompt"
	| "performance"
	| "text-storyboard"
	| "storyboard-image"
	| "video-prompt"
	| "video-output";

export type EpisodeCanvasReferenceStatus = "missing" | "ok" | "placeholder";

export interface EpisodeCanvasReference {
	agentReference: AgentReference;
	category: DocumentCategory | "asset" | "unknown";
	imageUrl?: string;
	key: string;
	status: EpisodeCanvasReferenceStatus;
	summary: string;
	title: string;
}

export interface EpisodeCanvasNodeData extends Record<string, unknown> {
	body: string;
	canGenerateReferenceImage?: boolean;
	canGenerateScene?: boolean;
	clipId?: string;
	imageUrl?: string;
	laneId: string;
	laneIndex: number;
	laneTitle: string;
	nodeType: EpisodeCanvasNodeType;
	reference?: EpisodeCanvasReference;
	references?: EpisodeCanvasReference[];
	shots?: StoryboardShotSummary[];
	source?: string;
	status?: TimelineClipStatus;
	subtitle: string;
	title: string;
}

export interface EpisodeCanvasNode {
	data: EpisodeCanvasNodeData;
	id: string;
	position: {
		x: number;
		y: number;
	};
	type: EpisodeCanvasNodeType;
}

export interface EpisodeCanvasEdge {
	data: {
		laneId: string;
		mediaType: EpisodeCanvasMediaType;
		relation: "flow" | "reference";
	};
	id: string;
	source: string;
	sourceHandle: string;
	target: string;
	targetHandle: string;
}

export interface EpisodeCanvasLane {
	blockId?: string;
	clipId: string;
	end: number;
	headingLevel?: number;
	headingOccurrence?: number;
	id: string;
	index: number;
	references: EpisodeCanvasReference[];
	shots: StoryboardShotSummary[];
	sourceMarkdown: string;
	start: number;
	title: string;
}

export interface EpisodeCanvasGraph {
	edges: EpisodeCanvasEdge[];
	lanes: EpisodeCanvasLane[];
	nodes: EpisodeCanvasNode[];
}

export interface BuildEpisodeCanvasGraphInput {
	assets?: ProjectAsset[];
	documentId?: string | null;
	documents?: MarkdownDocument[];
	episode: Episode;
	storyboardMarkdown?: string;
}

const referenceKinds = new Set<DocumentCategory | "asset" | "unknown">([
	"asset",
	"character",
	"prop",
	"reference",
	"scene",
	"storyboard",
	"unknown",
]);

export const buildEpisodeCanvasGraph = ({
	assets = [],
	documentId,
	documents = [],
	episode,
	storyboardMarkdown = "",
}: BuildEpisodeCanvasGraphInput): EpisodeCanvasGraph => {
	const laneSources = readStoryboardLaneSources(storyboardMarkdown, { documentId });
	const videoClips = episode.tracks.find((track) => track.type === "video")?.clips ?? [];
	const lanes = videoClips.map((clip, index) =>
		createLane({ assets, clip, documents, index, laneSources }),
	);
	const nodes: EpisodeCanvasNode[] = [];
	const edges: EpisodeCanvasEdge[] = [];

	for (const lane of lanes) {
		const referenceFlows = lane.references.map((reference, referenceIndex) => ({
			imageNode: createReferenceImageNode(lane, reference, referenceIndex),
			promptNode: createReferencePromptNode(lane, reference, referenceIndex),
		}));
		const videoPromptNode = createVideoPromptNode(lane);
		const videoOutputNode = createVideoOutputNode(episode, lane);

		nodes.push(
			...referenceFlows.flatMap((flow) => [flow.promptNode, flow.imageNode]),
			videoPromptNode,
			videoOutputNode,
		);

		for (const { imageNode, promptNode } of referenceFlows) {
			edges.push(
				createFlowEdge(
					lane.id,
					promptNode.id,
					referencePromptOutputPort,
					imageNode.id,
					referenceGenerationPromptInputPort,
					"script",
				),
			);
			edges.push({
				data: { laneId: lane.id, mediaType: "image", relation: "reference" },
				id: `edge-${imageNode.id}-${videoOutputNode.id}-${videoImageInputPort}`,
				source: imageNode.id,
				sourceHandle: referenceAssetImageOutputPort,
				target: videoOutputNode.id,
				targetHandle: videoImageInputPort,
			});
		}

		edges.push(
			createFlowEdge(
				lane.id,
				videoPromptNode.id,
				videoPromptOutputPort,
				videoOutputNode.id,
				videoScriptInputPort,
				"script",
			),
		);
	}

	return { edges, lanes, nodes };
};

export const focusEpisodeCanvasGraph = (
	graph: EpisodeCanvasGraph,
	episode: Episode,
	selectedClipId?: string | null,
): EpisodeCanvasGraph => {
	const lane = findFocusedLane(graph, episode, selectedClipId);
	if (!lane) return graph;

	const laneNodeIds = new Set(
		graph.nodes.filter((node) => node.data.laneId === lane.id).map((node) => node.id),
	);

	return {
		edges: graph.edges.filter(
			(edge) =>
				edge.data.laneId === lane.id &&
				laneNodeIds.has(edge.source) &&
				laneNodeIds.has(edge.target),
		),
		lanes: [lane],
		nodes: graph.nodes.filter((node) => node.data.laneId === lane.id),
	};
};

const createLane = ({
	assets,
	clip,
	documents,
	index,
	laneSources,
}: {
	assets: ProjectAsset[];
	clip: TimelineClip;
	documents: MarkdownDocument[];
	index: number;
	laneSources: StoryboardLaneSource[];
}): EpisodeCanvasLane => {
	const source = findLaneSource(clip, index, laneSources);
	const sourceMarkdown = source?.markdown ?? fallbackClipMarkdown(clip);
	const references = referenceSummariesFromMarkdown(sourceMarkdown, documents, assets);

	return {
		blockId: source?.blockId,
		clipId: clip.id,
		end: clip.end,
		headingLevel: source?.headingLevel,
		headingOccurrence: source?.headingOccurrence,
		id: `lane-${clip.id}`,
		index,
		references: references.length > 0 ? references : [placeholderReference()],
		shots: source?.shots.length ? source.shots : [],
		sourceMarkdown,
		start: clip.start,
		title: clip.title,
	};
};

const findLaneSource = (
	clip: TimelineClip,
	index: number,
	laneSources: StoryboardLaneSource[],
): StoryboardLaneSource | null => {
	const normalizedClipTitle = normalizeTitle(clip.title);
	return (
		laneSources.find((source) => normalizeTitle(source.title) === normalizedClipTitle) ??
		laneSources[index] ??
		null
	);
};

const findFocusedLane = (
	graph: EpisodeCanvasGraph,
	episode: Episode,
	selectedClipId?: string | null,
) => {
	if (graph.lanes.length <= 1) return graph.lanes[0] ?? null;

	const selectedId = selectedClipId?.trim();
	if (!selectedId) return graph.lanes[0] ?? null;

	const selectedVideoLane = graph.lanes.find((lane) => lane.clipId === selectedId);
	if (selectedVideoLane) return selectedVideoLane;

	const selectedClip = findClipById(episode, selectedId);
	if (!selectedClip) return graph.lanes[0] ?? null;

	return (
		graph.lanes.find((lane) => timelineClipsOverlap(lane, selectedClip)) ?? graph.lanes[0] ?? null
	);
};

const referenceSummariesFromMarkdown = (
	markdown: string,
	documents: MarkdownDocument[],
	assets: ProjectAsset[],
): EpisodeCanvasReference[] =>
	parseMentionsFromMarkdown(markdown)
		.map((reference) => referenceSummary(resolveMentionPayload(reference, documents, assets)))
		.filter((reference) => referenceKinds.has(reference.category));

const referenceSummary = (mention: ResolvedMention): EpisodeCanvasReference => {
	const category = referenceCategory(mention.reference);
	const key = mentionReferenceKey(mention.reference);

	return {
		category,
		agentReference: mention.reference,
		imageUrl: mention.images[0]?.url,
		key,
		status: mention.status,
		summary: cleanCanvasText(mention.text),
		title: mention.reference.title || referenceCategoryLabel(category),
	};
};

const placeholderReference = (): EpisodeCanvasReference => ({
	agentReference: {
		documentId: "placeholder",
		kind: "document",
		title: "待关联素材",
	},
	category: "unknown",
	key: "placeholder",
	status: "placeholder",
	summary: "在 storyboard 中使用 @mention 引用场景、人物或道具后会自动连线。",
	title: "待关联素材",
});

const referenceCategory = (reference: AgentReference): EpisodeCanvasReference["category"] => {
	if (reference.kind === "asset") return "asset";
	return reference.category ?? "unknown";
};

const createReferencePromptNode = (
	lane: EpisodeCanvasLane,
	reference: EpisodeCanvasReference,
	referenceIndex: number,
): EpisodeCanvasNode => ({
	data: {
		body: reference.summary,
		clipId: lane.clipId,
		laneId: lane.id,
		laneIndex: lane.index,
		laneTitle: lane.title,
		nodeType: "reference-prompt",
		reference,
		status: reference.status === "missing" ? "error" : "ready",
		subtitle: referenceCategoryLabel(reference.category),
		title: `${reference.title} 提示词`,
	},
	id: `node-${lane.id}-reference-prompt-${referenceIndex}-${slugify(reference.key)}`,
	position: { x: 0, y: 0 },
	type: "reference-prompt",
});

const createReferenceImageNode = (
	lane: EpisodeCanvasLane,
	reference: EpisodeCanvasReference,
	referenceIndex: number,
): EpisodeCanvasNode => ({
	data: {
		body: reference.imageUrl ? "已生成素材图，可继续作为下游表演参考。" : "从提示词生成素材图。",
		canGenerateReferenceImage: reference.status !== "placeholder",
		canGenerateScene: reference.category === "scene",
		clipId: lane.clipId,
		imageUrl: reference.imageUrl,
		laneId: lane.id,
		laneIndex: lane.index,
		laneTitle: lane.title,
		nodeType: "reference-image",
		reference,
		status: reference.status === "missing" ? "error" : reference.imageUrl ? "ready" : "draft",
		subtitle: "图片生成",
		title: reference.title,
	},
	id: `node-${lane.id}-reference-image-${referenceIndex}-${slugify(reference.key)}`,
	position: { x: 0, y: 0 },
	type: "reference-image",
});

const createVideoPromptNode = (lane: EpisodeCanvasLane): EpisodeCanvasNode => ({
	data: {
		body: cleanCanvasText(lane.sourceMarkdown),
		clipId: lane.clipId,
		laneId: lane.id,
		laneIndex: lane.index,
		laneTitle: lane.title,
		nodeType: "video-prompt",
		shots: lane.shots,
		source: lane.sourceMarkdown,
		status: "draft",
		subtitle: lane.shots.length > 0 ? `${lane.shots.length} 个镜头` : "分镜文字",
		title: "视频提示词",
	},
	id: `node-${lane.id}-video-prompt`,
	position: { x: 0, y: 0 },
	type: "video-prompt",
});

const createVideoOutputNode = (episode: Episode, lane: EpisodeCanvasLane): EpisodeCanvasNode => {
	const clip = findClipById(episode, lane.clipId);

	return {
		data: {
			body: clip?.content ?? "接收提示词和参考图生成视频。",
			clipId: lane.clipId,
			imageUrl: clip?.posterUrl ?? clip?.thumbnailUrl,
			laneId: lane.id,
			laneIndex: lane.index,
			laneTitle: lane.title,
			nodeType: "video-output",
			status: clip?.status ?? "draft",
			subtitle: clip?.videoUrl ? "视频已生成" : "开机拍摄",
			title: clip?.title ?? lane.title,
		},
		id: `node-${lane.id}-video-output`,
		position: { x: 0, y: 0 },
		type: "video-output",
	};
};

const createFlowEdge = (
	laneId: string,
	source: string,
	sourceHandle: string,
	target: string,
	targetHandle: string,
	mediaType: EpisodeCanvasMediaType,
): EpisodeCanvasEdge => ({
	data: { laneId, mediaType, relation: "flow" },
	id: `edge-${source}-${sourceHandle}-${target}-${targetHandle}`,
	source,
	sourceHandle,
	target,
	targetHandle,
});

const timelineClipsOverlap = (
	first: Pick<TimelineClip, "end" | "start">,
	second: Pick<TimelineClip, "end" | "start">,
) => Math.min(first.end, second.end) - Math.max(first.start, second.start) > 0.25;

const findClipById = (episode: Episode, clipId: string) =>
	episode.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId) ?? null;

const fallbackClipMarkdown = (clip: TimelineClip) =>
	[`## ${clip.title}`, clip.prompt || clip.content].filter(Boolean).join("\n\n");

const cleanCanvasText = (text: string) =>
	text
		.split("\n")
		.map((line) =>
			line
				.replace(/^#{1,6}\s+/, "")
				.replace(/!\[[^\]]*\]\((?:<[^>]+>|[^\s)]+)\)/gu, "")
				.replace(/@\[((?:\\.|[^\]\\])*)\]\((?:<[^>]+>|[^\s)]+)\)/gu, "@$1")
				.replace(/\*\*/g, "")
				.trim(),
		)
		.filter(Boolean)
		.join("\n")
		.trim();

const referenceCategoryLabel = (category: EpisodeCanvasReference["category"]) => {
	const labels: Record<EpisodeCanvasReference["category"], string> = {
		asset: "素材",
		character: "人物",
		overview: "总览",
		prop: "道具",
		reference: "参考",
		scene: "场景",
		screenplay: "剧本",
		storyboard: "分镜",
		unknown: "素材引用",
	};

	return labels[category];
};

const normalizeTitle = (value: string) => value.replace(/\s+/g, "").trim().toLowerCase();

const slugify = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
		.replace(/^-|-$/g, "") || "node";
