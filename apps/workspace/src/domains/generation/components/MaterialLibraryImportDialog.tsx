import { AudioLines, Check, Loader2, UploadCloud } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { GenerationDialogShell } from "@/domains/generation/components/GenerationDialogShell";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { Button } from "@/shared/components/ui/button";
import { DialogDismissButton } from "@/shared/components/ui/dialog-dismiss";
import { Input } from "@/shared/components/ui/input";
import { apiResourceURL } from "@/shared/lib/api-base";
import { formatBytes } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export interface MaterialLibraryImportDialogProps {
	assetKind?: MaterialImportAssetKind;
	confirming?: boolean;
	mediaAssets: MediaAsset[];
	onConfirmSelection: (assets: MediaAsset[]) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	onRefreshAssets?: () => void;
	onUploadAsset?: (file: File) => Promise<MediaAsset>;
	open: boolean;
	selectionMode?: "multiple" | "single";
	selectedAssetIds?: string[];
}

type MaterialImportAssetKind = Extract<MediaAsset["kind"], "audio" | "image" | "video">;

type MaterialImportState =
	| {
			phase: "editing" | "uploading";
			query: string;
			selectedAssetIds: string[];
			uploadedAssets: MediaAsset[];
	  }
	| {
			message: string;
			phase: "error";
			query: string;
			selectedAssetIds: string[];
			uploadedAssets: MediaAsset[];
	  };

type MaterialImportAction =
	| { selectedAssetIds: string[]; type: "opened" }
	| { query: string; type: "queryChanged" }
	| { assetId: string; selectionMode: "multiple" | "single"; type: "selectionToggled" }
	| { type: "uploadStarted" }
	| { assets: MediaAsset[]; selectionMode: "multiple" | "single"; type: "uploadSucceeded" }
	| { message: string; type: "uploadFailed" };

const emptyMaterialImportSelectionIds: string[] = [];

const initialMaterialImportState: MaterialImportState = {
	phase: "editing",
	query: "",
	selectedAssetIds: [],
	uploadedAssets: [],
};

