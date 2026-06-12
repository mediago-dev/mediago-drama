import { Clock3, FileText, MonitorPlay, WandSparkles } from "lucide-react";
import type React from "react";
import { Badge } from "@/shared/components/ui/badge";
import { formatTimelineTime, type Episode, type TimelineClip } from "@/domains/episode/lib/sample";

interface EpisodeInspectorProps {
	episode: Episode;
	selectedClip: TimelineClip | null;
}

export const EpisodeInspector: React.FC<EpisodeInspectorProps> = ({ episode, selectedClip }) => {
	if (!selectedClip) {
		return (
			<aside className="flex h-full min-h-0 flex-col border-l border-border bg-ide-panel text-ide-panel-foreground">
				<div className="border-b border-border bg-ide-toolbar px-2 py-2">
					<h2 className="text-sm font-semibold text-foreground">检查器</h2>
				</div>
				<div className="grid flex-1 place-items-center px-4 text-center text-xs text-muted-foreground">
					选择时间线片段后查看剧本、提示词和来源。
				</div>
			</aside>
		);
	}

	return (
		<aside className="flex h-full min-h-0 flex-col border-l border-border bg-ide-panel text-ide-panel-foreground">
			<div className="border-b border-border bg-ide-toolbar px-2 py-2">
				<p className="text-xs font-medium text-muted-foreground">检查器</p>
				<h2 className="truncate text-sm font-semibold text-foreground">{selectedClip.title}</h2>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-2">
				<div className="flex flex-wrap gap-1.5">
					<Badge variant="outline">{clipStatusLabel[selectedClip.status]}</Badge>
					<Badge variant="secondary">
						{formatTimelineTime(selectedClip.start)} - {formatTimelineTime(selectedClip.end)}
					</Badge>
					<Badge variant="outline">{episode.aspectRatio}</Badge>
				</div>

				<InspectorBlock icon={FileText} label="内容" value={selectedClip.content} />
				<InspectorBlock
					icon={WandSparkles}
					label="提示词"
					value={selectedClip.prompt ?? "未附加生成提示词。"}
				/>
				<InspectorBlock icon={MonitorPlay} label="来源" value={selectedClip.source ?? "时间线"} />
				<InspectorBlock
					icon={Clock3}
					label="时长"
					value={`${Math.round(selectedClip.end - selectedClip.start)} 秒`}
				/>
			</div>
		</aside>
	);
};

interface InspectorBlockProps {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
}

const InspectorBlock: React.FC<InspectorBlockProps> = ({ icon: Icon, label, value }) => (
	<section className="space-y-1.5">
		<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
			<Icon className="size-3.5" />
			<span>{label}</span>
		</div>
		<p className="border border-border bg-ide-toolbar px-2 py-1.5 text-xs leading-5 text-foreground">
			{value}
		</p>
	</section>
);

const clipStatusLabel = {
	draft: "草稿",
	generating: "生成中",
	ready: "就绪",
	error: "错误",
};
