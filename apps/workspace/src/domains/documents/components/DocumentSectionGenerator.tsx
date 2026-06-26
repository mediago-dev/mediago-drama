import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type {
	GenerationAsset,
	GenerationKind,
	GenerationMessageResponse,
	SelectedGenerationAsset,
} from "@/domains/generation/api/generation";
import {
	getSelectedGenerationAssets,
	selectedGenerationAssetsQueryKey,
} from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { DocumentMentionHoverPopover } from "@/domains/documents/components/DocumentMentionHoverPopover";
import { DocumentMention } from "@/domains/documents/components/extensions/document-mention";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	buildMentionPreviewReferences,
	extractDocumentImageAssets,
	resolveMentionPayloadWithSelectedAssets,
	type MentionPreviewReferences,
	uniqueResolvedMention,
} from "@/domains/documents/lib/mention-generation-references";
import {
	MediaGenerationWorkspace,
	type MediaGenerationWorkspaceViewMode,
} from "@/domains/generation/components/MediaGenerationWorkspace";
import { PromptEditor, type PromptEditorProps } from "@/domains/generation/components/PromptEditor";
import {
	mentionReferenceKey,
	parseMentionsFromMarkdown,
} from "@/domains/documents/lib/mention-resolver";
import { useDocumentSectionGenerationContext } from "@/domains/documents/components/useDocumentSectionGenerationContext";
import { type MarkdownDocument, useDocumentsStore } from "@/domains/documents/stores";

export interface DocumentSectionGeneratorProps {
	kind?: GenerationKind;
	section: MarkdownSectionContext;
	selectedAssetKeys: string[];
	materialLibraryImportOpen?: boolean;
	projectId?: string;
	resolveLatestSection?: boolean;
	onGenerationComplete: (
		pendingId: string,
		assets: GenerationAsset[],
		sourceTaskId: string,
	) => void;
	onGenerationError: (pendingId: string) => void;
	onGenerationResponse?: (pendingId: string, response: GenerationMessageResponse) => void;
	onGenerationStart: (pendingId: string, prompt: string) => void;
	onHistoryCountChange?: (count: number) => void;
	onMaterialLibraryImportOpenChange?: (open: boolean) => void;
	onOpenReferenceGeneration?: (section: MarkdownSectionContext) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onViewModeChange?: (viewMode: MediaGenerationWorkspaceViewMode) => void;
	selectedGenerationAssets?: SelectedGenerationAsset[];
	viewMode?: MediaGenerationWorkspaceViewMode;
}

