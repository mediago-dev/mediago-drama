import { X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { AgentReference } from "@/domains/agent/api/agent";
import type {
	GenerationAsset,
	GenerationMessageResponse,
	GenerationNotificationOpenTarget,
} from "@/domains/generation/api/generation";
import { projectGenerationConversation } from "@/domains/generation/api/generation";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { DocumentMention } from "@/domains/documents/components/extensions/document-mention";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	MediaGenerationWorkspace,
	type MediaGenerationWorkspaceViewMode,
} from "@/domains/generation/components/MediaGenerationWorkspace";
import { PromptEditor, type PromptEditorProps } from "@/domains/generation/components/PromptEditor";
import { Button } from "@/shared/components/ui/button";
import { documentCategoryDescriptorMap } from "@/domains/documents/lib/categories";
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
import { useDocumentsStore } from "@/domains/documents/stores";
import { cn } from "@/shared/lib/utils";

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
	onToggleImage: (asset: GenerationAsset, selected: boolean) => void;
	onViewModeChange?: (viewMode: MediaGenerationWorkspaceViewMode) => void;
	viewMode?: MediaGenerationWorkspaceViewMode;
}

const mentionPreviewTimestamp = "1970-01-01T00:00:00.000Z";

type MentionProjection = "all" | "text" | "image";

