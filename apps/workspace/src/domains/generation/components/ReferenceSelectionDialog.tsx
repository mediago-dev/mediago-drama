import { AudioLines, Check, Film, Loader2, Pause, Play, UploadCloud } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GenerationDialogShell } from "@/domains/generation/components/GenerationDialogShell";
import {
	buildGeneratedReferenceOptions,
	entryPromptText,
	type GeneratedReferenceOption,
} from "@/domains/generation/components/mediaGenerationHelpers";
import { GenerationVideoThumbnail } from "@/domains/generation/components/GenerationVideoThumbnail";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { generationStatusLabel } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

export interface ReferenceSelectionDialogProps {
	acceptedFileTypes?: string;
	disabled: boolean;
	entries: GenerationEntry[];
	inputId: string;
	isUploading: boolean;
	mediaAssets: MediaAsset[];
	onOpenChange: (open: boolean) => void;
	onRefreshAssets?: () => void;
	onRemoveReference: (asset: MediaAsset) => void;
	onToggleReference: (asset: MediaAsset) => void;
	onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
	open: boolean;
	references: MediaAsset[];
	requiresReference: boolean;
	selectableKinds: Set<MediaAsset["kind"]>;
	selectedAssetIds: string[];
	selectedShortcutAssetIds?: string[];
	shortcutGroups?: ReferenceSelectionShortcutGroup[];
	title?: string;
	visibleKindFilters?: ReferenceKindFilter[];
	onToggleShortcutReference?: (asset: MediaAsset) => void;
}

export interface ReferenceSelectionShortcutItem {
	asset: MediaAsset;
	subtitle?: string;
	title: string;
}

export interface ReferenceSelectionShortcutGroup {
	description?: string;
	id: string;
	items: ReferenceSelectionShortcutItem[];
	title: string;
}

interface ReferenceSelectionDialogController {
	acceptedFileTypes: string;
	disabled: boolean;
	inputId: string;
	isUploading: boolean;
	kindFilters: ReferenceKindFilter[];
	onOpenChange: (open: boolean) => void;
	onRemoveReference: (asset: MediaAsset) => void;
	onToggleReference: (asset: MediaAsset) => void;
	onToggleShortcutReference?: (asset: MediaAsset) => void;
	onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
	open: boolean;
	optionCounts: Record<ReferenceKindFilter, number>;
	options: GeneratedReferenceOption[];
	references: MediaAsset[];
	requiresReference: boolean;
	selectableKinds: Set<MediaAsset["kind"]>;
	selectedAssetIds: string[];
	selectedShortcutAssetIds: Set<string>;
	shortcutGroups: ReferenceSelectionShortcutGroup[];
	title: string;
	visibleOptions: GeneratedReferenceOption[];
	kindFilter: ReferenceKindFilter;
	onKindFilterChange: (value: ReferenceKindFilter) => void;
}

export const ReferenceSelectionDialog: React.FC<ReferenceSelectionDialogProps> = (props) => {
	const controller = useReferenceSelectionDialogController(props);
	return <ReferenceSelectionDialogView controller={controller} />;
};

