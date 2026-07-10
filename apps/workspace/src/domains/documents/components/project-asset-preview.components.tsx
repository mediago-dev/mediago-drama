import { File, Loader2 } from "lucide-react";
import type { MediaPlayerInstance } from "@vidstack/react";
import type React from "react";
import { memo, useRef } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { errorMessage, isMarkdownAsset, splitFrontmatter } from "./project-asset-preview.helpers";

export const TextAssetPreview: React.FC<{
	error: unknown;
	isLoading: boolean;
	showDocumentInfo: boolean;
	text?: string;
}> = ({ error, isLoading, showDocumentInfo, text }) => {
	if (isLoading) {
		return (
			<div className="grid min-h-0 flex-1 place-items-center border border-border bg-card">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" />
					<span>正在读取文本</span>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="min-h-0 flex-1 border border-border bg-card p-4 text-sm text-error-foreground">
				{errorMessage(error, "文本读取失败。")}
			</div>
		);
	}

	// Only Markdown files may treat a leading YAML block as document metadata.
	// Plain text and other source files must remain byte-for-byte equivalent after
	// decoding, including any leading `---` fences that are part of their content.
	const sourceText = text ?? "";
	const { body, frontmatter } = showDocumentInfo
		? splitFrontmatter(sourceText)
		: { body: sourceText, frontmatter: null };
	return (
		<div className="min-h-0 flex-1 overflow-auto border border-border bg-card">
			{frontmatter !== null ? (
				<details className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
					<summary className="cursor-pointer select-none font-medium">文档信息</summary>
					<pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
						{frontmatter}
					</pre>
				</details>
			) : null}
			<pre className="whitespace-pre-wrap break-words p-4 text-sm leading-7 text-foreground">
				{body}
			</pre>
		</div>
	);
};

const AssetPreviewBodyComponent: React.FC<{
	asset: ProjectAsset;
	isTextLoading: boolean;
	source: string;
	text?: string;
	textError: unknown;
}> = ({ asset, isTextLoading, source, text, textError }) => {
	const videoPlayerRef = useRef<MediaPlayerInstance | null>(null);

	if (asset.kind === "image") {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden border border-border bg-card p-4">
				<img src={source} alt={asset.filename} className="max-h-full max-w-full object-contain" />
			</div>
		);
	}

	if (asset.kind === "video") {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center border border-border bg-card p-2">
				<div className="aspect-video w-full max-w-[calc(70vh*16/9)] overflow-hidden bg-background">
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
		return (
			<TextAssetPreview
				text={text}
				error={textError}
				isLoading={isTextLoading}
				showDocumentInfo={isMarkdownAsset(asset)}
			/>
		);
	}

	return (
		<div className="grid min-h-0 flex-1 place-items-center border border-border bg-card p-6 text-center">
			<div className="max-w-sm">
				<File className="mx-auto mb-3 size-8 text-muted-foreground" />
				<p className="text-sm font-medium text-foreground">无法内联预览此文件</p>
				<p className="mt-1 text-xs text-muted-foreground">可下载后用本地应用打开。</p>
			</div>
		</div>
	);
};

// Memoized so keystrokes in the filename input above do not re-render the
// (potentially heavy) text or video preview — all props stay stable while
// only the pane's local draft state changes.
export const AssetPreviewBody = memo(AssetPreviewBodyComponent);
