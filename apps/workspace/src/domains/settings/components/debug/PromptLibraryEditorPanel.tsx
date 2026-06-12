import { Library, Loader2, Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	type PromptLayer,
	type PromptPreset,
	type PromptPresetKind,
	createPromptPreset,
	deletePromptPreset,
	listPromptPresets,
	promptPresetsKey,
	resetPromptPreset,
	updatePromptPreset,
} from "@/domains/generation/api/prompt-presets";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
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
import { cn } from "@/shared/lib/utils";

const layers: { value: PromptLayer; label: string }[] = [
	{ value: "style", label: "风格" },
	{ value: "extra", label: "其他" },
];
const layerLabelMap = Object.fromEntries(
	layers.map((layer) => [layer.value, layer.label]),
) as Record<PromptLayer, string>;

const kinds: { value: PromptPresetKind; label: string }[] = [
	{ value: "image", label: "图片" },
	{ value: "video", label: "视频" },
	{ value: "text", label: "文本" },
];

interface Draft {
	id: string;
	name: string;
	layer: PromptLayer;
	kind: PromptPresetKind;
	category: string;
	prompt: string;
}

const emptyDraft = (layer: PromptLayer): Draft => ({
	id: "",
	name: "",
	layer,
	kind: "image",
	category: "",
	prompt: "",
});