const useReferenceSelectionDialogController = ({
	acceptedFileTypes = "image/*,video/*,audio/*",
	disabled,
	entries,
	inputId,
	isUploading,
	mediaAssets,
	onOpenChange,
	onRefreshAssets,
	onRemoveReference,
	onToggleReference,
	onToggleShortcutReference,
	onUpload,
	open,
	references,
	requiresReference,
	selectableKinds,
	selectedAssetIds,
	selectedShortcutAssetIds = [],
	shortcutGroups = [],
	title = "选择参考图",
	visibleKindFilters,
}: ReferenceSelectionDialogProps): ReferenceSelectionDialogController => {
	const kindFilters = useMemo(
		() => normalizeReferenceKindFilters(visibleKindFilters),
		[visibleKindFilters],
	);
	const [kindFilter, setKindFilter] = useState<ReferenceKindFilter>(kindFilters[0] ?? "all");
	const options = useMemo(
		() => buildGeneratedReferenceOptions(entries, mediaAssets),
		[entries, mediaAssets],
	);
	const optionCounts = useMemo(
		() => ({
			all: options.length,
			image: options.filter((option) => option.kind === "image").length,
			video: options.filter((option) => option.kind === "video").length,
			audio: options.filter((option) => option.kind === "audio").length,
		}),
		[options],
	);
	const visibleOptions = useMemo(
		() => (kindFilter === "all" ? options : options.filter((option) => option.kind === kindFilter)),
		[kindFilter, options],
	);
	const selectedShortcutIDSet = useMemo(
		() => new Set(selectedShortcutAssetIds),
		[selectedShortcutAssetIds],
	);
	const visibleShortcutGroups = useMemo(
		() =>
			shortcutGroups
				.map((group) => ({
					...group,
					items: group.items.filter((item) =>
						kindFilter === "all" ? true : item.asset.kind === kindFilter,
					),
				}))
				.filter((group) => group.items.length > 0),
		[kindFilter, shortcutGroups],
	);

	useEffect(() => {
		if (kindFilters.includes(kindFilter)) return;
		setKindFilter(kindFilters[0] ?? "all");
	}, [kindFilter, kindFilters]);

	useEffect(() => {
		if (!open) return;

		onRefreshAssets?.();
	}, [onRefreshAssets, open]);

	return {
		acceptedFileTypes,
		disabled,
		inputId,
		isUploading,
		kindFilters,
		onKindFilterChange: setKindFilter,
		onOpenChange,
		onRemoveReference,
		onToggleReference,
		onToggleShortcutReference,
		onUpload,
		open,
		optionCounts,
		options,
		references,
		requiresReference,
		selectableKinds,
		selectedAssetIds,
		selectedShortcutAssetIds: selectedShortcutIDSet,
		shortcutGroups: visibleShortcutGroups,
		title,
		visibleOptions,
		kindFilter,
	};
};

const ReferenceSelectionDialogView: React.FC<{
	controller: ReferenceSelectionDialogController;
}> = ({ controller }) => {
	if (!controller.open) return null;

	return (
		<GenerationDialogShell
			open={controller.open}
			title={controller.title}
			titleId="generation-reference-title"
			description="上传素材，或从当前项目素材中选择。"
			closeDisabled={controller.isUploading}
			onOpenChange={controller.onOpenChange}
			toolbar={
				<>
					<input
						id={controller.inputId}
						type="file"
						accept={controller.acceptedFileTypes}
						className="sr-only"
						disabled={controller.disabled || controller.isUploading}
						onChange={controller.onUpload}
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={controller.disabled || controller.isUploading}
						onClick={() => document.getElementById(controller.inputId)?.click()}
					>
						{controller.isUploading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<UploadCloud className="size-4" />
						)}
						<span>上传</span>
					</Button>
					<p className="shrink-0 text-xs text-muted-foreground">
						已选 {controller.references.length} 个
					</p>
				</>
			}
		>
			<div className="grid gap-4">
				<ReferencePreviewStrip
					tone="card"
					disabled={controller.disabled}
					enableImagePreview
					references={controller.references}
					requiresReference={controller.requiresReference}
					simple
					onRemove={controller.onRemoveReference}
				/>
				{controller.shortcutGroups.map((group) => (
					<ReferenceShortcutGroup
						key={group.id}
						disabled={controller.disabled}
						group={group}
						selectableKinds={controller.selectableKinds}
						selectedAssetIds={controller.selectedAssetIds}
						selectedShortcutAssetIds={controller.selectedShortcutAssetIds}
						onToggleReference={controller.onToggleShortcutReference ?? controller.onToggleReference}
					/>
				))}
				{controller.kindFilters.length > 1 ? (
					<Tabs
						value={controller.kindFilter}
						onValueChange={(value) => controller.onKindFilterChange(value as ReferenceKindFilter)}
					>
						<TabsList
							className={cn(
								"grid h-8 w-full sm:w-96",
								controller.kindFilters.length === 2
									? "grid-cols-2"
									: controller.kindFilters.length === 3
										? "grid-cols-3"
										: "grid-cols-4",
							)}
						>
							{referenceKindTabs
								.filter((tab) => controller.kindFilters.includes(tab.value))
								.map((tab) => (
									<TabsTrigger key={tab.value} value={tab.value} className="text-xs">
										<span>{tab.label}</span>
										<span className="text-2xs text-muted-foreground">
											{controller.optionCounts[tab.value]}
										</span>
									</TabsTrigger>
								))}
						</TabsList>
					</Tabs>
				) : null}
				{controller.options.length === 0 ? (
					<div className="flex min-h-56 items-center justify-center rounded-sm border border-dashed border-border bg-muted px-4 text-center text-xs text-muted-foreground">
						{emptyReferenceOptionsText(controller.kindFilters)}
					</div>
				) : controller.visibleOptions.length === 0 ? (
					<div className="flex min-h-56 items-center justify-center rounded-sm border border-dashed border-border bg-muted px-4 text-center text-xs text-muted-foreground">
						当前没有{referenceKindFilterLabel(controller.kindFilter)}素材。
					</div>
				) : (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
						{controller.visibleOptions.map((option) => {
							const supported = Boolean(
								option.mediaAsset && controller.selectableKinds.has(option.mediaAsset.kind),
							);
							const selectable = !controller.disabled && supported;
							const selected = Boolean(
								option.mediaAsset && controller.selectedAssetIds.includes(option.mediaAsset.id),
							);

							return (
								<GeneratedReferenceOptionCard
									key={option.key}
									option={option}
									selectable={selectable}
									selected={selected}
									supported={supported}
									onToggle={() => {
										if (option.mediaAsset) controller.onToggleReference(option.mediaAsset);
									}}
								/>
							);
						})}
					</div>
				)}
			</div>
		</GenerationDialogShell>
	);
};

