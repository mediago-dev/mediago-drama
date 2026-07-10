import { useEffect, useMemo, useRef, useState } from "react";
import { createCallable } from "react-call";
import { normalizeMentionSectionTitle } from "@/domains/documents/lib/mention-section-create";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { DialogDismissButton } from "@/shared/components/ui/dialog-dismiss";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

export interface MentionSectionCreateDialogProps {
	createLabel: string;
	documentTitle: string;
}

export interface MentionSectionCreateDialogResult {
	title: string;
}

export const shouldIgnoreMentionSectionCreateEnter = (
	event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
	isComposing: boolean,
	compositionJustEnded: boolean,
) => Boolean(isComposing || compositionJustEnded || event.isComposing || event.keyCode === 229);

export const MentionSectionCreateDialog = createCallable<
	MentionSectionCreateDialogProps,
	MentionSectionCreateDialogResult | null
>(({ call, createLabel, documentTitle }) => {
	const [value, setValue] = useState("");
	const isComposingRef = useRef(false);
	const compositionJustEndedRef = useRef(false);
	const compositionEndTimerRef = useRef<number | null>(null);
	const title = useMemo(() => normalizeMentionSectionTitle(value), [value]);

	useEffect(
		() => () => {
			if (compositionEndTimerRef.current !== null) {
				window.clearTimeout(compositionEndTimerRef.current);
			}
		},
		[],
	);

	const clearCompositionEndTimer = () => {
		if (compositionEndTimerRef.current === null) return;
		window.clearTimeout(compositionEndTimerRef.current);
		compositionEndTimerRef.current = null;
	};

	const markCompositionJustEnded = () => {
		clearCompositionEndTimer();
		compositionJustEndedRef.current = true;
		compositionEndTimerRef.current = window.setTimeout(() => {
			compositionJustEndedRef.current = false;
			compositionEndTimerRef.current = null;
		}, 0);
	};

	const confirm = () => {
		if (!title) return;
		call.end({ title });
	};

	const inputId = "mention-section-create-title";

	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open) call.end(null);
			}}
		>
			<AlertDialogContent className="max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>{createLabel}</AlertDialogTitle>
					<AlertDialogDescription>将在《{documentTitle}》末尾插入二级标题。</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="grid gap-2">
					<Label htmlFor={inputId}>名称</Label>
					<Input
						id={inputId}
						autoFocus
						value={value}
						placeholder="请输入名称"
						onChange={(event) => setValue(event.target.value)}
						onCompositionStart={() => {
							clearCompositionEndTimer();
							isComposingRef.current = true;
							compositionJustEndedRef.current = false;
						}}
						onCompositionEnd={() => {
							isComposingRef.current = false;
							markCompositionJustEnded();
						}}
						onKeyDown={(event) => {
							if (event.key !== "Enter" || !title) return;
							if (
								shouldIgnoreMentionSectionCreateEnter(
									event.nativeEvent,
									isComposingRef.current,
									compositionJustEndedRef.current,
								)
							) {
								return;
							}
							event.preventDefault();
							confirm();
						}}
					/>
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel className="rounded-sm">取消</AlertDialogCancel>
					<DialogDismissButton
						type="button"
						className="rounded-sm"
						disabled={!title}
						onClick={confirm}
					>
						<span>确认</span>
					</DialogDismissButton>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
});
MentionSectionCreateDialog.displayName = "MentionSectionCreateDialog";

export const openMentionSectionCreateDialog = (props: MentionSectionCreateDialogProps) =>
	MentionSectionCreateDialog.call(props);