export const DocumentSectionGenerator: React.FC<DocumentSectionGeneratorProps> = ({
	kind = "image",
	materialLibraryImportOpen,
	onGenerationComplete,
	onGenerationError,
	onGenerationResponse,
	onGenerationStart,
	onHistoryCountChange,
	onMaterialLibraryImportOpenChange,
	onOpenReferenceGeneration,
	onToggleAsset,
	onViewModeChange,
	projectId,
	resolveLatestSection = true,
	section,
	selectedAssetKeys,
	selectedGenerationAssets,
	viewMode,
}) => {
	const generationKind = kind;
	const {
		activeSection,
		allAssets,
		allDocuments,
		conversationScopeId,
		documentContext,
		historyScopeId,
		modelPreferenceScopeId,
		normalizedProjectId,
		notificationTarget,
		projectConversation,
		sectionId,
		taskType,
	} = useDocumentSectionGenerationContext({
		kind: generationKind,
		projectId,
		resolveLatestSection,
		section,
	});
	const [removedMentionKeys, setRemovedMentionKeys] = useState<string[]>([]);
	const removedMentionKeySet = useMemo(() => new Set(removedMentionKeys), [removedMentionKeys]);
	const mediaAssets = useDocumentsMediaAssets();
	const latestMentionPreviewRef = useRef<MentionPreviewReferences>({
		assetMentionKeys: {},
		badges: {},
		references: [],
	});
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

	const resolveAllMentionsFromPrompt = useCallback(
		(promptMarkdown: string) =>
			parseMentionsFromMarkdown(`${activeSection.markdown}\n\n${promptMarkdown}`)
				.map((reference) =>
					resolveMentionPayloadWithSelectedAssets(
						reference,
						allDocuments,
						allAssets,
						mentionSelectedGenerationAssets,
					),
				)
				.filter(uniqueResolvedMention),
		[activeSection.markdown, allAssets, allDocuments, mentionSelectedGenerationAssets],
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
	const removePreviewReferenceAsset = useCallback((asset: MediaAsset) => {
		const mentionKey = latestMentionPreviewRef.current.assetMentionKeys[asset.id];
		if (!mentionKey) return;

		setRemovedMentionKeys((current) =>
			current.includes(mentionKey) ? current : [...current, mentionKey],
		);
	}, []);
	useEffect(() => {
		setRemovedMentionKeys([]);
	}, [activeSection.blockId, activeSection.documentId, activeSection.markdown]);

	return (
		<>
			<MediaGenerationWorkspace
				kind={generationKind}
				defaultHistorySourceLabel={
					sectionGenerationWorkspaceCopy[generationKind].historySourceLabel
				}
				emptyResultText={sectionGenerationWorkspaceCopy[generationKind].emptyResultText}
				assetTitle={activeSection.headingText}
				conversationId={projectConversation?.conversationId}
				conversationScopeId={conversationScopeId}
				conversationTitle={projectConversation?.conversationTitle}
				documentContext={documentContext}
				historyScopeId={historyScopeId}
				sectionId={sectionId}
				taskType={taskType}
				initialPrompt={activeSection.prompt}
				modelPreferenceScopeId={modelPreferenceScopeId}
				materialLibraryImportOpen={materialLibraryImportOpen}
				notificationTarget={notificationTarget}
				projectId={normalizedProjectId || undefined}
				promptPlaceholder={sectionGenerationWorkspaceCopy[generationKind].promptPlaceholder}
				referenceBadges={(prompt) => getMentionPreview(prompt).preview.badges}
				referencePreviewAssets={(prompt) => getMentionPreview(prompt).preview.references}
				renderPromptEditor={(props) => (
					<PromptMentionEditor
						{...props}
						allAssets={allAssets}
						allDocuments={allDocuments}
						onGenerateReference={onOpenReferenceGeneration}
						projectId={normalizedProjectId || undefined}
						selectedGenerationAssets={mentionSelectedGenerationAssets}
					/>
				)}
				selectedAssetKeys={selectedAssetKeys}
				selectedAssetResourceId={activeSection.blockId}
				selectedAssetSourceDocumentId={activeSection.documentId}
				selectedAssetTitle={activeSection.headingText}
				submitLabel={sectionGenerationWorkspaceCopy[generationKind].submitLabel}
				uploadIdPrefix="section-generation"
				onGenerationComplete={onGenerationComplete}
				onGenerationError={onGenerationError}
				onGenerationResponse={onGenerationResponse}
				onGenerationStart={onGenerationStart}
				onHistoryCountChange={onHistoryCountChange}
				onMaterialLibraryImportOpenChange={onMaterialLibraryImportOpenChange}
				onRemoveReferencePreview={removePreviewReferenceAsset}
				onToggleAsset={onToggleAsset}
				onViewModeChange={onViewModeChange}
				viewMode={viewMode}
			/>
		</>
	);
};

const sectionGenerationWorkspaceCopy: Record<
	GenerationKind,
	{
		emptyResultText: string;
		historySourceLabel: string;
		promptPlaceholder: string;
		submitLabel: string;
	}
> = {
	audio: {
		emptyResultText: "生成后会在这里显示可试听的语音素材。",
		historySourceLabel: "文章语音",
		promptPlaceholder: "输入要合成的语音文案、语气、角色声线和节奏",
		submitLabel: "生成语音",
	},
	image: {
		emptyResultText: "生成后会在这里显示可选用的章节插图。",
		historySourceLabel: "文章生成",
		promptPlaceholder: "描述要放入当前章节的视觉素材",
		submitLabel: "生成插图",
	},
	text: {
		emptyResultText: "生成后会在这里显示文本结果。",
		historySourceLabel: "文章文本",
		promptPlaceholder: "描述要生成或改写的文本内容",
		submitLabel: "生成文本",
	},
	video: {
		emptyResultText: "生成后会在这里显示可预览的视频素材。",
		historySourceLabel: "文章视频",
		promptPlaceholder: "描述当前章节的视频镜头、运动、机位、时长、画幅和质量",
		submitLabel: "生成视频",
	},
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
