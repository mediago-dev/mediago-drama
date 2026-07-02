import {
	AlertCircle,
	AudioLines,
	Check,
	ChevronDown,
	Clipboard,
	Film,
	Image as ImageIcon,
	Loader2,
	RefreshCw,
	Save,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import { Virtuoso } from "react-virtuoso";
import { AudioPlayer } from "@/components/AudioPlayer";
import { VideoPlayer } from "@/components/VideoPlayer";
import type { GenerationAsset } from "@/domains/generation/api/generation";
import { MarkdownContent } from "@/domains/agent/components/timeline/MarkdownContent";
import { Button } from "@/shared/components/ui/button";
import {
	generationAssetPosterSource,
	generationAssetSelectionKey,
	generationAssetSource,
	generationCreatedAtDetail,
	generationStatusLabel,
	isPendingVideoMessage,
	kindLabel,
	type ChatMessage,
	type ChatMessageDetail,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";
import {
	generatedAssetSaveKey,
	generatedTextSaveKey,
} from "@/domains/generation/components/generatedResultActions";

export const GenerationChatPanel: React.FC<{
	canSaveText?: boolean;
	entries: GenerationEntry[];
	onCopyPrompt?: (entry: GenerationEntry) => void;
	onRefreshVideo: (message: ChatMessage) => void;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onSaveText?: (entry: GenerationEntry) => void;
	onSelectEntry: (id: string) => void;
	onSelectGeneratedAsset?: (asset: GenerationAsset) => void;
	savedKeys?: string[];
	savingKeys?: string[];
	selectedGeneratedAssetKey?: string | null;
}> = ({
	canSaveText = false,
	entries,
	onCopyPrompt,
	onRefreshVideo,
	onSaveAsset,
	onSaveText,
	onSelectEntry,
	onSelectGeneratedAsset,
	savedKeys = [],
	savingKeys = [],
	selectedGeneratedAssetKey,
}) => {
	const listIdentity = useMemo(
		() => entries.map((entry) => entry.id).join("|") || "empty",
		[entries],
	);

	return (
		<section className="flex min-h-0 flex-1 flex-col bg-ide-editor">
			<Virtuoso
				key={listIdentity}
				className="h-full min-h-0 flex-1"
				data={entries}
				alignToBottom
				computeItemKey={(index, entry) => entry?.id ?? `generation-entry:${index}`}
				followOutput={(atBottom) => (atBottom ? "smooth" : false)}
				initialItemCount={Math.min(entries.length, 20)}
				increaseViewportBy={{ top: 900, bottom: 900 }}
				skipAnimationFrameInResizeObserver
				itemContent={(index, entry) => (
					<div
						className={cn(
							"mx-auto w-full max-w-6xl px-4 pb-6 md:px-6",
							index === 0 && "pt-4 md:pt-6",
						)}
					>
						<GenerationChatEntry
							entry={entry}
							canSaveText={canSaveText}
							onRefreshVideo={onRefreshVideo}
							onCopyPrompt={onCopyPrompt}
							onSaveAsset={onSaveAsset}
							onSaveText={onSaveText}
							onSelect={() => onSelectEntry(entry.id)}
							onSelectGeneratedAsset={onSelectGeneratedAsset}
							savedKeys={savedKeys}
							savingKeys={savingKeys}
							selectedGeneratedAssetKey={selectedGeneratedAssetKey}
						/>
					</div>
				)}
			/>
		</section>
	);
};

const GenerationChatEntry: React.FC<{
	canSaveText: boolean;
	entry: GenerationEntry;
	onCopyPrompt?: (entry: GenerationEntry) => void;
	onRefreshVideo: (message: ChatMessage) => void;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onSaveText?: (entry: GenerationEntry) => void;
	onSelect: () => void;
	onSelectGeneratedAsset?: (asset: GenerationAsset) => void;
	savedKeys: string[];
	savingKeys: string[];
	selectedGeneratedAssetKey?: string | null;
}> = ({
	canSaveText,
	entry,
	onCopyPrompt,
	onRefreshVideo,
	onSaveAsset,
	onSaveText,
	onSelect,
	onSelectGeneratedAsset,
	savedKeys,
	savingKeys,
	selectedGeneratedAssetKey,
}) => {
	const pending = isPendingGenerationStatus(entry.assistantMessage?.status ?? entry.status);
	const hasGeneratedAssets = Boolean(entry.assets?.length);
	const requestSummary = requestInlineSummary(
		requestDetailsWithCreatedAt(entry.requestDetails ?? [], entry.createdAt),
	);
	const requestedImageCount =
		pending && entry.kind === "image" ? requestGenerationCount(entry.requestDetails ?? []) : 0;
	const pendingPlaceholderCount = Math.max(0, requestedImageCount - (entry.assets?.length ?? 0));
	const isTextEntry = entry.kind === "text";
	const showTextLoading = isTextEntry && pending && entry.content.trim() === "";
	const failed = isFailedGenerationStatus(entry.assistantMessage?.status ?? entry.status);

	return (
		<div className="grid gap-3 border-b border-border pb-6 last:border-b-0">
			<div className="text-left">
				<CollapsiblePromptText
					prompt={entry.prompt || "生成请求"}
					requestSummary={requestSummary}
					onCopy={onCopyPrompt ? () => onCopyPrompt(entry) : undefined}
					onSelect={onSelect}
				/>
				<GenerationChatAssetStrip assets={entry.requestAssets ?? []} onSelect={onSelect} />
			</div>

			{hasGeneratedAssets && entry.assets ? (
				<GenerationAssetGallery
					entry={entry}
					assets={entry.assets}
					onSaveAsset={onSaveAsset}
					pendingPlaceholderCount={pendingPlaceholderCount}
					selectedGeneratedAssetKey={selectedGeneratedAssetKey}
					savedKeys={savedKeys}
					savingKeys={savingKeys}
					onSelectGeneratedAsset={onSelectGeneratedAsset}
				/>
			) : failed ? (
				<GenerationFailureCard entry={entry} />
			) : pendingPlaceholderCount > 1 ? (
				<GenerationPendingGrid count={pendingPlaceholderCount} />
			) : (
				<div className="max-w-[min(44rem,92%)] rounded-sm border border-border bg-ide-panel p-3">
					{isTextEntry ? null : (
						<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
							<div className="flex min-w-0 items-center gap-2">
								<div className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-ide-toolbar text-muted-foreground">
									{pending ? (
										<Loader2 className="size-4 animate-spin" />
									) : entry.kind === "image" ? (
										<ImageIcon className="size-4" />
									) : entry.kind === "audio" ? (
										<AudioLines className="size-4" />
									) : (
										<Film className="size-4" />
									)}
								</div>
								<div className="min-w-0">
									<p className="truncate text-xs font-medium text-foreground">
										{kindLabel(entry.kind)}
									</p>
									<p className="truncate text-xs text-muted-foreground">
										{entry.status ? generationStatusLabel(entry.status) : "生成结果"}
									</p>
								</div>
							</div>
							{entry.assistantMessage && isPendingVideoMessage(entry.assistantMessage) ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										if (entry.assistantMessage) onRefreshVideo(entry.assistantMessage);
									}}
								>
									<RefreshCw className="size-4" />
									<span>检查</span>
								</Button>
							) : null}
						</div>
					)}
					{isTextEntry ? (
						<div className="text-sm leading-6 text-foreground">
							{showTextLoading ? (
								<div className="flex items-center gap-2 text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									<span>文本生成中...</span>
								</div>
							) : (
								<MarkdownContent content={entry.content} />
							)}
							{canSaveText && onSaveText && entry.content.trim() ? (
								<div className="mt-3 flex justify-end">
									<SaveGeneratedResultButton
										saved={savedKeys.includes(generatedTextSaveKey(entry))}
										saving={savingKeys.includes(generatedTextSaveKey(entry))}
										onSave={() => onSaveText(entry)}
									/>
								</div>
							) : null}
						</div>
					) : (
						<p className="rounded-sm border border-dashed border-border bg-ide-editor p-3 text-xs leading-5 text-muted-foreground break-all">
							{entry.content}
						</p>
					)}
				</div>
			)}
			<GenerationDetailText details={entry.resultDetails ?? []} />
		</div>
	);
};

