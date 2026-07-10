import { Loader2, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	type PromptPresetCategory,
	type PromptPreset,
	createPromptPreset,
	deletePromptPreset,
	listPromptPresets,
	promptPresetsKey,
	resetPromptPreset,
	updatePromptPreset,
} from "@/domains/generation/api/prompt-presets";
import {
	createPromptCategory,
	listPromptCategories,
	promptCategoriesKey,
	type PromptCategory,
} from "@/domains/generation/api/prompt-categories";
import {
	defaultPromptCategories,
	extraPromptCategory,
	promptCategoryLabel,
	stylePromptCategory,
} from "@/domains/generation/lib/prompt-categories";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { DialogClose, DialogDismissButton } from "@/shared/components/ui/dialog-dismiss";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { cn } from "@/shared/lib/utils";
import { isPromptLibraryCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
import { PromptPackActions } from "./PromptPackActionsSlot";
import { SettingsMarkdownPreview } from "./SettingsMarkdownEditor";

interface Draft {
	id: string;
	name: string;
	category: PromptPresetCategory;
	prompt: string;
}

type CategoryDialogTarget = "edit" | "create";

const emptyDraft = (category: PromptPresetCategory): Draft => ({
	id: "",
	name: "",
	category,
	prompt: "",
});

export const PromptLibraryEditorPanel: React.FC = () => {
	const toast = useToast();
	const { mutate: mutateGlobal } = useSWRConfig();
	const {
		data: presets = [],
		isLoading,
		mutate,
	} = useSWR(promptPresetsKey, () => listPromptPresets());
	const { data: categories = defaultPromptCategories, mutate: mutateCategories } = useSWR(
		promptCategoriesKey,
		listPromptCategories,
	);
	const [categoryFilter, setCategoryFilter] = useState<PromptPresetCategory | "all">("all");
	const [selectedId, setSelectedId] = useState("");
	const [draft, setDraft] = useState<Draft>(emptyDraft("style"));
	const [createDraft, setCreateDraft] = useState<Draft>(emptyDraft("style"));
	const [createError, setCreateError] = useState("");
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
	const [categoryDialogTarget, setCategoryDialogTarget] = useState<CategoryDialogTarget>("edit");
	const [categoryDraftName, setCategoryDraftName] = useState("");
	const [categoryError, setCategoryError] = useState("");
	const [isCategorySaving, setIsCategorySaving] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isResetting, setIsResetting] = useState(false);
	const [error, setError] = useState("");

	const visiblePresets = useMemo(
		() =>
			presets.filter((preset) => categoryFilter === "all" || preset.category === categoryFilter),
		[presets, categoryFilter],
	);

	const presetCategories = useMemo(
		() => Array.from(new Set(presets.map((preset) => preset.category).filter(Boolean))),
		[presets],
	);

	const filterCategoryOptions = useMemo(
		() => promptCategoryOptions(categories, ...presetCategories),
		[categories, presetCategories],
	);

	const categoryOptions = useMemo(
		() =>
			promptCategoryOptions(categories, ...presetCategories, draft.category, createDraft.category),
		[categories, presetCategories, draft.category, createDraft.category],
	);

	const selectedPreset = useMemo(
		() => presets.find((preset) => preset.id === selectedId),
		[presets, selectedId],
	);

	useEffect(() => {
		if (!selectedPreset && visiblePresets[0]) {
			setSelectedId(visiblePresets[0].id);
		}
	}, [selectedPreset, visiblePresets]);

	useEffect(() => {
		if (!selectedPreset) return;
		setDraft(draftFromPreset(selectedPreset));
		setError("");
	}, [selectedPreset]);

	const canDeletePreset = Boolean(selectedPreset);
	const canResetPreset = Boolean(
		selectedPreset && (selectedPreset.source !== "user" || selectedPreset.overridden),
	);
	const draftValid = Boolean(draft.category.trim() && draft.name.trim() && draft.prompt.trim());
	const createDraftValid = Boolean(
		createDraft.category.trim() && createDraft.name.trim() && createDraft.prompt.trim(),
	);
	const refreshPromptLibraryCaches = () => mutateGlobal(isPromptLibraryCacheKey);

	const startCreate = () => {
		const category = categoryFilter === "all" ? stylePromptCategory : categoryFilter;
		setCreateDraft(emptyDraft(category));
		setCreateError("");
		setCreateDialogOpen(true);
	};

	const cancelCreate = () => {
		setCreateDialogOpen(false);
		setCreateDraft(emptyDraft(categoryFilter === "all" ? stylePromptCategory : categoryFilter));
		setCreateError("");
	};

	const openEditDialog = () => {
		if (!selectedPreset) return;
		setDraft(draftFromPreset(selectedPreset));
		setError("");
		setEditDialogOpen(true);
	};

	const closeEditDialog = () => {
		setEditDialogOpen(false);
		if (selectedPreset) setDraft(draftFromPreset(selectedPreset));
		setError("");
	};

	const selectPreset = (id: string) => {
		setSelectedId(id);
	};

	const saveEdit = async () => {
		if (!draftValid) return;
		setIsSaving(true);
		setError("");
		try {
			const input = {
				id: draft.id,
				name: draft.name.trim(),
				category: draft.category.trim() || extraPromptCategory,
				prompt: draft.prompt.trim(),
			};
			const saved = await updatePromptPreset(input.id, input);
			await refreshPromptLibraryCaches();
			setCategoryFilter((current) => categoryFilterAfterSave(current, saved.category));
			setSelectedId(saved.id);
			setEditDialogOpen(false);
			toast.success("已保存", { description: saved.name });
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("保存失败", { description: message });
		} finally {
			setIsSaving(false);
		}
	};

	const saveCreate = async () => {
		if (!createDraftValid) return;
		setIsSaving(true);
		setCreateError("");
		try {
			const input = {
				id: createDraft.id.trim() || slugify(createDraft.name),
				name: createDraft.name.trim(),
				category: createDraft.category.trim() || extraPromptCategory,
				prompt: createDraft.prompt.trim(),
			};
			const saved = await createPromptPreset(input);
			await refreshPromptLibraryCaches();
			setCreateDialogOpen(false);
			setCategoryFilter((current) => categoryFilterAfterSave(current, saved.category));
			setSelectedId(saved.id);
			toast.success("已创建", { description: saved.name });
		} catch (err) {
			const message = errorMessage(err);
			setCreateError(message);
			toast.error("保存失败", { description: message });
		} finally {
			setIsSaving(false);
		}
	};

	const openCategoryDialog = (target: CategoryDialogTarget) => {
		setCategoryDialogTarget(target);
		setCategoryDraftName("");
		setCategoryError("");
		setCategoryDialogOpen(true);
	};

	const saveCategory = async () => {
		const category = resolveCategoryValue(categoryDraftName, categoryOptions);
		const validationError = categoryValidationError(category);
		if (validationError) {
			setCategoryError(validationError);
			return;
		}
		const existing = categoryOptions.find((option) => option.value === category);
		if (existing) {
			selectCategory(category);
			return;
		}
		setIsCategorySaving(true);
		setCategoryError("");
		try {
			const created = await createPromptCategory({ label: category });
			await mutateCategories();
			await refreshPromptLibraryCaches();
			selectCategory(created.id);
		} catch (err) {
			setCategoryError(errorMessage(err));
		} finally {
			setIsCategorySaving(false);
		}
	};

	const selectCategory = (category: PromptPresetCategory) => {
		if (categoryDialogTarget === "edit") {
			setDraft((current) => ({ ...current, category }));
		} else {
			setCreateDraft((current) => ({ ...current, category }));
		}
		setCategoryDialogOpen(false);
		setCategoryDraftName("");
		setCategoryError("");
	};

	const deletePreset = async () => {
		if (!selectedPreset) return false;
		setIsDeleting(true);
		setError("");
		try {
			await deletePromptPreset(selectedPreset.id);
			await mutate();
			await refreshPromptLibraryCaches();
			setSelectedId("");
			toast.success("已删除");
			return true;
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("删除失败", { description: message });
			return false;
		} finally {
			setIsDeleting(false);
		}
	};

	const confirmDeletePreset = () => {
		if (!selectedPreset) return;
		const isUserCreated = selectedPreset.source === "user" && !selectedPreset.overridden;
		void confirmDialog({
			title: "删除提示词预设？",
			description: isUserCreated
				? `确定要删除“${selectedPreset.name}”吗？此操作无法撤销。`
				: `确定要删除“${selectedPreset.name}”吗？来自包的预设会从列表中隐藏。`,
			confirmLabel: "删除",
			confirmIcon: <Trash2 className="size-4" />,
			onConfirm: deletePreset,
		});
	};

	const resetPreset = async () => {
		if (!selectedPreset || !canResetPreset) return false;
		setIsResetting(true);
		setError("");
		try {
			const reset = await resetPromptPreset(selectedPreset.id);
			await refreshPromptLibraryCaches();
			setCategoryFilter((current) => categoryFilterAfterSave(current, reset.category));
			setSelectedId(reset.id);
			setDraft(draftFromPreset(reset));
			setEditDialogOpen(false);
			toast.success("提示词已恢复默认", { description: reset.name });
			return true;
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("恢复失败", { description: message });
			return false;
		} finally {
			setIsResetting(false);
		}
	};

	const confirmResetPreset = () => {
		if (!selectedPreset || !canResetPreset) return;
		void confirmDialog({
			title: "恢复提示词默认？",
			description: `将“${selectedPreset.name}”恢复为当前提示词包中的默认内容。`,
			confirmLabel: "恢复默认",
			confirmIcon: <RotateCcw className="size-4" />,
			variant: "default",
			onConfirm: resetPreset,
		});
	};

	return (
		<>
			<PromptPackActions>
				<Button type="button" variant="outline" onClick={startCreate}>
					<Plus className="size-4" />
					<span>新建</span>
				</Button>
				{canDeletePreset ? (
					<Button
						type="button"
						variant="destructive"
						onClick={confirmDeletePreset}
						disabled={isDeleting}
					>
						{isDeleting ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Trash2 className="size-4" />
						)}
						<span>{isDeleting ? "处理中" : "删除"}</span>
					</Button>
				) : null}
				<Button
					type="button"
					variant="outline"
					onClick={confirmResetPreset}
					disabled={!selectedPreset || !canResetPreset || isResetting}
				>
					{isResetting ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<RotateCcw className="size-4" />
					)}
					<span>{isResetting ? "恢复中" : "恢复默认"}</span>
				</Button>
				<Button type="button" onClick={openEditDialog} disabled={!selectedPreset}>
					<Pencil className="size-4" />
					<span>编辑</span>
				</Button>
			</PromptPackActions>

			<div className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-5">
				<div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
					<CategoryChip
						active={categoryFilter === "all"}
						onClick={() => setCategoryFilter("all")}
						label="全部"
					/>
					{filterCategoryOptions.map((category) => (
						<CategoryChip
							key={category.value}
							active={categoryFilter === category.value}
							onClick={() => setCategoryFilter(category.value)}
							label={category.label}
						/>
					))}
				</div>

				<div className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,16rem)_minmax(0,1fr)] gap-3 md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
					<div className="min-h-0 overflow-y-auto rounded-md border border-border">
						{isLoading && presets.length === 0 ? (
							<div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								<span>加载中</span>
							</div>
						) : visiblePresets.length === 0 ? (
							<p className="p-3 text-xs text-muted-foreground">没有匹配的预设。</p>
						) : (
							visiblePresets.map((preset) => (
								<button
									key={preset.id}
									type="button"
									onClick={() => selectPreset(preset.id)}
									className={cn(
										"flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left",
										preset.id === selectedId
											? "border-primary bg-ide-list-hover"
											: "border-transparent hover:bg-ide-list-hover",
									)}
								>
									<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
										{preset.name}
									</span>
									<span className="shrink-0 text-2xs text-muted-foreground">
										{promptCategoryOptionLabel(preset.category, categoryOptions)}
									</span>
								</button>
							))
						)}
					</div>

					<div className="min-h-0 min-w-0 overflow-y-auto rounded-md border border-border p-3">
						{!selectedPreset ? (
							<p className="py-6 text-center text-sm text-muted-foreground">
								选择左侧预设查看详情，或点击「新建」。
							</p>
						) : (
							<div className="space-y-3">
								{error ? (
									<Alert variant="destructive" className="rounded-md">
										<AlertDescription>{error}</AlertDescription>
									</Alert>
								) : null}

								<FieldRow label="名称">
									<p className="min-h-8 rounded-md border border-border bg-ide-panel px-3 py-1.5 text-sm leading-5 text-foreground">
										{selectedPreset.name}
									</p>
								</FieldRow>

								<FieldRow label="分类">
									<p className="min-h-8 rounded-md border border-border bg-ide-panel px-3 py-1.5 text-sm leading-5 text-foreground">
										{promptCategoryOptionLabel(selectedPreset.category, categoryOptions)}
									</p>
								</FieldRow>

								<div className="grid gap-2">
									<Label
										id="prompt-preset-preview-label"
										className="text-sm font-medium text-foreground"
									>
										提示词
									</Label>
									<SettingsMarkdownPreview
										ariaLabelledBy="prompt-preset-preview-label"
										className="min-h-40"
										placeholder="暂无提示词。"
										value={selectedPreset.prompt}
									/>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>

			<PromptPresetCreateDialog
				draft={createDraft}
				error={createError}
				isSaving={isSaving}
				open={createDialogOpen}
				categoryOptions={categoryOptions}
				valid={createDraftValid}
				onCancel={cancelCreate}
				onCreateCategory={() => openCategoryDialog("create")}
				onDraftChange={setCreateDraft}
				onOpenChange={(open) => {
					if (open) {
						setCreateDialogOpen(true);
						return;
					}
					cancelCreate();
				}}
				onSave={() => void saveCreate()}
			/>
			<PromptPresetEditDialog
				draft={draft}
				error={error}
				isSaving={isSaving}
				open={editDialogOpen}
				categoryOptions={categoryOptions}
				valid={draftValid}
				onCancel={closeEditDialog}
				onCreateCategory={() => openCategoryDialog("edit")}
				onDraftChange={setDraft}
				onOpenChange={(open) => {
					if (open) {
						openEditDialog();
						return;
					}
					closeEditDialog();
				}}
				onSave={() => void saveEdit()}
			/>
			<CategoryCreateDialog
				error={categoryError}
				isSaving={isCategorySaving}
				name={categoryDraftName}
				open={categoryDialogOpen}
				onNameChange={(value) => {
					setCategoryDraftName(value);
					setCategoryError("");
				}}
				onCancel={() => {
					setCategoryDialogOpen(false);
					setCategoryDraftName("");
					setCategoryError("");
				}}
				onOpenChange={(open) => {
					if (open) {
						setCategoryDialogOpen(true);
						return;
					}
					setCategoryDialogOpen(false);
					setCategoryDraftName("");
					setCategoryError("");
				}}
				onSave={() => void saveCategory()}
			/>
		</>
	);
};

