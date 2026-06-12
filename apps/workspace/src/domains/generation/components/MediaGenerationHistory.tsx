import { Check, Clipboard, FileText, Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import type React from "react";
import type { GenerationKind } from "@/domains/generation/api/generation";
import { GenerationVideoThumbnail } from "@/domains/generation/components/GenerationVideoThumbnail";
import {
	entryGeneratedAssets,
	entryPromptText,
	entrySelectionState,
	historySelectionText,
	isFailedGenerationStatus,
	isPendingGenerationStatus,
} from "@/domains/generation/components/mediaGenerationHelpers";
import { Button } from "@/shared/components/ui/button";
import {
	generationAssetSource,
	generationStatusLabel,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export const HistoryGenerationList: React.FC<{
	activeEntryId: string | null;
	deletingEntryIds: string[];
	defaultSourceLabel?: string;
	entries: GenerationEntry[];
	kind: GenerationKind;
	onCopyPrompt?: (entry: GenerationEntry) => void;
	onDeleteEntry: (entry: GenerationEntry) => void;
	onSelectEntry: (entry: GenerationEntry) => void;
	selectedAssetKeys: string[];
}> = ({
	activeEntryId,
	deletingEntryIds,
	defaultSourceLabel,
	entries,
	kind,
	onCopyPrompt,
	onDeleteEntry,
	onSelectEntry,
	selectedAssetKeys,
}) => {
	if (entries.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
				暂无生成历史。
			</div>
		);
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
			<div className="grid gap-2">
				{entries.map((entry) => (
					<HistoryGenerationItem
						key={entry.id}
						entry={entry}
						defaultSourceLabel={defaultSourceLabel}
						isDeleting={deletingEntryIds.includes(entry.id)}
						kind={kind}
						selected={entry.id === activeEntryId}
						selectedAssetKeys={selectedAssetKeys}
						onCopyPrompt={onCopyPrompt ? () => onCopyPrompt(entry) : undefined}
						onDelete={() => onDeleteEntry(entry)}
						onSelect={() => onSelectEntry(entry)}
					/>
				))}
			</div>
		</div>
	);
};

const HistoryGenerationItem: React.FC<{
	defaultSourceLabel?: string;
	entry: GenerationEntry;
	isDeleting: boolean;
	kind: GenerationKind;
	onCopyPrompt?: () => void;
	onDelete: () => void;
	onSelect: () => void;
	selected: boolean;
	selectedAssetKeys: string[];
}> = ({
	defaultSourceLabel,
	entry,
	isDeleting,
	kind,
	onCopyPrompt,
	onDelete,
	onSelect,
	selected,
	selectedAssetKeys,
}) => {
	const generatedAssets = entryGeneratedAssets(entry, kind);
	const thumbnail = generatedAssets[0];
	const source = thumbnail ? generationAssetSource(thumbnail) : "";
	const loading = isPendingGenerationStatus(entry.status);
	const failed = isFailedGenerationStatus(entry.status);
	const errorMessage = failed ? entryErrorText(entry) : "";
	const selection = entrySelectionState(generatedAssets, selectedAssetKeys);
	const sourceBadge = generationSourceBadge(defaultSourceLabel);
	const timeSummary = generationTimeSummary(entry, loading);

	return (
		<article
			className={cn(
				"group/history-item relative min-h-20 min-w-0 max-w-full rounded-sm border bg-card transition-colors",
				selected ? "border-primary" : "border-border hover:border-input",
				failed && !selected && "border-error-border hover:border-error-border",
			)}
		>
			<button
				type="button"
				className="flex w-full min-w-0 items-stretch gap-2 p-2 pr-10 text-left"
				onClick={onSelect}
			>
				<div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted">
					{source && thumbnail?.kind === "video" ? (
						<GenerationVideoThumbnail source={source} />
					) : source ? (
						<img src={source} alt="" className="size-full object-cover" />
					) : loading ? (
						<Loader2 className="size-4 animate-spin text-muted-foreground" />
					) : (
						<ImageIcon className="size-4 text-muted-foreground" />
					)}
				</div>
				<div className="min-w-0 flex-1 py-0.5">
					<div className="flex min-w-0 items-center gap-2">
						<span className="inline-flex min-w-0 items-center gap-2">
							<span
								className={cn(
									"truncate text-xs font-medium text-foreground",
									failed && "text-error-foreground",
								)}
								title={errorMessage || undefined}
							>
								{entry.status ? generationStatusLabel(entry.status) : "生成结果"}
							</span>
							<span
								className={cn(
									"shrink-0 text-xs text-muted-foreground",
									failed && "text-error-foreground",
								)}
							>
								{generatedAssets.length} {kind === "image" ? "张" : "个"}
							</span>
						</span>
						{selection.selectedCount > 0 ? (
							<span className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-primary">
								<Check className="size-3" />
								{historySelectionText(selection)}
							</span>
						) : null}
					</div>
					<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
						{entryPromptText(entry) || "无提示词"}
					</p>
					{sourceBadge || timeSummary ? (
						<div className="mt-1 flex min-w-0 items-center gap-2">
							{sourceBadge ? (
								<HistorySourceBadge badge={sourceBadge} className="min-w-0 flex-1" />
							) : null}
							{timeSummary ? (
								<span className="ml-auto shrink-0 whitespace-nowrap text-2xs leading-4 text-muted-foreground">
									{timeSummary}
								</span>
							) : null}
						</div>
					) : null}
				</div>
			</button>
			{onCopyPrompt ? (
				<HistoryIconButton
					ariaLabel="复制这条提示词"
					className="absolute right-10 top-2"
					title="复制提示词"
					onClick={onCopyPrompt}
				>
					<Clipboard className="size-3.5" />
				</HistoryIconButton>
			) : null}
			<DeleteEntryButton
				className="absolute right-2 top-2"
				isDeleting={isDeleting}
				onDelete={onDelete}
			/>
			{errorMessage ? <HistoryErrorTooltip message={errorMessage} /> : null}
		</article>
	);
};

const HistoryErrorTooltip: React.FC<{ message: string }> = ({ message }) => (
	<span
		role="tooltip"
		className="pointer-events-none absolute left-2 right-2 top-[calc(100%-0.25rem)] z-40 hidden rounded-sm border border-error-border bg-popover px-2.5 py-2 text-left text-xs leading-5 text-error-foreground shadow-lg group-hover/history-item:block group-focus-within/history-item:block"
	>
		<span className="line-clamp-6 whitespace-pre-wrap">{message}</span>
	</span>
);

const entryErrorText = (entry: GenerationEntry) =>
	entry.error?.trim() || entry.content.trim() || "生成失败，暂无错误详情。";

interface GenerationSourceBadge {
	label: string;
}

const HistorySourceBadge: React.FC<{ badge: GenerationSourceBadge; className?: string }> = ({
	badge,
	className,
}) => {
	return (
		<span
			className={cn(
				"inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium",
				"border-border bg-ide-toolbar text-muted-foreground",
				className,
			)}
			title={badge.label}
		>
			<FileText className="size-3 shrink-0" />
			<span className="truncate">{badge.label}</span>
		</span>
	);
};

const generationSourceBadge = (defaultSourceLabel?: string): GenerationSourceBadge | null => {
	if (defaultSourceLabel) return { label: defaultSourceLabel };

	return null;
};

const generationTimeSummary = (entry: GenerationEntry, running: boolean) => {
	const timeText = formatGenerationTime(entry.createdAt);
	if (!timeText) return "";

	const durationMs = generationDurationMs(entry, running);
	if (durationMs === null) return `生成 ${timeText}`;

	return `生成 ${timeText} · ${running ? "已用" : "用时"} ${formatGenerationDuration(durationMs)}`;
};

const generationDurationMs = (entry: GenerationEntry, running: boolean) => {
	if (typeof entry.durationMs === "number" && entry.durationMs >= 0) return entry.durationMs;
	if (!running || !entry.createdAt) return null;

	const startedAt = Date.parse(entry.createdAt);
	if (Number.isNaN(startedAt)) return null;

	return Math.max(0, Date.now() - startedAt);
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

const formatGenerationDuration = (valueMs: number) => {
	if (!Number.isFinite(valueMs) || valueMs < 1000) return "1 秒";

	const totalSeconds = Math.round(valueMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds} 秒`;

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours === 0) return `${minutes} 分 ${seconds} 秒`;

	return `${hours} 小时 ${remainingMinutes} 分`;
};

const DeleteEntryButton: React.FC<{
	className?: string;
	isDeleting: boolean;
	onDelete: () => void;
}> = ({ className, isDeleting, onDelete }) => (
	<HistoryIconButton
		ariaLabel="删除这条生成记录"
		className={className}
		disabled={isDeleting}
		title="删除生成记录"
		onClick={onDelete}
	>
		{isDeleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
	</HistoryIconButton>
);

const HistoryIconButton: React.FC<{
	ariaLabel: string;
	children: React.ReactNode;
	className?: string;
	disabled?: boolean;
	onClick: () => void;
	title: string;
}> = ({ ariaLabel, children, className, disabled, onClick, title }) => (
	<Button
		type="button"
		variant="ghost"
		size="icon"
		disabled={disabled}
		className={cn(
			"size-7 rounded-sm border border-input bg-card/90 text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground",
			className,
		)}
		aria-label={ariaLabel}
		title={title}
		onClick={(event) => {
			event.stopPropagation();
			onClick();
		}}
	>
		{children}
	</Button>
);
