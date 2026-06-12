import { CheckCircle2, MessageSquarePlus, WandSparkles } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { runAgentPrompt } from "@/domains/agent/lib/controller";
import {
	getOpenComments,
	getResolvedComments,
	selectDocumentById,
} from "@/domains/documents/lib/filters";
import { findMarkdownBlockForAnchor } from "@/domains/documents/lib/operations";
import { selectAgentIsRunning, useAgentStore } from "@/domains/agent/stores";
import { type DocumentComment, useDocumentsStore } from "@/domains/documents/stores";

export const DocumentCommentsPanel: React.FC = () => {
	const [body, setBody] = useState("");
	const documents = useDocumentsStore((state) => state.documents);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const addComment = useDocumentsStore((state) => state.addComment);
	const resolveComment = useDocumentsStore((state) => state.resolveComment);
	const setSelection = useDocumentsStore((state) => state.setSelection);
	const selection = useDocumentsStore((state) => state.selection);
	const isAgentRunning = useAgentStore(selectAgentIsRunning);
	const activeDocument = selectDocumentById(documents, activeDocumentId);
	const selectedText =
		selection && activeDocument && selection.documentId === activeDocument.id ? selection.text : "";
	const comments = activeDocument?.comments ?? [];
	const openComments = getOpenComments(comments);
	const resolvedComments = getResolvedComments(comments);

	const submitComment = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!activeDocument) return;

		addComment(activeDocument.id, selectedText, body);
		setBody("");
	};

	const askAgentToApplyComment = (comment: DocumentComment) => {
		if (!activeDocument) return;

		const blockSelection =
			findMarkdownBlockForAnchor(activeDocument.content, comment.anchor) ?? comment.anchorText;
		setSelection(activeDocument.id, blockSelection);
		void runAgentPrompt("", {
			anchorText: comment.anchorText,
			selection: blockSelection,
			displayPrompt: `根据这个批注修改这段内容：${comment.body}`,
			commentId: comment.id,
		});
	};

	return (
		<section className="flex h-full min-h-0 flex-col bg-ide-panel">
			<header className="border-b border-border bg-ide-toolbar px-3 py-2">
				<div className="flex items-center justify-between gap-2">
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-foreground">批注</h2>
						<p className="text-xs text-muted-foreground">锚定到文档片段的反馈</p>
					</div>
					<MessageSquarePlus className="size-4 text-muted-foreground" />
				</div>
			</header>

			<form onSubmit={submitComment} className="border-b border-border p-2">
				<div className="mb-2 border border-border bg-ide-toolbar px-2 py-1.5">
					<p className="text-xs font-medium text-muted-foreground">选中文本</p>
					<p className="mt-1 line-clamp-3 text-xs leading-5 text-foreground">
						{selectedText || "在文档中选择一段文字来锚定批注。"}
					</p>
				</div>
				<Textarea
					value={body}
					onChange={(event) => setBody(event.target.value)}
					placeholder="留下备注或修改要求"
					className="min-h-16 resize-none rounded-sm text-xs shadow-none"
				/>
				<Button
					type="submit"
					size="sm"
					className="mt-2 h-8 w-full rounded-sm"
					disabled={!body.trim() || !activeDocument}
				>
					<MessageSquarePlus />
					<span>添加批注</span>
				</Button>
			</form>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				<CommentList
					comments={openComments}
					empty="暂无未解决批注。"
					isAgentRunning={isAgentRunning}
					onAskAgent={askAgentToApplyComment}
					onResolve={(commentId) => activeDocument && resolveComment(activeDocument.id, commentId)}
				/>
				{resolvedComments.length > 0 ? (
					<div className="mt-4">
						<p className="mb-2 text-xs font-medium text-muted-foreground">已解决</p>
						<CommentList comments={resolvedComments} empty="" />
					</div>
				) : null}
			</div>
		</section>
	);
};

interface CommentListProps {
	comments: DocumentComment[];
	empty: string;
	isAgentRunning?: boolean;
	onAskAgent?: (comment: DocumentComment) => void;
	onResolve?: (commentId: string) => void;
}

const CommentList: React.FC<CommentListProps> = ({
	comments,
	empty,
	isAgentRunning,
	onAskAgent,
	onResolve,
}) => {
	if (comments.length === 0) {
		return empty ? <p className="py-3 text-xs text-muted-foreground">{empty}</p> : null;
	}

	return (
		<div className="space-y-1.5">
			{comments.map((comment) => (
				<article key={comment.id} className="border border-border bg-ide-editor p-2">
					<p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
						{comment.anchorText}
					</p>
					<p className="mt-1.5 text-xs leading-5 text-foreground">{comment.body}</p>
					<div className="mt-2 flex items-center justify-between gap-2">
						<span className="text-caption text-muted-foreground">
							{new Date(comment.createdAt).toLocaleTimeString()}
						</span>
						<div className="flex items-center gap-1">
							{onAskAgent ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 rounded-sm px-2 text-xs"
									onClick={() => onAskAgent(comment)}
									disabled={isAgentRunning}
								>
									<WandSparkles />
									<span>询问</span>
								</Button>
							) : null}
							{onResolve ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 rounded-sm px-2 text-xs"
									onClick={() => onResolve(comment.id)}
								>
									<CheckCircle2 />
									<span>解决</span>
								</Button>
							) : null}
						</div>
					</div>
				</article>
			))}
		</div>
	);
};