const CategoryChip: React.FC<{ active: boolean; label: string; onClick: () => void }> = ({
	active,
	label,
	onClick,
}) => (
	<button
		type="button"
		aria-pressed={active}
		onClick={onClick}
		className={cn(
			"rounded-full border px-3 py-1 text-xs",
			active
				? "border-primary bg-primary/10 font-medium text-foreground"
				: "border-border text-muted-foreground hover:bg-ide-list-hover",
		)}
	>
		{label}
	</button>
);

const FieldRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
	<div className="grid items-center gap-2 md:grid-cols-[5rem_minmax(0,1fr)]">
		<Label className="text-sm font-medium text-foreground">{label}</Label>
		{children}
	</div>
);

interface PromptCategoryOption {
	value: PromptPresetCategory;
	label: string;
}

const CategorySelectField: React.FC<{
	disabled?: boolean;
	onCreate: () => void;
	onChange: (value: string) => void;
	options: PromptCategoryOption[];
	value: string;
}> = ({ disabled = false, onCreate, onChange, options, value }) => (
	<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] gap-2">
		<Select value={value} disabled={disabled} onValueChange={onChange}>
			<SelectTrigger className="rounded-md text-foreground">
				<SelectValue placeholder="选择分类" />
			</SelectTrigger>
			<SelectContent align="start">
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
		<Button
			type="button"
			variant="outline"
			size="icon"
			disabled={disabled}
			aria-label="新建分类"
			title="新建分类"
			onClick={onCreate}
		>
			<Plus className="size-4" />
		</Button>
	</div>
);

