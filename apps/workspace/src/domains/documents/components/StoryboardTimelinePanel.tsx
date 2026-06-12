import { Captions, ChevronLeft, ChevronRight, Film, Image, Mic2, Music2 } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { createEpisodeFromMarkdownDocument } from "@/domains/episode/lib/from-markdown";
import {
	formatTimelineTime,
	type EpisodeSection,
	type TimelineClip,
	type TimelineTrackType,
} from "@/domains/episode/lib/sample";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { cn } from "@/shared/lib/utils";

interface StoryboardTimelinePanelProps {
	documentContent: string;
	documentId?: string;
	documentTitle?: string;
}

const previewTrackTypes = ["video", "voiceover", "caption"] as const;
const autoTrackTypes = ["music", "asset"] as const;

const trackMeta: Record<
	TimelineTrackType,
	{
		empty: string;
		icon: React.ComponentType<{ className?: string }>;
		label: string;
	}
> = {
	video: {
		icon: Film,
		label: "video",
		empty: "未填写视觉描述",
	},
	voiceover: {
		icon: Mic2,
		label: "voiceover",
		empty: "未填写旁白",
	},
	caption: {
		icon: Captions,
		label: "caption",
		empty: "未填写对白字幕",
	},
	music: {
		icon: Music2,
		label: "music",
		empty: "自动铺底",
	},
	asset: {
		icon: Image,
		label: "asset",
		empty: "自动标记",
	},
};

export const StoryboardTimelinePanel: React.FC<StoryboardTimelinePanelProps> = ({
	documentContent,
	documentId = "storyboard-panel",
	documentTitle = "分镜脚本",
}) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const episode = useMemo(
		() =>
			createEpisodeFromMarkdownDocument(
				createStoryboardDocument(documentId, documentTitle, documentContent),
			),
		[documentContent, documentId, documentTitle],
	);

	return (
		<aside
			className={cn(
				"hidden h-full min-h-0 shrink-0 flex-col border-l border-border bg-ide-panel text-ide-panel-foreground md:flex",
				isExpanded ? "w-80" : "w-11",
			)}
		>
			<header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-ide-toolbar px-2 text-ide-toolbar-foreground">
				{isExpanded ? (
					<>
						<div className="min-w-0">
							<h2 className="truncate text-sm font-semibold text-foreground">分镜同步</h2>
							<p className="truncate text-xs text-muted-foreground">
								{episode.sections.length} 个组 · {formatTimelineTime(episode.duration)}
							</p>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 rounded-sm"
							aria-label="折叠分镜同步面板"
							onClick={() => setIsExpanded(false)}
						>
							<ChevronRight />
						</Button>
					</>
				) : (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-7 rounded-sm"
						aria-label="展开分镜同步面板"
						onClick={() => setIsExpanded(true)}
					>
						<ChevronLeft />
					</Button>
				)}
			</header>

			{isExpanded ? (
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					<div className="mb-2 flex flex-wrap gap-1">
						{autoTrackTypes.map((type) => {
							const TrackIcon = trackMeta[type].icon;
							return (
								<Badge key={type} variant="outline" className="gap-1">
									<TrackIcon className="size-3" />
									{trackMeta[type].label}
								</Badge>
							);
						})}
					</div>
					{episode.sections.length > 0 ? (
						<div className="space-y-2">
							{episode.sections.map((section, index) => (
								<StoryboardSectionSummary
									key={section.id}
									episodeSection={section}
									index={index}
									clipsByTrack={clipsForSection(episode, section)}
								/>
							))}
						</div>
					) : (
						<p className="py-3 text-xs text-muted-foreground">还没有识别到 `## 第 0N 组`。</p>
					)}
				</div>
			) : null}
		</aside>
	);
};

interface StoryboardSectionSummaryProps {
	clipsByTrack: Partial<Record<(typeof previewTrackTypes)[number], TimelineClip>>;
	episodeSection: EpisodeSection;
	index: number;
}

const StoryboardSectionSummary: React.FC<StoryboardSectionSummaryProps> = ({
	clipsByTrack,
	episodeSection,
	index,
}) => (
	<article className="border border-border bg-ide-editor p-2">
		<div className="mb-2 flex items-start justify-between gap-2">
			<div className="min-w-0">
				<h3 className="truncate text-xs font-semibold text-foreground">
					{episodeSection.title || `第 ${String(index + 1).padStart(2, "0")} 组`}
				</h3>
				<p className="mt-0.5 text-caption text-muted-foreground">
					{formatTimelineTime(episodeSection.start)} - {formatTimelineTime(episodeSection.end)}
				</p>
			</div>
			<Badge variant="secondary" className="shrink-0 tabular-nums">
				{index + 1}
			</Badge>
		</div>
		<div className="space-y-1.5">
			{previewTrackTypes.map((type) => (
				<TrackSummary key={type} clip={clipsByTrack[type]} type={type} />
			))}
		</div>
	</article>
);

interface TrackSummaryProps {
	clip?: TimelineClip;
	type: (typeof previewTrackTypes)[number];
}

const TrackSummary: React.FC<TrackSummaryProps> = ({ clip, type }) => {
	const TrackIcon = trackMeta[type].icon;
	const content = clip?.content.trim() || trackMeta[type].empty;

	return (
		<div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 text-xs">
			<div className="flex min-w-0 items-center gap-1 text-muted-foreground">
				<TrackIcon className="size-3.5 shrink-0" />
				<span className="truncate">{trackMeta[type].label}</span>
			</div>
			<p
				className={cn(
					"line-clamp-2 min-w-0 leading-5",
					clip ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{content}
			</p>
		</div>
	);
};

const clipsForSection = (
	episode: ReturnType<typeof createEpisodeFromMarkdownDocument>,
	section: EpisodeSection,
) =>
	Object.fromEntries(
		previewTrackTypes.map((type) => [
			type,
			episode.tracks
				.find((track) => track.type === type)
				?.clips.find((clip) => clip.start === section.start && clip.end === section.end),
		]),
	) as Partial<Record<(typeof previewTrackTypes)[number], TimelineClip>>;

const createStoryboardDocument = (
	id: string,
	title: string,
	content: string,
): MarkdownDocument => ({
	id,
	title,
	content,
	category: "storyboard",
	parentId: null,
	sortOrder: 0,
	tags: [],
	version: 1,
	updatedAt: "",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});
