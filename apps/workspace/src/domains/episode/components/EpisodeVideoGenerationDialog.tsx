import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type {
	GenerationAsset,
	GenerationNotificationOpenTarget,
	SelectedGenerationAsset,
} from "@/domains/generation/api/generation";
import {
	getSelectedGenerationAssets,
	projectGenerationConversation,
	selectedGenerationAssetsQueryKey,
} from "@/domains/generation/api/generation";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import { DocumentMentionHoverPopover } from "@/domains/documents/components/DocumentMentionHoverPopover";
import { DocumentMention } from "@/domains/documents/components/extensions/document-mention";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { createSectionGenerationPrompt } from "@/domains/documents/lib/section-generation-prompt";
import {
	buildMentionPreviewReferences,
	buildMentionReferenceInputs,
	extractDocumentImageAssets,
	resolveMentionPayloadWithSelectedAssets,
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
import {
	readStoryboardLaneSources,
	type StoryboardLaneSource,
} from "@/domains/episode/lib/storyboard-shots";
import { formatTimelineTime, type Episode, type TimelineClip } from "@/domains/episode/lib/sample";
import type {
	MediaGenerationWorkspaceProps,
	PromptEditorProps,
} from "@/domains/generation/components/MediaGenerationWorkspace";
import { PromptEditor } from "@/domains/generation/components/PromptEditor";
import { generationAssetSource } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { selectedGenerationAssetKeysForSection } from "@/domains/generation/lib/selected-asset-keys";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { VideoGenerationDialog } from "@/shared/components/generation-dialogs/VideoGenerationDialog";

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
	selectedGenerationAssets?: SelectedGenerationAsset[];
}

export interface EpisodeVideoGenerationContext {
	blockId: string;
	headingLevel: number;
	headingOccurrence: number;
	headingText: string;
	plainText: string;
	prompt: string;
	sourceMarkdown: string;
}

export interface EpisodeVideoSourceSection {
	blockId?: string;
	bodyMarkdown: string;
	headingLevel: number;
	headingOccurrence: number;
	headingText: string;
	markdown: string;
	plainText: string;
}

const titleId = "episode-video-generation-title";

interface EpisodeVideoGenerationDialogController {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: string;
	workspaceProps: Omit<MediaGenerationWorkspaceProps, "kind">;
}

export const EpisodeVideoGenerationDialog: React.FC<EpisodeVideoGenerationDialogProps> = (
	props,
) => {
	const controller = useEpisodeVideoGenerationDialogController(props);
	return <EpisodeVideoGenerationDialogView controller={controller} />;
};

