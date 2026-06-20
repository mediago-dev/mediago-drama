import { AudioLines, Check, Film, Loader2, Pencil, UploadCloud, X } from "lucide-react";
import type React from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { apiResourceURL } from "@/shared/lib/api-base";
import {
	formatBytes,
	mediaKindLabel,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export const MaterialLibrary: React.FC<{
	activeAssetId?: string | null;
	assets: MediaAsset[];
	className?: string;
	compact?: boolean;
	disabled?: boolean;
	inputId: string;
	isUploading?: boolean;
	kindFilter: "all" | "image" | "video" | "audio";
	listClassName?: string;
	enableImagePreview?: boolean;
	onDelete: (asset: MediaAsset) => void;
	onKindFilterChange: (value: "all" | "image" | "video" | "audio") => void;
	onQueryChange: (value: string) => void;
	onRename: (asset: MediaAsset) => void;
	onToggle: (asset: MediaAsset) => void;
	onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
	query: string;
	selectableKinds: Set<MediaAsset["kind"]>;
	separated?: boolean;
	selectedAssetIds: string[];
	scrollList?: boolean;
	showRenameButton?: boolean;
	showUploadButton?: boolean;
	tone?: "card" | "ide";
	uploadButtonIconOnly?: boolean;
	uploadButtonPlacement?: "search" | "top";
}> = ({
	activeAssetId,
	assets,
	className,
	compact,
	disabled,
	inputId,
	isUploading,
	kindFilter,
	listClassName,
	enableImagePreview,
	onDelete,
	onKindFilterChange,
	onQueryChange,
	onRename,
	onToggle,
	onUpload,
	query,
	selectableKinds,
	separated = true,
	selectedAssetIds,
	scrollList = true,
	showRenameButton = true,
	showUploadButton = true,
	tone = "ide",
	uploadButtonIconOnly = false,
	uploadButtonPlacement = "top",
}) => (
	<section
		className={cn(
			separated ? "border-t border-border pt-4" : undefined,
			compact ? "sm:col-span-2 lg:col-span-3" : undefined,
			"min-w-0",
			className,
		)}
	>
		<input
			id={inputId}
			type="file"
			accept="image/*,video/*,audio/*"
			className="sr-only"
			disabled={disabled || isUploading}
			onChange={onUpload}
		/>
		{showUploadButton && uploadButtonPlacement === "top" ? (
			<div className="mb-3 flex shrink-0 justify-end">
				<MaterialUploadButton
					disabled={disabled || isUploading}
					iconOnly={uploadButtonIconOnly}
					inputId={inputId}
					isUploading={isUploading}
				/>
			</div>
		) : null}
		<div className="mb-3 grid shrink-0 gap-2">
			<div className="flex min-w-0 items-center gap-2">
				<Input
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					placeholder="搜索素材"
					className="h-8 min-w-0 flex-1 rounded-md text-xs text-foreground"
				/>
				{showUploadButton && uploadButtonPlacement === "search" ? (
					<MaterialUploadButton
						className="h-8 w-8 rounded-md"
						disabled={disabled || isUploading}
						iconOnly={uploadButtonIconOnly}
						inputId={inputId}
						isUploading={isUploading}
					/>
				) : null}
			</div>
			<Tabs
				value={kindFilter}
				onValueChange={(value) => onKindFilterChange(value as typeof kindFilter)}
			>
				<TabsList className="grid h-8 w-full grid-cols-4">
					<TabsTrigger value="all" className="text-xs">
						全部
					</TabsTrigger>
					<TabsTrigger value="image" className="text-xs">
						图像
					</TabsTrigger>
					<TabsTrigger value="video" className="text-xs">
						视频
					</TabsTrigger>
					<TabsTrigger value="audio" className="text-xs">
						音频
					</TabsTrigger>
				</TabsList>
			</Tabs>
		</div>
		{assets.length === 0 ? (
			<p
				className={cn(
					"shrink-0 rounded-sm border border-border p-3 text-xs text-muted-foreground",
					tone === "card" ? "bg-muted" : "bg-ide-editor",
				)}
			>
				没有匹配的素材。
			</p>
		) : (
			<div
				className={cn(
					"min-h-0 min-w-0",
					scrollList && listClassName ? "flex flex-1 flex-col overflow-hidden" : undefined,
				)}
			>
				<OptionalPhotoProvider enabled={enableImagePreview}>
					<div
						className={cn(
							"flex min-h-0 min-w-0 flex-col gap-2 pr-1",
							scrollList ? "max-h-72 overflow-y-auto overscroll-contain" : undefined,
							listClassName,
						)}
					>
						{assets.map((asset) => {
							const selected = selectedAssetIds.includes(asset.id);
							const busy = activeAssetId === asset.id;
							const selectable = !disabled && selectableKinds.has(asset.kind);
							return (
								<div
									key={asset.id}
									className={cn(
										"flex min-h-14 min-w-0 max-w-full shrink-0 items-center gap-2 overflow-hidden rounded-sm border p-2",
										tone === "card" ? "bg-background" : "bg-ide-editor",
										selected ? "border-primary" : "border-border",
										!selectable ? "opacity-60" : undefined,
									)}
								>
									{enableImagePreview ? (
										<MaterialAssetThumbnail asset={asset} enableImagePreview tone={tone} />
									) : null}
									<Button
										type="button"
										disabled={!selectable}
										variant="ghost"
										className="flex h-auto min-w-0 flex-1 justify-start gap-2 overflow-hidden p-0 text-left hover:bg-transparent"
										onClick={() => onToggle(asset)}
									>
										{enableImagePreview ? null : (
											<MaterialAssetThumbnail asset={asset} tone={tone} />
										)}
										<div className="min-w-0 flex-1">
											<p className="truncate text-xs font-medium text-foreground">
												{asset.filename}
											</p>
											<p className="truncate text-xs text-muted-foreground">
												{mediaKindLabel(asset.kind)} · {formatBytes(asset.sizeBytes)}
												{asset.kind === "video" && !selectable ? " · 仅结果素材" : ""}
											</p>
										</div>
										{selected ? <Check className="ml-auto size-4 shrink-0 text-primary" /> : null}
									</Button>
									{showRenameButton ? (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-8 px-2"
											disabled={busy}
											onClick={() => onRename(asset)}
										>
											<Pencil className="size-4" />
										</Button>
									) : null}
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-8 px-2"
										disabled={busy}
										onClick={() => onDelete(asset)}
									>
										{busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
									</Button>
								</div>
							);
						})}
					</div>
				</OptionalPhotoProvider>
			</div>
		)}
	</section>
);

const MaterialUploadButton: React.FC<{
	className?: string;
	disabled?: boolean;
	iconOnly?: boolean;
	inputId: string;
	isUploading?: boolean;
}> = ({ className, disabled, iconOnly, inputId, isUploading }) => (
	<Button
		type="button"
		variant="outline"
		size={iconOnly ? "icon" : "sm"}
		className={className}
		disabled={disabled}
		aria-label="上传素材"
		onClick={() => document.getElementById(inputId)?.click()}
	>
		{isUploading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
		{iconOnly ? null : <span>上传</span>}
	</Button>
);

const OptionalPhotoProvider: React.FC<{
	children: React.ReactNode;
	enabled?: boolean;
}> = ({ children, enabled }) =>
	enabled ? <PhotoProvider maskOpacity={0.84}>{children}</PhotoProvider> : <>{children}</>;

const MaterialAssetThumbnail: React.FC<{
	asset: MediaAsset;
	enableImagePreview?: boolean;
	tone: "card" | "ide";
}> = ({ asset, enableImagePreview, tone }) => {
	const className = cn(
		"flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border",
		asset.kind === "image"
			? "bg-muted-foreground/10"
			: tone === "card"
				? "bg-muted"
				: "bg-ide-toolbar",
	);

	if (asset.kind !== "image") {
		return (
			<div className={className}>
				{asset.kind === "audio" ? (
					<AudioLines className="size-4 text-muted-foreground" />
				) : (
					<Film className="size-4 text-muted-foreground" />
				)}
			</div>
		);
	}

	const source = apiResourceURL(asset.url);
	const image = <img src={source} alt="" className="size-full object-contain" />;

	if (!enableImagePreview) {
		return <div className={className}>{image}</div>;
	}

	return (
		<PhotoView src={source}>
			<button
				type="button"
				className={cn(className, "cursor-zoom-in")}
				aria-label={`预览 ${asset.filename}`}
			>
				{image}
			</button>
		</PhotoView>
	);
};