const collapsedPromptMaxHeightClassName = "max-h-[7rem]";
const promptCharacterCollapseThreshold = 180;
const promptLineCollapseThreshold = 4;

const CollapsiblePromptText: React.FC<{
	onCopy?: () => void;
	onSelect: () => void;
	prompt: string;
	requestSummary: string;
}> = ({ onCopy, onSelect, prompt, requestSummary }) => {
	const promptRef = useRef<HTMLParagraphElement | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [measuredOverflow, setMeasuredOverflow] = useState(false);
	const shouldOfferToggle =
		measuredOverflow || promptLikelyNeedsCollapse(prompt, promptCharacterCollapseThreshold);

	useEffect(() => {
		setExpanded(false);
		setMeasuredOverflow(false);
	}, [prompt]);

	useEffect(() => {
		if (expanded) return;

		const promptElement = promptRef.current;
		if (!promptElement) return;

		const measureOverflow = () => {
			setMeasuredOverflow(promptElement.scrollHeight > promptElement.clientHeight + 1);
		};

		measureOverflow();

		const observer = new ResizeObserver(measureOverflow);
		observer.observe(promptElement);

		return () => observer.disconnect();
	}, [expanded, prompt]);

	return (
		<div className="max-w-full">
			{onCopy ? (
				<div className="mb-1 flex justify-end">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-label="复制 Prompt"
						title="复制 Prompt"
						className="h-6 px-1.5 text-2xs text-muted-foreground hover:text-foreground"
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							onCopy();
						}}
					>
						<Clipboard className="size-3.5" />
						<span>复制 Prompt</span>
					</Button>
				</div>
			) : null}
			<div
				role="button"
				tabIndex={0}
				className="cursor-text select-text"
				onClick={onSelect}
				onKeyDown={(event) => handleKeyboardSelect(event, onSelect)}
			>
				<p
					ref={promptRef}
					className={cn(
						"whitespace-pre-wrap break-words text-sm leading-7 text-foreground",
						!expanded && `${collapsedPromptMaxHeightClassName} overflow-hidden`,
					)}
				>
					{prompt}
				</p>
				{requestSummary ? (
					<p className="mt-1 break-all text-sm leading-6 text-muted-foreground">{requestSummary}</p>
				) : null}
			</div>
			{shouldOfferToggle ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-expanded={expanded}
					aria-label={expanded ? "收起 Prompt" : "展开 Prompt"}
					className="mt-1 h-6 px-1.5 text-2xs text-muted-foreground hover:text-foreground"
					onClick={() => setExpanded((current) => !current)}
				>
					<ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
					<span>{expanded ? "收起 Prompt" : "展开 Prompt"}</span>
				</Button>
			) : null}
		</div>
	);
};

