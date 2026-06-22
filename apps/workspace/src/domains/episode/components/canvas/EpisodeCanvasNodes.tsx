import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	FileText,
	Film,
	Image,
	Loader2,
	Play,
	Quote,
	Sparkles,
	Users,
	Video,
} from "lucide-react";
import type React from "react";
import { GenerationVideoThumbnail } from "@/domains/generation/components/GenerationVideoThumbnail";
import type { TimelineCompanionTrackType } from "@/domains/episode/stores";
import type {
	EpisodeCanvasNodeData,
	EpisodeCanvasNodeType,
	EpisodeCanvasReference,
} from "@/domains/episode/lib/canvas-graph";
import {
	episodeCanvasMediaTypeTokens,
	getCanvasNodePorts,
	type EpisodeCanvasPort,
	type EpisodeCanvasPortSide,
} from "@/domains/episode/lib/canvas-ports";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export interface EpisodeCanvasFlowNodeData extends EpisodeCanvasNodeData {
	canGenerateReferenceImage?: boolean;
	canGenerateScene?: boolean;
	canGenerateStoryboardImage?: boolean;
	isSelected?: boolean;
	onGenerateClip?: (clipId: string) => void;
	onGenerateReferenceImage?: () => void;
	onGenerateScene?: (laneId: string) => void;
	onGenerateStoryboardImage?: (laneId: string) => void;
	onRequestCompanionGeneration?: (clipId: string, trackType: TimelineCompanionTrackType) => void;
}

const nodeWidth = "w-72";

export const ReferencePromptNode: React.FC<NodeProps> = (props) => {
	const data = canvasNodeData(props);
	return (
		<CanvasNodeFrame data={data} icon={<FileText className="size-4" />}>
			<div className="rounded-sm border border-border bg-muted p-3">
				<p className="whitespace-pre-line text-xs leading-5 text-foreground">
					{data.body || "暂无提示词"}
				</p>
			</div>
		</CanvasNodeFrame>
	);
};

export const ReferenceImageNode: React.FC<NodeProps> = (props) => {
	const data = canvasNodeData(props);
	return (
		<CanvasNodeFrame data={data} icon={<Image className="size-4" />}>
			{data.imageUrl ? (
				<img
					alt={data.title}
					className="mx-auto mb-2 max-h-56 max-w-full rounded-sm border border-border object-contain"
					src={data.imageUrl}
				/>
			) : (
				<div className="mb-2 grid h-28 w-full place-items-center rounded-sm border border-dashed border-border bg-muted text-muted-foreground">
					<Image className="size-6" />
				</div>
			)}
			<div className="mt-3 flex items-center justify-between gap-2">
				<span className="truncate text-[0.68rem] text-muted-foreground">
					{data.reference?.category === "scene" ? "场景生成" : "素材生成"}
				</span>
				<div className="flex shrink-0 gap-1.5">
					<NodeActionButton
						disabled={!data.canGenerateReferenceImage}
						label="生成"
						onClick={() => data.onGenerateReferenceImage?.()}
					>
						<Sparkles className="size-3.5" />
					</NodeActionButton>
				</div>
			</div>
		</CanvasNodeFrame>
	);
};

export const PerformanceNode: React.FC<NodeProps> = (props) => {
	const data = canvasNodeData(props);
	const clipId = data.clipId;

	return (
		<CanvasNodeFrame data={data} icon={<Users className="size-4" />}>
			<ReferenceChips references={data.references} />
			<p className="mt-2 max-h-16 overflow-hidden whitespace-pre-line text-xs leading-5 text-foreground">
				{data.body}
			</p>
			{clipId ? (
				<div className="mt-3 flex gap-1.5">
					<NodeActionButton
						label="旁白"
						onClick={() => data.onRequestCompanionGeneration?.(clipId, "voiceover")}
					>
						<Quote className="size-3.5" />
					</NodeActionButton>
					<NodeActionButton
						label="字幕"
						onClick={() => data.onRequestCompanionGeneration?.(clipId, "caption")}
					>
						<FileText className="size-3.5" />
					</NodeActionButton>
				</div>
			) : null}
		</CanvasNodeFrame>
	);
};

export const TextStoryboardNode: React.FC<NodeProps> = (props) => {
	const data = canvasNodeData(props);
	const shots = data.shots ?? [];

	return (
		<CanvasNodeFrame data={data} icon={<FileText className="size-4" />}>
			<div className="space-y-2">
				{shots.length > 0 ? (
					shots.slice(0, 3).map((shot) => (
						<div key={`${shot.title}-${shot.text}`} className="rounded-sm bg-muted px-2 py-1.5">
							<div className="flex items-center justify-between gap-2 text-[0.68rem] font-medium text-foreground">
								<span className="truncate">{shot.title}</span>
								{shot.durationLabel ? (
									<span className="shrink-0 tabular-nums text-muted-foreground">
										{shot.durationLabel}
									</span>
								) : null}
							</div>
							<p className="mt-1 line-clamp-2 text-[0.68rem] leading-4 text-muted-foreground">
								{[shot.shotSize, shot.perspective, shot.cameraMove, shot.text]
									.filter(Boolean)
									.join(" / ")}
							</p>
						</div>
					))
				) : (
					<p className="max-h-24 overflow-hidden whitespace-pre-line text-xs leading-5 text-foreground">
						{data.body}
					</p>
				)}
			</div>
		</CanvasNodeFrame>
	);
};

