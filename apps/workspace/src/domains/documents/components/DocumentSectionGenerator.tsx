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
	buildMentionPreviewReferences,
	buildMentionReferenceInputs,
	extractDocumentSectionImageReferences,
	extractDocumentImageAssets,
	type MentionPreviewReferences,
	uniqueResolvedMention,
} from "@/domains/documents/lib/mention-generation-references";
import type { ReferenceSelectionShortcutGroup } from "@/domains/generation/components/MediaGenerationDialogs";
import {
	MediaGenerationWorkspace,
	type MediaGenerationWorkspaceViewMode,
} from "@/domains/generation/components/MediaGenerationWorkspace";
import { PromptEditor, type PromptEditorProps } from "@/domains/generation/components/PromptEditor";
import { taskTypeForCategory } from "@/domains/generation/lib/prompt-layers";
import {
	mentionReferenceKey,
	parseMentionsFromMarkdown,
	resolveMentionPayload,
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
	const selectedNodeReferenceGroups = useMemo<ReferenceSelectionShortcutGroup[]>(() => {
		const document = allDocuments.find((item) => item.id === section.documentId);
		if (!document) return [];

		const references = extractDocumentSectionImageReferences(document.id, document.content);
		if (references.length === 0) return [];

		return [
			{
				description: `来自《${document.title || "当前文档"}》中已选用插图的节点`,
				id: "selected-document-section-images",
				title: "已选节点图片",
				items: references.map((reference) => ({
					asset: reference.asset,
					subtitle: reference.imageLabel,
					title: reference.sectionTitle,
				})),
			},
		];
	}, [allDocuments, section.documentId]);
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
				referenceShortcutGroups={selectedNodeReferenceGroups}
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
