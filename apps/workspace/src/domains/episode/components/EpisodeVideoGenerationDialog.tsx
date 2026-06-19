import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type {
	GenerationAsset,
	GenerationNotificationOpenTarget,
} from "@/domains/generation/api/generation";
import { projectGenerationConversation } from "@/domains/generation/api/generation";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import { DocumentMentionHoverPopover } from "@/domains/documents/components/DocumentMentionHoverPopover";
import { DocumentMention } from "@/domains/documents/components/extensions/document-mention";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	buildMentionPreviewReferences,
	buildMentionReferenceInputs,
	extractDocumentImageAssets,
	type MentionPreviewReferences,
	uniqueResolvedMention,
} from "@/domains/documents/lib/mention-generation-references";
import {
	mentionReferenceKey,
	parseMentionsFromMarkdown,
	resolveMentionPayload,
} from "@/domains/documents/lib/mention-resolver";
import { normalizeHeadingText, stripSectionIdCommentLines } from "@/domains/documents/lib/sections";
import { type MarkdownDocument, useDocumentsStore } from "@/domains/documents/stores";
import { formatTimelineTime, type Episode, type TimelineClip } from "@/domains/episode/lib/sample";
import {
	MediaGenerationWorkspace,
	type PromptEditorProps,
} from "@/domains/generation/components/MediaGenerationWorkspace";
import { PromptEditor } from "@/domains/generation/components/PromptEditor";
import {
	generationAssetSelectionKey,
	generationAssetSource,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";

interface EpisodeVideoGenerationDialogProps {
	documentId?: string;
	documentTitle?: string;
	episode: Episode;
	onGeneratedVideoReady?: (clipId: string, videoUrl: string | null) => void;
	onOpenChange: (open: boolean) => void;
	onOpenReferenceGeneration?: (section: MarkdownSectionContext) => void;
	open: boolean;
	projectId?: string;
	selectedClip: TimelineClip | null;
	selectedVideoUrl?: string | null;
}

interface EpisodeVideoGenerationContext {
	blockId: string;
	headingLevel: number;
	headingOccurrence: number;
	headingText: string;
	plainText: string;
	prompt: string;
	sourceMarkdown: string;
}

interface EpisodeVideoSourceSection {
	bodyMarkdown: string;
	headingLevel: number;
	headingOccurrence: number;
	headingText: string;
	markdown: string;
	plainText: string;
}

const titleId = "episode-video-generation-title";

export const EpisodeVideoGenerationDialog: React.FC<EpisodeVideoGenerationDialogProps> = ({
	documentId,
	documentTitle,
	episode,
	onGeneratedVideoReady,
	onOpenChange,
	onOpenReferenceGeneration,
	open,
	projectId,
	selectedClip,
	selectedVideoUrl,
}) => {
	const allDocuments = useDocumentsStore((state) => state.documents);
	const allAssets = useDocumentsStore((state) => state.assets);
	const sourceDocument = useMemo(
		() => allDocuments.find((document) => document.id === documentId?.trim()) ?? null,
		[allDocuments, documentId],
	);
	const sourceSection = useMemo(
		() => findEpisodeVideoSourceSection(sourceDocument?.content ?? "", selectedClip),
		[sourceDocument?.content, selectedClip],
	);
	const generationContext = useMemo(
		() => buildEpisodeVideoContext(episode, selectedClip, sourceSection),
		[episode, selectedClip, sourceSection],
	);
	const [removedMentionKeys, setRemovedMentionKeys] = useState<string[]>([]);
	const removedMentionKeySet = useMemo(() => new Set(removedMentionKeys), [removedMentionKeys]);
	const mediaAssets = useMemo(
		() =>
			allDocuments.flatMap((document) =>
				extractDocumentImageAssets(document.id, document.content ?? ""),
			),
		[allDocuments],
	);
	const latestMentionPreviewRef = useRef<MentionPreviewReferences>({
		assetMentionKeys: {},
		badges: {},
		references: [],
	});
	// 项目内的视频生成统一归到「项目级命名会话」，让创作台可见；非项目场景回退到按分镜片段的 scope。
	const normalizedProjectId = projectId?.trim() ?? "";
	const { data: projectsData } = useSWR(normalizedProjectId ? projectsKey : null, getProjects);
	const projectName = useMemo(
		() => projectsData?.projects.find((project) => project.id === normalizedProjectId)?.name ?? "",
		[projectsData, normalizedProjectId],
	);
	const projectConversation = useMemo(
		() => projectGenerationConversation(projectId, "video", projectName),
		[projectId, projectName],
	);
	const conversationScopeId = projectConversation?.conversationScopeId ?? generationContext.blockId;
	// 本地乐观缓存按分镜片段隔离；项目级会话里用 sectionId(=blockId) 过滤出当前片段的服务端任务。
	const historyScopeId = generationContext.blockId;
	const sectionId = projectConversation ? generationContext.blockId : undefined;
	const resolveAllMentionsFromPrompt = useCallback(
		(promptMarkdown: string) =>
			parseMentionsFromMarkdown(`${generationContext.sourceMarkdown}\n\n${promptMarkdown}`)
				.map((reference) => resolveMentionPayload(reference, allDocuments, allAssets))
				.filter(uniqueResolvedMention),
		[allAssets, allDocuments, generationContext.sourceMarkdown],
	);
	const resolveActiveMentionsFromPrompt = useCallback(
		(promptMarkdown: string) =>
			resolveAllMentionsFromPrompt(promptMarkdown).filter(
				(mention) => !removedMentionKeySet.has(mentionReferenceKey(mention.reference)),
			),
		[removedMentionKeySet, resolveAllMentionsFromPrompt],
	);
	const mentionReferenceAssetIds = useCallback(
		(promptMarkdown: string) =>
			buildMentionReferenceInputs(resolveActiveMentionsFromPrompt(promptMarkdown)).assetIds,
		[resolveActiveMentionsFromPrompt],
	);
	const mentionReferenceUrls = useCallback(
		(promptMarkdown: string) =>
			buildMentionReferenceInputs(resolveActiveMentionsFromPrompt(promptMarkdown)).urls,
		[resolveActiveMentionsFromPrompt],
	);
	const getMentionPreview = useCallback(
		(promptMarkdown: string) => {
			const mentions = resolveActiveMentionsFromPrompt(promptMarkdown);
			const preview = buildMentionPreviewReferences(mentions, mediaAssets);

			latestMentionPreviewRef.current = preview;

			return { mentions, preview };
		},
		[mediaAssets, resolveActiveMentionsFromPrompt],
	);
	const removePreviewReferenceAsset = useCallback((asset: MediaAsset) => {
		const mentionKey = latestMentionPreviewRef.current.assetMentionKeys[asset.id];
		if (!mentionKey) return;

		setRemovedMentionKeys((current) =>
			current.includes(mentionKey) ? current : [...current, mentionKey],
		);
	}, []);
	const notificationTarget = useMemo<GenerationNotificationOpenTarget | undefined>(() => {
		const normalizedProjectId = projectId?.trim();
		const normalizedDocumentId = documentId?.trim();
		if (!normalizedProjectId || !normalizedDocumentId) return undefined;

		return {
			kind: "document-section",
			projectId: normalizedProjectId,
			documentId: normalizedDocumentId,
			documentTitle: documentTitle?.trim() || episode.title,
			section: {
				blockId: generationContext.blockId,
				documentId: normalizedDocumentId,
				headingLevel: generationContext.headingLevel,
				headingOccurrence: generationContext.headingOccurrence,
				headingText: generationContext.headingText,
				markdown: generationContext.sourceMarkdown,
				plainText: generationContext.plainText,
				prompt: generationContext.prompt,
			},
		};
	}, [documentId, documentTitle, episode.title, generationContext, projectId]);
	const selectedAssetKeys = useMemo(() => {
		if (!selectedVideoUrl) return [];

		const assetKey = generationAssetSelectionKey({ kind: "video", url: selectedVideoUrl });
		return assetKey ? [assetKey] : [];
	}, [selectedVideoUrl]);
	const toggleGeneratedVideo = useCallback(
		(asset: GenerationAsset, selected: boolean) => {
			if (!selectedClip) return;

			const videoUrl = firstVideoAssetSource([asset]);
			if (!videoUrl) return;

			onGeneratedVideoReady?.(selectedClip.id, selected ? videoUrl : null);
		},
		[onGeneratedVideoReady, selectedClip],
	);

	useEffect(() => {
		setRemovedMentionKeys([]);
	}, [generationContext.blockId, generationContext.sourceMarkdown]);

	return (
		<GenerationModalShell
			open={open}
			title={`生成视频素材 · ${selectedClip?.title ?? episode.title}`}
			titleId={titleId}
			onOpenChange={onOpenChange}
		>
			<MediaGenerationWorkspace
				className="min-h-0 flex-1"
				kind="video"
				emptyResultText="生成后会在这里显示可预览的视频素材。"
				conversationId={projectConversation?.conversationId}
				conversationScopeId={conversationScopeId}
				conversationTitle={projectConversation?.conversationTitle}
				extraReferenceAssetIds={mentionReferenceAssetIds}
				extraReferenceUrls={mentionReferenceUrls}
				historyScopeId={historyScopeId}
				sectionId={sectionId}
				taskType="storyboard"
				initialPrompt={generationContext.prompt}
				modelPreferenceScopeId={conversationScopeId}
				notificationTarget={notificationTarget}
				promptPlaceholder="描述当前组的视频镜头、运动、机位、时长、画幅和质量"
				projectId={projectId}
				referenceBadges={(prompt) => getMentionPreview(prompt).preview.badges}
				referencePreviewAssets={(prompt) => getMentionPreview(prompt).preview.references}
				renderPromptEditor={(props) => (
					<EpisodeVideoPromptMentionEditor
						{...props}
						allAssets={allAssets}
						allDocuments={allDocuments}
						onGenerateReference={onOpenReferenceGeneration}
					/>
				)}
				submitLabel="生成视频"
				uploadIdPrefix="episode-video-generation"
				selectedAssetKeys={selectedAssetKeys}
				viewMode="history"
				onToggleAsset={toggleGeneratedVideo}
				onRemoveReferencePreview={removePreviewReferenceAsset}
				onGenerationComplete={(_, assets) => {
					const videoUrl = firstVideoAssetSource(assets);
					if (selectedClip && videoUrl) onGeneratedVideoReady?.(selectedClip.id, videoUrl);
				}}
			/>
		</GenerationModalShell>
	);
};

const buildEpisodeVideoContext = (
	episode: Episode,
	selectedClip: TimelineClip | null,
	sourceSection: EpisodeVideoSourceSection | null,
): EpisodeVideoGenerationContext => {
	const blockId = `episode-video:${episode.id}:${selectedClip?.id ?? "episode"}`;
	const headingText = sourceSection?.headingText ?? selectedClip?.title.trim() ?? episode.title;
	const plainText = sourceSection?.plainText ?? selectedClip?.content.trim() ?? episode.title;

	return {
		blockId,
		headingLevel: sourceSection?.headingLevel ?? 2,
		headingOccurrence: sourceSection?.headingOccurrence ?? 1,
		headingText,
		plainText,
		prompt: buildEpisodeVideoPrompt(episode, selectedClip, sourceSection),
		sourceMarkdown:
			sourceSection?.markdown ?? [`## ${headingText}`, "", plainText].filter(Boolean).join("\n"),
	};
};

const buildEpisodeVideoPrompt = (
	episode: Episode,
	selectedClip: TimelineClip | null,
	sourceSection: EpisodeVideoSourceSection | null,
) => {
	if (!selectedClip) {
		return [
			`为《${episode.title}》生成一段可用于剪辑工作台预览的视频镜头。`,
			`画幅比例：${episode.aspectRatio}`,
			`剧集时长：${formatTimelineTime(episode.duration)}`,
			"要求：镜头运动自然，画面清晰，适合作为时间线中的视频素材。",
		].join("\n");
	}

	const duration = Math.max(1, Math.round(selectedClip.end - selectedClip.start));
	const sourcePrompt = stripEpisodeVideoPromptInternalReferences(
		sourceSection?.bodyMarkdown || selectedClip.prompt || selectedClip.content,
	);
	return [
		sourcePrompt,
		"",
		`分组标题：${selectedClip.title}`,
		`画面内容：${selectedClip.content}`,
		`时间位置：${formatTimelineTime(selectedClip.start)} - ${formatTimelineTime(selectedClip.end)}`,
		`目标时长：${duration} 秒`,
		`画幅比例：${episode.aspectRatio}`,
		"要求：作为当前组的视频素材，动作连续，构图稳定，避免文字水印。",
	].join("\n");
};

const EpisodeVideoPromptMentionEditor: React.FC<
	PromptEditorProps & {
		allAssets: ProjectAsset[];
		allDocuments: MarkdownDocument[];
		onGenerateReference?: (section: MarkdownSectionContext) => void;
	}
> = ({ allAssets, allDocuments, onGenerateReference, ...props }) => {
	const extensions = useMemo(() => [DocumentMention], []);

	return (
		<DocumentMentionHoverPopover
			allAssets={allAssets}
			allDocuments={allDocuments}
			onGenerateReference={onGenerateReference}
		>
			<PromptEditor
				{...props}
				extensions={extensions}
				editorClassName="section-prompt-prosemirror"
			/>
		</DocumentMentionHoverPopover>
	);
};

const findEpisodeVideoSourceSection = (
	documentMarkdown: string,
	selectedClip: TimelineClip | null,
): EpisodeVideoSourceSection | null => {
	if (!selectedClip || !documentMarkdown.trim()) return null;

	const sections = collectMarkdownHeadingSections(documentMarkdown);
	if (sections.length === 0) return null;

	const normalizedTitle = normalizeHeadingText(selectedClip.title);
	const titleMatch = sections.find((section) => section.normalizedHeadingText === normalizedTitle);
	if (titleMatch) return titleMatch;

	const sourceIndex = episodeClipSourceIndex(selectedClip.id);
	if (sourceIndex == null) return null;

	return sections[sourceIndex] ?? null;
};

interface CollectedMarkdownSection extends EpisodeVideoSourceSection {
	normalizedHeadingText: string;
}

const collectMarkdownHeadingSections = (documentMarkdown: string): CollectedMarkdownSection[] => {
	const lines = documentMarkdown.split("\n");
	const headingOccurrences = new Map<string, number>();
	const sections: CollectedMarkdownSection[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
		if (!heading?.[1] || !heading[2]) continue;

		const headingLevel = heading[1].length;
		const headingText = heading[2].trim();
		const normalizedHeadingText = normalizeHeadingText(headingText);
		const occurrenceKey = `${headingLevel}:${normalizedHeadingText}`;
		const headingOccurrence = (headingOccurrences.get(occurrenceKey) ?? 0) + 1;
		headingOccurrences.set(occurrenceKey, headingOccurrence);

		const endIndex = findSectionEndLine(lines, index, headingLevel);
		const markdown = stripSectionIdCommentLines(lines.slice(index, endIndex).join("\n")).trim();
		const bodyMarkdown = stripEpisodeVideoPromptInternalReferences(
			stripSectionIdCommentLines(lines.slice(index + 1, endIndex).join("\n")),
		).trim();
		if (!markdown) continue;

		sections.push({
			bodyMarkdown,
			headingLevel,
			headingOccurrence,
			headingText,
			markdown,
			normalizedHeadingText,
			plainText: markdownToPlainText(markdown),
		});
	}

	return sections;
};

const findSectionEndLine = (lines: string[], headingIndex: number, headingLevel: number) => {
	for (let index = headingIndex + 1; index < lines.length; index += 1) {
		const heading = /^(#{1,6})\s+/.exec(lines[index]);
		if (heading?.[1] && heading[1].length <= headingLevel) return index;
	}

	return lines.length;
};

const episodeClipSourceIndex = (clipId: string) => {
	const match = /^video-(\d+)-/u.exec(clipId);
	if (!match?.[1]) return null;

	const index = Number(match[1]);
	return Number.isFinite(index) ? index : null;
};

const stripEpisodeVideoPromptInternalReferences = (markdown: string) =>
	markdown
		.split("\n")
		.filter((line) => !/^\s*\*\*引用资源\*\*\s*[：:]/.test(line))
		.join("\n")
		.replace(
			/@\[((?:\\.|[^\]\\])*)\]\((?:<[^>]+>|[^\s)]+)\)/g,
			(_, label: string) => `@${unescapeMentionLabelForPrompt(label)}`,
		)
		.replace(/\n{3,}/g, "\n\n");

const unescapeMentionLabelForPrompt = (value: string) => value.replace(/\\([\\[\]])/g, "$1");

const markdownToPlainText = (markdown: string) =>
	markdown
		.replace(/@\[((?:\\.|[^\]\\])*)\]\((?:<[^>]+>|[^\s)]+)\)/g, "$1")
		.replace(/!\[([^\]]*)\]\((?:<[^>]+>|[^\s)]+)\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/[*_`>#]/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.trim();

const firstVideoAssetSource = (assets: GenerationAsset[]) => {
	const asset = assets.find((item) => item.kind === "video" && generationAssetSource(item));

	return asset ? generationAssetSource(asset) : "";
};
