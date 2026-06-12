import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
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

interface NewDocumentDialogProps {
	initialCategory?: DocumentCategory | null;
	onCreate: (choice: NewDocumentDialogChoice) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

interface TemplateOption {
	category: DocumentCategory;
	description: string;
	id: string;
	name: string;
}

export const NewDocumentDialog: React.FC<NewDocumentDialogProps> = ({
	initialCategory,
	onCreate,
	onOpenChange,
	open,
}) => {
	const options = useMemo(() => buildTemplateOptions(), []);
	const [selectedId, setSelectedId] = useState(options[0]?.id ?? "");
	const selectedOption = options.find((option) => option.id === selectedId) ?? options[0];

	useEffect(() => {
		if (!open) return;
		const initialOption = options.find((option) => option.category === initialCategory);
		setSelectedId(initialOption?.id ?? options[0]?.id ?? "");
	}, [initialCategory, open, options]);

	const createSelectedDocument = () => {
		if (!selectedOption) return;
		onCreate({
			kind: "document",
			category: selectedOption.category,
		});
	};

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
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
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel className="rounded-sm">取消</AlertDialogCancel>
					<Button type="button" className="rounded-sm" onClick={createSelectedDocument}>
						<span>创建</span>
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

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
		.filter((descriptor) => descriptor.key !== "source-material")
		.map(
			(descriptor): TemplateOption => ({
				id: `category-${descriptor.key}`,
				name: descriptor.label,
				description: `创建一篇新的${descriptor.label}文档。`,
				category: descriptor.key,
			}),
		);