export type ReferenceKindFilter = "all" | "video" | "image" | "audio";

const referenceKindTabs: Array<{ label: string; value: ReferenceKindFilter }> = [
	{ label: "全部", value: "all" },
	{ label: "视频", value: "video" },
	{ label: "图片", value: "image" },
	{ label: "音频", value: "audio" },
];

const defaultReferenceKindFilters = referenceKindTabs.map((tab) => tab.value);

const normalizeReferenceKindFilters = (filters: ReferenceKindFilter[] | undefined) =>
	filters?.length ? filters : defaultReferenceKindFilters;

const referenceKindFilterLabel = (value: ReferenceKindFilter) => {
	if (value === "video") return "视频";
	if (value === "image") return "图片";
	if (value === "audio") return "音频";
	return "参考";
};

const emptyReferenceOptionsText = (filters: ReferenceKindFilter[]) => {
	if (filters.length === 1 && filters[0] === "image") return "当前项目暂无可选择的图片素材。";
	if (filters.length === 1 && filters[0] === "video") return "当前项目暂无可选择的视频素材。";
	if (filters.length === 1 && filters[0] === "audio") return "当前项目暂无可选择的音频素材。";
	return "当前项目暂无可选择的图片、视频或音频素材。";
};

const referenceKindFromMediaAssetKind = (
	kind: MediaAsset["kind"],
): Exclude<ReferenceKindFilter, "all"> | null => {
	if (kind === "image" || kind === "video" || kind === "audio") return kind;
	return null;
};

const ReferenceShortcutGroup: React.FC<{
	disabled: boolean;
	group: ReferenceSelectionShortcutGroup;
	onToggleReference: (asset: MediaAsset) => void;
	selectableKinds: Set<MediaAsset["kind"]>;
	selectedAssetIds: string[];
	selectedShortcutAssetIds: Set<string>;
}> = ({
	disabled,
	group,
	onToggleReference,
	selectableKinds,
	selectedAssetIds,
	selectedShortcutAssetIds,
}) => (
	<section className="grid gap-3 rounded-sm border border-border bg-muted/35 p-3">
		<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
			<div className="min-w-0">
				<p className="truncate text-xs font-semibold text-foreground">{group.title}</p>
				{group.description ? (
					<p className="mt-1 truncate text-2xs text-muted-foreground">{group.description}</p>
				) : null}
			</div>
			<p className="shrink-0 text-2xs text-muted-foreground">{group.items.length} 个</p>
		</div>
		<div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
			{group.items.map((item) => {
				const referenceKind = referenceKindFromMediaAssetKind(item.asset.kind);
				if (!referenceKind) return null;
				const supported = selectableKinds.has(item.asset.kind);
				const selectable = !disabled && supported;
				const selected =
					selectedAssetIds.includes(item.asset.id) || selectedShortcutAssetIds.has(item.asset.id);

				return (
					<ReferenceShortcutCard
						key={`${group.id}:${item.asset.id}`}
						item={item}
						referenceKind={referenceKind}
						selectable={selectable}
						selected={selected}
						supported={supported}
						onToggle={() => onToggleReference(item.asset)}
					/>
				);
			})}
		</div>
	</section>
);