const CategoryCreateDialog: React.FC<{
	error: string;
	isSaving: boolean;
	name: string;
	open: boolean;
	onCancel: () => void;
	onNameChange: (value: string) => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
}> = ({ error, isSaving, name, open, onCancel, onNameChange, onOpenChange, onSave }) => (
	<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
			<DialogPrimitive.Content
				className={cn(
					"fixed left-1/2 top-1/2 z-50 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
					dialogContentMotion,
				)}
				aria-describedby="prompt-category-create-description"
			>
				<header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
					<div className="min-w-0">
						<DialogPrimitive.Title className="text-sm font-semibold text-foreground">
							新建分类
						</DialogPrimitive.Title>
						<DialogPrimitive.Description
							id="prompt-category-create-description"
							className="mt-1 text-xs text-muted-foreground"
						>
							创建提示词分类。
						</DialogPrimitive.Description>
					</div>
					<DialogClose asChild>
						<Button type="button" variant="ghost" size="icon" aria-label="关闭新建分类">
							<X className="size-4" />
						</Button>
					</DialogClose>
				</header>

				<div className="space-y-3 p-4">
					{error ? (
						<Alert variant="destructive" className="rounded-md">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}
					<div className="grid gap-2">
						<Label htmlFor="prompt-category-name" className="text-sm font-medium text-foreground">
							分类名称
						</Label>
						<Input
							id="prompt-category-name"
							value={name}
							placeholder="如 镜头"
							className="rounded-md"
							onChange={(event) => onNameChange(event.target.value)}
						/>
					</div>
				</div>

				<footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
					<DialogDismissButton type="button" variant="ghost" onClick={onCancel}>
						取消
					</DialogDismissButton>
					<DialogDismissButton type="button" onClick={onSave} disabled={!name.trim() || isSaving}>
						{isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
						<span>创建</span>
					</DialogDismissButton>
				</footer>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	</DialogPrimitive.Root>
);

const PromptPresetEditDialog: React.FC<{
	categoryOptions: PromptCategoryOption[];
	draft: Draft;
	error: string;
	isSaving: boolean;
	open: boolean;
	valid: boolean;
	onCancel: () => void;
	onCreateCategory: () => void;
	onDraftChange: React.Dispatch<React.SetStateAction<Draft>>;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
}> = ({
	categoryOptions,
	draft,
	error,
	isSaving,
	open,
	valid,
	onCancel,
	onCreateCategory,
	onDraftChange,
	onOpenChange,
	onSave,
}) => (
	<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
			<DialogPrimitive.Content
				className={cn(
					"fixed left-1/2 top-1/2 z-50 flex max-h-[min(86vh,46rem)] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
					dialogContentMotion,
				)}
				aria-describedby="prompt-preset-edit-description"
			>
				<header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
					<div className="min-w-0">
						<DialogPrimitive.Title className="text-sm font-semibold text-foreground">
							编辑提示词
						</DialogPrimitive.Title>
						<DialogPrimitive.Description
							id="prompt-preset-edit-description"
							className="mt-1 text-xs text-muted-foreground"
						>
							修改当前分类提示词预设。
						</DialogPrimitive.Description>
					</div>
					<DialogClose asChild>
						<Button type="button" variant="ghost" size="icon" aria-label="关闭编辑提示词">
							<X className="size-4" />
						</Button>
					</DialogClose>
				</header>

				<div className="min-h-0 overflow-y-auto p-4">
					<div className="space-y-3">
						{error ? (
							<Alert variant="destructive" className="rounded-md">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}

						<FieldRow label="分类">
							<CategorySelectField
								value={draft.category}
								options={categoryOptions}
								onCreate={onCreateCategory}
								onChange={(value) => onDraftChange((current) => ({ ...current, category: value }))}
							/>
						</FieldRow>

						<FieldRow label="名称">
							<Input
								value={draft.name}
								className="rounded-md"
								onChange={(event) =>
									onDraftChange((current) => ({ ...current, name: event.target.value }))
								}
							/>
						</FieldRow>

						<div className="grid gap-2">
							<Label className="text-sm font-medium text-foreground">提示词</Label>
							<Textarea
								value={draft.prompt}
								className="min-h-48 resize-y rounded-md text-sm leading-6"
								onChange={(event) =>
									onDraftChange((current) => ({ ...current, prompt: event.target.value }))
								}
							/>
						</div>
					</div>
				</div>

				<footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
					<DialogDismissButton type="button" variant="ghost" onClick={onCancel}>
						取消
					</DialogDismissButton>
					<DialogDismissButton type="button" onClick={onSave} disabled={!valid || isSaving}>
						{isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
						<span>{isSaving ? "保存中" : "保存"}</span>
					</DialogDismissButton>
				</footer>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	</DialogPrimitive.Root>
);

const PromptPresetCreateDialog: React.FC<{
	categoryOptions: PromptCategoryOption[];
	draft: Draft;
	error: string;
	isSaving: boolean;
	open: boolean;
	valid: boolean;
	onCancel: () => void;
	onCreateCategory: () => void;
	onDraftChange: React.Dispatch<React.SetStateAction<Draft>>;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
}> = ({
	categoryOptions,
	draft,
	error,
	isSaving,
	open,
	valid,
	onCancel,
	onCreateCategory,
	onDraftChange,
	onOpenChange,
	onSave,
}) => {
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
				<DialogPrimitive.Content
					className={cn(
						"fixed left-1/2 top-1/2 z-50 flex max-h-[min(86vh,46rem)] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
						dialogContentMotion,
					)}
					aria-describedby="prompt-preset-create-description"
				>
					<header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
						<div className="min-w-0">
							<DialogPrimitive.Title className="text-sm font-semibold text-foreground">
								新建提示词
							</DialogPrimitive.Title>
							<DialogPrimitive.Description
								id="prompt-preset-create-description"
								className="mt-1 text-xs text-muted-foreground"
							>
								创建可复用的分类提示词预设。
							</DialogPrimitive.Description>
						</div>
						<DialogClose asChild>
							<Button type="button" variant="ghost" size="icon" aria-label="关闭新建提示词">
								<X className="size-4" />
							</Button>
						</DialogClose>
					</header>

					<div className="min-h-0 overflow-y-auto p-4">
						<div className="space-y-3">
							{error ? (
								<Alert variant="destructive" className="rounded-md">
									<AlertDescription>{error}</AlertDescription>
								</Alert>
							) : null}

							<FieldRow label="分类">
								<CategorySelectField
									value={draft.category}
									options={categoryOptions}
									onCreate={onCreateCategory}
									onChange={(value) =>
										onDraftChange((current) => ({ ...current, category: value }))
									}
								/>
							</FieldRow>

							<FieldRow label="名称">
								<Input
									value={draft.name}
									className="rounded-md"
									onChange={(event) =>
										onDraftChange((current) => ({ ...current, name: event.target.value }))
									}
								/>
							</FieldRow>

							<div className="grid gap-2">
								<Label className="text-sm font-medium text-foreground">提示词</Label>
								<Textarea
									value={draft.prompt}
									className="min-h-48 resize-y rounded-md text-sm leading-6"
									onChange={(event) =>
										onDraftChange((current) => ({ ...current, prompt: event.target.value }))
									}
								/>
							</div>
						</div>
					</div>

					<footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
						<DialogDismissButton type="button" variant="ghost" onClick={onCancel}>
							取消
						</DialogDismissButton>
						<DialogDismissButton type="button" onClick={onSave} disabled={!valid || isSaving}>
							{isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
							<span>保存</span>
						</DialogDismissButton>
					</footer>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};

const draftFromPreset = (preset: PromptPreset): Draft => ({
	id: preset.id,
	name: preset.name,
	category: preset.category || extraPromptCategory,
	prompt: preset.prompt,
});

const promptCategoryOptions = (
	categories: PromptCategory[],
	...activeCategories: string[]
): PromptCategoryOption[] => {
	const values = new Map<PromptPresetCategory, string>();
	for (const category of [...defaultPromptCategories, ...categories]) {
		if (category.id.trim())
			values.set(category.id.trim(), category.label.trim() || category.id.trim());
	}
	for (const category of activeCategories) {
		if (category.trim())
			values.set(category.trim(), promptCategoryLabel(category.trim(), categories));
	}
	return Array.from(values.entries())
		.map(([value, label]) => ({ value, label }))
		.sort((left, right) => {
			const leftDefaultIndex = defaultPromptCategories.findIndex(
				(category) => category.id === left.value,
			);
			const rightDefaultIndex = defaultPromptCategories.findIndex(
				(category) => category.id === right.value,
			);
			if (leftDefaultIndex >= 0 || rightDefaultIndex >= 0) {
				return (
					(leftDefaultIndex >= 0 ? leftDefaultIndex : Number.MAX_SAFE_INTEGER) -
					(rightDefaultIndex >= 0 ? rightDefaultIndex : Number.MAX_SAFE_INTEGER)
				);
			}
			return left.label.localeCompare(right.label, "zh-Hans-CN");
		});
};

const categoryFilterAfterSave = (
	current: PromptPresetCategory | "all",
	savedCategory: PromptPresetCategory,
) => {
	if (current === "all" || current === savedCategory) return current;
	return savedCategory;
};

const promptCategoryOptionLabel = (
	category: PromptPresetCategory,
	options: PromptCategoryOption[],
) => options.find((option) => option.value === category)?.label ?? promptCategoryLabel(category);

const resolveCategoryValue = (name: string, options: PromptCategoryOption[]) => {
	const normalized = name.trim();
	const existing = options.find(
		(option) => option.value === normalized || option.label === normalized,
	);
	return existing?.value ?? normalized;
};

const categoryValidationError = (category: string) => {
	const normalized = category.trim();
	if (!normalized) return "请输入分类名称。";
	if (
		normalized === "." ||
		normalized === ".." ||
		normalized.includes("/") ||
		normalized.includes("\\")
	) {
		return "分类名称不能包含路径字符。";
	}
	if ([...normalized].length > 64) return "分类名称不能超过 64 个字符。";
	for (const char of normalized) {
		const codePoint = char.codePointAt(0);
		if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
			return "分类名称不能包含控制字符。";
		}
	}
	return "";
};

const slugify = (value: string) => {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "-")
		.replace(/[-_]+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "");
	return slug || `preset-${Date.now()}`;
};

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请检查后端服务是否可用。";
};