export const MaterialLibraryImportDialog: React.FC<MaterialLibraryImportDialogProps> = ({
	assetKind = "image",
	mediaAssets,
	confirming = false,
	onConfirmSelection,
	onOpenChange,
	onRefreshAssets,
	onUploadAsset,
	open,
	selectionMode = "multiple",
	selectedAssetIds = emptyMaterialImportSelectionIds,
}) => {
	const kindCopy = materialImportKindCopy[assetKind];
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const [state, dispatch] = useReducer(materialImportReducer, initialMaterialImportState);
	const isUploading = state.phase === "uploading";
	const uploadError = state.phase === "error" ? state.message : "";
	const availableMediaAssets = useMemo(
		() => mergeMaterialImportAssets(mediaAssets, state.uploadedAssets),
		[mediaAssets, state.uploadedAssets],
	);
	const filteredAssets = useMemo(
		() =>
			availableMediaAssets.filter((asset) => {
				if (asset.kind !== assetKind) return false;
				const normalizedQuery = state.query.trim().toLowerCase();
				if (!normalizedQuery) return true;
				return asset.filename.toLowerCase().includes(normalizedQuery);
			}),
		[assetKind, availableMediaAssets, state.query],
	);
	const filteredAssetCount = useMemo(
		() => availableMediaAssets.filter((asset) => asset.kind === assetKind).length,
		[assetKind, availableMediaAssets],
	);
	const draftSelectedAssetIdSet = useMemo(
		() => new Set(state.selectedAssetIds),
		[state.selectedAssetIds],
	);
	const selectedAssets = useMemo(
		() =>
			availableMediaAssets.filter(
				(asset) => asset.kind === assetKind && draftSelectedAssetIdSet.has(asset.id),
			),
		[assetKind, availableMediaAssets, draftSelectedAssetIdSet],
	);

	useEffect(() => {
		if (!open) return;
		dispatch({ type: "opened", selectedAssetIds });
	}, [open, selectedAssetIds]);

	useEffect(() => {
		if (!open) return;

		onRefreshAssets?.();
	}, [onOpenChange, onRefreshAssets, open]);

	const uploadSelectedFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const input = event.currentTarget;
		const files = Array.from(input.files ?? []).filter((file) =>
			isMaterialUploadFile(file, assetKind),
		);
		input.value = "";
		if (!onUploadAsset) return;
		if (files.length === 0) {
			dispatch({ type: "uploadFailed", message: kindCopy.invalidUploadMessage });
			return;
		}

		dispatch({ type: "uploadStarted" });
		try {
			const uploaded = (await Promise.all(files.map((file) => onUploadAsset(file)))).filter(
				(asset) => asset.kind === assetKind,
			);
			if (uploaded.length === 0) {
				dispatch({ type: "uploadFailed", message: kindCopy.noUploadedSelectableMessage });
				return;
			}
			dispatch({ type: "uploadSucceeded", assets: uploaded, selectionMode });
		} catch (error) {
			dispatch({
				type: "uploadFailed",
				message: materialImportErrorMessage(error, kindCopy.uploadFailureMessage),
			});
		}
	};

	const confirmSelection = () => {
		if (confirming || isUploading) return;
		void onConfirmSelection(selectedAssets);
	};

	if (!open) return null;

	return (
		<GenerationDialogShell
			open={open}
			title="从素材库中选择"
			titleId="generation-material-import-title"
			description={kindCopy.description}
			className="max-h-[min(42rem,calc(100vh-2rem))]"
			closeDisabled={confirming || isUploading}
			onOpenChange={onOpenChange}
			toolbar={
				<>
					<Input
						value={state.query}
						placeholder={kindCopy.searchPlaceholder}
						className="h-8 min-w-0 max-w-sm flex-1 rounded-md text-xs text-foreground"
						onChange={(event) => dispatch({ type: "queryChanged", query: event.target.value })}
					/>
					<input
						ref={uploadInputRef}
						aria-label={kindCopy.uploadInputLabel}
						type="file"
						accept={kindCopy.accept}
						multiple
						className="sr-only"
						disabled={confirming || isUploading || !onUploadAsset}
						onChange={uploadSelectedFiles}
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 shrink-0 rounded-md px-2.5 text-xs"
						disabled={confirming || isUploading || !onUploadAsset}
						onClick={() => uploadInputRef.current?.click()}
					>
						{isUploading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<UploadCloud className="size-4" />
						)}
						<span>{kindCopy.uploadButtonLabel}</span>
					</Button>
					<p className="shrink-0 text-xs text-muted-foreground">
						{kindCopy.label} {filteredAssetCount} 个
					</p>
				</>
			}
			error={uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : undefined}
			footer={
				<>
					<p className="text-xs text-muted-foreground">
						已选 {selectedAssets.length} {kindCopy.unit}
					</p>
					<div className="flex items-center gap-2">
						<DialogDismissButton
							type="button"
							variant="ghost"
							size="sm"
							disabled={confirming || isUploading}
							onClick={() => onOpenChange(false)}
						>
							取消
						</DialogDismissButton>
						<DialogDismissButton
							type="button"
							size="sm"
							disabled={confirming || isUploading}
							onClick={confirmSelection}
						>
							{confirming ? kindCopy.confirmingLabel : kindCopy.confirmLabel}
						</DialogDismissButton>
					</div>
				</>
			}
		>
			{filteredAssetCount === 0 ? (
				<div className="flex min-h-56 items-center justify-center rounded-sm border border-dashed border-border bg-muted px-4 text-center text-xs text-muted-foreground">
					{kindCopy.emptyMessage}
				</div>
			) : filteredAssets.length === 0 ? (
				<div className="flex min-h-56 items-center justify-center rounded-sm border border-dashed border-border bg-muted px-4 text-center text-xs text-muted-foreground">
					{kindCopy.noMatchMessage}
				</div>
			) : (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
					{filteredAssets.map((asset) => (
						<MaterialLibraryImportCard
							key={asset.id}
							asset={asset}
							assetKind={assetKind}
							selected={draftSelectedAssetIdSet.has(asset.id)}
							onSelect={() =>
								dispatch({ type: "selectionToggled", assetId: asset.id, selectionMode })
							}
						/>
					))}
				</div>
			)}
		</GenerationDialogShell>
	);
};

const materialImportReducer = (
	state: MaterialImportState,
	action: MaterialImportAction,
): MaterialImportState => {
	switch (action.type) {
		case "opened":
			return {
				phase: "editing",
				query: "",
				selectedAssetIds: action.selectedAssetIds,
				uploadedAssets: [],
			};
		case "queryChanged":
			return { ...state, query: action.query };
		case "selectionToggled":
			if (action.selectionMode === "single") {
				return {
					...state,
					selectedAssetIds: state.selectedAssetIds.includes(action.assetId) ? [] : [action.assetId],
				};
			}

			return {
				...state,
				selectedAssetIds: state.selectedAssetIds.includes(action.assetId)
					? state.selectedAssetIds.filter((id) => id !== action.assetId)
					: [...state.selectedAssetIds, action.assetId],
			};
		case "uploadStarted":
			return { ...state, phase: "uploading" };
		case "uploadSucceeded":
			const lastUploadedAssetId = action.assets.at(-1)?.id;
			return {
				phase: "editing",
				query: state.query,
				selectedAssetIds:
					action.selectionMode === "single"
						? lastUploadedAssetId
							? [lastUploadedAssetId]
							: []
						: uniqueMaterialAssetIds([
								...state.selectedAssetIds,
								...action.assets.map((asset) => asset.id),
							]),
				uploadedAssets: mergeMaterialImportAssets(state.uploadedAssets, action.assets),
			};
		case "uploadFailed":
			return { ...state, phase: "error", message: action.message };
	}
};

