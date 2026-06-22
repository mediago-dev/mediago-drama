import {
	applyNodeChanges,
	Background,
	type Connection,
	Controls,
	type Edge as FlowEdge,
	MiniMap,
	type NodeChange,
	type Node as FlowNode,
	type NodeMouseHandler,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentReference } from "@/domains/agent/api/agent";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import type { MarkdownSectionMentionReference } from "@/domains/documents/lib/editor-registry";
import { createSectionGenerationPrompt } from "@/domains/documents/lib/section-generation-prompt";
import { useDocumentsStore, type MarkdownDocument } from "@/domains/documents/stores";
import type {
	EpisodeCanvasEdge,
	EpisodeCanvasEdge as ProjectedCanvasEdge,
	EpisodeCanvasNodeType,
} from "@/domains/episode/lib/canvas-graph";
import {
	buildEpisodeCanvasGraph,
	focusEpisodeCanvasGraph,
	type EpisodeCanvasGraph,
	type EpisodeCanvasLane,
	type EpisodeCanvasNode,
} from "@/domains/episode/lib/canvas-graph";
import { createReferenceImageGenerationSection } from "@/domains/episode/lib/canvas-generation";
import {
	applyCanvasNodePositionChanges,
	applyCanvasNodePositionOverrides,
	type EpisodeCanvasNodePositionOverrides,
} from "@/domains/episode/lib/canvas-node-position";
import {
	canConnectPorts,
	episodeCanvasMediaTypeTokens,
	findCanvasPort,
	referenceAssetImageOutputPort,
	videoImageInputPort,
	type EpisodeCanvasMediaType,
	type EpisodeCanvasPort,
} from "@/domains/episode/lib/canvas-ports";
import { layoutEpisodeCanvasGraph } from "@/domains/episode/lib/canvas-layout";
import type { Episode } from "@/domains/episode/lib/sample";
import { useEpisodeCanvasLayoutStore } from "@/domains/episode/stores/canvas-layout";
import { resolveThemeMode, useThemeStore, type ThemeMode } from "@/shared/stores/theme";
import {
	episodeCanvasNodeTypes,
	type EpisodeCanvasFlowNodeData,
} from "./canvas/EpisodeCanvasNodes";
import type { TimelineCompanionTrackType } from "@/domains/episode/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";

interface EpisodeCanvasViewProps {
	activeDocument: MarkdownDocument | null;
	assets: ProjectAsset[];
	documents: MarkdownDocument[];
	episode: Episode;
	selectedClipId: string;
	storyboardMarkdown: string;
	onGenerateClip: (clipId: string) => void;
	onOpenReferenceGeneration: (section: MarkdownSectionContext) => void;
	onRequestCompanionGeneration: (
		videoClipId: string,
		trackType: TimelineCompanionTrackType,
	) => void;
	onSelectClip: (clipId: string) => void;
}

interface EpisodeCanvasFlowEdgeData extends Record<string, unknown> {
	laneId: string;
	mediaType: ProjectedCanvasEdge["data"]["mediaType"];
	relation: ProjectedCanvasEdge["data"]["relation"];
}

type EpisodeCanvasFlowNode = FlowNode<EpisodeCanvasFlowNodeData, EpisodeCanvasNodeType>;
type EpisodeCanvasFlowEdge = FlowEdge<EpisodeCanvasFlowEdgeData>;
type EpisodeCanvasEdgePalette = Record<EpisodeCanvasMediaType, string>;
type EpisodeCanvasColorMode = ReturnType<typeof resolveThemeMode>;

interface EpisodeCanvasConnectionContext {
	inputPort: EpisodeCanvasPort;
	outputPort: EpisodeCanvasPort;
	sourceNode: EpisodeCanvasFlowNode;
	targetNode: EpisodeCanvasFlowNode;
}

type EpisodeCanvasConnectionLike = Pick<Connection, "source" | "target"> & {
	sourceHandle?: string | null;
	targetHandle?: string | null;
};

const emptyNodePositionOverrides: EpisodeCanvasNodePositionOverrides = {};
const canvasLayoutStorageVersion = "layout-v2";
const episodeCanvasMediaTypes = [
	"image",
	"script",
	"video",
] as const satisfies readonly EpisodeCanvasMediaType[];
const fallbackEpisodeCanvasEdgePalette: EpisodeCanvasEdgePalette = {
	image: episodeCanvasMediaTypeTokens.image.foreground,
	script: episodeCanvasMediaTypeTokens.script.foreground,
	video: episodeCanvasMediaTypeTokens.video.foreground,
};
const episodeCanvasEdgeColorVariables: Record<EpisodeCanvasMediaType, string> = {
	image: "--success-foreground",
	script: "--warning-foreground",
	video: "--info-foreground",
};

