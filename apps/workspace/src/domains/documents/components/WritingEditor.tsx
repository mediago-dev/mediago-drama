import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Menu, MessageSquare, MessageSquareOff } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
	MarkdownHybridEditor,
	prewarmMarkdownHybridEditorContent,
	type MarkdownSectionContext,
	type MarkdownHybridEditorHandle,
	type SectionGenerateKind,
	type SelectionCoords,
} from "@/domains/documents/components/MarkdownHybridEditor";
import { DocumentMentionHoverPopover } from "@/domains/documents/components/DocumentMentionHoverPopover";
import {
	createDocumentMentionExtension,
	DocumentMention,
} from "@/domains/documents/components/extensions/document-mention";
import { DocumentHistoryPanel } from "@/domains/documents/components/DocumentHistoryPanel";
import { SelectionBubble } from "@/domains/documents/components/SelectionBubble";
import { createDOMTextAnchorResolver } from "@/domains/documents/components/text-anchor-dom";
import type { InlineDecorationRange } from "@/domains/documents/components/tiptap/storage";
import { Button } from "@/shared/components/ui/button";
import { registerEditor } from "@/domains/documents/lib/editor-registry";
import { selectEditableDocument } from "@/domains/documents/lib/filters";
import {
	type DocumentComment,
	type MarkdownDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { getRouteProjectId } from "@/domains/workspace/lib/workbench-route";
import { useSelectedGenerationAssets } from "@/domains/generation/hooks/useSelectedGenerationAssets";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";
import type { SelectedGenerationResourceType } from "@/domains/generation/api/generation";

const autosaveDelayMs = 500;
const markerClusterDistance = 28;
const selectionBubbleContainerPaddingY = 8;
const selectionBubbleEdgePaddingX = 80;
const selectionBubbleGapY = 8;
const selectionBubbleHeight = 40;
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
	const [historyOpen, setHistoryOpen] = useState(false);
	const editorRef = useRef<MarkdownHybridEditorHandle>(null);
	const mainRef = useRef<HTMLElement>(null);
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const openGenerationDialog = useMediaGenerationStore((state) => state.open);
	const { assets: selectedGenerationAssets } = useSelectedGenerationAssets(projectId, {
		enabled: Boolean(projectId),
	});
	const selectedGenerationAssetsRef = useRef(selectedGenerationAssets);
	selectedGenerationAssetsRef.current = selectedGenerationAssets;
	const documents = useDocumentsStore((state) => state.documents);
	const assets = useDocumentsStore((state) => state.assets);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const activeCommentId = useDocumentsStore((state) => state.activeCommentId);
	const focusComment = useDocumentsStore((state) => state.focusComment);
	const markDocumentSaved = useDocumentsStore((state) => state.markDocumentSaved);
	const openPendingComment = useDocumentsStore((state) => state.openPendingComment);
	const pendingComment = useDocumentsStore((state) => state.pendingComment);
	const renameDocument = useDocumentsStore((state) => state.renameDocument);
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
	const selectionBubblePosition = selectionCoords
		? selectionBubblePositionForScrollContainer(mainRef.current, selectionCoords)
		: null;
	const commentMarkers = useMemo(
		() => buildCommentMarkers(activeDocument?.comments ?? [], commentOffsets),
		[activeDocument?.comments, commentOffsets],
	);
	const activeWritingEditorExtraExtensions = useMemo(
		() => [
			createDocumentMentionExtension({
				getSelectedGenerationAssets: () => selectedGenerationAssetsRef.current,
			}),
		],
		[],
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

	const focusCommentAnchor = useCallback(
		(commentId: string) => {
			focusComment(commentId);
			setSelectionCoords(null);
		},
		[focusComment],
	);

	const openSectionGeneration = useCallback(
		(section: MarkdownSectionContext, kind: SectionGenerateKind = "image") => {
			const selectedAssetResourceType =
				kind === "audio" ? selectedAudioResourceTypeForSection(documents, section) : undefined;

			openGenerationDialog({
				kind,
				projectId: projectId || undefined,
				section,
				...(selectedAssetResourceType ? { selectedAssetResourceType } : {}),
			});
		},
		[documents, openGenerationDialog, projectId],
	);

	if (!activeDocument) {
		return (
			<main className="grid h-full min-h-0 flex-1 place-items-center overflow-hidden bg-ide-editor">
				<p className="text-sm text-muted-foreground">创建文档后开始写作。</p>
			</main>
		);
	}

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
							projectId={projectId ?? undefined}
							selectedGenerationAssets={selectedGenerationAssets}
						>
							<MarkdownHybridEditor
								key={activeDocument.id}
								ref={editorRef}
								activeCommentId={activeCommentId}
								comments={activeDocument.comments}
								documentId={activeDocument.id}
								extraExtensions={activeWritingEditorExtraExtensions}
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
				{selectionBubblePosition ? (
					<SelectionBubble
						top={selectionBubblePosition.top}
						x={selectionBubblePosition.x}
						selectedText={selectedText}
						onComment={openCommentComposer}
					/>
				) : null}
			</main>
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

const selectedAudioResourceTypeForSection = (
	documents: MarkdownDocument[],
	section: Pick<MarkdownSectionContext, "documentId">,
): SelectedGenerationResourceType | undefined => {
	const category = documents.find((document) => document.id === section.documentId)?.category;
	return category === "character" ? "character" : undefined;
};

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

interface SelectionBubblePosition {
	top: number;
	x: number;
}

const selectionBubblePositionForScrollContainer = (
	container: HTMLElement | null,
	coords: SelectionCoords,
): SelectionBubblePosition => {
	if (!container) {
		return {
			top: Math.max(
				coords.y - selectionBubbleHeight - selectionBubbleGapY,
				selectionBubbleContainerPaddingY,
			),
			x: coords.x,
		};
	}

	const rect = container.getBoundingClientRect();
	const width = container.clientWidth || rect.width;
	const minX = container.scrollLeft + selectionBubbleEdgePaddingX;
	const maxX = Math.max(minX, container.scrollLeft + width - selectionBubbleEdgePaddingX);
	const x = coords.x - rect.left + container.scrollLeft;
	const selectionTop = coords.y - rect.top + container.scrollTop;
	const selectionBottom = (coords.bottom ?? coords.y) - rect.top + container.scrollTop;
	const safeTop = selectionBubbleSafeTop(container, rect);
	const maxTop = Math.max(
		safeTop,
		container.scrollTop +
			(container.clientHeight || rect.height) -
			selectionBubbleHeight -
			selectionBubbleContainerPaddingY,
	);
	const aboveTop = selectionTop - selectionBubbleHeight - selectionBubbleGapY;
	const belowTop = selectionBottom + selectionBubbleGapY;
	const preferredTop = aboveTop >= safeTop ? aboveTop : belowTop;

	return {
		top: Math.min(Math.max(preferredTop, safeTop), maxTop),
		x: Math.min(Math.max(x, minX), maxX),
	};
};

const selectionBubbleSafeTop = (container: HTMLElement, containerRect: DOMRect) => {
	const toolbar = container.querySelector<HTMLElement>(".tiptap-toolbar");
	const containerTop = container.scrollTop + selectionBubbleContainerPaddingY;
	if (!toolbar) return containerTop;

	const toolbarRect = toolbar.getBoundingClientRect();
	const toolbarBottom = toolbarRect.bottom - containerRect.top + container.scrollTop;
	return Math.max(containerTop, toolbarBottom + selectionBubbleGapY);
};

const sameOffsets = (first: Record<string, number>, second: Record<string, number>) => {
	const firstKeys = Object.keys(first);
	const secondKeys = Object.keys(second);
	if (firstKeys.length !== secondKeys.length) return false;

	return firstKeys.every((key) => Math.abs((first[key] ?? 0) - (second[key] ?? 0)) < 0.5);
};