export const VideoPromptNode: React.FC<NodeProps> = (props) => {
	const data = canvasNodeData(props);
	const shots = data.shots ?? [];

	return (
		<CanvasNodeFrame data={data} icon={<FileText className="size-4" />}>
			<div className="space-y-2">
				{shots.length > 0 ? (
					shots.map((shot) => (
						<div key={`${shot.title}-${shot.text}`} className="rounded-sm bg-muted px-2 py-1.5">
							<div className="flex items-center justify-between gap-2 text-[0.68rem] font-medium text-foreground">
								<span className="truncate">{shot.title}</span>
								{shot.durationLabel ? (
									<span className="shrink-0 tabular-nums text-muted-foreground">
										{shot.durationLabel}
									</span>
								) : null}
							</div>
							<p className="mt-1 whitespace-pre-line text-[0.68rem] leading-4 text-muted-foreground">
								{shot.prompt ||
									[shot.shotSize, shot.perspective, shot.cameraMove, shot.text]
										.filter(Boolean)
										.join(" / ")}
							</p>
						</div>
					))
				) : (
					<p className="whitespace-pre-line text-xs leading-5 text-foreground">{data.body}</p>
				)}
			</div>
		</CanvasNodeFrame>
	);
};

export const StoryboardImageNode: React.FC<NodeProps> = (props) => {
	const data = canvasNodeData(props);

	return (
		<CanvasNodeFrame data={data} icon={<Film className="size-4" />}>
			{data.imageUrl ? (
				<img
					alt={data.title}
					className="h-20 w-full rounded-sm border border-border object-cover"
					src={data.imageUrl}
				/>
			) : (
				<div className="grid h-20 w-full place-items-center rounded-sm border border-dashed border-border bg-muted text-muted-foreground">
					<Film className="size-5" />
				</div>
			)}
			<div className="mt-3 flex items-center justify-between gap-2">
				<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{data.body}</p>
				<NodeActionButton
					disabled={!data.canGenerateStoryboardImage}
					label="生成"
					onClick={() => data.onGenerateStoryboardImage?.(data.laneId)}
				>
					<Sparkles className="size-3.5" />
				</NodeActionButton>
			</div>
		</CanvasNodeFrame>
	);
};

export const VideoOutputNode: React.FC<NodeProps> = (props) => {
	const data = canvasNodeData(props);
	const clipId = data.clipId;

	return (
		<CanvasNodeFrame data={data} icon={<Video className="size-4" />}>
			<div className="relative aspect-video w-full overflow-hidden rounded-sm border border-border bg-muted">
				{data.imageUrl ? (
					<img alt={data.title} className="size-full object-cover" src={data.imageUrl} />
				) : data.videoUrl ? (
					<GenerationVideoThumbnail source={data.videoUrl} />
				) : (
					<div className="grid size-full place-items-center text-muted-foreground">
						<Video className="size-5" />
					</div>
				)}
			</div>
			<div className="mt-3 flex items-center justify-between gap-2">
				<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{data.body}</p>
				{clipId ? (
					<div className="flex shrink-0 gap-1.5">
						<NodeActionButton label="生成" onClick={() => data.onGenerateClip?.(clipId)}>
							<Play className="size-3.5" />
						</NodeActionButton>
					</div>
				) : null}
			</div>
		</CanvasNodeFrame>
	);
};

const CanvasNodeFrame: React.FC<{
	children: React.ReactNode;
	data: EpisodeCanvasFlowNodeData;
	icon: React.ReactNode;
}> = ({ children, data, icon }) => (
	<div
		className={cn(
			nodeWidth,
			"relative rounded-lg border bg-ide-panel p-3 text-foreground shadow-sm transition-[border-color,box-shadow]",
			data.isSelected
				? "border-primary shadow-[0_0_0_2px_var(--accent)]"
				: "border-border hover:border-primary/60",
		)}
		data-testid={`episode-canvas-node-${data.nodeType}-${data.clipId ?? data.laneId}`}
	>
		<CanvasPortHandles data={data} side="input" />
		<CanvasPortHandles data={data} side="output" />
		<div className="mb-2 flex items-start justify-between gap-2">
			<div className="flex min-w-0 items-center gap-2">
				<div className="grid size-7 shrink-0 place-items-center rounded-sm border border-border bg-muted text-foreground">
					{icon}
				</div>
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold">{data.title}</div>
					<div className="truncate text-[0.68rem] text-muted-foreground">{data.subtitle}</div>
				</div>
			</div>
			<StatusPill data={data} />
		</div>
		{children}
	</div>
);

