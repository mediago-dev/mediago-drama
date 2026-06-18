import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Menu, MessageSquare, MessageSquareOff, ScissorsLineDashed } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { GenerationAsset } from "@/domains/generation/api/generation";
import {
	MarkdownHybridEditor,
	prewarmMarkdownHybridEditorContent,
	type MarkdownSectionContext,
	type MarkdownHybridEditorHandle,
	type SelectionCoords,
} from "@/domains/documents/components/MarkdownHybridEditor";
import { DocumentMentionHoverPopover } from "@/domains/documents/components/DocumentMentionHoverPopover";
import { DocumentMention } from "@/domains/documents/components/extensions/document-mention";
import { SectionGenerationDialog } from "@/domains/documents/components/SectionGenerationDialog";
import { DocumentHistoryPanel } from "@/domains/documents/components/DocumentHistoryPanel";
import { SelectionBubble } from "@/domains/documents/components/SelectionBubble";
import { createDOMTextAnchorResolver } from "@/domains/documents/components/text-anchor-dom";
import {
	appendSectionImageMarkdown,
	removeSectionImageMarkdown,
} from "@/domains/documents/components/tiptap/section-images";
import type { InlineDecorationRange } from "@/domains/documents/components/tiptap/storage";
import { Button } from "@/shared/components/ui/button";
import { registerEditor } from "@/domains/documents/lib/editor-registry";
import type { MarkdownSectionImage } from "@/domains/documents/lib/editor-registry";
import { selectEditableDocument } from "@/domains/documents/lib/filters";
import { sectionGenerationIdentityKey } from "@/domains/documents/lib/section-generation";
import {
	type DocumentComment,
	type MarkdownDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import {
	generationAssetSelectionKey,
	generationAssetSource,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { agentProjectPath, getRouteProjectId } from "@/domains/workspace/lib/workbench-route";

const autosaveDelayMs = 500;
const markerClusterDistance = 28;
export const writingEditorExtraExtensions = [DocumentMention];

export const prewarmWritingEditorDocument = (
	document: Pick<MarkdownDocument, "content" | "id">,
) => {
	prewarmMarkdownHybridEditorContent({
		documentId: document.id,
		extraExtensions: writingEditorExtraExtensions,
		value: document.content,
	});
};

interface WritingEditorProps {
	onOpenDocumentList?: () => void;
}

export const WritingEditor: React.FC<WritingEditorProps> = ({ onOpenDocumentList }) => {
	const [selectionCoords, setSelectionCoords] = useState<SelectionCoords | null>(null);
	const [selectionRange, setSelectionRange] = useState<InlineDecorationRange | null>(null);
	const [commentOffsets, setCommentOffsets] = useState<Record<string, number>>({});
	const [sectionGeneration, setSectionGeneration] = useState<MarkdownSectionContext | null>(null);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [selectedSectionAssetKeys, setSelectedSectionAssetKeys] = useState<
		Record<string, string[]>
	>({});
	const editorRef = useRef<MarkdownHybridEditorHandle>(null);
	const mainRef = useRef<HTMLElement>(null);
	const navigate = useNavigate();
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const documents = useDocumentsStore((state) => state.documents);
	const assets = useDocumentsStore((state) => state.assets);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const activeCommentId = useDocumentsStore((state) => state.activeCommentId);
	const convertDocumentToWorkbenchDraft = useDocumentsStore(
		(state) => state.convertDocumentToWorkbenchDraft,
	);
	const focusComment = useDocumentsStore((state) => state.focusComment);
	const markDocumentSaved = useDocumentsStore((state) => state.markDocumentSaved);
	const openPendingComment = useDocumentsStore((state) => state.openPendingComment);
	const pendingComment = useDocumentsStore((state) => state.pendingComment);
	const renameDocument = useDocumentsStore((state) => state.renameDocument);
	const pendingGenerationOpenRequest = useGenerationNotificationStore(
		(state) => state.pendingOpenRequest,
	);
	const consumeGenerationOpenRequest = useGenerationNotificationStore(
		(state) => state.consumeOpenRequest,
	);
	const selection = useDocumentsStore((state) => state.selection);
	const setSelection = useDocumentsStore((state) => state.setSelection);
	const setShowComments = useDocumentsStore((state) => state.setShowComments);
	const showComments = useDocumentsStore((state) => state.showComments);
	const updateDocumentContent = useDocumentsStore((state) => state.updateDocumentContent);
	const activeDocument = selectEditableDocument(documents, activeDocumentId);
	const activeSelection =
		selection && activeDocument && selection.documentId === activeDocument.id ? selection : null;
	const activePendingComment =
		pendingComment && activeDocument && pendingComment.documentId === activeDocument.id
			? pendingComment
			: null;
	const selectedText = activeSelection?.text ?? "";
	const commentMarkers = useMemo(
		() => buildCommentMarkers(activeDocument?.comments ?? [], commentOffsets),
		[activeDocument?.comments, commentOffsets],
	);
	useEffect(() => {
		if (!activeDocument?.isDirty) return;

		const timeout = window.setTimeout(() => {
			markDocumentSaved(activeDocument.id);
		}, autosaveDelayMs);

		return () => window.clearTimeout(timeout);
	}, [
		activeDocument?.id,
		activeDocument?.isDirty,
		activeDocument?.title,
		activeDocument?.content,
		markDocumentSaved,
	]);

	useEffect(() => {
		setSelectionCoords(null);
		setSelectionRange(null);
		setSelectedSectionAssetKeys({});
	}, [activeDocument?.id]);

	useEffect(() => {
		registerEditor(editorRef.current);
		return () => registerEditor(null);
	}, [activeDocument?.id]);

	const measureCommentMarkers = useCallback(() => {
		const container = mainRef.current;
		const editorRoot = document.querySelector<HTMLElement>(".tiptap-content");
		if (!container || !editorRoot || !activeDocument || showComments) return;

		const containerRect = container.getBoundingClientRect();
		const anchorResolver = createDOMTextAnchorResolver(editorRoot);
		const nextOffsets: Record<string, number> = {};
		for (const comment of activeDocument.comments) {
			const anchorRect = anchorResolver.findRect(comment.anchor, { fallbackToToken: true });
			if (anchorRect) {
				nextOffsets[comment.id] = anchorRect.top - containerRect.top + container.scrollTop;
			}
		}
		setCommentOffsets((current) => (sameOffsets(current, nextOffsets) ? current : nextOffsets));
	}, [activeDocument, showComments]);

	useEffect(() => {
		measureCommentMarkers();
	}, [activeDocument?.content, activeDocument?.comments, measureCommentMarkers]);

	useEffect(() => {
		let frame = 0;
		const scheduleMeasure = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(measureCommentMarkers);
		};

		window.addEventListener("resize", scheduleMeasure);
		document.addEventListener("scroll", scheduleMeasure, true);
		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("resize", scheduleMeasure);
			document.removeEventListener("scroll", scheduleMeasure, true);
		};
	}, [measureCommentMarkers]);

	const openCommentComposer = () => {
		if (!activeDocument || !selectedText || !selectionCoords) return;

		openPendingComment({
			documentId: activeDocument.id,
			selection: selectedText,
			x: selectionCoords.x,
			y: selectionCoords.y,
		});
		setSelectionCoords(null);
	};

	const openStoryboardWorkbench = () => {
		if (!activeDocument || !projectId || activeDocument.category !== "storyboard") return;

		const draft =
			activeDocument.workbenchDraft ?? convertDocumentToWorkbenchDraft(activeDocument.id);
		if (!draft) return;

		navigate(
			agentProjectPath(projectId, {
				documentId: activeDocument.id,
				workbench: "timeline",
			}),
		);
	};

	const focusCommentAnchor = useCallback(
		(commentId: string) => {
			focusComment(commentId);
			setSelectionCoords(null);
		},
		[focusComment],
	);

	const openSectionGeneration = useCallback((section: MarkdownSectionContext) => {
		const sectionKey = sectionGenerationIdentityKey(section);
		setSelectedSectionAssetKeys((current) => ({
			...current,
			[sectionKey]: sectionImageAssetKeys(section),
		}));
		setSectionGeneration(section);
	}, []);

	useEffect(() => {
		if (!activeDocument || !pendingGenerationOpenRequest) return;
		if (pendingGenerationOpenRequest.target.documentId !== activeDocument.id) return;

		openSectionGeneration(pendingGenerationOpenRequest.target.section);
		consumeGenerationOpenRequest(pendingGenerationOpenRequest.notificationId);
	}, [
		activeDocument,
		consumeGenerationOpenRequest,
		openSectionGeneration,
		pendingGenerationOpenRequest,
	]);

	const toggleSectionImage = useCallback(
		(section: MarkdownSectionContext, asset: GenerationAsset, selected: boolean) => {
			const source = generationAssetSource(asset);
			const assetKey = generationAssetSelectionKey(asset);
			if (!source || !assetKey) return;

			const image = {
				src: source,
				title: section.headingText,
			};
			const applied =
				section.documentId === activeDocument?.id
					? selected
						? editorRef.current?.setSectionImage(section, image)
						: editorRef.current?.removeSectionImage(section, image)
					: applySectionImageToStoredDocument({
							documents,
							image,
							section,
							selected,
							updateDocumentContent,
						});
			if (!applied) return;

			const sectionKey = sectionGenerationIdentityKey(section);
			setSelectedSectionAssetKeys((current) => ({
				...current,
				[sectionKey]: selected
					? current[sectionKey]?.includes(assetKey)
						? current[sectionKey]
						: [...(current[sectionKey] ?? []), assetKey]
					: (current[sectionKey] ?? []).filter((key) => key !== assetKey),
			}));
		},
		[activeDocument?.id, documents, updateDocumentContent],
	);

	const ignorePendingSectionImage = useCallback(() => {}, []);

	const completeSectionImageGeneration = useCallback(
		(
			section: MarkdownSectionContext,
			pendingId: string,
			_assets: GenerationAsset[],
			_sourceTaskId: string,
		) => {
			editorRef.current?.removeSectionImagePlaceholder(section, pendingId);
		},
		[],
	);

	const removePendingSectionImage = useCallback(
		(section: MarkdownSectionContext, pendingId: string) => {
			editorRef.current?.removeSectionImagePlaceholder(section, pendingId);
		},
		[],
	);

	if (!activeDocument) {
		return (
			<main className="grid h-full min-h-0 flex-1 place-items-center overflow-hidden bg-ide-editor">
				<p className="text-sm text-muted-foreground">创建文档后开始写作。</p>
			</main>
		);
	}

	const canOpenWorkbench = activeDocument.category === "storyboard";

	return (
		<>
			<main ref={mainRef} className="relative h-full min-h-0 flex-1 overflow-y-auto bg-ide-editor">
				<div className="mx-auto min-h-full w-full max-w-6xl px-4 py-4 transition-[padding-bottom] duration-200 ease-out">
					<section className="min-w-0">
						<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
							<div className="flex flex-wrap items-center gap-1.5">
								<p className="text-xs text-muted-foreground">
									更新于 {new Date(activeDocument.updatedAt).toLocaleTimeString("zh-CN")}
								</p>
							</div>
							<div className="flex items-center gap-1.5">
								{onOpenDocumentList ? (
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="md:hidden"
										aria-label="打开文档列表"
										onClick={onOpenDocumentList}
									>
										<Menu />
									</Button>
								) : null}
								{!showComments ? (
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label="展开批注"
										onClick={() => setShowComments(true)}
									>
										<MessageSquare />
									</Button>
								) : (
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label="收起批注"
										onClick={() => setShowComments(false)}
									>
										<MessageSquareOff />
									</Button>
								)}
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label="查看变更记录"
									title="变更记录"
									disabled={!projectId}
									onClick={() => setHistoryOpen(true)}
								>
									<History />
								</Button>
								{canOpenWorkbench ? (
									<Button
										type="button"
										size="sm"
										variant="outline"
										className="h-8 rounded-sm"
										onClick={openStoryboardWorkbench}
									>
										<ScissorsLineDashed />
										<span>跳转到剪辑工作台</span>
									</Button>
								) : null}
							</div>
						</div>

						<input
							value={activeDocument.title}
							onChange={(event) => renameDocument(activeDocument.id, event.target.value)}
							placeholder="未命名"
							className="mb-2 w-full border-0 bg-transparent text-2xl font-semibold leading-tight text-foreground outline-none placeholder:text-muted-foreground md:text-3xl"
						/>

						<DocumentMentionHoverPopover
							allAssets={assets}
							allDocuments={documents}
							onGenerateReference={openSectionGeneration}
						>
							<MarkdownHybridEditor
								key={activeDocument.id}
								ref={editorRef}
								activeCommentId={activeCommentId}
								comments={activeDocument.comments}
								documentId={activeDocument.id}
								extraExtensions={writingEditorExtraExtensions}
								pendingSelectionAnchor={
									activePendingComment ? (activeSelection?.anchor ?? null) : null
								}
								pendingSelectionRange={
									activePendingComment && activeSelection ? selectionRange : null
								}
								value={activeDocument.content}
								onChange={(content) => updateDocumentContent(activeDocument.id, content)}
								onCommentAnchorClick={focusCommentAnchor}
								onSectionGenerate={openSectionGeneration}
								onSelectionChange={(text) => setSelection(activeDocument.id, text)}
								onSelectionCoordChange={setSelectionCoords}
								onSelectionRangeChange={setSelectionRange}
							/>
						</DocumentMentionHoverPopover>
					</section>
				</div>
				{!showComments && commentMarkers.length > 0 ? (
					<div className="pointer-events-none absolute right-2 top-0 z-20 hidden md:block">
						{commentMarkers.map((marker) => (
							<button
								key={marker.key}
								type="button"
								className="pointer-events-auto absolute right-0 flex size-5 items-center justify-center rounded-sm border border-border bg-ide-toolbar/90 text-2xs font-medium text-foreground shadow-sm transition-colors hover:bg-ide-list-hover"
								style={{ top: marker.top }}
								onClick={() => focusComment(marker.commentId)}
								aria-label={`展开 ${marker.count} 条批注`}
								title="批注"
							>
								{marker.count}
							</button>
						))}
					</div>
				) : null}
			</main>
			{selectionCoords ? (
				<SelectionBubble
					x={selectionCoords.x}
					y={selectionCoords.y}
					selectedText={selectedText}
					onComment={openCommentComposer}
				/>
			) : null}
			<SectionGenerationDialog
				open={Boolean(sectionGeneration)}
				projectId={projectId ?? undefined}
				section={sectionGeneration}
				selectedAssetKeys={
					sectionGeneration
						? (selectedSectionAssetKeys[sectionGenerationIdentityKey(sectionGeneration)] ?? [])
						: []
				}
				onGenerationComplete={completeSectionImageGeneration}
				onGenerationError={removePendingSectionImage}
				onGenerationStart={ignorePendingSectionImage}
				onOpenChange={(open) => {
					if (!open) setSectionGeneration(null);
				}}
				onOpenReferenceGeneration={openSectionGeneration}
				onToggleImage={toggleSectionImage}
			/>
			<DocumentHistoryPanel
				open={historyOpen}
				onOpenChange={setHistoryOpen}
				projectId={projectId}
				document={activeDocument}
			/>
		</>
	);
};

