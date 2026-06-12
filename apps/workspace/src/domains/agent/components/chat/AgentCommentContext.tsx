import { MessageSquare, X } from "lucide-react";
import type React from "react";
import type { DocumentComment } from "@/domains/documents/stores";
import { cn } from "@/shared/lib/utils";

const maxVisibleComments = 4;

export const AgentCommentContextStrip: React.FC<{
	className?: string;
	comments: DocumentComment[];
	disabled?: boolean;
	onRemove?: (commentId: string) => void;
}> = ({ className, comments, disabled = false, onRemove }) => {
	if (comments.length === 0) return null;

	const visibleComments = comments.slice(0, maxVisibleComments);
	const hiddenCount = Math.max(0, comments.length - visibleComments.length);

	return (
		<div
			className={cn(
				"flex min-w-0 flex-nowrap gap-1.5 overflow-hidden",
				disabled && "pointer-events-none opacity-60",
				className,
			)}
			aria-label="未解决批注"
		>
			{visibleComments.map((comment) => (
				<CommentContextChip
					key={comment.id}
					comment={comment}
					disabled={disabled}
					onRemove={onRemove ? () => onRemove(comment.id) : undefined}
				/>
			))}
			{hiddenCount > 0 ? (
				<div className="inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-sm border border-border bg-ide-toolbar px-2 py-1 text-caption text-ide-toolbar-foreground">
					<MessageSquare className="size-3" />
					<span className="whitespace-nowrap text-muted-foreground">+{hiddenCount} 条批注</span>
				</div>
			) : null}
		</div>
	);
};

const CommentContextChip: React.FC<{
	comment: DocumentComment;
	disabled: boolean;
	onRemove?: () => void;
}> = ({ comment, disabled, onRemove }) => {
	const label = [comment.body, comment.anchorText].filter(Boolean).join(" · ");

	return (
		<div
			className="inline-flex min-w-0 max-w-full shrink items-center gap-1.5 rounded-sm border border-border bg-ide-toolbar px-2 py-1 text-caption text-ide-toolbar-foreground"
			title={label}
		>
			<MessageSquare className="size-3 shrink-0 text-muted-foreground" />
			<span className="min-w-0 max-w-64 truncate whitespace-nowrap font-medium text-foreground">
				{label}
			</span>
			{onRemove ? (
				<button
					type="button"
					className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground"
					disabled={disabled}
					onClick={onRemove}
					aria-label={`移除批注 ${label}`}
				>
					<X className="size-3" />
				</button>
			) : null}
		</div>
	);
};