const useEpisodeVideoGenerationDialogController = ({
	documentId,
	documentTitle,
	episode,
	onGeneratedVideoReady,
	onOpenChange,
	onOpenReferenceGeneration,
	open,
	projectId,
	selectedClip,
	selectedGenerationAssets,
}: EpisodeVideoGenerationDialogProps): EpisodeVideoGenerationDialogController => {
	const allDocuments = useDocumentsStore((state) => state.documents);
	const allAssets = useDocumentsStore((state) => state.assets);
	const sourceDocument = useMemo(
		() => allDocuments.find((document) => document.id === documentId?.trim()) ?? null,
		[allDocuments, documentId],
	);
	const sourceSection = useMemo(
		() =>
			findEpisodeVideoSourceSection(
				sourceDocument?.content ?? "",
				selectedClip,
				sourceDocument?.id ?? documentId,
			),
		[sourceDocument?.content, sourceDocument?.id, documentId, selectedClip],
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
	const shouldLoadSelectedGenerationAssets =
		selectedGenerationAssets === undefined && Boolean(normalizedProjectId);
	const { data: selectedGenerationAssetsData } = useSWR(
		shouldLoadSelectedGenerationAssets
			? selectedGenerationAssetsQueryKey(normalizedProjectId)
			: null,
		() => getSelectedGenerationAssets(normalizedProjectId),
	);
	const mentionSelectedGenerationAssets =
		selectedGenerationAssets ?? selectedGenerationAssetsData?.assets ?? [];
	const projectName = useMemo(
		() => projectsData?.projects.find((project) => project.id === normalizedProjectId)?.name ?? "",
		[projectsData, normalizedProjectId],
	);
	const normalizedDocumentId = documentId?.trim() ?? "";
	const selectableSourceBlockId = sourceSection?.blockId?.trim() ?? "";
	const canSelectProjectResource = Boolean(selectableSourceBlockId && normalizedDocumentId);
	const projectConversation = useMemo(
		() => projectGenerationConversation(projectId, "video", projectName),
		[projectId, projectName],
	);
	const conversationScopeId = projectConversation?.conversationScopeId ?? generationContext.blockId;
	// 本地乐观缓存按分镜片段隔离；项目级会话里用 sectionId(=blockId) 过滤出当前片段的服务端任务。
	const historyScopeId = generationContext.blockId;
	const sectionId = projectConversation ? generationContext.blockId : undefined;
	const documentContext = useMemo(() => {
		const sourceSectionBlockId = sourceSection?.blockId;
		if (!normalizedDocumentId || !sourceSectionBlockId) return undefined;

		return {
			...(normalizedProjectId ? { projectId: normalizedProjectId } : {}),
			documentId: normalizedDocumentId,
			sectionId: sourceSectionBlockId,
		};
	}, [normalizedDocumentId, normalizedProjectId, sourceSection?.blockId]);
	const resolveAllMentionsFromPrompt = useCallback(
		(promptMarkdown: string) =>
			parseMentionsFromMarkdown(`${generationContext.sourceMarkdown}\n\n${promptMarkdown}`)
				.map((reference) =>
					resolveMentionPayloadWithSelectedAssets(
						reference,
						allDocuments,
						allAssets,
						mentionSelectedGenerationAssets,
					),
				)
				.filter(uniqueResolvedMention),
		[allAssets, allDocuments, generationContext.sourceMarkdown, mentionSelectedGenerationAssets],
	);
	const resolveActiveMentionsFromPrompt = useCallback(
		(promptMarkdown: string) =>
			resolveAllMentionsFromPrompt(promptMarkdown).filter(
				(mention) => !removedMentionKeySet.has(mentionReferenceKey(mention.reference)),
			),
		[removedMentionKeySet, resolveAllMentionsFromPrompt],
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
	const getMentionReferenceInputs = useCallback(
		(promptMarkdown: string) =>
			buildMentionReferenceInputs(resolveActiveMentionsFromPrompt(promptMarkdown)),
		[resolveActiveMentionsFromPrompt],
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
		if (!canSelectProjectResource) return [];

		const selectedKeys = selectedGenerationAssetKeysForSection(
			mentionSelectedGenerationAssets,
			{ blockId: selectableSourceBlockId, documentId: normalizedDocumentId },
			"video",
		);
		return selectedKeys;
	}, [
		canSelectProjectResource,
		mentionSelectedGenerationAssets,
		normalizedDocumentId,
		selectableSourceBlockId,
	]);
	const toggleGeneratedVideo = useCallback(
		(asset: GenerationAsset, selected: boolean) => {
			if (!canSelectProjectResource || !selectedClip) return;

			const videoUrl = firstVideoAssetSource([asset]);
			if (!videoUrl) return;

			onGeneratedVideoReady?.(selectedClip.id, selected ? videoUrl : null);
		},
		[canSelectProjectResource, onGeneratedVideoReady, selectedClip],
	);

	useEffect(() => {
		setRemovedMentionKeys([]);
	}, [generationContext.blockId, generationContext.sourceMarkdown]);

	return {
		onOpenChange,
		open,
		title: `生成视频素材 · ${selectedClip?.title ?? episode.title}`,
		workspaceProps: {
			className: "min-h-0 flex-1",
			emptyResultText: "生成后会在这里显示可预览的视频素材。",
			conversationId: projectConversation?.conversationId,
			conversationScopeId,
			conversationTitle: projectConversation?.conversationTitle,
			documentContext,
			historyScopeId,
			sectionId,
			assetTitle: generationContext.headingText,
			taskType: "storyboard",
			initialPrompt: generationContext.prompt,
			modelPreferenceScopeId: conversationScopeId,
			notificationTarget,
			persistAssetSelection: true,
			promptPlaceholder: "描述当前组的视频镜头、运动、机位、时长、画幅和质量",
			projectId,
			extraReferenceAssetIds: (prompt) => getMentionReferenceInputs(prompt).assetIds,
			extraReferenceUrls: (prompt) => getMentionReferenceInputs(prompt).urls,
			referenceBadges: (prompt) => getMentionPreview(prompt).preview.badges,
			referencePreviewAssets: (prompt) => getMentionPreview(prompt).preview.references,
			renderPromptEditor: (props) => (
				<EpisodeVideoPromptMentionEditor
					{...props}
					allAssets={allAssets}
					allDocuments={allDocuments}
					onGenerateReference={onOpenReferenceGeneration}
					projectId={normalizedProjectId || undefined}
					selectedGenerationAssets={mentionSelectedGenerationAssets}
				/>
			),
			submitLabel: "生成视频",
			uploadIdPrefix: "episode-video-generation",
			selectedAssetKeys,
			selectedAssetResourceId: canSelectProjectResource ? selectableSourceBlockId : undefined,
			selectedAssetSourceDocumentId: canSelectProjectResource ? normalizedDocumentId : undefined,
			selectedAssetTitle: generationContext.headingText,
			viewMode: "history",
			onToggleAsset: canSelectProjectResource ? toggleGeneratedVideo : undefined,
			onRemoveReferencePreview: removePreviewReferenceAsset,
		},
	};
};

const EpisodeVideoGenerationDialogView: React.FC<{
	controller: EpisodeVideoGenerationDialogController;
}> = ({ controller }) => (
	<VideoGenerationDialog
		open={controller.open}
		title={controller.title}
		titleId={titleId}
		workspaceProps={controller.workspaceProps}
		onOpenChange={controller.onOpenChange}
	/>
);

export const buildEpisodeVideoContext = (
	episode: Episode,
	selectedClip: TimelineClip | null,
	sourceSection: EpisodeVideoSourceSection | null,
): EpisodeVideoGenerationContext => {
	const blockId =
		sourceSection?.blockId ?? `episode-video:${episode.id}:${selectedClip?.id ?? "episode"}`;
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

export const buildEpisodeVideoPrompt = (
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

	const sourcePrompt = stripEpisodeVideoPromptInternalReferences(
		sourceSection?.markdown || selectedClip.prompt || selectedClip.content || selectedClip.title,
	).trim();
	if (sourceSection) {
		return createSectionGenerationPrompt(sourcePrompt, sourceSection.headingText);
	}

	const title = selectedClip.title.trim();
	if (!sourcePrompt) return title;
	return [`## ${title}`, "", sourcePrompt].filter(Boolean).join("\n");
};

const EpisodeVideoPromptMentionEditor: React.FC<
	PromptEditorProps & {
		allAssets: ProjectAsset[];
		allDocuments: MarkdownDocument[];
		onGenerateReference?: (section: MarkdownSectionContext) => void;
		projectId?: string;
		selectedGenerationAssets?: SelectedGenerationAsset[];
	}
> = ({
	allAssets,
	allDocuments,
	onGenerateReference,
	projectId,
	selectedGenerationAssets,
	...props
}) => {
	const extensions = useMemo(() => [DocumentMention], []);

	return (
		<DocumentMentionHoverPopover
			allAssets={allAssets}
			allDocuments={allDocuments}
			onGenerateReference={onGenerateReference}
			projectId={projectId}
			selectedGenerationAssets={selectedGenerationAssets}
		>
			<PromptEditor
				{...props}
				extensions={extensions}
				editorClassName="section-prompt-prosemirror"
			/>
		</DocumentMentionHoverPopover>
	);
};

export const findEpisodeVideoSourceSection = (
	documentMarkdown: string,
	selectedClip: TimelineClip | null,
	documentId?: string | null,
): EpisodeVideoSourceSection | null => {
	if (!selectedClip || !documentMarkdown.trim()) return null;

	const laneSources = readStoryboardLaneSources(documentMarkdown, { documentId });
	if (laneSources.length === 0) return null;

	const normalizedTitle = normalizeHeadingText(selectedClip.title);
	const titleMatch = laneSources.find(
		(section) => normalizeHeadingText(section.title) === normalizedTitle,
	);
	if (titleMatch) return sourceSectionFromLaneSource(titleMatch);

	const sourceIndex = episodeClipSourceIndex(selectedClip.id);
	if (sourceIndex == null) return null;

	const indexedSource = laneSources[sourceIndex];
	return indexedSource ? sourceSectionFromLaneSource(indexedSource) : null;
};

const sourceSectionFromLaneSource = (source: StoryboardLaneSource): EpisodeVideoSourceSection => {
	const markdown = stripSectionIdCommentLines(source.markdown).trim();
	const bodyMarkdown = stripEpisodeVideoPromptInternalReferences(
		stripSectionHeadingLine(markdown),
	).trim();

	return {
		blockId: source.blockId,
		bodyMarkdown,
		headingLevel: source.headingLevel,
		headingOccurrence: source.headingOccurrence,
		headingText: source.title,
		markdown,
		plainText: markdownToPlainText(markdown),
	};
};

const stripSectionHeadingLine = (markdown: string) =>
	markdown
		.split("\n")
		.filter((line, index) => index > 0 || !/^#{1,6}\s+/.test(line))
		.join("\n");

const episodeClipSourceIndex = (clipId: string) => {
	const match = /^video-(\d+)-/u.exec(clipId);
	if (!match?.[1]) return null;

	const index = Number(match[1]);
	return Number.isFinite(index) ? index : null;
};

const stripEpisodeVideoPromptInternalReferences = (markdown: string) =>
	markdown
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			if (/^!\[([^\]]*)\]\((?:<[^>]+>|[^\s)]+)\)$/.test(trimmed)) return false;
			return true;
		})
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");

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

export const buildEpisodeVideoReferenceInputs = ({
	allAssets,
	allDocuments,
	promptMarkdown,
	sourceMarkdown,
}: {
	allAssets: ProjectAsset[];
	allDocuments: MarkdownDocument[];
	promptMarkdown: string;
	sourceMarkdown: string;
}) =>
	buildMentionReferenceInputs(
		parseMentionsFromMarkdown(`${sourceMarkdown}\n\n${promptMarkdown}`)
			.map((reference) => resolveMentionPayload(reference, allDocuments, allAssets))
			.filter(uniqueResolvedMention),
	);

export const firstVideoAssetSource = (assets: GenerationAsset[]) => {
	const asset = assets.find((item) => item.kind === "video" && generationAssetSource(item));

	return asset ? generationAssetSource(asset) : "";
};
