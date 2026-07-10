import { Check, Loader2, Pause, Play, Star } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type {
	GenerationAsset,
	GenerationModelsResponse,
	GenerationParam,
} from "@/domains/generation/api/generation";
import {
	generationModelsKey,
	getGenerationModels,
	previewGenerationVoice,
} from "@/domains/generation/api/generation";
import {
	catalogOrFallback,
	generationAssetSelectionKey,
	generationAssetSource,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import {
	formatBytes,
	paramOptionLabel,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { MaterialLibraryImportDialog } from "@/domains/generation/components/MaterialLibraryImportDialog";
import { getMediaAssets, uploadMediaAsset, type MediaAsset } from "@/domains/workspace/api/media";
import { DialogDismissButton } from "@/shared/components/ui/dialog-dismiss";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

export type AudioReferenceSelectionTab = "all" | "library";
type SystemVoiceTab = "all" | "favorites";
type VoiceGender = "all" | "female" | "male" | "child" | "character";
type VoiceAge = "all" | "child" | "youth" | "adult" | "elder" | "character";
type VoiceTrait =
	| "all"
	| "gentle"
	| "sweet"
	| "mature"
	| "news"
	| "story"
	| "confident"
	| "playful"
	| "character";

interface AudioReferenceSelectionPanelProps {
	activeTab: AudioReferenceSelectionTab;
	materialLibraryOpen?: boolean;
	onActiveTabChange: (tab: AudioReferenceSelectionTab) => void;
	onCancelSelection: () => void;
	onConfirmSelection?: (asset: GenerationAsset | null) => Promise<void> | void;
	onMaterialLibraryOpenChange?: (open: boolean) => void;
	open: boolean;
	projectId?: string;
	selectedAssetKeys?: string[];
}

interface SystemVoiceOption {
	age: VoiceAge;
	gender: VoiceGender;
	label: string;
	language: string;
	mimeType: string;
	name: string;
	previewUrl: string;
	routeId: string;
	trait: VoiceTrait;
	traitLabel: string;
	value: string;
}

const allVoiceFilterValue = "all";
const preferredMandarinLanguage = "中文 (普通话)";
const voiceFavoriteStorageKey = "generation.minimax.voiceFavorites";
const emptySelectedAssetKeys: string[] = [];

const audioMediaAssetsKey = (projectId?: string) =>
	["audio-reference-selection", projectId?.trim() ?? ""] as const;

export const AudioReferenceSelectionPanel: React.FC<AudioReferenceSelectionPanelProps> = ({
	activeTab,
	materialLibraryOpen = false,
	onActiveTabChange,
	onCancelSelection,
	onConfirmSelection,
	onMaterialLibraryOpenChange,
	open,
	projectId,
	selectedAssetKeys,
}) => {
	const resolvedSelectedAssetKeys = selectedAssetKeys ?? emptySelectedAssetKeys;
	const [draftAsset, setDraftAsset] = useState<GenerationAsset | null | undefined>(undefined);
	const [confirming, setConfirming] = useState(false);
	const [systemVoiceTab, setSystemVoiceTab] = useState<SystemVoiceTab>("all");
	const [gender, setGender] = useState<VoiceGender>("all");
	const [age, setAge] = useState<VoiceAge>("all");
	const [language, setLanguage] = useState(allVoiceFilterValue);
	const [trait, setTrait] = useState<VoiceTrait>("all");
	const [favorites, setFavorites] = useState<Set<string>>(() => readVoiceFavorites());
	const defaultLanguageAppliedRef = useRef(false);
	const playback = useAudioPreviewPlayback();
	const stopPlayback = playback.stopPlayback;
	const { data: catalogData, isLoading: catalogLoading } = useSWR(
		open ? generationModelsKey : null,
		getGenerationModels,
	);
	const {
		data: mediaAssetsData,
		isLoading: mediaAssetsLoading,
		mutate: refreshMediaAssets,
	} = useSWR(open ? audioMediaAssetsKey(projectId) : null, () =>
		getMediaAssets({ kind: "audio", projectId: projectId?.trim() || undefined }),
	);
	const catalog = useMemo(() => catalogOrFallback(catalogData), [catalogData]);
	const systemVoices = useMemo(() => buildSystemVoiceOptions(catalog), [catalog]);
	const systemVoiceLanguages = useMemo(
		() => Array.from(new Set(systemVoices.map((voice) => voice.language))).filter(Boolean),
		[systemVoices],
	);
	const visibleSystemVoices = useMemo(
		() =>
			systemVoices.filter((voice) => {
				if (systemVoiceTab === "favorites" && !favorites.has(voice.value)) return false;
				if (gender !== "all" && voice.gender !== gender) return false;
				if (age !== "all" && voice.age !== age) return false;
				if (language !== allVoiceFilterValue && voice.language !== language) return false;
				if (trait !== "all" && voice.trait !== trait) return false;
				return true;
			}),
		[age, favorites, gender, language, systemVoiceTab, systemVoices, trait],
	);
	const userAudioAssets = useMemo(
		() => (mediaAssetsData?.assets ?? []).filter((asset) => asset.kind === "audio"),
		[mediaAssetsData?.assets],
	);
	const selectedKeys = useMemo(() => {
		if (draftAsset === undefined) return resolvedSelectedAssetKeys;
		if (!draftAsset) return [];

		const selectionKey = generationAssetSelectionKey(draftAsset);
		return selectionKey ? [selectionKey] : [];
	}, [draftAsset, resolvedSelectedAssetKeys]);

	useEffect(() => {
		if (open) return;
		stopPlayback();
		setDraftAsset(undefined);
		setConfirming(false);
	}, [open, stopPlayback]);

	useEffect(() => {
		if (open && activeTab === "library") void refreshMediaAssets();
	}, [activeTab, open, refreshMediaAssets]);

	useEffect(() => {
		if (open && materialLibraryOpen) void refreshMediaAssets();
	}, [materialLibraryOpen, open, refreshMediaAssets]);

	useEffect(() => {
		if (!open) {
			defaultLanguageAppliedRef.current = false;
			setLanguage(allVoiceFilterValue);
			return;
		}
		if (defaultLanguageAppliedRef.current) return;

		const nextLanguage = defaultMandarinLanguage(systemVoiceLanguages);
		if (!nextLanguage) return;

		defaultLanguageAppliedRef.current = true;
		setLanguage(nextLanguage);
	}, [open, systemVoiceLanguages]);

	const toggleAsset = useCallback(
		(asset: GenerationAsset) => {
			const selectionKey = generationAssetSelectionKey(asset);
			if (!selectionKey) return;
			setDraftAsset(selectedKeys.includes(selectionKey) ? null : asset);
		},
		[selectedKeys],
	);

	const selectAsset = useCallback((asset: GenerationAsset) => {
		const selectionKey = generationAssetSelectionKey(asset);
		if (!selectionKey) return;
		setDraftAsset(asset);
	}, []);

	const selectMaterialAsset = useCallback(
		(asset: MediaAsset) => {
			playback.stopPlayback();
			selectAsset(mediaAssetGenerationAsset(asset));
			onActiveTabChange("library");
			onMaterialLibraryOpenChange?.(false);
		},
		[onActiveTabChange, onMaterialLibraryOpenChange, playback, selectAsset],
	);

	const confirmMaterialAssets = useCallback(
		(assets: MediaAsset[]) => {
			const selectedAsset = assets[0];
			if (!selectedAsset) {
				onMaterialLibraryOpenChange?.(false);
				return;
			}

			selectMaterialAsset(selectedAsset);
		},
		[onMaterialLibraryOpenChange, selectMaterialAsset],
	);

	const uploadMaterialAudioAsset = useCallback(
		async (file: File) => {
			const mediaAsset = await uploadMediaAsset(file, projectId?.trim() || undefined);
			void refreshMediaAssets();
			return mediaAsset;
		},
		[projectId, refreshMediaAssets],
	);

	const selectedMaterialAssetIds = useMemo(
		() =>
			userAudioAssets
				.filter((asset) => {
					const selectionKey = generationAssetSelectionKey(mediaAssetGenerationAsset(asset));
					return Boolean(selectionKey && selectedKeys.includes(selectionKey));
				})
				.map((asset) => asset.id),
		[selectedKeys, userAudioAssets],
	);

	const toggleFavorite = useCallback((voiceID: string) => {
		setFavorites((current) => {
			const next = new Set(current);
			if (next.has(voiceID)) {
				next.delete(voiceID);
			} else {
				next.add(voiceID);
			}
			writeVoiceFavorites(next);
			return next;
		});
	}, []);

	const changeActiveTab = useCallback(
		(tab: AudioReferenceSelectionTab) => {
			if (tab !== activeTab) playback.stopPlayback();
			onActiveTabChange(tab);
		},
		[activeTab, onActiveTabChange, playback],
	);

	const changeSystemVoiceTab = useCallback(
		(tab: SystemVoiceTab) => {
			if (tab !== systemVoiceTab) playback.stopPlayback();
			setSystemVoiceTab(tab);
		},
		[playback, systemVoiceTab],
	);
	const cancelSelection = useCallback(() => {
		stopPlayback();
		setDraftAsset(undefined);
		onCancelSelection();
	}, [onCancelSelection, stopPlayback]);
	const confirmSelection = useCallback(async () => {
		if (draftAsset === undefined) {
			cancelSelection();
			return;
		}

		setConfirming(true);
		try {
			await onConfirmSelection?.(draftAsset);
			cancelSelection();
		} finally {
			setConfirming(false);
		}
	}, [cancelSelection, draftAsset, onConfirmSelection]);

	return (
		<section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-card text-card-foreground">
			<div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
				<div className="flex min-w-0 items-center gap-1 rounded-sm border border-border bg-ide-toolbar p-0.5">
					<AudioTabButton
						active={activeTab === "all"}
						label="全部音色"
						onClick={() => changeActiveTab("all")}
					/>
					<AudioTabButton
						active={activeTab === "library"}
						label="我的音色"
						onClick={() => changeActiveTab("library")}
					/>
				</div>
				{activeTab === "all" ? (
					<>
						<div className="flex min-w-0 items-center gap-1 rounded-sm border border-border bg-ide-toolbar p-0.5">
							<SystemVoiceTabButton
								active={systemVoiceTab === "all"}
								label="全部"
								onClick={() => changeSystemVoiceTab("all")}
							/>
							<SystemVoiceTabButton
								active={systemVoiceTab === "favorites"}
								label="收藏"
								onClick={() => changeSystemVoiceTab("favorites")}
							/>
						</div>
						<VoiceFilterSelect
							ariaLabel="性别"
							value={gender}
							options={voiceGenderOptions}
							onChange={(value) => setGender(value as VoiceGender)}
						/>
						<VoiceFilterSelect
							ariaLabel="年龄"
							value={age}
							options={voiceAgeOptions}
							onChange={(value) => setAge(value as VoiceAge)}
						/>
						<VoiceFilterSelect
							ariaLabel="语言"
							value={language}
							options={[
								{ label: "全部", value: allVoiceFilterValue },
								...systemVoiceLanguages.map((item) => ({ label: item, value: item })),
							]}
							onChange={setLanguage}
						/>
						<VoiceFilterSelect
							ariaLabel="类型"
							value={trait}
							options={voiceTraitOptions}
							onChange={(value) => setTrait(value as VoiceTrait)}
						/>
					</>
				) : null}
			</div>
			<div className="min-h-0 overflow-y-auto p-4">
				{activeTab === "all" ? (
					<SystemVoiceGrid
						favorites={favorites}
						isLoading={catalogLoading && systemVoices.length === 0}
						playingKey={playback.playingKey}
						previewingKey={playback.previewingKey}
						selectedKeys={selectedKeys}
						voices={visibleSystemVoices}
						onFavoriteToggle={toggleFavorite}
						onPreviewVoice={playback.playSystemVoice}
						onToggleVoice={toggleAsset}
					/>
				) : (
					<UserAudioGrid
						assets={userAudioAssets}
						isLoading={mediaAssetsLoading}
						playingKey={playback.playingKey}
						selectedKeys={selectedKeys}
						onPreviewAsset={playback.playSource}
						onToggleAsset={toggleAsset}
					/>
				)}
			</div>
			<MaterialLibraryImportDialog
				assetKind="audio"
				mediaAssets={mediaAssetsData?.assets ?? []}
				open={materialLibraryOpen}
				selectedAssetIds={selectedMaterialAssetIds}
				selectionMode="single"
				onConfirmSelection={confirmMaterialAssets}
				onOpenChange={onMaterialLibraryOpenChange ?? (() => undefined)}
				onRefreshAssets={() => {
					void refreshMediaAssets();
				}}
				onUploadAsset={uploadMaterialAudioAsset}
			/>
			<footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-4 py-3">
				<DialogDismissButton
					type="button"
					variant="outline"
					size="sm"
					className="h-8 rounded-sm"
					disabled={confirming}
					onClick={cancelSelection}
				>
					取消
				</DialogDismissButton>
				<DialogDismissButton
					type="button"
					size="sm"
					className="h-8 rounded-sm"
					disabled={confirming}
					onClick={() => {
						void confirmSelection();
					}}
				>
					{confirming ? <Loader2 className="size-4 animate-spin" /> : null}
					<span>确定</span>
				</DialogDismissButton>
			</footer>
		</section>
	);
};

const AudioTabButton: React.FC<{
	active: boolean;
	label: string;
	onClick: () => void;
}> = ({ active, label, onClick }) => (
	<button
		type="button"
		className={cn(
			"flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			active
				? "bg-card text-foreground shadow-sm"
				: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
		)}
		onClick={onClick}
	>
		<span>{label}</span>
	</button>
);

const SystemVoiceTabButton: React.FC<{
	active: boolean;
	label: string;
	onClick: () => void;
}> = ({ active, label, onClick }) => (
	<button
		type="button"
		className={cn(
			"flex h-7 items-center rounded-sm px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			active
				? "bg-card text-foreground shadow-sm"
				: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
		)}
		onClick={onClick}
	>
		{label}
	</button>
);

const VoiceFilterSelect: React.FC<{
	ariaLabel: string;
	onChange: (value: string) => void;
	options: Array<{ label: string; value: string }>;
	value: string;
}> = ({ ariaLabel, onChange, options, value }) => {
	const selectedOption = options.find((option) => option.value === value);
	const triggerLabel =
		value === allVoiceFilterValue ? ariaLabel : (selectedOption?.label ?? ariaLabel);

	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger
				aria-label={ariaLabel}
				className="h-8 w-28 rounded-sm border-input bg-muted px-2 text-xs font-semibold shadow-none hover:bg-ide-list-hover"
			>
				<span className="min-w-0 truncate">{triggerLabel}</span>
			</SelectTrigger>
			<SelectContent className="max-h-64">
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
};

const SystemVoiceGrid: React.FC<{
	favorites: ReadonlySet<string>;
	isLoading: boolean;
	onFavoriteToggle: (voiceID: string) => void;
	onPreviewVoice: (voice: SystemVoiceOption) => void;
	onToggleVoice: (asset: GenerationAsset) => void;
	playingKey: string;
	previewingKey: string;
	selectedKeys: string[];
	voices: SystemVoiceOption[];
}> = ({
	favorites,
	isLoading,
	onFavoriteToggle,
	onPreviewVoice,
	onToggleVoice,
	playingKey,
	previewingKey,
	selectedKeys,
	voices,
}) => {
	if (isLoading) return <AudioSelectionLoading label="正在加载音色" />;
	if (voices.length === 0) return null;

	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
			{voices.map((voice) => {
				const asset = systemVoiceGenerationAsset(voice);
				const selectionKey = generationAssetSelectionKey(asset);
				const selected = Boolean(selectionKey && selectedKeys.includes(selectionKey));
				const previewing = previewingKey === systemVoicePreviewKey(voice);
				const playing = playingKey === systemVoicePreviewKey(voice);

				return (
					<SystemVoiceCard
						key={`${voice.routeId}:${voice.value}`}
						favorited={favorites.has(voice.value)}
						playing={playing}
						previewing={previewing}
						selected={selected}
						voice={voice}
						onFavoriteToggle={() => onFavoriteToggle(voice.value)}
						onPreview={() => onPreviewVoice(voice)}
						onToggle={() => onToggleVoice(asset)}
					/>
				);
			})}
		</div>
	);
};

const SystemVoiceCard: React.FC<{
	favorited: boolean;
	onFavoriteToggle: () => void;
	onPreview: () => void;
	onToggle: () => void;
	playing: boolean;
	previewing: boolean;
	selected: boolean;
	voice: SystemVoiceOption;
}> = ({
	favorited,
	onFavoriteToggle,
	onPreview,
	onToggle,
	playing,
	previewing,
	selected,
	voice,
}) => (
	<div
		className={cn(
			"group/voice-card flex min-h-[4.5rem] min-w-0 items-center gap-2.5 rounded-sm border bg-ide-editor p-2.5 transition-colors",
			selected ? "border-primary" : "border-border hover:border-input",
		)}
	>
		<button
			type="button"
			aria-label={playing ? `暂停 ${voice.label}` : `试听 ${voice.label}`}
			className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-foreground transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
			disabled={previewing}
			onClick={onPreview}
		>
			{previewing ? (
				<Loader2 className="size-4 animate-spin" />
			) : playing ? (
				<Pause className="size-4" />
			) : (
				<Play className="ml-0.5 size-4" />
			)}
		</button>
		<button
			type="button"
			aria-label={selected ? `取消选择 ${voice.label}` : `选择 ${voice.label}`}
			className="grid min-w-0 flex-1 gap-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={onToggle}
		>
			<span className="flex min-w-0 items-center gap-2">
				<span className="truncate text-sm font-semibold text-foreground">{voice.name}</span>
				<span className="shrink-0 rounded bg-info-surface px-1.5 py-0.5 text-2xs font-semibold text-info-foreground">
					{voice.traitLabel}
				</span>
				{selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
			</span>
			<span className="truncate text-xs text-muted-foreground">{voice.language}</span>
		</button>
		<button
			type="button"
			aria-label={favorited ? `取消收藏 ${voice.name}` : `收藏 ${voice.name}`}
			aria-pressed={favorited}
			className={cn(
				"inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/voice-card:opacity-100",
				favorited && "text-warning-foreground opacity-100",
			)}
			onClick={onFavoriteToggle}
		>
			<Star className={cn("size-4", favorited && "fill-current")} />
		</button>
	</div>
);

const UserAudioGrid: React.FC<{
	assets: MediaAsset[];
	isLoading: boolean;
	onPreviewAsset: (key: string, source: string) => void;
	onToggleAsset: (asset: GenerationAsset) => void;
	playingKey: string;
	selectedKeys: string[];
}> = ({ assets, isLoading, onPreviewAsset, onToggleAsset, playingKey, selectedKeys }) => {
	if (isLoading) return <AudioSelectionLoading label="正在加载素材库音频" />;
	if (assets.length === 0) return null;

	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
			{assets.map((asset) => {
				const generationAsset = mediaAssetGenerationAsset(asset);
				const source = generationAssetSource(generationAsset);
				const selectionKey = generationAssetSelectionKey(generationAsset);
				const selected = Boolean(selectionKey && selectedKeys.includes(selectionKey));
				const title = audioAssetTitle(asset);
				const previewKey = userAudioPreviewKey(asset);

				return (
					<UserAudioCard
						key={asset.id}
						asset={asset}
						playing={playingKey === previewKey}
						selected={selected}
						source={source}
						title={title}
						onPreview={() => onPreviewAsset(previewKey, source)}
						onToggle={() => onToggleAsset(generationAsset)}
					/>
				);
			})}
		</div>
	);
};

const UserAudioCard: React.FC<{
	asset: MediaAsset;
	onPreview: () => void;
	onToggle: () => void;
	playing: boolean;
	selected: boolean;
	source: string;
	title: string;
}> = ({ asset, onPreview, onToggle, playing, selected, source, title }) => (
	<div
		className={cn(
			"grid min-h-28 min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-sm border bg-ide-editor p-3 transition-colors",
			selected ? "border-primary" : "border-border hover:border-input",
		)}
	>
		<button
			type="button"
			aria-label={playing ? `暂停 ${title}` : `播放 ${title}`}
			className="inline-flex size-10 items-center justify-center rounded-sm border border-border bg-card text-foreground transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
			disabled={!source}
			onClick={onPreview}
		>
			{playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
		</button>
		<button
			type="button"
			aria-label={selected ? `取消选择 ${title}` : `选择 ${title}`}
			className="grid min-w-0 gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={onToggle}
		>
			<span className="flex min-w-0 items-center gap-2">
				<span className="truncate text-sm font-semibold text-foreground">{title}</span>
				{selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
			</span>
			<span className="truncate text-xs text-muted-foreground">
				{asset.mimeType || "audio/mpeg"}
			</span>
			<span className="truncate text-2xs text-muted-foreground">
				{asset.durationSeconds ? `${formatDuration(asset.durationSeconds)} · ` : ""}
				{formatBytes(asset.sizeBytes)}
			</span>
		</button>
	</div>
);

const AudioSelectionLoading: React.FC<{ label: string }> = ({ label }) => (
	<div className="grid min-h-80 place-items-center rounded-sm border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
		<span className="flex items-center gap-2">
			<Loader2 className="size-4 animate-spin" />
			{label}
		</span>
	</div>
);

const buildSystemVoiceOptions = (catalog: GenerationModelsResponse): SystemVoiceOption[] => {
	const previewsByRouteVoice = new Map<
		string,
		NonNullable<GenerationModelsResponse["voicePreviews"]>[number]
	>();
	const previewsByVoice = new Map<
		string,
		NonNullable<GenerationModelsResponse["voicePreviews"]>[number]
	>();
	for (const preview of catalog.voicePreviews ?? []) {
		previewsByRouteVoice.set(systemVoicePreviewMapKey(preview.routeId, preview.voiceId), preview);
		if (!previewsByVoice.has(preview.voiceId)) previewsByVoice.set(preview.voiceId, preview);
	}

	const voicesById = new Map<string, SystemVoiceOption>();
	for (const route of catalog.routes.filter((item) => item.kind === "audio")) {
		const voiceParam = route.params.find(isVoiceParam);
		for (const option of voiceParam?.options ?? []) {
			const existing = voicesById.get(option.value);
			const preview =
				previewsByRouteVoice.get(systemVoicePreviewMapKey(route.id, option.value)) ??
				previewsByVoice.get(option.value);
			const label = paramOptionLabel(option.label || option.value);
			const voice = voiceDisplayParts(label);
			const voiceType = inferVoiceType(`${label} ${option.value}`);
			const next: SystemVoiceOption = {
				age: voiceType.age,
				gender: voiceType.gender,
				label,
				language: voice.language,
				mimeType: preview?.mimeType || "audio/mpeg",
				name: voice.name,
				previewUrl: preview?.url || "",
				routeId: preview?.routeId || route.id,
				trait: voiceType.trait,
				traitLabel: voiceType.traitLabel,
				value: option.value,
			};

			if (!existing || (!existing.previewUrl && next.previewUrl))
				voicesById.set(option.value, next);
		}
	}

	return Array.from(voicesById.values()).sort((left, right) =>
		left.label.localeCompare(right.label, "zh-Hans-CN"),
	);
};

const isVoiceParam = (param: GenerationParam) =>
	param.name === "voiceId" && Array.isArray(param.options) && param.options.length > 0;

const voiceDisplayParts = (label: string) => {
	const [languagePart, ...nameParts] = label.split(" · ");
	if (nameParts.length === 0) return { language: "其他", name: label };

	return {
		language: languagePart.trim() || "其他",
		name: nameParts.join(" · ").trim() || label,
	};
};

const defaultMandarinLanguage = (languages: string[]) =>
	languages.find((item) => item === preferredMandarinLanguage) ??
	languages.find((item) => item === "中文（普通话）") ??
	languages.find((item) => /中文.*普通话|普通话.*中文/u.test(item)) ??
	languages.find((item) => item.includes("中文")) ??
	"";

const voiceGenderOptions: Array<{ label: string; value: VoiceGender }> = [
	{ label: "全部", value: "all" },
	{ label: "女声", value: "female" },
	{ label: "男声", value: "male" },
	{ label: "童声", value: "child" },
	{ label: "角色", value: "character" },
];

const voiceAgeOptions: Array<{ label: string; value: VoiceAge }> = [
	{ label: "全部", value: "all" },
	{ label: "儿童", value: "child" },
	{ label: "青年", value: "youth" },
	{ label: "成年", value: "adult" },
	{ label: "长者", value: "elder" },
	{ label: "角色", value: "character" },
];

const voiceTraitOptions: Array<{ label: string; value: VoiceTrait }> = [
	{ label: "全部", value: "all" },
	{ label: "温柔", value: "gentle" },
	{ label: "甜美", value: "sweet" },
	{ label: "成熟", value: "mature" },
	{ label: "播报", value: "news" },
	{ label: "叙事", value: "story" },
	{ label: "自信", value: "confident" },
	{ label: "活泼", value: "playful" },
	{ label: "角色", value: "character" },
];

const inferVoiceType = (text: string) => {
	const normalized = text.toLowerCase();
	const trait = inferVoiceTrait(normalized);

	return {
		age: inferVoiceAge(normalized),
		gender: inferVoiceGender(normalized),
		trait,
		traitLabel: voiceTraitOptions.find((item) => item.value === trait)?.label ?? "类型",
	};
};

const inferVoiceGender = (text: string): VoiceGender => {
	if (/(童|child|children|kid|elf)/i.test(text)) return "child";
	if (/(girl|woman|female|lady|sister|princess|queen|女|姐|妹|小姐|奶奶|阿姨|闺蜜)/i.test(text)) {
		return "female";
	}
	if (/(boy|man|male|gentleman|brother|king|男|哥|弟|爷|叔|少爷|男友|学长)/i.test(text)) {
		return "male";
	}
	return "character";
};

const inferVoiceAge = (text: string): VoiceAge => {
	if (/(童|child|children|kid|little|elf)/i.test(text)) return "child";
	if (/(elder|senior|大爷|奶奶|长者|花甲)/i.test(text)) return "elder";
	if (/(youth|teen|young|student|青年|少女|少年|学生|学弟|学姐|小哥|小玲|萌妹)/i.test(text)) {
		return "youth";
	}
	if (
		/(robot|ghost|armor|cartoon|anime|santa|rudolph|grinch|spirit|character|机械|卡通|动漫)/i.test(
			text,
		)
	) {
		return "character";
	}
	return "adult";
};

const inferVoiceTrait = (text: string): VoiceTrait => {
	if (/(gentle|warm|soft|kind|calm|serene|soothing|温柔|温暖|柔和|善良|热心|闺蜜)/i.test(text)) {
		return "gentle";
	}
	if (/(sweet|cute|lovely|charming|甜|可爱|萌|俏皮|清脆)/i.test(text)) return "sweet";
	if (/(mature|reliable|executive|senior|wise|成熟|沉稳|阅历|稳重)/i.test(text)) return "mature";
	if (/(news|anchor|announcer|host|radio|narrator|播报|新闻|主持|主播|旁白)/i.test(text)) {
		return "news";
	}
	if (/(story|storyteller|narrator|lyrical|dramatist|叙事|故事|抒情)/i.test(text)) {
		return "story";
	}
	if (
		/(confident|boss|dominant|strict|powerful|brave|determined|霸道|强势|自信|勇敢|嚣张)/i.test(
			text,
		)
	) {
		return "confident";
	}
	if (/(playful|cheerful|humorous|funny|jovial|energetic|活泼|搞笑|爽快|开心)/i.test(text)) {
		return "playful";
	}
	return "character";
};

const readVoiceFavorites = () => {
	if (typeof window === "undefined") return new Set<string>();
	try {
		const rawValue = window.localStorage.getItem(voiceFavoriteStorageKey);
		const parsed = rawValue ? JSON.parse(rawValue) : [];
		return new Set(
			Array.isArray(parsed)
				? parsed.filter((item): item is string => typeof item === "string")
				: [],
		);
	} catch {
		return new Set<string>();
	}
};

const writeVoiceFavorites = (favorites: Set<string>) => {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(voiceFavoriteStorageKey, JSON.stringify(Array.from(favorites)));
	} catch {
		// Ignore storage failures; voice selection itself should stay usable.
	}
};

const systemVoiceGenerationAsset = (voice: SystemVoiceOption): GenerationAsset => ({
	kind: "audio",
	mimeType: voice.mimeType,
	sourceType: "imported",
	title: voice.label,
	url: voice.previewUrl,
});

const mediaAssetGenerationAsset = (asset: MediaAsset): GenerationAsset => ({
	kind: "audio",
	mimeType: asset.mimeType,
	title: audioAssetTitle(asset),
	url: asset.url,
});

const audioAssetTitle = (asset: MediaAsset) =>
	asset.filename.trim().replace(/\.[a-z0-9]+$/iu, "") || "未命名音频";

const formatDuration = (seconds: number) => {
	const safeSeconds = Math.max(0, Math.round(seconds));
	const minutes = Math.floor(safeSeconds / 60);
	const rest = safeSeconds % 60;
	return `${minutes}:${String(rest).padStart(2, "0")}`;
};

const systemVoicePreviewMapKey = (routeId: string, voiceId: string) => `${routeId}:${voiceId}`;
const systemVoicePreviewKey = (voice: SystemVoiceOption) => `voice:${voice.routeId}:${voice.value}`;
const userAudioPreviewKey = (asset: MediaAsset) => `asset:${asset.id}`;

const useAudioPreviewPlayback = () => {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const sourceCacheRef = useRef(new Map<string, string>());
	const [playingKey, setPlayingKey] = useState("");
	const [previewingKey, setPreviewingKey] = useState("");

	const stopPlayback = useCallback((targetKey?: string) => {
		audioRef.current?.pause();
		if (audioRef.current) audioRef.current.onended = null;
		audioRef.current = null;
		setPlayingKey((current) => (!targetKey || current === targetKey ? "" : current));
	}, []);

	const playSource = useCallback(
		(key: string, source: string) => {
			if (!source) return;
			if (playingKey === key) {
				stopPlayback(key);
				return;
			}

			stopPlayback();
			const audio = new Audio(source);
			audio.onended = () => {
				if (audioRef.current !== audio) return;
				audioRef.current = null;
				setPlayingKey((current) => (current === key ? "" : current));
			};
			audioRef.current = audio;
			void audio
				.play()
				.then(() => setPlayingKey(key))
				.catch(() => {
					if (audioRef.current === audio) audioRef.current = null;
					setPlayingKey((current) => (current === key ? "" : current));
				});
		},
		[playingKey, stopPlayback],
	);

	const playSystemVoice = useCallback(
		async (voice: SystemVoiceOption) => {
			const key = systemVoicePreviewKey(voice);
			if (playingKey === key) {
				stopPlayback(key);
				return;
			}

			const cachedSource = sourceCacheRef.current.get(key);
			if (voice.previewUrl || cachedSource) {
				playSource(key, cachedSource || voice.previewUrl);
				return;
			}

			setPreviewingKey(key);
			try {
				const response = await previewGenerationVoice({
					routeId: voice.routeId,
					voiceId: voice.value,
				});
				const source = generationAssetSource(response.asset);
				if (!source) return;
				sourceCacheRef.current.set(key, source);
				playSource(key, source);
			} finally {
				setPreviewingKey((current) => (current === key ? "" : current));
			}
		},
		[playingKey, playSource, stopPlayback],
	);

	useEffect(
		() => () => {
			audioRef.current?.pause();
			if (audioRef.current) audioRef.current.onended = null;
			audioRef.current = null;
		},
		[],
	);

	return {
		playingKey,
		previewingKey,
		playSource,
		playSystemVoice,
		stopPlayback,
	};
};