export const EpisodeCanvasView: React.FC<EpisodeCanvasViewProps> = (props) => (
	<ReactFlowProvider>
		<EpisodeCanvasViewInner {...props} />
	</ReactFlowProvider>
);

const EpisodeCanvasViewInner: React.FC<EpisodeCanvasViewProps> = ({
	activeDocument,
	assets,
	documents,
	episode,
	selectedClipId,
	storyboardMarkdown,
	onGenerateClip,
	onOpenReferenceGeneration,
	onRequestCompanionGeneration,
	onSelectClip,
}) => {
	const { fitView } = useReactFlow<EpisodeCanvasFlowNode, EpisodeCanvasFlowEdge>();
	const toggleSectionMention = useDocumentsStore((state) => state.toggleSectionMention);
	const canvasLayoutScopeId = useMemo(
		() => canvasLayoutScopeIdFromDocument(activeDocument, episode),
		[activeDocument, episode],
	);
	const persistedNodePositionOverrides = useEpisodeCanvasLayoutStore(
		(state) => state.nodePositionsByScope[canvasLayoutScopeId] ?? emptyNodePositionOverrides,
	);
	const setPersistedNodePositions = useEpisodeCanvasLayoutStore((state) => state.setNodePositions);
	const nodePositionOverridesRef = useRef<EpisodeCanvasNodePositionOverrides>(
		persistedNodePositionOverrides,
	);
	const fullGraph = useMemo<EpisodeCanvasGraph>(
		() =>
			buildEpisodeCanvasGraph({
				assets,
				documentId: activeDocument?.id,
				documents,
				episode,
				storyboardMarkdown,
			}),
		[activeDocument?.id, assets, documents, episode, storyboardMarkdown],
	);
	const graph = useMemo(
		() => focusEpisodeCanvasGraph(fullGraph, episode, selectedClipId),
		[episode, fullGraph, selectedClipId],
	);
	const layout = useMemo(() => layoutEpisodeCanvasGraph(graph), [graph]);
	const canvasColorMode = useEpisodeCanvasColorMode();
	const edgePalette = useEpisodeCanvasEdgePalette();
	const activeLane = layout.lanes[0] ?? null;
	const sectionByLaneId = useMemo(
		() => buildSectionContextByLaneId(activeDocument, layout),
		[activeDocument, layout],
	);
	const laneById = useMemo(
		() => new Map(layout.lanes.map((lane) => [lane.id, lane])),
		[layout.lanes],
	);
	const baseNodes = useMemo<EpisodeCanvasFlowNode[]>(() => {
		const flowNodes = layout.nodes.map((node) => {
			const referenceImageGenerationSection = createReferenceImageGenerationSection({
				documents,
				node,
			});

			return canvasFlowNode(node, {
				canGenerateReferenceImage: Boolean(
					node.data.canGenerateReferenceImage && referenceImageGenerationSection,
				),
				canGenerateScene: Boolean(
					node.data.canGenerateScene && sectionByLaneId.has(node.data.laneId),
				),
				canGenerateStoryboardImage: sectionByLaneId.has(node.data.laneId),
				isSelected: node.data.clipId === selectedClipId,
				onGenerateClip,
				onGenerateReferenceImage: () => {
					if (referenceImageGenerationSection) {
						onOpenReferenceGeneration(referenceImageGenerationSection);
					}
				},
				onGenerateScene: (laneId) => {
					const section = sectionByLaneId.get(laneId);
					if (section) onOpenReferenceGeneration(section);
				},
				onGenerateStoryboardImage: (laneId) => {
					const section = sectionByLaneId.get(laneId);
					if (section) onOpenReferenceGeneration(section);
				},
				onRequestCompanionGeneration,
			});
		});

		return flowNodes;
	}, [
		documents,
		layout.nodes,
		onGenerateClip,
		onOpenReferenceGeneration,
		onRequestCompanionGeneration,
		sectionByLaneId,
		selectedClipId,
	]);
	const [nodes, setNodes] = useState<EpisodeCanvasFlowNode[]>(() =>
		applyCanvasNodePositionOverrides(baseNodes, persistedNodePositionOverrides),
	);
	const edges = useMemo<EpisodeCanvasFlowEdge[]>(
		() => layout.edges.map((edge) => canvasFlowEdge(edge, edgePalette)),
		[edgePalette, layout.edges],
	);
	const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
	useEffect(() => {
		nodePositionOverridesRef.current = persistedNodePositionOverrides;
		setNodes(applyCanvasNodePositionOverrides(baseNodes, persistedNodePositionOverrides));
	}, [baseNodes, persistedNodePositionOverrides]);
	const handleNodeClick = useCallback<NodeMouseHandler<EpisodeCanvasFlowNode>>(
		(_event, node) => {
			if (node.data.clipId) onSelectClip(node.data.clipId);
		},
		[onSelectClip],
	);
	const handleNodesChange = useCallback(
		(changes: NodeChange<EpisodeCanvasFlowNode>[]) => {
			setNodes((current) => applyNodeChanges(changes, current));
			const nextOverrides = applyCanvasNodePositionChanges(
				nodePositionOverridesRef.current,
				changes,
			);
			if (nextOverrides !== nodePositionOverridesRef.current) {
				nodePositionOverridesRef.current = nextOverrides;
			}
			if (shouldPersistNodePositionChanges(changes)) {
				setPersistedNodePositions(canvasLayoutScopeId, nodePositionOverridesRef.current);
			}
		},
		[canvasLayoutScopeId, setPersistedNodePositions],
	);
	const handleConnect = useCallback(
		(connection: Connection) => {
			const connectionContext = resolveConnectionContext(connection, nodeById);
			if (
				!connectionContext ||
				!canConnectPorts(connectionContext.outputPort, connectionContext.inputPort)
			) {
				return;
			}
			if (!isEditableReferenceConnection(connectionContext)) return;

			const section = sectionIdentityFromLane(
				laneById.get(connectionContext.targetNode.data.laneId),
				activeDocument?.id,
			);
			const reference = connectionContext.sourceNode.data.reference?.agentReference;
			const mentionReference = reference ? mentionReferenceFromAgentReference(reference) : null;
			if (!section || !mentionReference) return;

			toggleSectionMention(section, mentionReference, true);
		},
		[activeDocument?.id, laneById, nodeById, toggleSectionMention],
	);
	const isValidCanvasConnection = useCallback(
		(connection: EpisodeCanvasConnectionLike) => {
			const connectionContext = resolveConnectionContext(connection, nodeById);
			return Boolean(
				connectionContext &&
				connectionContext.sourceNode.data.laneId === connectionContext.targetNode.data.laneId &&
				canConnectPorts(connectionContext.outputPort, connectionContext.inputPort),
			);
		},
		[nodeById],
	);
	const handleEdgesDelete = useCallback(
		(deletedEdges: EpisodeCanvasFlowEdge[]) => {
			for (const edge of deletedEdges) {
				if (edge.data?.relation !== "reference") continue;

				const sourceNode = nodeById.get(edge.source);
				const section = sectionIdentityFromLane(laneById.get(edge.data.laneId), activeDocument?.id);
				const reference = sourceNode?.data.reference?.agentReference;
				const mentionReference = reference ? mentionReferenceFromAgentReference(reference) : null;
				if (!section || !mentionReference) continue;

				toggleSectionMention(section, mentionReference, false);
			}
		},
		[activeDocument?.id, laneById, nodeById, toggleSectionMention],
	);
	useEffect(() => {
		if (nodes.length === 0) return;

		const frame = window.requestAnimationFrame(() => {
			void fitView({ duration: 220, padding: 0.16 });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [activeLane?.id, fitView, nodes.length]);

	return (
		<section
			className="flex min-h-0 flex-1 flex-col bg-ide-preview"
			data-testid="episode-canvas-view"
		>
			<div className="flex h-12 shrink-0 items-center border-b border-border bg-ide-toolbar px-3">
				<div className="flex min-w-0 items-center gap-2">
					<div className="truncate text-xs text-muted-foreground">
						{activeLane?.title ?? "当前胶卷"} / 共 {fullGraph.lanes.length} 条胶卷 /{" "}
						{layout.nodes.length} 个节点
					</div>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-hidden bg-ide-editor">
				<ReactFlow
					className="episode-canvas-flow"
					colorMode={canvasColorMode}
					edges={edges}
					minZoom={0.28}
					nodes={nodes}
					nodesConnectable
					nodesDraggable
					nodeTypes={episodeCanvasNodeTypes}
					panOnScroll
					proOptions={{ hideAttribution: true }}
					isValidConnection={isValidCanvasConnection}
					onConnect={handleConnect}
					onEdgesDelete={handleEdgesDelete}
					onNodeClick={handleNodeClick}
					onNodesChange={handleNodesChange}
				>
					<Background
						bgColor="var(--ide-editor)"
						className="bg-ide-editor"
						color="color-mix(in srgb, var(--border) 72%, transparent)"
						gap={28}
					/>
					<Controls className="border border-border bg-ide-panel text-foreground" />
					<MiniMap
						className="hidden border border-border bg-ide-panel md:block"
						maskColor="var(--popover)"
						nodeColor="var(--muted)"
						nodeStrokeColor="var(--primary)"
						nodeStrokeWidth={2}
						pannable
						zoomable
					/>
				</ReactFlow>
			</div>
		</section>
	);
};

const canvasFlowNode = (
	node: EpisodeCanvasNode,
	actions: Pick<
		EpisodeCanvasFlowNodeData,
		| "canGenerateStoryboardImage"
		| "canGenerateReferenceImage"
		| "canGenerateScene"
		| "isSelected"
		| "onGenerateClip"
		| "onGenerateReferenceImage"
		| "onGenerateScene"
		| "onGenerateStoryboardImage"
		| "onRequestCompanionGeneration"
	>,
): EpisodeCanvasFlowNode => ({
	...node,
	data: {
		...node.data,
		...actions,
	},
	draggable: true,
	selectable: true,
});

const canvasFlowEdge = (
	edge: EpisodeCanvasEdge,
	edgePalette: EpisodeCanvasEdgePalette,
): EpisodeCanvasFlowEdge => ({
	...edge,
	data: edge.data,
	deletable: edge.data.relation === "reference",
	style: {
		stroke: edgePalette[edge.data.mediaType],
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: edge.data.relation === "reference" ? 1.4 : 2,
	},
	type: "bezier",
});

const useEpisodeCanvasColorMode = () => {
	const themeMode = useThemeStore((state) => state.mode);
	const [colorMode, setColorMode] = useState<EpisodeCanvasColorMode>(() =>
		resolveEpisodeCanvasColorMode(themeMode),
	);

	useEffect(() => {
		const updateColorMode = () => setColorMode(resolveEpisodeCanvasColorMode(themeMode));
		updateColorMode();

		if (themeMode !== "system" || typeof window === "undefined") return;

		const query = window.matchMedia?.("(prefers-color-scheme: dark)");
		query?.addEventListener("change", updateColorMode);
		return () => query?.removeEventListener("change", updateColorMode);
	}, [themeMode]);

	return colorMode;
};

const resolveEpisodeCanvasColorMode = (themeMode: ThemeMode): EpisodeCanvasColorMode => {
	if (typeof window === "undefined") return "light";
	return resolveThemeMode(themeMode);
};

const useEpisodeCanvasEdgePalette = () => {
	const [palette, setPalette] = useState<EpisodeCanvasEdgePalette>(
		fallbackEpisodeCanvasEdgePalette,
	);

	useEffect(() => {
		const updatePalette = () => setPalette(readEpisodeCanvasEdgePalette());
		updatePalette();

		if (typeof MutationObserver === "undefined") return;

		const observer = new MutationObserver(updatePalette);
		observer.observe(document.documentElement, {
			attributeFilter: ["data-theme", "class"],
			attributes: true,
		});
		return () => observer.disconnect();
	}, []);

	return palette;
};

const readEpisodeCanvasEdgePalette = (): EpisodeCanvasEdgePalette => {
	if (typeof document === "undefined" || typeof window === "undefined") {
		return fallbackEpisodeCanvasEdgePalette;
	}

	const palette: EpisodeCanvasEdgePalette = { ...fallbackEpisodeCanvasEdgePalette };
	for (const mediaType of episodeCanvasMediaTypes) {
		palette[mediaType] = resolveCssColorVariable(
			episodeCanvasEdgeColorVariables[mediaType],
			fallbackEpisodeCanvasEdgePalette[mediaType],
		);
	}
	return palette;
};

const resolveCssColorVariable = (variableName: string, fallback: string) => {
	const probe = document.createElement("span");
	probe.style.color = `var(${variableName})`;
	probe.style.pointerEvents = "none";
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";

	const target = document.body ?? document.documentElement;
	target.appendChild(probe);
	const color = window.getComputedStyle(probe).color.trim();
	probe.remove();

	return color || fallback;
};

const canvasLayoutScopeIdFromDocument = (
	activeDocument: MarkdownDocument | null,
	episode: Episode,
) => {
	const documentId = activeDocument?.id.trim();
	return documentId
		? `${canvasLayoutStorageVersion}:document:${documentId}`
		: `${canvasLayoutStorageVersion}:episode:${episode.id}`;
};

const shouldPersistNodePositionChanges = (changes: NodeChange<EpisodeCanvasFlowNode>[]) =>
	changes.some(
		(change) => change.type === "position" && (!("dragging" in change) || change.dragging !== true),
	);

const resolveConnectionContext = (
	connection: EpisodeCanvasConnectionLike,
	nodeById: Map<string, EpisodeCanvasFlowNode>,
): EpisodeCanvasConnectionContext | null => {
	if (!connection.source || !connection.target) return null;

	const sourceNode = nodeById.get(connection.source);
	const targetNode = nodeById.get(connection.target);
	if (!sourceNode || !targetNode) return null;

	const outputPort = findCanvasPort(sourceNode.type, connection.sourceHandle, "output");
	const inputPort = findCanvasPort(targetNode.type, connection.targetHandle, "input");
	if (!outputPort || !inputPort) return null;

	return {
		inputPort,
		outputPort,
		sourceNode,
		targetNode,
	};
};

const isEditableReferenceConnection = ({
	inputPort,
	outputPort,
	sourceNode,
	targetNode,
}: EpisodeCanvasConnectionContext) =>
	sourceNode.type === "reference-image" &&
	targetNode.type === "video-output" &&
	sourceNode.data.laneId === targetNode.data.laneId &&
	outputPort.id === referenceAssetImageOutputPort &&
	inputPort.id === videoImageInputPort &&
	canConnectPorts(outputPort, inputPort);

const sectionIdentityFromLane = (lane?: EpisodeCanvasLane, documentId?: string | null) => {
	if (!documentId || !lane?.blockId || !lane.headingLevel || !lane.headingOccurrence) return null;

	return {
		blockId: lane.blockId,
		documentId,
		headingLevel: lane.headingLevel,
		headingOccurrence: lane.headingOccurrence,
		headingText: lane.title,
	};
};

const mentionReferenceFromAgentReference = (
	reference: AgentReference,
): MarkdownSectionMentionReference | null => {
	if (reference.kind === "asset") return null;

	return {
		documentId: reference.documentId,
		...(reference.kind === "section" && reference.blockId ? { blockId: reference.blockId } : {}),
		title: reference.title,
		...(reference.category ? { category: reference.category } : {}),
	};
};

const buildSectionContextByLaneId = (
	activeDocument: MarkdownDocument | null,
	graph: Pick<EpisodeCanvasGraph, "lanes">,
) => {
	const sections = new Map<string, MarkdownSectionContext>();
	if (!activeDocument) return sections;

	for (const lane of graph.lanes) {
		if (!lane.blockId || !lane.headingLevel || !lane.headingOccurrence) continue;

		sections.set(lane.id, {
			blockId: lane.blockId,
			documentId: activeDocument.id,
			headingLevel: lane.headingLevel,
			headingOccurrence: lane.headingOccurrence,
			headingText: lane.title,
			markdown: lane.sourceMarkdown,
			plainText: plainTextFromMarkdown(lane.sourceMarkdown),
			prompt: createSectionGenerationPrompt(lane.sourceMarkdown, lane.title),
		});
	}

	return sections;
};

const plainTextFromMarkdown = (markdown: string) =>
	markdown
		.split("\n")
		.map((line) =>
			line
				.replace(/^#{1,6}\s+/, "")
				.replace(/!\[[^\]]*\]\((?:<[^>]+>|[^\s)]+)\)/gu, "")
				.replace(/@\[((?:\\.|[^\]\\])*)\]\((?:<[^>]+>|[^\s)]+)\)/gu, "$1")
				.replace(/\*\*/g, "")
				.trim(),
		)
		.filter(Boolean)
		.join("\n")
		.trim();