const promptLikelyNeedsCollapse = (prompt: string, characterThreshold: number) => {
	const lineCount = prompt.split(/\r\n|\r|\n/u).length;

	return prompt.length > characterThreshold || lineCount > promptLineCollapseThreshold;
};

const handleKeyboardSelect = (event: React.KeyboardEvent<HTMLElement>, onSelect: () => void) => {
	if (event.key !== "Enter" && event.key !== " ") return;

	event.preventDefault();
	onSelect();
};

const GenerationFailureCard: React.FC<{
	entry: GenerationEntry;
}> = ({ entry }) => {
	const rawError = (entry.error || entry.assistantMessage?.error || "").trim();
	const legacyRawError = rawError || legacyRawErrorFromContent(entry.content);
	const summary = generationFailureSummary({
		errorCode: entry.errorCode || entry.assistantMessage?.errorCode,
		errorType: entry.errorType || entry.assistantMessage?.errorType,
		message: entry.content,
		rawError: legacyRawError,
	});
	const retryable = Boolean(entry.retryable || entry.assistantMessage?.retryable);

	return (
		<div className="max-w-[min(44rem,92%)] overflow-hidden rounded-sm border border-error-border bg-error-surface">
			<div className="flex min-w-0 gap-3 p-3">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-error-border bg-card text-error-foreground">
					<AlertCircle className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<p className="text-sm font-semibold text-error-foreground">
							{kindLabel(entry.kind)}生成失败
						</p>
						{entry.status ? (
							<span className="rounded-sm border border-error-border bg-card px-1.5 py-0.5 text-2xs font-medium text-error-foreground">
								{generationStatusLabel(entry.status)}
							</span>
						) : null}
					</div>
					<p className="mt-1 text-xs leading-5 text-error-foreground">{summary}</p>
					{retryable ? (
						<p className="mt-1 text-xs leading-5 text-error-foreground/80">可以稍后重试。</p>
					) : null}
					{legacyRawError ? (
						<details className="group mt-3">
							<summary className="cursor-pointer text-xs font-medium text-error-foreground outline-none transition-colors hover:text-foreground">
								错误详情
							</summary>
							<pre className="mt-2 max-h-36 overflow-auto rounded-sm border border-error-border bg-card p-2 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words">
								{compactGenerationError(legacyRawError)}
							</pre>
						</details>
					) : null}
				</div>
			</div>
		</div>
	);
};

