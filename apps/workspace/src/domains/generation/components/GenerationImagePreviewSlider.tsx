import { Check } from "lucide-react";
import type React from "react";
import { PhotoSlider } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import type { GenerationAsset } from "@/domains/generation/api/generation";
import { generationAssetSelectionKey } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export interface GenerationImagePreviewItem {
	asset: GenerationAsset;
	key: string;
	src: string;
}

interface GenerationImagePreviewSliderProps {
	images: GenerationImagePreviewItem[];
	index: number | null;
	onClose: () => void;
	onIndexChange: (index: number) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	selectedAssetKeys: string[];
}

export const GenerationImagePreviewSlider: React.FC<GenerationImagePreviewSliderProps> = ({
	images,
	index,
	onClose,
	onIndexChange,
	onToggleAsset,
	selectedAssetKeys,
}) => {
	const visible = index !== null && images.length > 0;
	const safeIndex = visible ? clampPreviewIndex(index, images.length) : 0;

	return (
		<PhotoSlider
			images={images.map((image) => ({ key: image.key, src: image.src }))}
			index={safeIndex}
			maskOpacity={0.84}
			visible={visible}
			toolbarRender={({ index: currentIndex }) => {
				const item = images[currentIndex];
				if (!item || !onToggleAsset) return null;

				const selectionKey = generationAssetSelectionKey(item.asset);
				if (!selectionKey) return null;

				const selected = selectedAssetKeys.includes(selectionKey);

				return (
					<button
						type="button"
						role="checkbox"
						aria-checked={selected}
						aria-label={selected ? "取消选入图片" : "选入图片"}
						title={selected ? "取消选入图片" : "选入图片"}
						className={cn(
							"flex size-9 items-center justify-center rounded-sm border shadow-lg ring-1 ring-black/15 transition-colors",
							selected
								? "border-primary bg-primary text-primary-foreground"
								: "border-white/80 bg-background/90 text-transparent hover:bg-background",
						)}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							onToggleAsset(item.asset, !selected);
						}}
					>
						<Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
					</button>
				);
			}}
			onClose={onClose}
			onIndexChange={(nextIndex) => {
				onIndexChange(clampPreviewIndex(nextIndex, images.length));
			}}
		/>
	);
};

const clampPreviewIndex = (index: number, length: number) =>
	Math.min(Math.max(index, 0), Math.max(length - 1, 0));