export const PromptLibraryEditorPanel: React.FC = () => {
	const toast = useToast();
	const {
		data: presets = [],
		isLoading,
		mutate,
	} = useSWR(promptPresetsKey, () => listPromptPresets());
	const [layerFilter, setLayerFilter] = useState<PromptLayer | "all">("all");
	const [query, setQuery] = useState("");
	const [selectedId, setSelectedId] = useState("");
	const [draft, setDraft] = useState<Draft>(emptyDraft("style"));
	const [createDraft, setCreateDraft] = useState<Draft>(emptyDraft("style"));
	const [createError, setCreateError] = useState("");
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [error, setError] = useState("");

	const visiblePresets = useMemo(() => {
		const keyword = query.trim().toLowerCase();
		return presets.filter((preset) => {
			if (layerFilter !== "all" && preset.layer !== layerFilter) return false;
			if (!keyword) return true;
			return (
				preset.name.toLowerCase().includes(keyword) || preset.id.toLowerCase().includes(keyword)
			);
		});
	}, [presets, layerFilter, query]);

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

	const readonlyBuiltin = selectedPreset?.source === "builtin";
	const hasKind = draft.layer !== "style";
	const draftValid = Boolean(draft.name.trim() && draft.prompt.trim());
	const createHasKind = createDraft.layer !== "style";
	const createDraftValid = Boolean(createDraft.name.trim() && createDraft.prompt.trim());

	const startCreate = () => {
		const layer = layerFilter === "all" ? "style" : layerFilter;
		setCreateDraft(emptyDraft(layer));
		setCreateError("");
		setCreateDialogOpen(true);
	};

	const cancelCreate = () => {
		setCreateDialogOpen(false);
		setCreateDraft(emptyDraft(layerFilter === "all" ? "style" : layerFilter));
		setCreateError("");
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
				layer: draft.layer,
				kind: hasKind ? draft.kind : undefined,
				category: draft.category.trim() || undefined,
				prompt: draft.prompt.trim(),
			};
			const saved = await updatePromptPreset(input.id, input);
			await mutate();
			setLayerFilter(saved.layer);
			setSelectedId(saved.id);
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
				layer: createDraft.layer,
				kind: createHasKind ? createDraft.kind : undefined,
				category: createDraft.category.trim() || undefined,
				prompt: createDraft.prompt.trim(),
			};
			const saved = await createPromptPreset(input);
			await mutate();
			setCreateDialogOpen(false);
			setLayerFilter(saved.layer);
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

	const saveAsCustom = () => {
		if (!selectedPreset) return;
		setCreateDraft({
			id: "",
			name: `${selectedPreset.name} 副本`,
			layer: selectedPreset.layer,
			kind: (selectedPreset.kind as PromptPresetKind) ?? "image",
			category: selectedPreset.category ?? "",
			prompt: selectedPreset.prompt,
		});
		setCreateError("");
		setCreateDialogOpen(true);
	};

	const removeOrReset = async () => {
		if (!selectedPreset) return;
		setIsDeleting(true);
		setError("");
		try {
			if (selectedPreset.builtin) {
				const reset = await resetPromptPreset(selectedPreset.id);
				await mutate();
				setSelectedId(reset.id);
				toast.success("已恢复默认");
			} else {
				await deletePromptPreset(selectedPreset.id);
				await mutate();
				setSelectedId("");
				toast.success("已删除");
			}
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("操作失败", { description: message });
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<>
			<SettingsPanelLayout
				title="提示词库"
				description="按层管理可复用的提示词预设（风格 / 其他）。"
				icon={<Library className="size-4" />}
				actions={
					<Button type="button" variant="outline" onClick={startCreate}>
						<Plus className="size-4" />
						<span>新建</span>
					</Button>
				}
			>
				<div className="mb-3 flex flex-wrap items-center gap-2">
					<LayerChip
						active={layerFilter === "all"}
						onClick={() => setLayerFilter("all")}
						label="全部"
					/>
					{layers.map((layer) => (
						<LayerChip
							key={layer.value}
							active={layerFilter === layer.value}
							onClick={() => setLayerFilter(layer.value)}
							label={layer.label}
						/>
					))}
					<div className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5">
						<Search className="size-3.5 text-muted-foreground" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="搜索"
							className="w-32 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
						/>
					</div>
				</div>

				<div className="grid min-h-0 gap-3 md:grid-cols-[15rem_minmax(0,1fr)]">
					<div className="max-h-[28rem] min-h-0 overflow-y-auto rounded-md border border-border">
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
										{layerLabelMap[preset.layer]}
									</span>
									<span className="shrink-0 text-2xs text-muted-foreground">
										{preset.source === "builtin" ? "内置" : "自定义"}
									</span>
								</button>
							))
						)}
					</div>

					<div className="min-w-0 rounded-md border border-border p-3">
						{!selectedPreset ? (
							<p className="py-6 text-center text-sm text-muted-foreground">
								选择左侧预设进行编辑，或点击「新建」。
							</p>
						) : (
							<div className="space-y-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="flex items-center gap-2">
										<Badge variant="secondary" className="rounded-md">
											{layerLabelMap[draft.layer]}
										</Badge>
										{readonlyBuiltin ? (
											<Badge variant="outline" className="rounded-md">
												内置 · 只读
											</Badge>
										) : null}
									</div>
									{readonlyBuiltin ? (
										<Button type="button" variant="outline" size="sm" onClick={saveAsCustom}>
											另存为自定义
										</Button>
									) : null}
								</div>

								{error ? (
									<Alert variant="destructive" className="rounded-md">
										<AlertDescription>{error}</AlertDescription>
									</Alert>
								) : null}

								<FieldRow label="名称">
									<Input
										value={draft.name}
										disabled={readonlyBuiltin}
										className="rounded-md"
										onChange={(event) =>
											setDraft((current) => ({ ...current, name: event.target.value }))
										}
									/>
								</FieldRow>

								{hasKind ? (
									<FieldRow label="适用">
										<Select
											value={draft.kind}
											disabled={readonlyBuiltin}
											onValueChange={(value) =>
												setDraft((current) => ({ ...current, kind: value as PromptPresetKind }))
											}
										>
											<SelectTrigger className="rounded-md text-foreground">
												<SelectValue />
											</SelectTrigger>
											<SelectContent align="start">
												{kinds.map((kind) => (
													<SelectItem key={kind.value} value={kind.value}>
														{kind.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</FieldRow>
								) : null}

								<FieldRow label="分类">
									<Input
										value={draft.category}
										disabled={readonlyBuiltin}
										placeholder="可选，如 character / scene"
										className="rounded-md"
										onChange={(event) =>
											setDraft((current) => ({ ...current, category: event.target.value }))
										}
									/>
								</FieldRow>

								<div className="grid gap-2">
									<Label className="text-sm font-medium text-foreground">提示词</Label>
									<Textarea
										value={draft.prompt}
										disabled={readonlyBuiltin}
										className="min-h-40 resize-y rounded-md text-sm leading-6"
										onChange={(event) =>
											setDraft((current) => ({ ...current, prompt: event.target.value }))
										}
									/>
								</div>

								<div className="flex justify-end gap-2">
									{selectedPreset ? (
										<Button
											type="button"
											variant={selectedPreset.builtin ? "outline" : "destructive"}
											onClick={() => void removeOrReset()}
											disabled={isDeleting}
										>
											{isDeleting ? (
												<Loader2 className="size-4 animate-spin" />
											) : selectedPreset.builtin ? (
												<RotateCcw className="size-4" />
											) : (
												<Trash2 className="size-4" />
											)}
											<span>{selectedPreset.builtin ? "恢复默认" : "删除"}</span>
										</Button>
									) : null}
									<Button
										type="button"
										onClick={() => void saveEdit()}
										disabled={readonlyBuiltin || !draftValid || isSaving}
									>
										{isSaving ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<Save className="size-4" />
										)}
										<span>保存</span>
									</Button>
								</div>
							</div>
						)}
					</div>
				</div>
			</SettingsPanelLayout>

			<PromptPresetCreateDialog
				draft={createDraft}
				error={createError}
				isSaving={isSaving}
				open={createDialogOpen}
				valid={createDraftValid}
				onCancel={cancelCreate}
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
		</>
	);
};

const LayerChip: React.FC<{ active: boolean; label: string; onClick: () => void }> = ({
	active,
	label,
	onClick,
}) => (
	<button
		type="button"
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

const PromptPresetCreateDialog: React.FC<{
	draft: Draft;
	error: string;
	isSaving: boolean;
	open: boolean;
	valid: boolean;
	onCancel: () => void;
	onDraftChange: React.Dispatch<React.SetStateAction<Draft>>;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
}> = ({ draft, error, isSaving, open, valid, onCancel, onDraftChange, onOpenChange, onSave }) => {
	const hasKind = draft.layer !== "style";

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
				<DialogPrimitive.Content
					className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(86vh,46rem)] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
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
								创建可复用的分层提示词预设。
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button type="button" variant="ghost" size="icon" aria-label="关闭新建提示词">
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</header>

					<div className="min-h-0 overflow-y-auto p-4">
						<div className="space-y-3">
							<div className="flex items-center gap-2">
								<Badge variant="secondary" className="rounded-md">
									{layerLabelMap[draft.layer]}
								</Badge>
								<Badge variant="outline" className="rounded-md">
									新建
								</Badge>
							</div>

							{error ? (
								<Alert variant="destructive" className="rounded-md">
									<AlertDescription>{error}</AlertDescription>
								</Alert>
							) : null}

							<FieldRow label="层">
								<Select
									value={draft.layer}
									onValueChange={(value) =>
										onDraftChange((current) => ({ ...current, layer: value as PromptLayer }))
									}
								>
									<SelectTrigger className="rounded-md text-foreground">
										<SelectValue />
									</SelectTrigger>
									<SelectContent align="start">
										{layers.map((layer) => (
											<SelectItem key={layer.value} value={layer.value}>
												{layer.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
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

							{hasKind ? (
								<FieldRow label="适用">
									<Select
										value={draft.kind}
										onValueChange={(value) =>
											onDraftChange((current) => ({
												...current,
												kind: value as PromptPresetKind,
											}))
										}
									>
										<SelectTrigger className="rounded-md text-foreground">
											<SelectValue />
										</SelectTrigger>
										<SelectContent align="start">
											{kinds.map((kind) => (
												<SelectItem key={kind.value} value={kind.value}>
													{kind.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</FieldRow>
							) : null}

							<FieldRow label="分类">
								<Input
									value={draft.category}
									placeholder="可选，如 character / scene"
									className="rounded-md"
									onChange={(event) =>
										onDraftChange((current) => ({ ...current, category: event.target.value }))
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
						<Button type="button" variant="ghost" onClick={onCancel}>
							取消
						</Button>
						<Button type="button" onClick={onSave} disabled={!valid || isSaving}>
							{isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
							<span>保存</span>
						</Button>
					</footer>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};

const draftFromPreset = (preset: PromptPreset): Draft => ({
	id: preset.id,
	name: preset.name,
	layer: preset.layer,
	kind: (preset.kind as PromptPresetKind) ?? "image",
	category: preset.category ?? "",
	prompt: preset.prompt,
});

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