interface CommentMarker {
	commentId: string;
	count: number;
	key: string;
	top: number;
}

const buildCommentMarkers = (
	comments: DocumentComment[],
	commentOffsets: Record<string, number>,
): CommentMarker[] => {
	const markers: CommentMarker[] = [];
	for (const comment of comments) {
		const top = commentOffsets[comment.id];
		if (top === undefined) continue;

		const marker = markers.find((item) => Math.abs(item.top - top) < markerClusterDistance);
		if (marker) {
			marker.count += 1;
			continue;
		}

		markers.push({
			commentId: comment.id,
			count: 1,
			key: comment.id,
			top,
		});
	}
	return markers;
};

const sectionImageAssetKeys = (section: MarkdownSectionContext) => {
	const keys = section.markdown.split("\n").flatMap((line) => {
		const source = sectionImageSourceFromLine(line.trim());
		return source ? [`image:${source}`] : [];
	});

	return Array.from(new Set(keys));
};

const sectionImageSourceFromLine = (line: string) => {
	const match = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$/.exec(line);
	if (!match) return null;
	if (
		["mediago-drama-section-image-pending:", "media-cli-section-image-pending:"].some((prefix) =>
			match[1].startsWith(prefix),
		)
	)
		return null;
	const source = match[2] ?? match[3] ?? null;
	if (match[1] === "正在生成图片" && source?.startsWith("data:image/svg+xml;base64,")) return null;

	return source;
};

const applySectionImageToStoredDocument = ({
	documents,
	image,
	section,
	selected,
	updateDocumentContent,
}: {
	documents: MarkdownDocument[];
	image: MarkdownSectionImage;
	section: MarkdownSectionContext;
	selected: boolean;
	updateDocumentContent: (id: string, content: string) => void;
}) => {
	const document = documents.find((item) => item.id === section.documentId);
	if (!document) return false;

	const result = selected
		? appendSectionImageMarkdown(document.content, section, image)
		: removeSectionImageMarkdown(document.content, section, image);
	if (!result) return false;
	if (result.changed) updateDocumentContent(document.id, result.markdown);

	return selected || result.changed;
};

const sameOffsets = (first: Record<string, number>, second: Record<string, number>) => {
	const firstKeys = Object.keys(first);
	const secondKeys = Object.keys(second);
	if (firstKeys.length !== secondKeys.length) return false;

	return firstKeys.every((key) => Math.abs((first[key] ?? 0) - (second[key] ?? 0)) < 0.5);
};
