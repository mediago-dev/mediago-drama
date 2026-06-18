import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type {
	GenerationAsset,
	GenerationMessageResponse,
	GenerationNotificationOpenTarget,
} from "@/domains/generation/api/generation";
import { projectGenerationConversation } from "@/domains/generation/api/generation";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { DocumentMentionHoverPopover } from "@/domains/documents/components/DocumentMentionHoverPopover";
import { DocumentMention } from "@/domains/documents/components/extensions/document-mention";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	MediaGenerationWorkspace,
	type MediaGenerationWorkspaceViewMode,
} from "@/domains/generation/components/MediaGenerationWorkspace";
import { PromptEditor, type PromptEditorProps } from "@/domains/generation/components/PromptEditor";
import { taskTypeForCategory } from "@/domains/generation/lib/prompt-layers";
import { mentionDisplayText } from "@/domains/documents/lib/mention-suggestion";
import {
	mentionReferenceKey,
	parseMentionsFromMarkdown,
	resolveMentionPayload,
	type ResolvedMention,
} from "@/domains/documents/lib/mention-resolver";
import {
	sectionGenerationConversationScopeId,
	sectionGenerationHistoryScopeId,
	sectionGenerationIdentityKey,
	sectionGenerationPreferenceScopeId,
} from "@/domains/documents/lib/section-generation";
import { type MarkdownDocument, useDocumentsStore } from "@/domains/documents/stores";

interface DocumentSectionGeneratorProps {
	section: MarkdownSectionContext;
	selectedAssetKeys: string[];
	projectId?: string;
	onGenerationComplete: (
		pendingId: string,
		assets: GenerationAsset[],
		sourceTaskId: string,
	) => void;
	onGenerationError: (pendingId: string) => void;
	onGenerationResponse?: (pendingId: string, response: GenerationMessageResponse) => void;
	onGenerationStart: (pendingId: string, prompt: string) => void;
	onHistoryCountChange?: (count: number) => void;
	onOpenReferenceGeneration?: (section: MarkdownSectionContext) => void;
	onToggleImage: (asset: GenerationAsset, selected: boolean) => void;
	onViewModeChange?: (viewMode: MediaGenerationWorkspaceViewMode) => void;
	viewMode?: MediaGenerationWorkspaceViewMode;
}

const mentionPreviewTimestamp = "1970-01-01T00:00:00.000Z";