const ReferenceShortcutCard: React.FC<{
	item: ReferenceSelectionShortcutItem;
	onToggle: () => void;
	referenceKind: Exclude<ReferenceKindFilter, "all">;
	selectable: boolean;
	selected: boolean;
	supported: boolean;
}> = ({ item, onToggle, referenceKind, selectable, selected, supported }) => (
	<div
		className={cn(
			"min-w-0 overflow-hidden rounded-sm border bg-card text-left transition-colors",
			selected ? "border-primary" : "border-border",
			selectable ? "hover:border-input" : "opacity-60",
		)}
	>
		<div className="relative aspect-[4/3] bg-muted-foreground/10">
			{referenceKind === "audio" ? (
				<ReferenceMediaPreview
					kind={referenceKind}
					mimeType={item.asset.mimeType}
					source={item.asset.url}
					title={item.asset.filename}
				/>
			) : (
				<button
					type="button"
					disabled={!selectable}
					className="size-full disabled:cursor-default"
					aria-label={`选择 ${item.title}`}
					onClick={onToggle}
				>
					<ReferenceMediaPreview
						kind={referenceKind}
						mimeType={item.asset.mimeType}
						source={item.asset.url}
						title={item.asset.filename}
					/>
				</button>
			)}
			<ReferenceKindBadge kind={referenceKind} />
			{selected ? (
				<span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-sm bg-primary px-1.5 py-1 text-xs font-medium text-primary-foreground shadow-sm">
					<Check className="size-3" />
					已选
				</span>
			) : null}
		</div>
		<button
			type="button"
			disabled={!selectable}
			className="grid w-full gap-1 p-2 text-left disabled:cursor-default"
			onClick={onToggle}
		>
			<p className="truncate text-xs font-medium text-foreground">{item.title}</p>
			<p className="truncate text-2xs text-muted-foreground">
				{supported ? (item.subtitle ?? "可作为参考") : "当前模型不可用"}
			</p>
		</button>
	</div>
);

const GeneratedReferenceOptionCardContent: React.FC<{
	onToggle: () => void;
	option: GeneratedReferenceOption;
	selectable: boolean;
	selected: boolean;
	supported: boolean;
	title: string;
}> = ({ onToggle, option, selectable, selected, supported, title }) => (
	<>
		<div className="relative aspect-square bg-muted-foreground/10">
			{option.kind === "audio" ? (
				<GeneratedReferenceOptionPreview option={option} title={title} />
			) : (
				<button
					type="button"
					disabled={!selectable}
					className="size-full disabled:cursor-default"
					aria-label={`选择 ${title}`}
					onClick={onToggle}
				>
					<GeneratedReferenceOptionPreview option={option} title={title} />
				</button>
			)}
			<ReferenceKindBadge kind={option.kind} />
			{selected ? (
				<span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-sm bg-primary px-1.5 py-1 text-xs font-medium text-primary-foreground shadow-sm">
					<Check className="size-3" />
					已选
				</span>
			) : null}
		</div>
		<button
			type="button"
			disabled={!selectable}
			className="grid w-full gap-1 p-2 text-left disabled:cursor-default"
			onClick={onToggle}
		>
			<p className="line-clamp-2 text-xs leading-4 text-muted-foreground">{title}</p>
			<p className="truncate text-xs text-muted-foreground">
				{referenceOptionStatusText(option, supported)}
			</p>
		</button>
	</>
);

