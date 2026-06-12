import { Loader2, Wand2, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { formatTimelineTime, type Episode, type TimelineClip } from "@/domains/episode/lib/sample";
import type { TimelineCompanionTrackType } from "@/domains/episode/stores";

interface EpisodeCompanionGenerationDialogProps {
	episode: Episode;
	onCommit: (videoClipId: string, trackType: TimelineCompanionTrackType, content: string) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	trackType: TimelineCompanionTrackType | null;
	videoClip: TimelineClip | null;
}

const titleId = "episode-companion-generation-title";

export const EpisodeCompanionGenerationDialog: React.FC<EpisodeCompanionGenerationDialogProps> = ({
	episode,
	onCommit,
	onOpenChange,
	open,
	trackType,
	videoClip,
}) => {
	const initialPrompt = useMemo(
		() =>
			videoClip && trackType ? buildCompanionGenerationPrompt(episode, videoClip, trackType) : "",
		[episode, trackType, videoClip],
	);
	const [prompt, setPrompt] = useState(initialPrompt);
	const [content, setContent] = useState("");
	const [isGenerating, setIsGenerating] = useState(false);
	const [hasGenerated, setHasGenerated] = useState(false);

	useEffect(() => {
		if (!open) return;

		setPrompt(initialPrompt);
		setContent("");
		setIsGenerating(false);
		setHasGenerated(false);
	}, [initialPrompt, open, trackType, videoClip?.id]);

	useEffect(() => {
		if (!open) return;

		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onOpenChange(false);
		};

		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [onOpenChange, open]);

	if (!open || !videoClip || !trackType) return null;

	const companionLabel = trackTypeLabel[trackType];
	const canCommit = hasGenerated && !isGenerating && Boolean(content.trim());

	const generateDraft = () => {
		setIsGenerating(true);

		window.setTimeout(() => {
			setContent(generateCompanionDraft(videoClip, prompt, trackType));
			setHasGenerated(true);
			setIsGenerating(false);
		}, 520);
	};

	const commitDraft = () => {
		if (!canCommit) return;

		onCommit(videoClip.id, trackType, content.trim());
		onOpenChange(false);
	};

	return (
		<div
			data-state="open"
			className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onOpenChange(false);
			}}
		>
			<section
				data-state="open"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className="flex max-h-[min(40rem,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
			>
				<header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
					<div className="min-w-0">
						<h2 id={titleId} className="truncate text-sm font-semibold text-foreground">
							生成{companionLabel} · {videoClip.title}
						</h2>
						<p className="mt-1 truncate text-xs text-muted-foreground">
							{formatTimelineTime(videoClip.start)} - {formatTimelineTime(videoClip.end)} ·{" "}
							{episode.aspectRatio}
						</p>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={`关闭${companionLabel}生成`}
						onClick={() => onOpenChange(false)}
					>
						<X />
					</Button>
				</header>

				<div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4">
					<div className="grid gap-2 rounded-sm border border-border bg-ide-panel p-3">
						<div className="flex items-center justify-between gap-3">
							<p className="text-xs font-medium text-foreground">分镜上下文</p>
							<p className="shrink-0 text-xs text-muted-foreground">
								{Math.max(1, Math.round(videoClip.end - videoClip.start))} 秒
							</p>
						</div>
						<p className="text-xs leading-5 text-muted-foreground">{videoClip.content}</p>
					</div>

					<div className="grid gap-2">
						<label className="text-xs font-medium text-foreground" htmlFor="companion-prompt">
							生成提示词
						</label>
						<Textarea
							id="companion-prompt"
							value={prompt}
							className="min-h-28 resize-none text-sm"
							onChange={(event) => {
								setPrompt(event.target.value);
								setHasGenerated(false);
							}}
						/>
					</div>

					<div className="grid gap-2">
						<label className="text-xs font-medium text-foreground" htmlFor="companion-output">
							{companionLabel}
						</label>
						<Textarea
							id="companion-output"
							value={content}
							placeholder={`生成后显示${companionLabel}文案`}
							className="min-h-36 resize-none text-sm"
							onChange={(event) => {
								setContent(event.target.value);
								setHasGenerated(Boolean(event.target.value.trim()));
							}}
						/>
					</div>
				</div>

				<footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
					<p className="min-w-0 truncate text-xs text-muted-foreground">
						生成完成后才会写入{companionLabel}轨道。
					</p>
					<div className="flex shrink-0 items-center gap-2">
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							取消
						</Button>
						<Button type="button" variant="outline" disabled={isGenerating} onClick={generateDraft}>
							{isGenerating ? <Loader2 className="animate-spin" /> : <Wand2 />}
							<span>{hasGenerated ? "重新生成" : "生成"}</span>
						</Button>
						<Button type="button" disabled={!canCommit} onClick={commitDraft}>
							加入时间轴
						</Button>
					</div>
				</footer>
			</section>
		</div>
	);
};

const trackTypeLabel: Record<TimelineCompanionTrackType, string> = {
	caption: "字幕",
	voiceover: "旁白",
};

const buildCompanionGenerationPrompt = (
	episode: Episode,
	videoClip: TimelineClip,
	trackType: TimelineCompanionTrackType,
) =>
	[
		`为《${episode.title}》的分镜「${videoClip.title}」生成${trackTypeLabel[trackType]}。`,
		`时间：${formatTimelineTime(videoClip.start)} - ${formatTimelineTime(videoClip.end)}`,
		`画面：${videoClip.content}`,
		videoClip.prompt ? `视频提示词：${videoClip.prompt}` : "",
		trackType === "voiceover"
			? "要求：旁白自然、有叙事推进，适合口播。"
			: "要求：字幕短句清晰，适合直接贴到画面上。",
	]
		.filter(Boolean)
		.join("\n");

const generateCompanionDraft = (
	videoClip: TimelineClip,
	prompt: string,
	trackType: TimelineCompanionTrackType,
) => {
	const base = cleanSentence(videoClip.content || prompt || videoClip.title);
	if (trackType === "caption") return captionFromText(base);

	const detail = cleanSentence(prompt).replace(base, "").trim();
	return detail ? `${base} ${detail}`.slice(0, 120) : `${base}，让这一幕自然承接当前节奏。`;
};

const cleanSentence = (value: string) =>
	value
		.replace(/[`*_#>[\]()]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[。！？,.，；;：:]+$/u, "");

const captionFromText = (value: string) => {
	const normalized = cleanSentence(value);
	if (normalized.length <= 24) return normalized;

	return `${normalized.slice(0, 22)}…`;
};
