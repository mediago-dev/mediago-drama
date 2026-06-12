import { File, Loader2 } from "lucide-react";
import type { MediaPlayerInstance } from "@vidstack/react";
import type React from "react";
import { useRef } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { apiResourceURL } from "@/shared/lib/api-base";
import { truncateTextPreview } from "./project-asset-preview.helpers";

export const TextAssetPreview: React.FC<{
	error: unknown;
	isLoading: boolean;
	text?: string;
}> = ({ error, isLoading, text }) => {
	if (isLoading) {
		return (
			<div className="grid min-h-80 place-items-center border border-border bg-card">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" />
					<span>正在读取文本</span>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="border border-border bg-card p-4 text-sm text-error-foreground">
				文本读取失败。
			</div>
		);
	}

	return (
		<pre className="max-h-[70vh] overflow-auto border border-border bg-card p-4 text-xs leading-5 text-foreground">
			{truncateTextPreview(text ?? "")}
		</pre>
	);
};

export const AssetPreviewBody: React.FC<{
	asset: ProjectAsset;
	isTextLoading: boolean;
	text?: string;
	textError: unknown;
}> = ({ asset, isTextLoading, text, textError }) => {
	const videoPlayerRef = useRef<MediaPlayerInstance | null>(null);
	const source = apiResourceURL(asset.url);

	if (asset.kind === "image") {
		return (
			<div className="flex min-h-80 items-start justify-center overflow-hidden border border-border bg-card">
				<img src={source} alt={asset.filename} className="max-h-[70vh] max-w-full object-contain" />
			</div>
		);
	}

	if (asset.kind === "video") {
		return (
			<div className="border border-border bg-card p-2">
				<div className="mx-auto aspect-video w-full max-w-[calc(70vh*16/9)] overflow-hidden bg-background">
					<VideoPlayer
						playerRef={videoPlayerRef}
						src={source}
						title={asset.filename}
						mimeType={asset.mimeType || "video/mp4"}
						showTitleInControls={false}
						className="h-full w-full"
					/>
				</div>
			</div>
		);
	}

	if (asset.kind === "text") {
		return <TextAssetPreview text={text} error={textError} isLoading={isTextLoading} />;
	}

	return (
		<div className="grid min-h-80 place-items-center border border-border bg-card p-6 text-center">
			<div className="max-w-sm">
				<File className="mx-auto mb-3 size-8 text-muted-foreground" />
				<p className="text-sm font-medium text-foreground">无法内联预览此文件</p>
				<p className="mt-1 text-xs text-muted-foreground">可下载后用本地应用打开。</p>
			</div>
		</div>
	);
};
