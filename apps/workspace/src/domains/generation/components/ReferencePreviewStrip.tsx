import { Music2, X } from "lucide-react";
import type React from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { Button } from "@/shared/components/ui/button";
import { apiResourceURL } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/utils";

export const ReferencePreviewStrip: React.FC<{
	disabled?: boolean;
	enableImagePreview?: boolean;
	onRemove?: (asset: MediaAsset) => void;
	referenceBadges?: Record<string, string>;
	references: MediaAsset[];
	requiresReference?: boolean;
	simple?: boolean;
	tone?: "card" | "ide";
}> = ({
	disabled,
	enableImagePreview,
	onRemove,
	referenceBadges,
	references,
	requiresReference,
	simple,
	tone = "ide",
}) => {
	if (disabled) {
		return (
			<div
				className={cn(
					"rounded-sm border border-dashed border-border p-3 text-xs text-muted-foreground",
					tone === "card" ? "bg-muted" : "bg-ide-toolbar",
				)}
			>
				当前供应商不使用参考媒体。
			</div>
		);
	}

	if (references.length === 0) {
		if (!requiresReference) return null;

		return (
			<div className="rounded-sm border border-dashed border-warning-border bg-warning-surface p-3 text-xs text-warning-foreground">
				请选择至少一个参考图像或视频。
			</div>
		);
	}

	if (simple) {
		return (
			<OptionalPhotoProvider enabled={enableImagePreview}>
				<div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
					{references.map((asset) => (
						<ReferencePreviewItem
							key={asset.id}
							asset={asset}
							badge={referenceBadges?.[asset.id]}
							enableImagePreview={enableImagePreview}
							simple
							tone={tone}
							onRemove={onRemove}
						/>
					))}
				</div>
			</OptionalPhotoProvider>
		);
	}

	return (
		<div
			className={cn(
				"rounded-sm border border-border p-3",
				tone === "card" ? "bg-card" : "bg-ide-panel",
			)}
		>
			<div className="mb-2 flex items-center justify-between gap-2">
				<p className="text-xs font-medium text-foreground">参考素材</p>
				<p className="text-xs text-muted-foreground">已选择 {references.length} 个</p>
			</div>
			<OptionalPhotoProvider enabled={enableImagePreview}>
				<div className="flex gap-2 overflow-x-auto pb-1">
					{references.map((asset) => (
						<ReferencePreviewItem
							key={asset.id}
							asset={asset}
							badge={referenceBadges?.[asset.id]}
							enableImagePreview={enableImagePreview}
							tone={tone}
							onRemove={onRemove}
						/>
					))}
				</div>
			</OptionalPhotoProvider>
		</div>
	);
};

const ReferencePreviewItem: React.FC<{
	asset: MediaAsset;
	badge?: string;
	enableImagePreview?: boolean;
	onRemove?: (asset: MediaAsset) => void;
	simple?: boolean;
	tone: "card" | "ide";
}> = ({ asset, badge, enableImagePreview, onRemove, simple, tone }) => (
	<div
		className={cn(
			"relative shrink-0 overflow-hidden rounded-sm",
			simple ? "h-20 w-20" : "h-24 w-24 border border-border",
			"bg-muted-foreground/10",
		)}
	>
		<ReferencePreviewMedia asset={asset} enableImagePreview={enableImagePreview} />
		{badge ? (
			<div
				className={cn(
					"pointer-events-none absolute left-1 right-1 z-10",
					simple ? "bottom-1" : "top-1",
				)}
			>
				<span className="block truncate rounded-sm bg-background/90 px-1.5 py-0.5 text-2xs font-medium text-foreground shadow-sm">
					{badge}
				</span>
			</div>
		) : null}
		{simple ? null : (
			<div
				className={cn(
					"pointer-events-none absolute inset-x-0 bottom-0 px-2 py-1",
					tone === "card" ? "bg-background/90" : "bg-ide-editor/85",
				)}
			>
				<p className="truncate text-xs text-foreground">{asset.filename}</p>
			</div>
		)}
		{onRemove ? (
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className={cn(
					"absolute right-1 top-1 h-6 w-6 p-0",
					tone === "card" ? "bg-background/90" : "bg-ide-editor/85",
				)}
				onClick={() => onRemove(asset)}
			>
				<X className="size-3" />
			</Button>
		) : null}
	</div>
);

const ReferencePreviewMedia: React.FC<{
	asset: MediaAsset;
	enableImagePreview?: boolean;
}> = ({ asset, enableImagePreview }) => {
	const source = apiResourceURL(asset.url);

	if (asset.kind === "video") {
		return <video src={source} muted preload="metadata" className="size-full object-cover" />;
	}

	if (asset.kind === "audio") {
		return (
			<div className="flex size-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
				<Music2 className="size-5" />
				<span className="text-2xs font-medium">音频</span>
			</div>
		);
	}

	const image = <img src={source} alt="" className="size-full object-contain" />;

	if (!enableImagePreview) return image;

	return (
		<PhotoView src={source}>
			<button
				type="button"
				className="size-full cursor-zoom-in"
				aria-label={`预览 ${asset.filename}`}
			>
				{image}
			</button>
		</PhotoView>
	);
};

const OptionalPhotoProvider: React.FC<{
	children: React.ReactNode;
	enabled?: boolean;
}> = ({ children, enabled }) =>
	enabled ? <PhotoProvider maskOpacity={0.84}>{children}</PhotoProvider> : <>{children}</>;
