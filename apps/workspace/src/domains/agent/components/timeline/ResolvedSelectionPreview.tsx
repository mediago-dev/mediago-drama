import type React from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";

// ResolvedSelectionPreview shows the picked option's image on a frozen
// selection/form card and opens it in a zoomable lightbox on click, so the
// user can inspect the finalized image or style sample at full size.
export const ResolvedSelectionPreview: React.FC<{
	imageUrl?: string;
	alt: string;
}> = ({ imageUrl, alt }) => {
	if (!imageUrl) return null;
	return (
		<PhotoProvider maskOpacity={0.84}>
			<PhotoView src={imageUrl}>
				<button
					type="button"
					className="mt-2 block cursor-zoom-in rounded-sm border border-border p-0"
					aria-label={`查看大图：${alt}`}
				>
					<img src={imageUrl} alt={alt} className="max-h-40 max-w-full rounded-sm object-cover" />
				</button>
			</PhotoView>
		</PhotoProvider>
	);
};
