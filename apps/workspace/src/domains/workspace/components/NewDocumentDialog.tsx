import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { createCallable } from "react-call";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import {
	DialogDismissButton,
	isolateDialogDismissPointerDown,
} from "@/shared/components/ui/dialog-dismiss";
import {
	documentCategoryDescriptorMap,
	documentCategoryDescriptors,
} from "@/domains/documents/lib/categories";
import type { DocumentCategory } from "@/domains/documents/stores";
import { cn } from "@/shared/lib/utils";

export interface NewDocumentChoice {
	kind: "document";
	category: DocumentCategory;
}

export interface UploadAssetChoice {
	kind: "upload";
	file: File;
}

export type NewDocumentDialogChoice = NewDocumentChoice | UploadAssetChoice;
export type NewDocumentDialogResult = NewDocumentDialogChoice | { kind: "reference" } | null;

interface NewDocumentDialogProps {
	initialCategory?: DocumentCategory | null;
	showReferenceHandoff?: boolean;
}

interface TemplateOption {
	category: DocumentCategory;
	description: string;
	id: string;
	name: string;
}

export const NewDocumentDialog = createCallable<NewDocumentDialogProps, NewDocumentDialogResult>(
	({ initialCategory, showReferenceHandoff = false, call }) => {
		const options = useMemo(() => buildTemplateOptions(), []);
		const [selectedId, setSelectedId] = useState(options[0]?.id ?? "");
		const selectedOption = options.find((option) => option.id === selectedId) ?? options[0];

		useEffect(() => {
			const initialOption = options.find((option) => option.category === initialCategory);
			setSelectedId(initialOption?.id ?? options[0]?.id ?? "");
		}, [initialCategory, options]);

		const createSelectedDocument = () => {
			if (!selectedOption) return;
			call.end({
				kind: "document",
				category: selectedOption.category,
			});
		};

		return (
			<AlertDialog
				open
				onOpenChange={(open) => {
					if (!open) call.end(null);
				}}
			>
				<AlertDialogContent className="max-w-xl">
					<AlertDialogHeader>
						<AlertDialogTitle>新建文档</AlertDialogTitle>
						<AlertDialogDescription>选择要创建的项目文档类型。</AlertDialogDescription>
					</AlertDialogHeader>

					<div className="grid max-h-[min(28rem,60vh)] gap-2 overflow-y-auto pr-1">
						{options.map((option) => (
							<TemplateOptionButton
								key={option.id}
								option={option}
								selected={option.id === selectedOption?.id}
								onSelect={() => setSelectedId(option.id)}
							/>
						))}
						{showReferenceHandoff ? (
							<TemplateOptionButton
								option={referenceOption}
								selected={false}
								onSelect={() => call.end({ kind: "reference" })}
							/>
						) : null}
					</div>

					<AlertDialogFooter>
						<AlertDialogCancel className="rounded-sm">取消</AlertDialogCancel>
						<DialogDismissButton
							type="button"
							className="rounded-sm"
							onClick={createSelectedDocument}
						>
							<span>创建</span>
						</DialogDismissButton>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	},
);
NewDocumentDialog.displayName = "NewDocumentDialog";

export const openNewDocumentDialog = (props: NewDocumentDialogProps = {}) =>
	NewDocumentDialog.call(props);

interface TemplateOptionButtonProps {
	onSelect: () => void;
	option: TemplateOption;
	selected: boolean;
}

const TemplateOptionButton: React.FC<TemplateOptionButtonProps> = ({
	onSelect,
	option,
	selected,
}) => {
	const descriptor = documentCategoryDescriptorMap[option.category];
	const OptionIcon = descriptor.icon;

	return (
		<button
			type="button"
			onClick={onSelect}
			onPointerDown={(event) => isolateDialogDismissPointerDown(event)}
			aria-pressed={selected}
			className={cn(
				"grid grid-cols-[1.75rem_minmax(0,1fr)_0.875rem] gap-2 rounded-sm border p-2 text-left transition-colors",
				selected
					? "border-primary bg-ide-list-active text-ide-list-active-foreground"
					: "border-border bg-ide-editor text-foreground hover:bg-ide-list-hover",
			)}
		>
			<span className="flex size-7 items-center justify-center rounded-sm bg-ide-toolbar">
				<OptionIcon
					className="size-4"
					style={{ color: `var(${descriptor.colorVar})` }}
					aria-hidden="true"
				/>
			</span>
			<span className="min-w-0">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-xs font-semibold">{option.name}</span>
					<span className="shrink-0 rounded-sm border border-border bg-ide-toolbar px-1.5 py-0.5 text-2xs text-muted-foreground">
						{descriptor.label}
					</span>
				</span>
				<span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
					{option.description}
				</span>
			</span>
			<span
				className={cn(
					"mt-1 size-3.5 rounded-full border",
					selected ? "border-primary bg-primary" : "border-border",
				)}
				aria-hidden="true"
			/>
		</button>
	);
};

const buildTemplateOptions = (): TemplateOption[] =>
	documentCategoryDescriptors
		.filter((descriptor) => descriptor.key !== "reference")
		.map(
			(descriptor): TemplateOption => ({
				id: `category-${descriptor.key}`,
				name: descriptor.label,
				description: `创建一篇新的${descriptor.label}文档。`,
				category: descriptor.key,
			}),
		);

const referenceOption: TemplateOption = {
	id: "category-reference",
	name: "资料",
	description: "上传本地文件或创建空白资料文档。",
	category: "reference",
};
