import { MessageSquareText, Pencil, RotateCcw, Save, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	type PromptTemplate,
	listPromptTemplates,
	promptTemplatesKey,
	resetPromptTemplate,
	updatePromptTemplate,
} from "@/domains/settings/api/prompt-templates";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { cn } from "@/shared/lib/utils";
import { PromptPackActions } from "./PromptPackActionsSlot";
import { SettingsMarkdownEditor, SettingsMarkdownPreview } from "./SettingsMarkdownEditor";

export const PromptTemplateEditorPanel: React.FC = () => {
	const toast = useToast();
	const {
		data: templates = [],
		isLoading,
		mutate,
	} = useSWR(promptTemplatesKey, listPromptTemplates);
	const templateList = useMemo(() => visibleInstructionTemplates(templates), [templates]);
	const [selectedId, setSelectedId] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const selectedTemplate = useMemo(
		() =>
			cloneTemplate(templateList.find((template) => template.id === selectedId) ?? templateList[0]),
		[selectedId, templateList],
	);
	const [draft, setDraft] = useState<PromptTemplate | null>(selectedTemplate);
	const [isResetting, setIsResetting] = useState(false);

	useEffect(() => {
		if (!templateList.length) return;
		if (!selectedId || !templateList.some((template) => template.id === selectedId)) {
			setSelectedId(templateList[0].id);
		}
	}, [selectedId, templateList]);

	useEffect(() => {
		setDraft(selectedTemplate);
	}, [selectedTemplate]);

	const save = async () => {
		if (!draft) return;
		const nextTemplate = sanitizeTemplate(draft);
		setIsSaving(true);
		try {
			const savedTemplate = await updatePromptTemplate(nextTemplate.id, nextTemplate);
			await mutate(
				templates.map((template) => (template.id === savedTemplate.id ? savedTemplate : template)),
				false,
			);
			setDraft(cloneTemplate(savedTemplate));
			setEditDialogOpen(false);
			toast.success("系统指令已保存");
		} catch (error) {
			toast.error("系统指令保存失败", { description: errorMessage(error) });
		} finally {
			setIsSaving(false);
		}
	};

	const openEditDialog = () => {
		setDraft(selectedTemplate);
		setEditDialogOpen(true);
	};

	const closeEditDialog = () => {
		setEditDialogOpen(false);
		setDraft(selectedTemplate);
	};

	const reset = async () => {
		if (!selectedTemplate?.overridden) return;
		setIsResetting(true);
		try {
			const resetTemplate = await resetPromptTemplate(selectedTemplate.id);
			await mutate(
				templates.map((template) => (template.id === resetTemplate.id ? resetTemplate : template)),
				false,
			);
			setDraft(cloneTemplate(resetTemplate));
			toast.success("系统指令已恢复默认");
		} catch (error) {
			toast.error("恢复默认失败", { description: errorMessage(error) });
		} finally {
			setIsResetting(false);
		}
	};

	return (
		<>
			<PromptPackActions>
				{draft ? (
					<>
						{selectedTemplate?.overridden ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => void reset()}
								disabled={isResetting}
							>
								<RotateCcw className="size-4" />
								<span>{isResetting ? "恢复中" : "恢复默认"}</span>
							</Button>
						) : null}
						<Button type="button" onClick={openEditDialog}>
							<Pencil className="size-4" />
							<span>编辑</span>
						</Button>
					</>
				) : null}
			</PromptPackActions>

			<PromptTemplateEditDialog
				draft={draft}
				isSaving={isSaving}
				open={editDialogOpen}
				onCancel={closeEditDialog}
				onDraftChange={setDraft}
				onOpenChange={(open) => {
					if (open) {
						openEditDialog();
						return;
					}
					closeEditDialog();
				}}
				onSave={() => void save()}
			/>

			<div className="h-full min-h-0 overflow-y-auto px-5 py-5">
				<div className="space-y-3">
					{isLoading && templateList.length === 0 ? (
						<p className={templateMessageClassName}>正在加载系统指令。</p>
					) : !draft ? (
						<p className={templateMessageClassName}>没有可用的系统指令。</p>
					) : (
						<>
							<div className={settingsFormRowClassName}>
								<div className="min-w-0">
									<Label
										htmlFor="prompt-template-select"
										className="text-sm font-medium text-foreground"
									>
										当前指令
									</Label>
									<p className="mt-1 text-xs text-muted-foreground">选择要查看的系统指令片段。</p>
								</div>
								<Select value={selectedId} onValueChange={setSelectedId}>
									<SelectTrigger id="prompt-template-select" className="rounded-md text-foreground">
										<SelectValue placeholder="选择提示词" />
									</SelectTrigger>
									<SelectContent align="start">
										{templateList.map((template) => (
											<SelectItem key={template.id} value={template.id}>
												<span className="flex min-w-0 w-full items-center gap-2">
													<span className="min-w-0 flex-1 truncate">{template.name}</span>
													<EntrySourceBadge
														source={template.source}
														overridden={template.overridden}
													/>
												</span>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							{draft.description ? (
								<div className={settingsFormRowClassName}>
									<Label className="text-sm font-medium text-foreground">说明</Label>
									<p className="text-sm leading-6 text-muted-foreground">{draft.description}</p>
								</div>
							) : null}

							<div className={promptBodyRowClassName}>
								<div className="flex items-center justify-between gap-2">
									<Label
										id="prompt-template-content-label"
										className="text-sm font-medium text-foreground"
									>
										提示词内容
									</Label>
									<span className="flex items-center gap-1 text-xs text-muted-foreground">
										<MessageSquareText className="size-3.5" />
										{countLines(draft.content)} 行
									</span>
								</div>
								<SettingsMarkdownPreview
									ariaLabelledBy="prompt-template-content-label"
									className="min-h-72"
									placeholder="暂无提示词内容。"
									value={draft.content}
								/>
							</div>
						</>
					)}
				</div>
			</div>
		</>
	);
};

const PromptTemplateEditDialog: React.FC<{
	draft: PromptTemplate | null;
	isSaving: boolean;
	open: boolean;
	onCancel: () => void;
	onDraftChange: React.Dispatch<React.SetStateAction<PromptTemplate | null>>;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
}> = ({ draft, isSaving, open, onCancel, onDraftChange, onOpenChange, onSave }) => (
	<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
			<DialogPrimitive.Content
				className={cn(
					"fixed left-1/2 top-1/2 z-50 flex max-h-[min(86vh,46rem)] w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
					dialogContentMotion,
				)}
				aria-describedby="prompt-template-edit-description"
			>
				<header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
					<div className="min-w-0">
						<DialogPrimitive.Title className="text-sm font-semibold text-foreground">
							编辑指令
						</DialogPrimitive.Title>
						<DialogPrimitive.Description
							id="prompt-template-edit-description"
							className="mt-1 text-xs text-muted-foreground"
						>
							修改当前系统指令内容。
						</DialogPrimitive.Description>
					</div>
					<DialogPrimitive.Close asChild>
						<Button type="button" variant="ghost" size="icon" aria-label="关闭编辑指令">
							<X className="size-4" />
						</Button>
					</DialogPrimitive.Close>
				</header>

				<div className="min-h-0 overflow-y-auto p-4">
					{draft ? (
						<div className="grid gap-2">
							<div className="flex items-center justify-between gap-2">
								<Label
									id="prompt-template-edit-content-label"
									className="text-sm font-medium text-foreground"
								>
									提示词内容
								</Label>
								<span className="flex items-center gap-1 text-xs text-muted-foreground">
									<MessageSquareText className="size-3.5" />
									{countLines(draft.content)} 行
								</span>
							</div>
							<SettingsMarkdownEditor
								ariaLabelledBy="prompt-template-edit-content-label"
								placeholder="编写系统指令..."
								value={draft.content}
								onChange={(content) => onDraftChange({ ...draft, content })}
							/>
						</div>
					) : null}
				</div>

				<footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
					<Button type="button" variant="ghost" onClick={onCancel}>
						取消
					</Button>
					<Button type="button" onClick={onSave} disabled={!draft || isSaving}>
						<Save className="size-4" />
						<span>{isSaving ? "保存中" : "保存"}</span>
					</Button>
				</footer>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	</DialogPrimitive.Root>
);

const settingsFormRowClassName = cn(
	"py-2",
	"grid gap-3 md:grid-cols-[minmax(var(--settings-label-column-min),var(--settings-label-column-max))_minmax(0,1fr)] md:items-start",
);

const promptBodyRowClassName = "grid gap-2 py-2";

const templateMessageClassName = "py-2 text-sm text-muted-foreground";

export const visibleInstructionTemplates = (templates: PromptTemplate[]) =>
	templates.filter((template) => template.injectable !== false && template.editable !== false);

const EntrySourceBadge: React.FC<Pick<PromptTemplate, "source" | "overridden">> = ({
	overridden,
	source,
}) => (
	<Badge
		variant={overridden || source === "official" ? "secondary" : "outline"}
		className="rounded-md"
	>
		{entrySourceLabel(source, overridden)}
	</Badge>
);

const entrySourceLabel = (source: PromptTemplate["source"], overridden?: boolean) => {
	if (overridden) return "已覆盖";
	if (source === "official") return "官方默认";
	return "用户覆盖";
};

const sanitizeTemplate = (template: PromptTemplate): PromptTemplate => ({
	...template,
	content: template.content.replace(/\r\n/g, "\n").trim(),
});

const cloneTemplate = (template: PromptTemplate | undefined): PromptTemplate | null => {
	if (!template) return null;
	return { ...template };
};

const countLines = (content: string) => {
	const normalized = content.replace(/\r\n/g, "\n").trim();
	if (!normalized) return 0;
	return normalized.split("\n").length;
};

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请检查后端服务是否可写系统指令。";
};
