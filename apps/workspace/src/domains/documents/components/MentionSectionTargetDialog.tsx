import type React from "react";
import { createCallable } from "react-call";
import { documentCategoryDescriptorMap } from "@/domains/documents/lib/categories";
import type { DocumentCategory } from "@/domains/documents/stores";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { cn } from "@/shared/lib/utils";

export type MentionSectionTargetCategory = Extract<
	DocumentCategory,
	"character" | "prop" | "scene" | "storyboard" | "screenplay"
>;

export interface MentionSectionTargetDialogProps {
	title: string;
}

export interface MentionSectionTargetDialogResult {
	category: MentionSectionTargetCategory;
}

export const mentionSectionTargetCategories: readonly MentionSectionTargetCategory[] = [
	"character",
	"prop",
	"scene",
	"storyboard",
	"screenplay",
] as const;

export const MentionSectionTargetDialog = createCallable<
	MentionSectionTargetDialogProps,
	MentionSectionTargetDialogResult | null
>(({ call, title }) => (
	<AlertDialog
		open
		onOpenChange={(open) => {
			if (!open) call.end(null);
		}}
	>
		<AlertDialogContent className="max-w-md">
			<AlertDialogHeader>
				<AlertDialogTitle>选择新增位置</AlertDialogTitle>
				<AlertDialogDescription>将「{title}」新增到哪类文档？</AlertDialogDescription>
			</AlertDialogHeader>

			<div className="grid gap-2">
				{mentionSectionTargetCategories.map((category) => (
					<MentionSectionTargetOption
						key={category}
						category={category}
						onSelect={() => call.end({ category })}
					/>
				))}
			</div>

			<AlertDialogFooter>
				<AlertDialogCancel className="rounded-sm">取消</AlertDialogCancel>
			</AlertDialogFooter>
		</AlertDialogContent>
	</AlertDialog>
));
MentionSectionTargetDialog.displayName = "MentionSectionTargetDialog";

export const openMentionSectionTargetDialog = (props: MentionSectionTargetDialogProps) =>
	MentionSectionTargetDialog.call(props);

const MentionSectionTargetOption: React.FC<{
	category: MentionSectionTargetCategory;
	onSelect: () => void;
}> = ({ category, onSelect }) => {
	const descriptor = documentCategoryDescriptorMap[category];
	const OptionIcon = descriptor.icon;

	return (
		<button
			type="button"
			className={cn(
				"grid min-h-12 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 rounded-sm border border-border bg-ide-editor p-2 text-left text-foreground transition-colors hover:bg-ide-list-hover",
			)}
			onClick={onSelect}
		>
			<span className="flex size-7 items-center justify-center rounded-sm bg-ide-toolbar">
				<OptionIcon
					className="size-4"
					style={{ color: `var(${descriptor.colorVar})` }}
					aria-hidden="true"
				/>
			</span>
			<span className="min-w-0">
				<span className="block truncate text-xs font-semibold">{descriptor.label}文档</span>
				<span className="mt-0.5 block truncate text-xs text-muted-foreground">
					新增到{descriptor.label}设定
				</span>
			</span>
		</button>
	);
};
