import { FileText, Film, Image as ImageIcon, Loader2 } from "lucide-react";
import type React from "react";
import {
	generationAssetSource,
	generationStatusLabel,
	kindLabel,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { GenerationVideoThumbnail } from "@/domains/generation/components/GenerationVideoThumbnail";
import { cn } from "@/shared/lib/utils";

export const GenerationHistoryPanel: React.FC<{
	activeEntryId?: string | null;
	className?: string;
	entries: GenerationEntry[];
	onSelectEntry: (id: string) => void;
	title?: string;
}> = ({ activeEntryId, className, entries, onSelectEntry, title = "历史生成" }) => (
	<section className={cn("flex min-h-0 flex-col bg-ide-panel", className)}>
		<div className="shrink-0 border-b border-border px-4 py-3">
			<p className="text-sm font-semibold text-foreground">{title}</p>
		</div>
		{entries.length === 0 ? (
			<div className="flex min-h-44 flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
				暂无生成历史。
			</div>
		) : (
			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				<div className="grid gap-2">
					{entries.map((entry) => (
						<GenerationHistoryItem
							key={entry.id}
							entry={entry}
							selected={entry.id === activeEntryId}
							onSelect={() => onSelectEntry(entry.id)}
						/>
					))}
				</div>
			</div>
		)}
	</section>
);

const GenerationHistoryItem: React.FC<{
	entry: GenerationEntry;
	onSelect: () => void;
	selected: boolean;
}> = ({ entry, onSelect, selected }) => {
	const thumbnail = entry.assets?.find((asset) => generationAssetSource(asset));
	const source = thumbnail ? generationAssetSource(thumbnail) : "";
	const isLoading = entry.status === "loading";

	return (
		<button
			type="button"
			className={cn(
				"flex w-full gap-3 rounded-sm border p-2 text-left transition-colors",
				selected
					? "border-primary bg-primary/10"
					: "border-border bg-ide-editor hover:bg-ide-list-hover",
			)}
			onClick={onSelect}
		>
			<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-ide-toolbar">
				{isLoading ? (
					<Loader2 className="size-4 animate-spin text-muted-foreground" />
				) : source && thumbnail?.kind === "image" ? (
					<img src={source} alt="" className="size-full object-cover" />
				) : source && thumbnail?.kind === "video" ? (
					<GenerationVideoThumbnail source={source} />
				) : entry.kind === "image" ? (
					<ImageIcon className="size-4 text-muted-foreground" />
				) : entry.kind === "text" ? (
					<FileText className="size-4 text-muted-foreground" />
				) : (
					<Film className="size-4 text-muted-foreground" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-foreground">{kindLabel(entry.kind)}</span>
					{entry.status ? (
						<span className="text-xs text-muted-foreground">
							{generationStatusLabel(entry.status)}
						</span>
					) : null}
				</div>
				<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
					{entry.prompt || entry.content}
				</p>
			</div>
		</button>
	);
};