const GenerationPendingGrid: React.FC<{
	count: number;
}> = ({ count }) => (
	<div className="grid max-w-full grid-cols-2 gap-3 lg:grid-cols-4">
		{Array.from({ length: count }, (_, index) => (
			<div
				key={index}
				className="flex aspect-[3/4] min-h-40 items-center justify-center rounded-sm border border-border bg-ide-panel"
			>
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
			</div>
		))}
	</div>
);

const GenerationChatAssetStrip: React.FC<{
	assets: GenerationAsset[];
	onSelect: () => void;
}> = ({ assets, onSelect }) => {
	const visibleAssets = assets.filter((asset) => generationAssetSource(asset));
	if (visibleAssets.length === 0) return null;

	return (
		<div
			role="button"
			tabIndex={0}
			className="mt-3 flex gap-2 overflow-x-auto pb-1"
			onClick={onSelect}
			onKeyDown={(event) => handleKeyboardSelect(event, onSelect)}
		>
			{visibleAssets.map((asset) => {
				const source = generationAssetSource(asset);
				return (
					<div
						key={`${asset.kind}:${source}`}
						className={cn(
							"flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border",
							asset.kind === "video" || asset.kind === "audio"
								? "bg-ide-toolbar"
								: "bg-muted-foreground/10",
						)}
					>
						{asset.kind === "video" ? (
							<video
								src={source}
								poster={generationAssetPosterSource(asset) || undefined}
								muted
								preload="metadata"
								className="size-full object-cover"
							/>
						) : asset.kind === "audio" ? (
							<AudioLines className="size-5 text-muted-foreground" />
						) : (
							<img src={source} alt="" className="size-full object-contain" />
						)}
					</div>
				);
			})}
		</div>
	);
};

const requestDetailsWithCreatedAt = (
	details: ChatMessageDetail[],
	createdAt?: string,
): ChatMessageDetail[] => {
	const createdAtDetail = generationCreatedAtDetail(createdAt);
	if (!createdAtDetail || details.some((detail) => detail.label === createdAtDetail.label)) {
		return details;
	}

	return [...details, createdAtDetail];
};

const isPendingGenerationStatus = (status?: string) =>
	[
		"loading",
		"streaming",
		"submitting",
		"submitted",
		"running",
		"pending",
		"processing",
		"queued",
	].includes(String(status ?? "").toLowerCase());

const isFailedGenerationStatus = (status?: string) =>
	["failed", "error", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());

const generationFailureSummary = ({
	errorCode,
	errorType,
	message,
	rawError,
}: {
	errorCode?: string;
	errorType?: string;
	message?: string;
	rawError: string;
}) => {
	const readableMessage = (message ?? "").trim();
	if (readableMessage && !isRawFailureText(readableMessage)) {
		return readableMessage;
	}
	const normalizedType = `${errorType ?? ""} ${errorCode ?? ""}`.toLowerCase();
	if (normalizedType.includes("policy_violation")) {
		return "生成结果触发供应商内容安全策略，未返回可用结果。";
	}
	if (normalizedType.includes("invalid_parameter")) {
		return "请求参数无效，请调整参数后重试。";
	}
	if (normalizedType.includes("timeout")) {
		return "模型服务响应超时，任务可能仍在处理中，请稍后再检查。";
	}
	if (normalizedType.includes("rate_limited")) {
		return "供应商请求频率受限，请稍后重试。";
	}
	if (normalizedType.includes("authentication")) {
		return "供应商密钥未配置或无效，请检查供应商配置。";
	}

	const detail = compactGenerationError(rawError);
	const normalized = detail.toLowerCase();
	if (!normalized) return "生成服务没有返回错误详情。";

	// Legacy fallback for locally cached messages created before backend error mapping.
	if (normalized.includes("policyviolation") || normalized.includes("copyright restrictions")) {
		return "生成结果触发供应商内容安全策略，未返回可用结果。";
	}
	if (normalized.includes("invalidparameter") && normalized.includes("duration")) {
		return "请求参数无效：当前模型不支持这个时长。";
	}
	if (normalized.includes("context deadline exceeded")) {
		return "状态检查超时，任务可能仍在供应商侧处理。请稍后再次检查状态。";
	}
	if (normalized.includes("status 400")) {
		return "供应商返回 400 错误，请调整参数或提示词后重试。";
	}

	return truncateFailureText(detail, 120);
};