const MaterialLibraryImportCard: React.FC<{
	asset: MediaAsset;
	assetKind: MaterialImportAssetKind;
	onSelect: () => void;
	selected: boolean;
}> = ({ asset, assetKind, onSelect, selected }) => (
	<button
		type="button"
		role="checkbox"
		aria-checked={selected}
		className={cn(
			"min-w-0 overflow-hidden rounded-sm border bg-card text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			selected ? "border-primary" : "border-border hover:border-input",
		)}
		onClick={onSelect}
	>
		<div className="relative aspect-[4/3] bg-muted-foreground/10">
			{assetKind === "image" ? (
				<img src={apiResourceURL(asset.url)} alt="" className="size-full object-contain" />
			) : assetKind === "video" ? (
				<video
					src={apiResourceURL(asset.url)}
					poster={asset.posterUrl ? apiResourceURL(asset.posterUrl) : undefined}
					className="size-full object-contain"
					muted
					preload="metadata"
				/>
			) : (
				<div className="flex size-full items-center justify-center text-muted-foreground">
					<AudioLines className="size-8" />
				</div>
			)}
			{selected ? (
				<span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-sm bg-primary px-1.5 py-1 text-xs font-medium text-primary-foreground shadow-sm">
					<Check className="size-3" />
					已选
				</span>
			) : null}
		</div>
		<div className="grid gap-1 p-2">
			<p className="truncate text-xs font-medium text-foreground">{asset.filename}</p>
			<p className="truncate text-2xs text-muted-foreground">
				{materialImportKindCopy[assetKind].label} · {formatBytes(asset.sizeBytes)}
			</p>
		</div>
	</button>
);

const materialImportKindCopy: Record<
	MaterialImportAssetKind,
	{
		accept: string;
		confirmingLabel: string;
		confirmLabel: string;
		description: string;
		emptyMessage: string;
		invalidUploadMessage: string;
		label: string;
		noMatchMessage: string;
		noUploadedSelectableMessage: string;
		searchPlaceholder: string;
		unit: string;
		uploadButtonLabel: string;
		uploadFailureMessage: string;
		uploadInputLabel: string;
	}
> = {
	audio: {
		accept: "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm",
		confirmingLabel: "选择中...",
		confirmLabel: "选择音频",
		description: "上传音频，或从当前项目素材中选择。",
		emptyMessage: "当前素材库暂无音频素材。",
		invalidUploadMessage: "请选择音频文件。",
		label: "音频",
		noMatchMessage: "没有匹配的音频素材。",
		noUploadedSelectableMessage: "上传完成，但没有可选择的音频素材。",
		searchPlaceholder: "搜索音频素材",
		unit: "个",
		uploadButtonLabel: "上传音频",
		uploadFailureMessage: "音频上传失败。",
		uploadInputLabel: "上传音频素材",
	},
	image: {
		accept: "image/*",
		confirmingLabel: "加入中...",
		confirmLabel: "加入生成记录",
		description: "确认后加入当前生成记录，再从生成记录中选择是否放入文档。",
		emptyMessage: "当前素材库暂无图片素材。",
		invalidUploadMessage: "请选择图片文件。",
		label: "图片",
		noMatchMessage: "没有匹配的图片素材。",
		noUploadedSelectableMessage: "上传完成，但没有可选择的图片素材。",
		searchPlaceholder: "搜索图片素材",
		unit: "张",
		uploadButtonLabel: "上传图片",
		uploadFailureMessage: "图片上传失败。",
		uploadInputLabel: "上传图片素材",
	},
	video: {
		accept: "video/*,.mp4,.webm,.mov,.m4v",
		confirmingLabel: "加入中...",
		confirmLabel: "加入生成记录",
		description: "确认后加入当前视频生成记录，再从生成记录中选择是否放入分镜。",
		emptyMessage: "当前素材库暂无视频素材。",
		invalidUploadMessage: "请选择视频文件。",
		label: "视频",
		noMatchMessage: "没有匹配的视频素材。",
		noUploadedSelectableMessage: "上传完成，但没有可选择的视频素材。",
		searchPlaceholder: "搜索视频素材",
		unit: "个",
		uploadButtonLabel: "上传视频",
		uploadFailureMessage: "视频上传失败。",
		uploadInputLabel: "上传视频素材",
	},
};

const mergeMaterialImportAssets = (baseAssets: MediaAsset[], nextAssets: MediaAsset[]) => {
	const seen = new Set<string>();
	const merged: MediaAsset[] = [];
	for (const asset of [...nextAssets, ...baseAssets]) {
		if (!asset.id || seen.has(asset.id)) continue;
		seen.add(asset.id);
		merged.push(asset);
	}
	return merged;
};

const uniqueMaterialAssetIds = (ids: string[]) => {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const id of ids) {
		const value = id.trim();
		if (!value || seen.has(value)) continue;
		seen.add(value);
		unique.push(value);
	}
	return unique;
};

const isMaterialUploadFile = (file: File, kind: MaterialImportAssetKind) => {
	if (kind === "audio") {
		return file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/iu.test(file.name);
	}
	if (kind === "video") {
		return file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/iu.test(file.name);
	}

	return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif)$/iu.test(file.name);
};

const materialImportErrorMessage = (error: unknown, fallback: string) => {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return fallback;
};
