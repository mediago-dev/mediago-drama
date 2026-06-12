import { Film } from "lucide-react";
import type React from "react";

export const GenerationVideoThumbnail: React.FC<{ source: string }> = ({ source }) => (
	<div className="relative size-full">
		<Film className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />
		<video
			src={source}
			muted
			playsInline
			preload="auto"
			aria-hidden="true"
			className="relative size-full object-cover"
			onLoadedMetadata={seekVideoPreviewFrame}
			onCanPlay={seekVideoPreviewFrame}
		/>
	</div>
);

const seekVideoPreviewFrame = (event: React.SyntheticEvent<HTMLVideoElement>) => {
	const video = event.currentTarget;
	if (video.dataset.previewFrameSeeked === "true") return;

	const duration = video.duration;
	const targetTime = Number.isFinite(duration) ? Math.min(0.1, Math.max(0, duration - 0.01)) : 0.1;
	if (targetTime <= 0) return;

	try {
		video.currentTime = targetTime;
		video.dataset.previewFrameSeeked = "true";
	} catch {
		// Some remote videos disallow programmatic seeking before enough data is buffered.
	}
};