const legacyRawErrorFromContent = (content: string) => {
	const trimmed = content.trim();
	return isRawFailureText(trimmed) ? trimmed : "";
};

const isRawFailureText = (text: string) => {
	const normalized = text.toLowerCase();
	return (
		text.length > 160 ||
		normalized.includes("request failed with status") ||
		normalized.includes("dmx request failed") ||
		normalized.includes('{"error"') ||
		normalized.includes('\\"error\\"')
	);
};

const compactGenerationError = (rawError: string) =>
	rawError
		.trim()
		.replace(/^生成请求失败。\s*/u, "")
		.replace(/^视频生成任务已提交，完成后请再次检查状态。\s*/u, "")
		.replace(/\\n/g, "\n")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");

const truncateFailureText = (value: string, maxLength: number) => {
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length <= maxLength) return text;

	return `${text.slice(0, maxLength - 1)}...`;
};

const GenerationAssetGallery: React.FC<{
	assets: GenerationAsset[];
	entry: GenerationEntry;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onSelectGeneratedAsset?: (asset: GenerationAsset) => void;
	pendingPlaceholderCount?: number;
	savedKeys: string[];
	savingKeys: string[];
	selectedGeneratedAssetKey?: string | null;
}> = ({
	assets,
	entry,
	onSaveAsset,
	onSelectGeneratedAsset,
	pendingPlaceholderCount = 0,
	savedKeys,
	savingKeys,
	selectedGeneratedAssetKey,
}) => {
	if (assets.length === 0 && pendingPlaceholderCount === 0) return null;

	return (
		<PhotoProvider maskOpacity={0.84}>
			<div className="flex max-w-full gap-2 overflow-x-auto pb-1">
				{assets.map((asset) => {
					const source = generationAssetSource(asset);
					if (!source) return null;
					const selected =
						asset.kind === "image" &&
						selectedGeneratedAssetKey === generationAssetSelectionKey(asset);

					return asset.kind === "audio" ? (
						<div
							key={source}
							className="relative flex w-[min(36rem,78vw)] shrink-0 flex-col gap-3 overflow-hidden rounded-sm border border-border bg-ide-panel p-3"
						>
							<div className="flex min-w-0 items-center gap-2 pr-20">
								<span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
									<AudioLines className="size-4" />
								</span>
								<div className="min-w-0">
									<p className="truncate text-xs font-medium text-foreground">生成音频</p>
									<p className="truncate text-2xs text-muted-foreground">
										{asset.mimeType || "audio/mpeg"}
									</p>
								</div>
							</div>
							<AudioPlayer
								src={source}
								mimeType={asset.mimeType || "audio/mpeg"}
								title="生成音频"
							/>
							{onSaveAsset ? (
								<SaveGeneratedResultButton
									className="absolute right-2 top-2 z-10"
									saved={savedKeys.includes(generatedAssetSaveKey(entry, asset))}
									saving={savingKeys.includes(generatedAssetSaveKey(entry, asset))}
									onSave={() => onSaveAsset(entry, asset)}
								/>
							) : null}
						</div>
					) : asset.kind === "video" ? (
						<div
							key={source}
							className="relative w-[min(44rem,78vw)] shrink-0 overflow-hidden rounded-sm border border-border bg-ide-toolbar"
						>
							<VideoPlayer
								src={source}
								mimeType={asset.mimeType || "video/mp4"}
								poster={generationAssetPosterSource(asset)}
								showTitleInControls={false}
								className="h-full w-full"
							/>
							{onSaveAsset ? (
								<SaveGeneratedResultButton
									className="absolute right-2 top-2 z-10"
									saved={savedKeys.includes(generatedAssetSaveKey(entry, asset))}
									saving={savingKeys.includes(generatedAssetSaveKey(entry, asset))}
									onSave={() => onSaveAsset(entry, asset)}
								/>
							) : null}
						</div>
					) : (
						<div
							key={source}
							className={cn(
								"relative shrink-0 overflow-hidden rounded-sm border bg-muted-foreground/10",
								selected ? "border-primary" : "border-border",
							)}
						>
							<PhotoView src={source}>
								<button type="button" className="block cursor-zoom-in" aria-label="预览生成图片">
									<img
										src={source}
										alt=""
										className="block h-[22rem] max-h-[62vh] max-w-[min(18rem,78vw)] object-contain"
									/>
								</button>
							</PhotoView>
							{onSaveAsset ? (
								<SaveGeneratedResultButton
									className="absolute right-2 top-2 z-10"
									saved={savedKeys.includes(generatedAssetSaveKey(entry, asset))}
									saving={savingKeys.includes(generatedAssetSaveKey(entry, asset))}
									onSave={() => onSaveAsset(entry, asset)}
								/>
							) : null}
							{onSelectGeneratedAsset ? (
								<div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-ide-editor/90 px-2 py-2">
									<span className="truncate text-xs text-foreground">
										{selected ? "已选用到当前标题区域" : "生成结果"}
									</span>
									<Button
										type="button"
										size="sm"
										variant={selected ? "default" : "outline"}
										className="h-7 shrink-0 rounded-sm px-2"
										onClick={() => onSelectGeneratedAsset(asset)}
									>
										{selected ? <Check className="size-3.5" /> : <ImageIcon className="size-3.5" />}
										<span>{selected ? "已选用" : "选用"}</span>
									</Button>
								</div>
							) : null}
						</div>
					);
				})}
				{Array.from({ length: pendingPlaceholderCount }, (_, index) => (
					<GenerationPendingImageCard key={`pending:${assets.length + index}`} />
				))}
			</div>
		</PhotoProvider>
	);
};