export const DocumentSectionGenerator: React.FC<DocumentSectionGeneratorProps> = ({
	onGenerationComplete,
	onGenerationError,
	onGenerationResponse,
	onGenerationStart,
	onHistoryCountChange,
	onToggleImage,
	onViewModeChange,
	projectId,
	section,
	selectedAssetKeys,
	viewMode,
}) => {
	const allDocuments = useDocumentsStore((state) => state.documents);
	const allAssets = useDocumentsStore((state) => state.assets);
	const [mentionProjections, setMentionProjections] = useState<Record<string, MentionProjection>>(
		{},
	);
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
	const latestMentionsRef = useRef<ResolvedMention[]>([]);

	const resolveMentionsFromPrompt = useCallback(
		(promptMarkdown: string) =>
			parseMentionsFromMarkdown(`${section.markdown}\n\n${promptMarkdown}`)
				.map((reference) => resolveMentionPayload(reference, allDocuments, allAssets))
				.filter((mention) => !removedMentionKeySet.has(mentionReferenceKey(mention.reference))),
		[allAssets, allDocuments, removedMentionKeySet, section.markdown],
	);
	const mentionPromptAppendix = useCallback(
		(promptMarkdown: string) =>
			buildMentionPromptAppendix(resolveMentionsFromPrompt(promptMarkdown), mentionProjections),
		[mentionProjections, resolveMentionsFromPrompt],
	);
	const mentionReferenceAssetIds = useCallback(
		(promptMarkdown: string) =>
			buildMentionReferenceInputs(resolveMentionsFromPrompt(promptMarkdown), mentionProjections)
				.assetIds,
		[mentionProjections, resolveMentionsFromPrompt],
	);
	const mentionReferenceUrls = useCallback(
		(promptMarkdown: string) =>
			buildMentionReferenceInputs(resolveMentionsFromPrompt(promptMarkdown), mentionProjections)
				.urls,
		[mentionProjections, resolveMentionsFromPrompt],
	);
	const setMentionProjection = useCallback(
		(reference: AgentReference, projection: MentionProjection) => {
			const key = mentionReferenceKey(reference);
			setMentionProjections((current) =>
				current[key] === projection ? current : { ...current, [key]: projection },
			);
		},
		[],
	);
	const removeMentionReference = useCallback((reference: AgentReference) => {
		const key = mentionReferenceKey(reference);
		setRemovedMentionKeys((current) => (current.includes(key) ? current : [...current, key]));
	}, []);
	const getMentionPreview = useCallback(
		(promptMarkdown: string) => {
			const mentions = resolveMentionsFromPrompt(promptMarkdown);
			const preview = buildMentionPreviewReferences(mentions, mentionProjections, mediaAssets);

			latestMentionsRef.current = mentions;
			latestMentionPreviewRef.current = preview;

			return { mentions, preview };
		},
		[mediaAssets, mentionProjections, resolveMentionsFromPrompt],
	);
	const removePreviewReferenceAsset = useCallback(
		(asset: MediaAsset) => {
			const mentionKey = latestMentionPreviewRef.current.assetMentionKeys[asset.id];
			if (!mentionKey) return;

			setMentionProjectionsForRemoval(setMentionProjection, latestMentionsRef.current, mentionKey);
		},
		[setMentionProjection],
	);
	useEffect(() => {
		setMentionProjections({});
		setRemovedMentionKeys([]);
	}, [section.blockId, section.documentId]);

	return (
		<>
			<MediaGenerationWorkspace
				kind="image"
				defaultHistorySourceLabel="文章生成"
				emptyResultText="生成后会在这里显示可选用的章节插图。"
				extraPrompt={mentionPromptAppendix}
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
				promptExtras={(prompt) => {
					const { mentions } = getMentionPreview(prompt);

					return (
						<MentionReferenceStrip
							mentions={mentions}
							projections={mentionProjections}
							onProjectionChange={setMentionProjection}
							onRemove={removeMentionReference}
						/>
					);
				}}
				referenceBadges={(prompt) => getMentionPreview(prompt).preview.badges}
				referencePreviewAssets={(prompt) => getMentionPreview(prompt).preview.references}
				renderPromptEditor={(props) => <PromptMentionEditor {...props} />}
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

const PromptMentionEditor: React.FC<PromptEditorProps> = (props) => {
	const extensions = useMemo(() => [DocumentMention], []);

	return (
		<PromptEditor {...props} extensions={extensions} editorClassName="section-prompt-prosemirror" />
	);
};

const MentionReferenceStrip: React.FC<{
	mentions: ResolvedMention[];
	onProjectionChange: (reference: AgentReference, projection: MentionProjection) => void;
	onRemove: (reference: AgentReference) => void;
	projections: Record<string, MentionProjection>;
}> = ({ mentions, onProjectionChange, onRemove, projections }) => {
	if (mentions.length === 0) return null;

	return (
		<div className="grid shrink-0 gap-2 rounded-sm border border-border bg-background p-2">
			<div className="flex items-center justify-between gap-3">
				<p className="truncate text-xs font-medium text-foreground">引用资料</p>
				<p className="shrink-0 text-xs text-muted-foreground">{mentions.length} 条</p>
			</div>
			<div className="flex gap-2 overflow-x-auto pb-1">
				{mentions.map((mention) => {
					const key = mentionReferenceKey(mention.reference);
					const projection = projectionForMention(mention, projections);
					const missing = mention.status === "missing";
					const hasText = mention.text.trim().length > 0;
					const hasImage = mention.images.length > 0;
					const meta = mentionMetaText(mention);

					return (
						<div
							key={key}
							className="grid min-w-56 max-w-72 shrink-0 gap-2 rounded-sm border border-border bg-card p-2"
						>
							<div className="flex min-w-0 items-start gap-2">
								<span
									className="agent-reference-mention min-w-0"
									data-category={mention.reference.category}
									data-kind={mention.reference.kind}
								>
									{mentionDisplayText(mention.reference.title)}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="ml-auto size-6 shrink-0 text-muted-foreground"
									aria-label={`移除 ${mentionDisplayText(mention.reference.title)} 引用`}
									onClick={() => onRemove(mention.reference)}
								>
									<X className="size-3.5" />
								</Button>
							</div>
							<p className="truncate text-xs text-muted-foreground">{meta}</p>
							<div className="grid grid-cols-3 overflow-hidden rounded-sm border border-border bg-muted p-0.5">
								{mentionProjectionOptions.map((option) => {
									const disabled =
										missing ||
										(option.value === "text" && !hasText) ||
										(option.value === "image" && !hasImage);

									return (
										<button
											key={option.value}
											type="button"
											disabled={disabled}
											className={cn(
												"h-6 rounded-sm px-1.5 text-2xs font-medium transition-colors",
												projection === option.value
													? "bg-background text-foreground shadow-sm"
													: "text-muted-foreground hover:text-foreground",
												disabled && "cursor-not-allowed opacity-45 hover:text-muted-foreground",
											)}
											onClick={() => onProjectionChange(mention.reference, option.value)}
										>
											{option.label}
										</button>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
};

const mentionProjectionOptions: Array<{ label: string; value: MentionProjection }> = [
	{ label: "全部", value: "all" },
	{ label: "文本", value: "text" },
	{ label: "图片", value: "image" },
];

const projectionForMention = (
	mention: ResolvedMention,
	projections: Record<string, MentionProjection>,
) => projections[mentionReferenceKey(mention.reference)] ?? "all";

const mentionMetaText = (mention: ResolvedMention) => {
	if (mention.status === "missing") return "已失效";

	const categoryLabel = mention.reference.category
		? documentCategoryDescriptorMap[mention.reference.category].label
		: mention.reference.kind === "asset"
			? "素材"
			: "文档";
	const scopeLabel =
		mention.reference.kind === "section"
			? "章节"
			: mention.reference.kind === "asset"
				? mention.reference.assetKind || "文件"
				: "全文";
	const imageLabel = mention.images.length > 0 ? `${mention.images.length} 图` : "无图片";

	return `${categoryLabel} · ${scopeLabel} · ${imageLabel}`;
};

const buildMentionPromptAppendix = (
	mentions: ResolvedMention[],
	projections: Record<string, MentionProjection>,
) => {
	const lines = mentions.flatMap((mention) => {
		if (mention.status !== "ok") return [];

		const projection = projectionForMention(mention, projections);
		if (!projectionAllowsText(projection)) return [];

		const text = mention.text.trim();
		if (!text) return [];

		const categoryLabel = mention.reference.category
			? documentCategoryDescriptorMap[mention.reference.category].label
			: "文档";

		return [
			`- ${mentionDisplayText(mention.reference.title)}（${categoryLabel}）：\n${indentMentionText(
				text,
			)}`,
		];
	});

	return lines.length > 0 ? `参考资料：\n${lines.join("\n\n")}` : "";
};

const buildMentionReferenceInputs = (
	mentions: ResolvedMention[],
	projections: Record<string, MentionProjection>,
) => {
	const assetIds: string[] = [];
	const urls: string[] = [];
	const seenAssetIds = new Set<string>();
	const seenUrls = new Set<string>();

	for (const mention of mentions) {
		if (mention.status !== "ok") continue;
		if (!projectionAllowsImage(projectionForMention(mention, projections))) continue;

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
	projections: Record<string, MentionProjection>,
	mediaAssets: MediaAsset[],
): MentionPreviewReferences => {
	const seenReferenceIds = new Set<string>();
	const assetMentionKeys: Record<string, string> = {};
	const badges: Record<string, string> = {};
	const references: MediaAsset[] = [];

	for (const mention of mentions) {
		if (mention.status !== "ok") continue;
		if (!projectionAllowsImage(projectionForMention(mention, projections))) continue;

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

const setMentionProjectionsForRemoval = (
	onMentionProjectionChange: (reference: AgentReference, projection: MentionProjection) => void,
	mentions: ResolvedMention[],
	mentionKey: string,
) => {
	const mention = mentions.find((item) => mentionReferenceKey(item.reference) === mentionKey);
	if (mention) onMentionProjectionChange(mention.reference, "text");
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

const projectionAllowsText = (projection: MentionProjection) =>
	projection === "all" || projection === "text";

const projectionAllowsImage = (projection: MentionProjection) =>
	projection === "all" || projection === "image";

const indentMentionText = (text: string) =>
	text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
