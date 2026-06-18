import { Images } from "lucide-react";
import type React from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import { generationAssetSource } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export const untitledSelectedImageLabel = "未命名图片";

export const SelectedGenerationAssetsGrid: React.FC<{
	assets: SelectedGenerationAsset[];
	className?: string;
}> = ({ assets, className }) => (
	<PhotoProvider maskOpacity={0.84}>
		<section className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)}>
			{assets.map((asset) => (
				<SelectedGenerationAssetCard key={asset.id} asset={asset} />
			))}
		</section>
	</PhotoProvider>
);

export const SelectedGenerationAssetsEmpty: React.FC<{ label?: string }> = ({
	label = "暂无已选图片",
}) => (
	<div className="grid min-h-56 place-items-center border border-dashed border-border bg-card">
		<div className="grid justify-items-center gap-2 text-center">
			<Images className="size-5 text-muted-foreground" />
			<p className="text-sm text-foreground">{label}</p>
		</div>
	</div>
);

const SelectedGenerationAssetCard: React.FC<{ asset: SelectedGenerationAsset }> = ({ asset }) => {
	const source = selectedAssetSource(asset);
	const title = asset.title?.trim() || untitledSelectedImageLabel;

	return (
		<article className="min-w-0 overflow-hidden rounded-sm border border-border bg-card">
			<div className="aspect-[4/3] bg-ide-toolbar">
				{source ? (
					<PhotoView src={source}>
						<button type="button" className="size-full cursor-zoom-in" aria-label={`预览${title}`}>
							<img src={source} alt={title} className="size-full object-contain" />
						</button>
					</PhotoView>
				) : (
					<div className="grid size-full place-items-center text-xs text-muted-foreground">
						图片地址缺失
					</div>
				)}
			</div>
			<div className="px-3 py-2">
				<p className="truncate text-sm font-medium text-foreground" title={title}>
					{title}
				</p>
			</div>
		</article>
	);
};

const selectedAssetSource = (asset: SelectedGenerationAsset) =>
	generationAssetSource({
		kind: asset.kind,
		url: asset.url,
		base64: asset.base64,
		mimeType: asset.mimeType,
	});