const GenerationPendingImageCard: React.FC = () => (
	<div className="flex h-[22rem] max-h-[62vh] w-[min(18rem,78vw)] shrink-0 flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border bg-ide-panel text-xs text-muted-foreground">
		<Loader2 className="size-5 animate-spin" />
		<span>生成中</span>
	</div>
);

const SaveGeneratedResultButton: React.FC<{
	className?: string;
	onSave: () => void;
	saved: boolean;
	saving: boolean;
}> = ({ className, onSave, saved, saving }) => (
	<Button
		type="button"
		variant="secondary"
		size="sm"
		disabled={saving || saved}
		aria-label={saved ? "素材已保存" : saving ? "正在保存素材" : "保存素材"}
		title={saved ? "素材已保存" : "保存素材"}
		className={cn(
			"h-7 shrink-0 rounded-sm border-border bg-card/90 px-2 text-xs text-foreground shadow-sm hover:bg-card disabled:opacity-100 [&_svg]:size-3.5",
			saved && "text-success-foreground",
			className,
		)}
		onClick={(event) => {
			event.preventDefault();
			event.stopPropagation();
			onSave();
		}}
	>
		{saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : <Save />}
		<span>{saved ? "已保存" : "保存"}</span>
	</Button>
);

const GenerationDetailText: React.FC<{
	details: ChatMessageDetail[];
}> = ({ details }) => {
	if (details.length === 0) return null;

	return (
		<p className="break-all text-xs leading-5 text-muted-foreground">
			{details.map((detail) => `${detail.label}: ${detail.value}`).join(" | ")}
		</p>
	);
};

const requestInlineSummary = (details: ChatMessageDetail[]) =>
	details.map((detail) => `${detail.label}: ${detail.value}`).join(" | ");

const requestGenerationCount = (details: ChatMessageDetail[]) => {
	for (const detail of details) {
		if (!isGenerationCountLabel(detail.label)) continue;

		const count = countFromDetailValue(detail.value);
		if (count !== null) return count;
	}

	return 1;
};

const isGenerationCountLabel = (label: string) => {
	const normalizedLabel = label.trim().toLowerCase();

	return (
		normalizedLabel === "n" ||
		normalizedLabel === "images" ||
		normalizedLabel === "图像数量" ||
		normalizedLabel === "图片数量" ||
		normalizedLabel === "生成数量" ||
		normalizedLabel === "数量"
	);
};

const countFromDetailValue = (value: string) => {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:张|个|幅|images?|pics?|pictures?)?$/iu);
	if (!match?.[1]) return null;

	const count = Number(match[1]);
	if (!Number.isFinite(count)) return null;

	return Math.max(1, Math.min(4, Math.round(count)));
};
