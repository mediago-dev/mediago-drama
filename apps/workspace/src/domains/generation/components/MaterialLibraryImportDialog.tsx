import { Check, Loader2, UploadCloud } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { GenerationDialogShell } from "@/domains/generation/components/GenerationDialogShell";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { apiResourceURL } from "@/shared/lib/api-base";
import { formatBytes } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export interface MaterialLibraryImportDialogProps {
	confirming?: boolean;
	mediaAssets: MediaAsset[];
	onConfirmSelection: (assets: MediaAsset[]) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	onRefreshAssets?: () => void;
	onUploadAsset?: (file: File) => Promise<MediaAsset>;
	open: boolean;
	selectedAssetIds?: string[];
}

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
	| { assetId: string; type: "selectionToggled" }
	| { type: "uploadStarted" }
	| { assets: MediaAsset[]; type: "uploadSucceeded" }
	| { message: string; type: "uploadFailed" };

const emptyMaterialImportSelectionIds: string[] = [];

const initialMaterialImportState: MaterialImportState = {
	phase: "editing",
	query: "",
	selectedAssetIds: [],
	uploadedAssets: [],
};

export const MaterialLibraryImportDialog: React.FC<MaterialLibraryImportDialogProps> = ({
	mediaAssets,
	confirming = false,
	onConfirmSelection,
	onOpenChange,
	onRefreshAssets,
	onUploadAsset,
	open,
	selectedAssetIds = emptyMaterialImportSelectionIds,
}) => {
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const [state, dispatch] = useReducer(materialImportReducer, initialMaterialImportState);
	const isUploading = state.phase === "uploading";
	const uploadError = state.phase === "error" ? state.message : "";
	const availableMediaAssets = useMemo(
		() => mergeMaterialImportAssets(mediaAssets, state.uploadedAssets),
		[mediaAssets, state.uploadedAssets],
	);
	const imageAssets = useMemo(
		() =>
			availableMediaAssets.filter((asset) => {
				if (asset.kind !== "image") return false;
				const normalizedQuery = state.query.trim().toLowerCase();
				if (!normalizedQuery) return true;
				return asset.filename.toLowerCase().includes(normalizedQuery);
			}),
		[availableMediaAssets, state.query],
	);
	const imageAssetCount = useMemo(
		() => availableMediaAssets.filter((asset) => asset.kind === "image").length,
		[availableMediaAssets],
	);
	const draftSelectedAssetIdSet = useMemo(
		() => new Set(state.selectedAssetIds),
		[state.selectedAssetIds],
	);
	const selectedAssets = useMemo(
		() =>
			availableMediaAssets.filter(
				(asset) => asset.kind === "image" && draftSelectedAssetIdSet.has(asset.id),
			),
		[availableMediaAssets, draftSelectedAssetIdSet],
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
		const files = Array.from(input.files ?? []).filter(isImageUploadFile);
		input.value = "";
		if (!onUploadAsset) return;
		if (files.length === 0) {
			dispatch({ type: "uploadFailed", message: "请选择图片文件。" });
			return;
		}

		dispatch({ type: "uploadStarted" });
		try {
			const uploaded = (await Promise.all(files.map((file) => onUploadAsset(file)))).filter(
				(asset) => asset.kind === "image",
			);
			if (uploaded.length === 0) {
				dispatch({ type: "uploadFailed", message: "上传完成，但没有可选择的图片素材。" });
				return;
			}
			dispatch({ type: "uploadSucceeded", assets: uploaded });
		} catch (error) {
			dispatch({
				type: "uploadFailed",
				message: materialImportErrorMessage(error, "图片上传失败。"),
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
			description="确认后加入当前生成记录，再从生成记录中选择是否放入文档。"
			className="max-h-[min(42rem,calc(100vh-2rem))]"
			closeDisabled={confirming || isUploading}
			onOpenChange={onOpenChange}
			toolbar={
				<>
					<Input
						value={state.query}
						placeholder="搜索图片素材"
						className="h-8 min-w-0 max-w-sm flex-1 rounded-md text-xs text-foreground"
						onChange={(event) => dispatch({ type: "queryChanged", query: event.target.value })}
					/>
					<input
						ref={uploadInputRef}
						aria-label="上传图片素材"
						type="file"
						accept="image/*"
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
						<span>上传图片</span>
					</Button>
					<p className="shrink-0 text-xs text-muted-foreground">图片 {imageAssetCount} 个</p>
				</>
			}
			error={uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : undefined}
			footer={
				<>
					<p className="text-xs text-muted-foreground">已选 {selectedAssets.length} 张</p>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={confirming || isUploading}
							onClick={() => onOpenChange(false)}
						>
							取消
						</Button>
						<Button
							type="button"
							size="sm"
							disabled={confirming || isUploading}
							onClick={confirmSelection}
						>
							{confirming ? "加入中..." : "加入生成记录"}
						</Button>
					</div>
				</>
			}
		>
			{imageAssetCount === 0 ? (
				<div className="flex min-h-56 items-center justify-center rounded-sm border border-dashed border-border bg-muted px-4 text-center text-xs text-muted-foreground">
					当前素材库暂无图片素材。
				</div>
			) : imageAssets.length === 0 ? (
				<div className="flex min-h-56 items-center justify-center rounded-sm border border-dashed border-border bg-muted px-4 text-center text-xs text-muted-foreground">
					没有匹配的图片素材。
				</div>
			) : (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
					{imageAssets.map((asset) => (
						<MaterialLibraryImportCard
							key={asset.id}
							asset={asset}
							selected={draftSelectedAssetIdSet.has(asset.id)}
							onSelect={() => dispatch({ type: "selectionToggled", assetId: asset.id })}
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
			return {
				...state,
				selectedAssetIds: state.selectedAssetIds.includes(action.assetId)
					? state.selectedAssetIds.filter((id) => id !== action.assetId)
					: [...state.selectedAssetIds, action.assetId],
			};
		case "uploadStarted":
			return { ...state, phase: "uploading" };
		case "uploadSucceeded":
			return {
				phase: "editing",
				query: state.query,
				selectedAssetIds: uniqueMaterialAssetIds([
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
	onSelect: () => void;
	selected: boolean;
}> = ({ asset, onSelect, selected }) => (
	<button
		type="button"
		role="checkbox"
		aria-checked={selected}
		className={cn(
			"min-w-0 overflow-hidden rounded-sm border bg-card text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-input",
		)}
		onClick={onSelect}
	>
		<div className="relative aspect-[4/3] bg-muted-foreground/10">
			<img src={apiResourceURL(asset.url)} alt="" className="size-full object-contain" />
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
				图片 · {formatBytes(asset.sizeBytes)}
			</p>
		</div>
	</button>
);

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

const isImageUploadFile = (file: File) =>
	file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif)$/iu.test(file.name);

const materialImportErrorMessage = (error: unknown, fallback: string) => {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return fallback;
};