const GeneratedReferenceOptionCard: React.FC<{
	option: GeneratedReferenceOption;
	onToggle: () => void;
	selectable: boolean;
	selected: boolean;
	supported: boolean;
}> = ({ option, onToggle, selectable, selected, supported }) => {
	const title = referenceOptionTitle(option);

	return (
		<div
			className={cn(
				"min-w-0 overflow-hidden rounded-sm border bg-card text-left transition-colors",
				selected ? "border-primary" : "border-border",
				selectable ? "hover:border-input" : "opacity-60",
			)}
		>
			<GeneratedReferenceOptionCardContent
				option={option}
				selectable={selectable}
				selected={selected}
				supported={supported}
				title={title}
				onToggle={onToggle}
			/>
		</div>
	);
};

const GeneratedReferenceOptionPreview: React.FC<{
	option: GeneratedReferenceOption;
	title: string;
}> = ({ option, title }) => (
	<ReferenceMediaPreview
		kind={option.kind}
		mimeType={option.mediaAsset?.mimeType}
		source={option.source}
		title={title}
	/>
);

const ReferenceMediaPreview: React.FC<{
	kind: Exclude<ReferenceKindFilter, "all">;
	mimeType?: string;
	source: string;
	title: string;
}> = ({ kind, mimeType, source, title }) => {
	if (kind === "video") {
		return <GenerationVideoThumbnail source={source} />;
	}

	if (kind === "audio") {
		return <ReferenceAudioPreview mimeType={mimeType} source={source} title={title} />;
	}

	return <img src={source} alt="" className="size-full object-contain" />;
};

const ReferenceAudioPreview: React.FC<{
	mimeType?: string;
	source: string;
	title: string;
}> = ({ mimeType, source, title }) => {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [playFailed, setPlayFailed] = useState(false);

	const togglePlayback = () => {
		const audio = audioRef.current;
		if (!audio) return;

		if (isPlaying) {
			audio.pause();
			setIsPlaying(false);
			return;
		}

		setPlayFailed(false);
		const playPromise = audio.play();
		void playPromise
			.then(() => setIsPlaying(true))
			.catch(() => {
				setIsPlaying(false);
				setPlayFailed(true);
			});
	};

	return (
		<div className="relative flex size-full items-center justify-center overflow-hidden bg-muted">
			<audio
				ref={audioRef}
				src={source}
				preload="metadata"
				className="hidden"
				onEnded={() => setIsPlaying(false)}
				onPause={() => setIsPlaying(false)}
				onPlay={() => setIsPlaying(true)}
			>
				{mimeType ? <source src={source} type={mimeType} /> : null}
			</audio>
			<AudioLines className="absolute size-12 text-muted-foreground/20" aria-hidden="true" />
			<button
				type="button"
				className="relative flex size-11 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label={`${isPlaying ? "暂停" : "播放"} ${title}`}
				onClick={(event) => {
					event.stopPropagation();
					togglePlayback();
				}}
			>
				{isPlaying ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
			</button>
			{playFailed ? (
				<span className="absolute bottom-2 rounded-sm bg-background/90 px-1.5 py-0.5 text-2xs text-destructive shadow-sm">
					无法播放
				</span>
			) : null}
		</div>
	);
};

const ReferenceKindBadge: React.FC<{ kind: Exclude<ReferenceKindFilter, "all"> }> = ({ kind }) => {
	if (kind === "image") return null;

	const Icon = kind === "audio" ? AudioLines : Film;

	return (
		<span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-sm bg-background/90 px-1.5 py-1 text-2xs font-medium text-foreground shadow-sm">
			<Icon className="size-3" />
			{referenceKindFilterLabel(kind)}
		</span>
	);
};

const referenceOptionTitle = (option: GeneratedReferenceOption) =>
	option.entry
		? entryPromptText(option.entry) || option.mediaAsset?.filename || fallbackOptionTitle(option)
		: option.mediaAsset?.filename || fallbackOptionTitle(option);

const referenceOptionStatusText = (option: GeneratedReferenceOption, supported: boolean) => {
	if (!option.mediaAsset) return "暂不可作为参考";
	if (!supported) return "当前模型不可用";
	if (option.entry?.status) return generationStatusLabel(option.entry.status);

	return "可作为参考";
};

const fallbackOptionTitle = (option: GeneratedReferenceOption) => {
	const kindLabel = referenceKindFilterLabel(option.kind);

	return option.entry ? `历史生成${kindLabel}` : `项目${kindLabel}素材`;
};