export const DocumentSectionGenerator: React.FC<DocumentSectionGeneratorProps> = ({
	onGenerationComplete,
	onGenerationError,
	onGenerationResponse,
	onGenerationStart,
	onHistoryCountChange,
	onOpenReferenceGeneration,
	onToggleImage,
	onViewModeChange,
	projectId,
	section,
	selectedAssetKeys,
	viewMode,
}) => {
	const allDocuments = useDocumentsStore((state) => state.documents);
	const allAssets = useDocumentsStore((state) => state.assets);
	const [removedMentionKeys, setRemovedMentionKeys] = useState<string[]>([]);
	const removedMentionKeySet = useMemo(() => new Set(removedMentionKeys), [removedMentionKeys]);
	const documentCategory = useMemo(
		() => allDocuments.find((document) => document.id === section.documentId)?.category,
		[allDocuments, section.documentId],
	);
	const mediaAssets = useDocumentsMediaAssets();
	// 在智能体项目里把生成统一归到「项目级命名会话」，让创作台可见；非项目场景回退到章节 scope。
	const { data: projectsData } = useSWR(projectId?.trim() ? projectsKey : null, getProjects);
	const projectName = useMemo(
		() => projectsData?.projects.find((project) => project.id === projectId?.trim())?.name ?? "",
		[projectsData, projectId],
	);
	const projectConversation = useMemo(
		() => projectGenerationConversation(projectId, "image", projectName),
		[projectId, projectName],
	);
	const conversationScopeId = useMemo(
		() =>
			projectConversation?.conversationScopeId ??
			sectionGenerationConversationScopeId(section, projectId),
		[projectConversation, projectId, section],
	);
	// 本地乐观缓存始终按章节隔离；项目级会话里再用 sectionId 过滤出本章节的服务端任务。
	const historyScopeId = useMemo(
		() => sectionGenerationHistoryScopeId(section, projectId),
		[projectId, section],
	);
	const sectionId = useMemo(
		() => (projectConversation ? sectionGenerationIdentityKey(section) : undefined),
		[projectConversation, section],
	);
	const modelPreferenceScopeId = useMemo(
		() => sectionGenerationPreferenceScopeId(section, projectId),
		[projectId, section],
	);
	const notificationTarget = useMemo<GenerationNotificationOpenTarget | undefined>(() => {
		const normalizedProjectId = projectId?.trim();
		if (!normalizedProjectId) return undefined;

		const documentTitle =
			allDocuments.find((document) => document.id === section.documentId)?.title ||
			section.headingText;
		return {
			kind: "document-section",
			projectId: normalizedProjectId,
			documentId: section.documentId,
			documentTitle,
			section: {
				blockId: section.blockId,
				documentId: section.documentId,
				headingLevel: section.headingLevel,
				headingOccurrence: section.headingOccurrence,
				headingText: section.headingText,
				markdown: section.markdown,
				plainText: section.plainText,
				prompt: section.prompt,
			},
		};
	}, [allDocuments, projectId, section]);
	const latestMentionPreviewRef = useRef<MentionPreviewReferences>({
		assetMentionKeys: {},
		badges: {},
		references: [],
	});

	const resolveAllMentionsFromPrompt = useCallback(
		(promptMarkdown: string) =>
			parseMentionsFromMarkdown(`${section.markdown}\n\n${promptMarkdown}`)
				.map((reference) => resolveMentionPayload(reference, allDocuments, allAssets))
				.filter(uniqueResolvedMention),
		[allAssets, allDocuments, section.markdown],
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
	useEffect(() => {
		setRemovedMentionKeys([]);
	}, [section.blockId, section.documentId]);

	return (
		<>
			<MediaGenerationWorkspace
				kind="image"
				defaultHistorySourceLabel="文章生成"
				emptyResultText="生成后会在这里显示可选用的章节插图。"
				extraReferenceAssetIds={mentionReferenceAssetIds}
				extraReferenceUrls={mentionReferenceUrls}
				conversationId={projectConversation?.conversationId}
				conversationScopeId={conversationScopeId}
				conversationTitle={projectConversation?.conversationTitle}
				historyScopeId={historyScopeId}
				sectionId={sectionId}
				taskType={taskTypeForCategory(documentCategory)}
				initialPrompt={section.prompt}
				modelPreferenceScopeId={modelPreferenceScopeId}
				notificationTarget={notificationTarget}
				projectId={projectId}
				promptPlaceholder="描述要放入当前章节的视觉素材"
				referenceBadges={(prompt) => getMentionPreview(prompt).preview.badges}
				referencePreviewAssets={(prompt) => getMentionPreview(prompt).preview.references}
				renderPromptEditor={(props) => (
					<PromptMentionEditor
						{...props}
						allAssets={allAssets}
						allDocuments={allDocuments}
						onGenerateReference={onOpenReferenceGeneration}
					/>
				)}
				selectedAssetKeys={selectedAssetKeys}
				submitLabel="生成插图"
				uploadIdPrefix="section-generation"
				onGenerationComplete={onGenerationComplete}
				onGenerationError={onGenerationError}
				onGenerationResponse={onGenerationResponse}
				onGenerationStart={onGenerationStart}
				onHistoryCountChange={onHistoryCountChange}
				onRemoveReferencePreview={removePreviewReferenceAsset}
				onToggleAsset={onToggleImage}
				onViewModeChange={onViewModeChange}
				viewMode={viewMode}
			/>
		</>
	);
};

const useDocumentsMediaAssets = () => {
	const allDocuments = useDocumentsStore((state) => state.documents);
	return useMemo(
		() =>
			allDocuments.flatMap((document) =>
				extractDocumentImageAssets(document.id, document.content ?? ""),
			),
		[allDocuments],
	);
};

const PromptMentionEditor: React.FC<
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

const buildMentionReferenceInputs = (mentions: ResolvedMention[]) => {
	const assetIds: string[] = [];
	const urls: string[] = [];
	const seenAssetIds = new Set<string>();
	const seenUrls = new Set<string>();

	for (const mention of mentions) {
		if (mention.status !== "ok") continue;

		for (const image of mention.images) {
			if (image.mediaAssetId) {
				if (seenAssetIds.has(image.mediaAssetId)) continue;

				seenAssetIds.add(image.mediaAssetId);
				assetIds.push(image.mediaAssetId);
				continue;
			}

			if (!image.url || seenUrls.has(image.url)) continue;

			seenUrls.add(image.url);
			urls.push(image.url);
		}
	}

	return { assetIds, urls };
};

interface MentionPreviewReferences {
	assetMentionKeys: Record<string, string>;
	badges: Record<string, string>;
	references: MediaAsset[];
}

const buildMentionPreviewReferences = (
	mentions: ResolvedMention[],
	mediaAssets: MediaAsset[],
): MentionPreviewReferences => {
	const seenReferenceIds = new Set<string>();
	const assetMentionKeys: Record<string, string> = {};
	const badges: Record<string, string> = {};
	const references: MediaAsset[] = [];

	for (const mention of mentions) {
		if (mention.status !== "ok") continue;

		const mentionKey = mentionReferenceKey(mention.reference);
		const badge = `来自 ${mentionDisplayText(mention.reference.title)}`;

		for (const image of mention.images) {
			const matchedAsset = findMediaAssetForMentionImage(image, mediaAssets);
			const reference = matchedAsset ?? createMentionPreviewAsset(mention, image);
			if (!reference) continue;

			badges[reference.id] ??= badge;
			assetMentionKeys[reference.id] ??= mentionKey;
			if (seenReferenceIds.has(reference.id)) continue;

			seenReferenceIds.add(reference.id);
			references.push(reference);
		}
	}

	return { assetMentionKeys, badges, references };
};

const findMediaAssetForMentionImage = (
	image: ResolvedMention["images"][number],
	mediaAssets: MediaAsset[],
) =>
	mediaAssets.find(
		(asset) =>
			asset.kind === "image" &&
			((image.mediaAssetId && asset.id === image.mediaAssetId) ||
				asset.url === image.url ||
				asset.sourceUrl === image.url),
	) ?? null;

const createMentionPreviewAsset = (
	mention: ResolvedMention,
	image: ResolvedMention["images"][number],
): MediaAsset | null => {
	if (!image.url) return null;

	return {
		createdAt: mentionPreviewTimestamp,
		filename: `来自 ${mentionDisplayText(mention.reference.title)}`,
		id: `mention-reference:${mentionReferenceKey(mention.reference)}:${image.mediaAssetId ?? image.url}`,
		kind: "image",
		mimeType: "image/*",
		sizeBytes: 0,
		sourceUrl: image.url,
		updatedAt: mentionPreviewTimestamp,
		url: image.url,
	};
};

const uniqueResolvedMention = (
	mention: ResolvedMention,
	index: number,
	mentions: ResolvedMention[],
) =>
	mentions.findIndex(
		(item) => mentionReferenceKey(item.reference) === mentionReferenceKey(mention.reference),
	) === index;

const extractDocumentImageAssets = (documentId: string, markdown: string): MediaAsset[] =>
	Array.from(markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)/g)).flatMap(
		(match, index) => {
			const url = match[1] ?? match[2] ?? "";
			if (!url) return [];

			return [
				{
					createdAt: mentionPreviewTimestamp,
					filename: `文档图片 ${index + 1}`,
					id: `document-image:${documentId}:${index}:${url}`,
					kind: "image" as const,
					mimeType: "image/*",
					sizeBytes: 0,
					sourceUrl: url,
					updatedAt: mentionPreviewTimestamp,
					url,
				},
			];
		},
	);