const CanvasPortHandles: React.FC<{
	data: EpisodeCanvasFlowNodeData;
	side: EpisodeCanvasPortSide;
}> = ({ data, side }) => {
	const ports =
		side === "input"
			? getCanvasNodePorts(data.nodeType).inputs
			: getCanvasNodePorts(data.nodeType).outputs;

	return (
		<>
			{ports.map((port, index) => (
				<CanvasPortHandle
					key={port.id}
					index={index}
					port={port}
					side={side}
					total={ports.length}
				/>
			))}
		</>
	);
};

const CanvasPortHandle: React.FC<{
	index: number;
	port: EpisodeCanvasPort;
	side: EpisodeCanvasPortSide;
	total: number;
}> = ({ index, port, side, total }) => {
	const tokens = episodeCanvasMediaTypeTokens[port.mediaType];
	const top = `${portTopPercent(index, total)}%`;
	const isInput = side === "input";

	return (
		<>
			<Handle
				id={port.id}
				className="!size-3 !border-2 !border-background"
				position={isInput ? Position.Left : Position.Right}
				style={{
					background: tokens.foreground,
					top,
				}}
				type={isInput ? "target" : "source"}
			/>
			<span
				className={cn(
					"pointer-events-none absolute z-10 max-w-24 -translate-y-1/2 truncate rounded-sm border px-1.5 py-0.5 text-[0.62rem] font-medium shadow-sm",
					isInput
						? "left-0 -translate-x-[calc(100%+0.45rem)]"
						: "right-0 translate-x-[calc(100%+0.45rem)]",
				)}
				style={{
					background: tokens.surface,
					borderColor: tokens.border,
					color: tokens.foreground,
					top,
				}}
			>
				{port.label}
			</span>
		</>
	);
};

const portTopPercent = (index: number, total: number) => {
	if (total <= 1) return 50;
	const step = 32 / Math.max(total - 1, 1);
	return 34 + index * step;
};

const StatusPill: React.FC<{ data: EpisodeCanvasFlowNodeData }> = ({ data }) => {
	const status = data.status ?? "draft";
	const Icon = statusIcon(status);

	return (
		<div
			className={cn(
				"inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[0.65rem] font-medium",
				statusClassName(status),
			)}
		>
			<Icon className={cn("size-3", status === "generating" && "animate-spin")} />
			<span>{statusLabel(status)}</span>
		</div>
	);
};

const ReferenceChips: React.FC<{ references?: EpisodeCanvasReference[] }> = ({ references }) => {
	const visible = references?.slice(0, 3) ?? [];
	if (visible.length === 0) return null;

	return (
		<div className="flex flex-wrap gap-1">
			{visible.map((reference) => (
				<span
					key={reference.key}
					className="max-w-full truncate rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[0.68rem] text-muted-foreground"
				>
					@{reference.title}
				</span>
			))}
		</div>
	);
};

const NodeActionButton: React.FC<{
	children: React.ReactNode;
	disabled?: boolean;
	label: string;
	onClick: () => void;
}> = ({ children, disabled = false, label, onClick }) => (
	<Button
		aria-label={label}
		className="h-7 rounded-sm px-2 text-[0.68rem]"
		disabled={disabled}
		size="sm"
		type="button"
		variant="secondary"
		onClick={(event) => {
			event.stopPropagation();
			onClick();
		}}
	>
		{children}
		<span>{label}</span>
	</Button>
);

const canvasNodeData = (props: NodeProps): EpisodeCanvasFlowNodeData =>
	props.data as EpisodeCanvasFlowNodeData;

const statusIcon = (status: EpisodeCanvasFlowNodeData["status"]) => {
	if (status === "ready") return CheckCircle2;
	if (status === "generating") return Loader2;
	if (status === "error") return AlertTriangle;
	return Circle;
};

const statusLabel = (status: EpisodeCanvasFlowNodeData["status"]) => {
	if (status === "ready") return "就绪";
	if (status === "generating") return "生成中";
	if (status === "error") return "异常";
	return "草稿";
};

const statusClassName = (status: EpisodeCanvasFlowNodeData["status"]) => {
	if (status === "ready") return "border-success-border bg-success-surface text-success-foreground";
	if (status === "generating") return "border-info-border bg-info-surface text-info-foreground";
	if (status === "error") return "border-error-border bg-error-surface text-error-foreground";
	return "border-border bg-muted text-muted-foreground";
};

export const episodeCanvasNodeTypes: Record<EpisodeCanvasNodeType, React.FC<NodeProps>> = {
	performance: PerformanceNode,
	"reference-image": ReferenceImageNode,
	"reference-prompt": ReferencePromptNode,
	"storyboard-image": StoryboardImageNode,
	"text-storyboard": TextStoryboardNode,
	"video-prompt": VideoPromptNode,
	"video-output": VideoOutputNode,
};
