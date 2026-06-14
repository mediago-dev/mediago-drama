import {
	Bot,
	Check,
	MessageSquarePlus,
	MessageSquare,
	PanelRightClose,
	PencilLine,
	Trash2,
	X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { runAgentPrompt } from "@/domains/agent/lib/controller";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Textarea } from "@/shared/components/ui/textarea";
import { createDOMTextAnchorResolver } from "@/domains/documents/components/text-anchor-dom";
import { getOpenComments } from "@/domains/documents/lib/filters";
import { findMarkdownBlockForAnchor } from "@/domains/documents/lib/operations";
import { type DocumentComment, useDocumentsStore } from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { agentProjectPath, agentProjectRouteState } from "@/domains/workspace/lib/workbench-route";
import { selectAgentIsRunning, useAgentStore } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";

const cardEstimateHeight = 112;
const editingCardEstimateHeight = 176;
const resolvedCardEstimateHeight = 96;
const pendingEmptyEstimateHeight = 144;
const pendingWithActionsEstimateHeight = 176;
const itemGap = 8;
const pendingCommentComposerSelector = "[data-pending-comment-composer]";

type CommentTab = "anchored" | "dangling";

export const CommentsGutter: React.FC = () => {
	const [activeTab, setActiveTab] = useState<CommentTab>("anchored");
	const [draft, setDraft] = useState("");
	const [editDraft, setEditDraft] = useState("");
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const [commentOffsets, setCommentOffsets] = useState<Record<string, number>>({});
	const [commentHeights, setCommentHeights] = useState<Record<string, number>>({});
	const [pendingOffset, setPendingOffset] = useState<number | null>(null);
	const [pendingHeight, setPendingHeight] = useState<number | null>(null);
	const [bodyTop, setBodyTop] = useState(0);
	const [bodyHeight, setBodyHeight] = useState(0);
	const bodyRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();
	const documents = useDocumentsStore((state) => state.documents);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const activeCommentId = useDocumentsStore((state) => state.activeCommentId);
	const documentProjectId = useDocumentsStore((state) => state.projectId);
	const pendingComment = useDocumentsStore((state) => state.pendingComment);
	const selection = useDocumentsStore((state) => state.selection);
	const showComments = useDocumentsStore((state) => state.showComments);
	const addComment = useDocumentsStore((state) => state.addComment);
	const clearPendingComment = useDocumentsStore((state) => state.clearPendingComment);
	const deleteComment = useDocumentsStore((state) => state.deleteComment);
	const focusComment = useDocumentsStore((state) => state.focusComment);
	const setShowComments = useDocumentsStore((state) => state.setShowComments);
	const updateComment = useDocumentsStore((state) => state.updateComment);
	const agentIsRunning = useAgentStore(selectAgentIsRunning);
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setAgentTab = useAgentLayoutStore((state) => state.setTab);
	const activeDocument =
		documents.find((document) => document.id === activeDocumentId) ?? documents[0] ?? null;
	const comments = activeDocument?.comments ?? [];
	const openComments = useMemo(() => getOpenComments(comments), [comments]);
	const projectId = documentProjectId ?? activeProjectId;
	const anchoredComments = useMemo(
		() =>
			showComments && activeDocument
				? comments.filter((comment) => hasCommentAnchor(activeDocument.content, comment))
				: [],
		[activeDocument, comments, showComments],
	);
	const danglingComments = useMemo(
		() =>
			showComments && activeDocument
				? comments.filter((comment) => !hasCommentAnchor(activeDocument.content, comment))
				: [],
		[activeDocument, comments, showComments],
	);
	const activePending =
		pendingComment && activeDocument && pendingComment.documentId === activeDocument.id
			? pendingComment
			: null;
	const activeSelection =
		selection && activeDocument && selection.documentId === activeDocument.id ? selection : null;
	const fallbackPendingTop = activePending ? activePending.y - bodyTop : null;
	const pendingBaseTop =
		activePending && fallbackPendingTop !== null ? (pendingOffset ?? fallbackPendingTop) : null;
	const pendingEstimatedHeight = draft.trim()
		? pendingWithActionsEstimateHeight
		: pendingEmptyEstimateHeight;
	const pendingLayoutHeight = pendingHeight ?? pendingEstimatedHeight;
	const { commentLayouts, pendingTop } = useMemo(
		() =>
			buildCommentLayouts(
				anchoredComments,
				commentOffsets,
				commentHeights,
				editingCommentId,
				pendingBaseTop,
				pendingLayoutHeight,
			),
		[
			anchoredComments,
			commentOffsets,
			commentHeights,
			editingCommentId,
			pendingBaseTop,
			pendingLayoutHeight,
		],
	);
	const contentHeight = Math.max(
		bodyHeight,
		pendingTop === null ? 0 : pendingTop + pendingLayoutHeight,
		...commentLayouts.map((item) => item.top + item.estimatedHeight),
	);

	const measureAnchors = useCallback(() => {
		const body = bodyRef.current;
		const editorRoot = document.querySelector<HTMLElement>(".tiptap-content");
		if (!body || !editorRoot) return;

		const rect = body.getBoundingClientRect();
		setBodyTop(rect.top);
		setBodyHeight(rect.height);

		const anchorResolver = createDOMTextAnchorResolver(editorRoot);
		const nextOffsets: Record<string, number> = {};
		for (const comment of anchoredComments) {
			const anchorRect = anchorResolver.findRect(comment.anchor, { fallbackToToken: true });
			if (anchorRect) {
				nextOffsets[comment.id] = anchorRect.top - rect.top;
			}
		}
		setCommentOffsets((current) => (sameOffsets(current, nextOffsets) ? current : nextOffsets));

		const nextHeights: Record<string, number> = {};
		for (const element of body.querySelectorAll<HTMLElement>("[data-comment-card-id]")) {
			const id = element.dataset.commentCardId;
			if (!id) continue;
			nextHeights[id] = element.getBoundingClientRect().height;
		}
		setCommentHeights((current) => (sameOffsets(current, nextHeights) ? current : nextHeights));

		const pendingAnchor = activePending
			? (activeSelection?.anchor ?? activePending.selection)
			: null;
		const pendingRect = pendingAnchor
			? anchorResolver.findRect(pendingAnchor, { fallbackToToken: true })
			: null;
		const nextPendingOffset = pendingRect ? pendingRect.top - rect.top : null;
		setPendingOffset((current) =>
			sameNullableOffset(current, nextPendingOffset) ? current : nextPendingOffset,
		);

		const pendingElement = body.querySelector<HTMLElement>(pendingCommentComposerSelector);
		const nextPendingHeight = pendingElement ? pendingElement.getBoundingClientRect().height : null;
		setPendingHeight((current) =>
			sameNullableOffset(current, nextPendingHeight) ? current : nextPendingHeight,
		);
	}, [activePending, activeSelection?.anchor, anchoredComments]);

	useEffect(() => {
		measureAnchors();
	}, [
		activeDocument?.content,
		activeTab,
		draft,
		editDraft,
		editingCommentId,
		measureAnchors,
		showComments,
	]);

	useEffect(() => {
		setDraft("");
	}, [activePending?.documentId, activePending?.selection, activePending?.y]);

	useEffect(() => {
		if (activePending) return;
		setPendingOffset(null);
		setPendingHeight(null);
	}, [activePending]);

	useEffect(() => {
		if (!editingCommentId) return;
		if (comments.some((comment) => comment.id === editingCommentId)) return;

		setEditingCommentId(null);
		setEditDraft("");
	}, [comments, editingCommentId]);

	useEffect(() => {
		setEditingCommentId(null);
		setEditDraft("");
	}, [activeDocument?.id]);

	useEffect(() => {
		if (!showComments || !activeCommentId || !activeDocument) return;

		if (danglingComments.some((comment) => comment.id === activeCommentId)) {
			setActiveTab("dangling");
			return;
		}
		if (anchoredComments.some((comment) => comment.id === activeCommentId)) {
			setActiveTab("anchored");
		}
	}, [activeCommentId, activeDocument, anchoredComments, danglingComments, showComments]);

	useEffect(() => {
		let frame = 0;
		const scheduleMeasure = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(measureAnchors);
		};

		window.addEventListener("resize", scheduleMeasure);
		document.addEventListener("scroll", scheduleMeasure, true);
		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("resize", scheduleMeasure);
			document.removeEventListener("scroll", scheduleMeasure, true);
		};
	}, [measureAnchors]);

	useEffect(() => {
		if (!showComments || !activeCommentId) return;
		if (activeTab !== "anchored") return;

		const item = commentLayouts.find((layout) => layout.comment.id === activeCommentId);
		if (!item) return;

		measureAnchors();
	}, [activeCommentId, activeTab, commentLayouts, measureAnchors, showComments]);

	useEffect(() => {
		if (!showComments || pendingTop === null) return;
		setActiveTab("anchored");
	}, [pendingTop, showComments]);

	useEffect(() => {
		if (!activePending) return;

		const clearPendingCommentOnOutsidePointer = (event: PointerEvent) => {
			const target = event.target;
			const element =
				target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
			if (element?.closest(pendingCommentComposerSelector)) return;

			setDraft("");
			clearPendingComment();
		};

		document.addEventListener("pointerdown", clearPendingCommentOnOutsidePointer, true);
		return () => {
			document.removeEventListener("pointerdown", clearPendingCommentOnOutsidePointer, true);
		};
	}, [activePending, clearPendingComment]);

	const submitPendingComment = () => {
		if (!activeDocument || !activePending || !draft.trim()) return;

		addComment(activeDocument.id, activePending.selection, draft);
		setDraft("");
		clearPendingComment();
	};

	const startEditingComment = (comment: DocumentComment) => {
		focusComment(comment.id);
		setEditingCommentId(comment.id);
		setEditDraft(comment.body);
	};

	const cancelEditingComment = () => {
		setEditingCommentId(null);
		setEditDraft("");
	};

	const submitCommentEdit = (event: React.FormEvent<HTMLFormElement>, comment: DocumentComment) => {
		event.preventDefault();
		if (!activeDocument || !editDraft.trim()) return;

		updateComment(activeDocument.id, comment.id, editDraft);
		setEditingCommentId(null);
		setEditDraft("");
		focusComment(comment.id);
	};

	const submitOpenCommentsToAgent = () => {
		if (agentIsRunning || openComments.length === 0) return;

		setAgentTab("agent");
		if (projectId && activeDocument) {
			navigate(agentProjectPath(projectId, { documentId: activeDocument.id }), {
				state: agentProjectRouteState("agent"),
			});
		}
		void runAgentPrompt("", {
			displayPrompt: "按照评论修改",
			taskPrompt: "按照评论修改",
		});
	};

	if (!showComments) {
		return null;
	}

	return (
		<aside className="hidden h-full min-h-0 w-64 shrink-0 flex-col border-l border-border bg-ide-panel text-ide-panel-foreground md:flex">
			<header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-ide-toolbar px-3 text-ide-toolbar-foreground">
				<div className="flex min-w-0 items-center gap-2">
					<MessageSquare className="size-4 text-muted-foreground" />
					<h2 className="truncate text-sm font-semibold text-foreground">批注</h2>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="隐藏批注"
					onClick={() => setShowComments(false)}
				>
					<PanelRightClose />
				</Button>
			</header>

			<Tabs
				value={activeTab}
				onValueChange={(value) => setActiveTab(value as CommentTab)}
				className="flex min-h-0 flex-1 flex-col"
			>
				<div className="border-b border-border p-2">
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="anchored">正文 {anchoredComments.length}</TabsTrigger>
						<TabsTrigger value="dangling">悬空 {danglingComments.length}</TabsTrigger>
					</TabsList>
				</div>
				<TabsContent
					ref={bodyRef}
					value="anchored"
					className="relative mt-0 min-h-0 flex-1 overflow-hidden p-2"
				>
					<div className="relative w-full" style={{ minHeight: contentHeight }}>
						{activePending && pendingTop !== null ? (
							<PendingCommentInput
								body={draft}
								selection={activePending.selection}
								top={pendingTop}
								onCancel={() => {
									setDraft("");
									clearPendingComment();
								}}
								onChange={setDraft}
								onSubmit={submitPendingComment}
							/>
						) : null}

						{commentLayouts.map(({ comment, top }) => (
							<CommentCard
								key={comment.id}
								comment={comment}
								editBody={editDraft}
								editing={editingCommentId === comment.id}
								focused={activeCommentId === comment.id}
								top={top}
								onCancelEdit={cancelEditingComment}
								onDelete={() => {
									if (editingCommentId === comment.id) cancelEditingComment();
									if (activeDocument) deleteComment(activeDocument.id, comment.id);
								}}
								onEditBodyChange={setEditDraft}
								onFocus={() => focusComment(comment.id)}
								onSaveEdit={(event) => submitCommentEdit(event, comment)}
								onStartEdit={() => startEditingComment(comment)}
							/>
						))}

						{!activePending && anchoredComments.length === 0 ? (
							<p className="px-1 py-3 text-xs text-muted-foreground">暂无正文批注。</p>
						) : null}
					</div>
				</TabsContent>
				<TabsContent value="dangling" className="mt-0 min-h-0 flex-1 overflow-y-auto p-2">
					<div className="space-y-2">
						{danglingComments.map((comment) => (
							<CommentCard
								key={comment.id}
								comment={comment}
								editBody={editDraft}
								editing={editingCommentId === comment.id}
								focused={activeCommentId === comment.id}
								onCancelEdit={cancelEditingComment}
								onDelete={() => {
									if (editingCommentId === comment.id) cancelEditingComment();
									if (activeDocument) deleteComment(activeDocument.id, comment.id);
								}}
								onEditBodyChange={setEditDraft}
								onFocus={() => focusComment(comment.id)}
								onSaveEdit={(event) => submitCommentEdit(event, comment)}
								onStartEdit={() => startEditingComment(comment)}
							/>
						))}
						{danglingComments.length === 0 ? (
							<p className="px-1 py-3 text-xs text-muted-foreground">暂无悬空批注。</p>
						) : null}
					</div>
				</TabsContent>
			</Tabs>
			{openComments.length > 0 ? (
				<footer className="flex shrink-0 justify-end border-t border-border bg-ide-panel p-2">
					<Button
						type="button"
						size="sm"
						className="h-8 rounded-sm px-2.5"
						disabled={agentIsRunning}
						onClick={submitOpenCommentsToAgent}
						title={agentIsRunning ? "智能体运行中" : `提交 ${openComments.length} 条未解决批注`}
					>
						<Bot />
						<span>提交给 agent</span>
					</Button>
				</footer>
			) : null}
		</aside>
	);
};

