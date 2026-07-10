import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { createCallable } from "react-call";
import { Check, ChevronRight } from "lucide-react";
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

		const handleOptionKeyDown = (
			event: React.KeyboardEvent<HTMLButtonElement>,
			optionId: string,
		) => {
			const currentIndex = options.findIndex((option) => option.id === optionId);
			if (currentIndex < 0) return;

			let nextIndex: number | null = null;
			switch (event.key) {
				case "ArrowDown":
				case "ArrowRight":
					nextIndex = (currentIndex + 1) % options.length;
					break;
				case "ArrowLeft":
				case "ArrowUp":
					nextIndex = (currentIndex - 1 + options.length) % options.length;
					break;
				case "End":
					nextIndex = options.length - 1;
					break;
				case "Home":
					nextIndex = 0;
					break;
				default:
					return;
			}

			event.preventDefault();
			const nextOption = options[nextIndex];
			if (!nextOption) return;
			setSelectedId(nextOption.id);
			document.getElementById(`new-document-option-${nextOption.id}`)?.focus();
		};

		return (
			<AlertDialog
				open
				onOpenChange={(open) => {
					if (!open) call.end(null);
				}}
			>
				<AlertDialogContent
					className="max-w-2xl gap-5 p-5"
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						document.getElementById(`new-document-option-${selectedOption?.id}`)?.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>新建文档</AlertDialogTitle>
						<AlertDialogDescription>选择一种内容类型开始创作。</AlertDialogDescription>
					</AlertDialogHeader>

					<div className="grid max-h-[min(32rem,65vh)] gap-4 overflow-y-auto pr-1">
						<div
							role="radiogroup"
							aria-label="文档类型"
							className="grid grid-cols-1 gap-2 sm:grid-cols-2"
						>
							{options.map((option) => (
								<TemplateOptionButton
									key={option.id}
									option={option}
									selected={option.id === selectedOption?.id}
									onSelect={() => setSelectedId(option.id)}
									onKeyDown={(event) => handleOptionKeyDown(event, option.id)}
								/>
							))}
						</div>
						{showReferenceHandoff ? (
							<div className="grid gap-2 border-t border-border pt-3">
								<span className="text-2xs font-medium text-muted-foreground">其他方式</span>
								<ReferenceOptionButton onSelect={() => call.end({ kind: "reference" })} />
							</div>
						) : null}
					</div>

					<AlertDialogFooter>
						<AlertDialogCancel className="rounded-sm">取消</AlertDialogCancel>
						<DialogDismissButton
							type="button"
							className="rounded-sm"
							onClick={createSelectedDocument}
						>
							<span>创建{selectedOption?.name ?? "文档"}</span>
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
	onKeyDown: React.KeyboardEventHandler<HTMLButtonElement>;
	onSelect: () => void;
	option: TemplateOption;
	selected: boolean;
}

const TemplateOptionButton: React.FC<TemplateOptionButtonProps> = ({
	onKeyDown,
	onSelect,
	option,
	selected,
}) => {
	const descriptor = documentCategoryDescriptorMap[option.category];
	const OptionIcon = descriptor.icon;

	return (
		<button
			id={`new-document-option-${option.id}`}
			type="button"
			role="radio"
			aria-checked={selected}
			tabIndex={selected ? 0 : -1}
			onClick={onSelect}
			onKeyDown={onKeyDown}
			onPointerDown={(event) => isolateDialogDismissPointerDown(event)}
			className={cn(
				"grid min-h-20 grid-cols-[2.25rem_minmax(0,1fr)_1rem] items-start gap-3 rounded-control border p-3 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
				selected
					? "border-primary bg-ide-list-active text-foreground shadow-sm"
					: "border-border bg-ide-editor text-foreground hover:bg-ide-list-hover",
			)}
		>
			<span className="flex size-9 items-center justify-center rounded-control bg-ide-toolbar">
				<OptionIcon
					className="size-[1.125rem]"
					style={{ color: `var(${descriptor.colorVar})` }}
					aria-hidden="true"
				/>
			</span>
			<span className="min-w-0 pt-0.5">
				<span className="block truncate text-sm font-semibold">{option.name}</span>
				<span className="mt-1 block text-xs leading-5 text-muted-foreground">
					{option.description}
				</span>
			</span>
			<span
				className={cn(
					"mt-1 flex size-4 items-center justify-center rounded-full border transition-colors",
					selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
				)}
				aria-hidden="true"
			>
				{selected ? <Check className="size-3" strokeWidth={2.5} /> : null}
			</span>
		</button>
	);
};

interface ReferenceOptionButtonProps {
	onSelect: () => void;
}

const ReferenceOptionButton: React.FC<ReferenceOptionButtonProps> = ({ onSelect }) => {
	const descriptor = documentCategoryDescriptorMap[referenceOption.category];
	const OptionIcon = descriptor.icon;

	return (
		<button
			type="button"
			onClick={onSelect}
			onPointerDown={(event) => isolateDialogDismissPointerDown(event)}
			className="grid min-h-16 grid-cols-[2.25rem_minmax(0,1fr)_1rem] items-center gap-3 rounded-control border border-border bg-ide-editor p-3 text-left text-foreground transition-[background-color,border-color,box-shadow] hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			<span className="flex size-9 items-center justify-center rounded-control bg-ide-toolbar">
				<OptionIcon
					className="size-[1.125rem]"
					style={{ color: `var(${descriptor.colorVar})` }}
					aria-hidden="true"
				/>
			</span>
			<span className="min-w-0">
				<span className="block text-sm font-semibold">{referenceOption.name}</span>
				<span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
					{referenceOption.description}
				</span>
			</span>
			<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
		</button>
	);
};

const templateOptionDescriptionMap: Partial<Record<DocumentCategory, string>> = {
	screenplay: "编写故事正文、对白与场景调度",
	character: "整理人物背景、动机与关系",
	scene: "记录地点、环境与氛围设定",
	prop: "管理关键道具的外观与用途",
	storyboard: "拆解镜头、画面与节奏安排",
};

const buildTemplateOptions = (): TemplateOption[] =>
	documentCategoryDescriptors
		.filter((descriptor) => descriptor.key !== "reference")
		.map(
			(descriptor): TemplateOption => ({
				id: `category-${descriptor.key}`,
				name: descriptor.label,
				description:
					templateOptionDescriptionMap[descriptor.key] ?? `创建新的${descriptor.label}文档`,
				category: descriptor.key,
			}),
		);

const referenceOption: TemplateOption = {
	id: "category-reference",
	name: "资料",
	description: "上传文件，或创建空白参考资料",
	category: "reference",
};