interface PendingCommentInputProps {
	body: string;
	selection: string;
	top: number;
	onCancel: () => void;
	onChange: (body: string) => void;
	onSubmit: () => void;
}

const PendingCommentInput: React.FC<PendingCommentInputProps> = ({
	body,
	selection,
	top,
	onCancel,
	onChange,
	onSubmit,
}) => (
	<form
		data-pending-comment-composer=""
		onSubmit={(event) => {
			event.preventDefault();
			onSubmit();
		}}
		className="absolute inset-x-0 overflow-hidden rounded-sm border border-border bg-ide-editor shadow-lg"
		style={{ top }}
	>
		<div className="h-1 bg-primary" />
		<div className="p-3">
			<div className="mb-3 flex items-start gap-2">
				<div className="mt-1 h-7 w-0.5 shrink-0 rounded-sm bg-border" />
				<p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{selection}</p>
			</div>
			<Textarea
				value={body}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Enter" || event.shiftKey) return;

					event.preventDefault();
					onSubmit();
				}}
				placeholder="输入评论"
				className="min-h-14 resize-none rounded-sm border-primary bg-background text-sm shadow-none"
				autoFocus
			/>
			{body.trim() ? (
				<div className="mt-2 flex justify-end gap-1.5">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 rounded-sm px-2"
						onClick={onCancel}
						aria-label="取消评论"
					>
						<X />
					</Button>
					<Button type="submit" size="sm" className="h-7 rounded-sm px-2">
						<MessageSquarePlus />
						<span>评论</span>
					</Button>
				</div>
			) : null}
		</div>
	</form>
);

interface CommentCardProps {
	comment: DocumentComment;
	editBody: string;
	editing: boolean;
	focused: boolean;
	top?: number;
	onCancelEdit: () => void;
	onDelete: () => void;
	onEditBodyChange: (body: string) => void;
	onFocus: () => void;
	onSaveEdit: (event: React.FormEvent<HTMLFormElement>) => void;
	onStartEdit: () => void;
}

const CommentCard: React.FC<CommentCardProps> = ({
	comment,
	editBody,
	editing,
	focused,
	top,
	onCancelEdit,
	onDelete,
	onEditBodyChange,
	onFocus,
	onSaveEdit,
	onStartEdit,
}) => (
	<article
		data-comment-card-id={comment.id}
		role={editing ? undefined : "button"}
		tabIndex={editing ? undefined : 0}
		className={cn(
			"rounded-sm border border-border bg-ide-editor p-2 text-xs shadow-sm transition-[box-shadow,border-color]",
			top !== undefined && "absolute inset-x-0",
			!editing && "cursor-pointer",
			focused && "border-primary shadow-lg",
			comment.resolved && "opacity-75",
		)}
		style={top !== undefined ? { top } : undefined}
		onClick={editing ? undefined : onFocus}
		onKeyDown={(event) => {
			if (editing) return;
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				onFocus();
			}
		}}
	>
		<p className="line-clamp-2 leading-5 text-muted-foreground">{comment.anchorText}</p>
		{editing ? (
			<form className="mt-1.5" onSubmit={onSaveEdit} onClick={(event) => event.stopPropagation()}>
				<Textarea
					value={editBody}
					onChange={(event) => onEditBodyChange(event.target.value)}
					className="min-h-16 resize-none rounded-sm text-xs shadow-none"
					autoFocus
				/>
				<div className="mt-2 flex items-center justify-between gap-2">
					<span className="text-caption text-muted-foreground">{getCommentMetaLabel(comment)}</span>
					<div className="flex items-center gap-1.5">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 rounded-sm px-2 text-xs"
							onClick={onCancelEdit}
						>
							<X />
							<span>取消</span>
						</Button>
						<Button
							type="submit"
							size="sm"
							className="h-7 rounded-sm px-2 text-xs"
							disabled={!editBody.trim() || editBody.trim() === comment.body.trim()}
						>
							<Check />
							<span>保存</span>
						</Button>
					</div>
				</div>
			</form>
		) : (
			<p className="mt-1.5 whitespace-pre-wrap leading-5 text-foreground">{comment.body}</p>
		)}
		{editing ? null : (
			<div className="mt-2 flex items-center justify-between gap-2">
				<span className="text-caption text-muted-foreground">{getCommentMetaLabel(comment)}</span>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 rounded-sm px-2 text-xs"
						onClick={(event) => {
							event.stopPropagation();
							onStartEdit();
						}}
					>
						<PencilLine />
						<span>编辑</span>
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 rounded-sm px-2 text-xs"
						onClick={(event) => {
							event.stopPropagation();
							onDelete();
						}}
					>
						<Trash2 />
						<span>删除</span>
					</Button>
				</div>
			</div>
		)}
	</article>
);

const getCommentMetaLabel = (comment: DocumentComment) =>
	comment.resolved
		? "已解决"
		: new Date(comment.createdAt).toLocaleTimeString("zh-CN", {
				hour: "2-digit",
				minute: "2-digit",
			});

interface CommentLayout {
	baseTop: number;
	comment: DocumentComment;
	estimatedHeight: number;
	top: number;
}

interface LayoutResult {
	commentLayouts: CommentLayout[];
	pendingTop: number | null;
}

type LayoutItem =
	| {
			baseTop: number;
			comment: DocumentComment;
			estimatedHeight: number;
			sortKey: string;
			type: "comment";
	  }
	| {
			baseTop: number;
			estimatedHeight: number;
			sortKey: string;
			type: "pending";
	  };

const buildCommentLayouts = (
	comments: DocumentComment[],
	commentOffsets: Record<string, number>,
	commentHeights: Record<string, number>,
	editingCommentId: string | null,
	pendingBaseTop: number | null,
	pendingHeight: number,
): LayoutResult => {
	let nextTop = Number.NEGATIVE_INFINITY;
	let pendingTop: number | null = null;
	const commentLayouts: CommentLayout[] = [];
	const items: LayoutItem[] = comments.flatMap((comment) => {
		const offset = commentOffsets[comment.id];
		if (offset === undefined) return [];
		const fallbackHeight =
			comment.id === editingCommentId
				? editingCardEstimateHeight
				: comment.resolved
					? resolvedCardEstimateHeight
					: cardEstimateHeight;
		return {
			baseTop: offset,
			comment,
			estimatedHeight: commentHeights[comment.id] ?? fallbackHeight,
			sortKey: comment.createdAt,
			type: "comment",
		};
	});

	if (pendingBaseTop !== null) {
		items.push({
			baseTop: pendingBaseTop,
			estimatedHeight: pendingHeight,
			sortKey: "",
			type: "pending",
		});
	}

	for (const item of items.sort(sortLayoutItems)) {
		const top = Math.max(item.baseTop, nextTop);
		nextTop = top + item.estimatedHeight + itemGap;

		if (item.type === "pending") {
			pendingTop = top;
			continue;
		}

		commentLayouts.push({
			baseTop: item.baseTop,
			comment: item.comment,
			estimatedHeight: item.estimatedHeight,
			top,
		});
	}

	return { commentLayouts, pendingTop };
};

const sortLayoutItems = (first: LayoutItem, second: LayoutItem) =>
	first.baseTop - second.baseTop ||
	layoutItemRank(first) - layoutItemRank(second) ||
	first.sortKey.localeCompare(second.sortKey);

const layoutItemRank = (item: LayoutItem) => (item.type === "comment" ? 0 : 1);

const hasCommentAnchor = (content: string, comment: DocumentComment) =>
	Boolean(
		findMarkdownBlockForAnchor(content, comment.anchor) ??
		findMarkdownBlockForAnchor(content, comment.anchorText),
	);

const sameOffsets = (first: Record<string, number>, second: Record<string, number>) => {
	const firstKeys = Object.keys(first);
	const secondKeys = Object.keys(second);
	if (firstKeys.length !== secondKeys.length) return false;

	return firstKeys.every((key) => Math.abs((first[key] ?? 0) - (second[key] ?? 0)) < 0.5);
};

const sameNullableOffset = (first: number | null, second: number | null) => {
	if (first === null || second === null) return first === second;
	return Math.abs(first - second) < 0.5;
};
