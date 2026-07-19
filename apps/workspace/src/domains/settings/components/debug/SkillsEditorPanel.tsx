import { BookOpenCheck, Loader2, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	createSkill,
	deleteSkill,
	getSkill,
	listSkills,
	resetSkill,
	skillsKey,
	updateSkill,
} from "@/domains/settings/api/skills";
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
import {
	composeSkillMarkdown,
	splitSkillMarkdown,
	updateSkillDescription,
} from "@/domains/settings/lib/skill-markdown";
import { sanitizeSkillName } from "@/domains/settings/lib/skill-name";
import { orderSkillsByPackTag } from "@/domains/settings/lib/skill-order";
import { useToast } from "@/hooks/useToast";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { isPromptPackContentCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
import { listPromptPacks, promptPacksKey } from "@/domains/settings/api/packs";
import { PromptPackActions } from "./PromptPackActionsSlot";
import { PromptPackMembershipBadge } from "./PromptPackMembershipBadge";
import { SettingsMarkdownEditor, SettingsMarkdownPreview } from "./SettingsMarkdownEditor";

export const SkillsEditorPanel: React.FC<{ showActions?: boolean }> = ({ showActions = true }) => {
	const toast = useToast();
	const { mutate: mutateGlobal } = useSWRConfig();
	const { data: skills = [], isLoading, mutate: mutateSkills } = useSWR(skillsKey, listSkills);
	const { data: packs = [], isLoading: isPacksLoading } = useSWR(promptPacksKey, listPromptPacks);
	const importedPackIDs = useMemo(
		() => new Set(packs.filter((pack) => pack.source === "imported").map((pack) => pack.id)),
		[packs],
	);
	const orderedSkills = useMemo(
		() => orderSkillsByPackTag(isPacksLoading ? [] : skills, packs),
		[isPacksLoading, packs, skills],
	);
	const selectableSkills = useMemo(
		() => orderedSkills.filter((skill) => !skill.packId || !importedPackIDs.has(skill.packId)),
		[importedPackIDs, orderedSkills],
	);
	const editablePacks = useMemo(() => packs.filter((pack) => pack.source === "local"), [packs]);
	const [selectedName, setSelectedName] = useState("");
	const [frontmatterDraft, setFrontmatterDraft] = useState("");
	const [descriptionDraft, setDescriptionDraft] = useState("");
	const [bodyDraft, setBodyDraft] = useState("");
	const selectedMeta = useMemo(
		() => selectableSkills.find((skill) => skill.name === selectedName) ?? selectableSkills[0],
		[selectableSkills, selectedName],
	);
	const skillDetailKey = selectedMeta ? `${skillsKey}/${selectedMeta.name}` : null;
	const {
		data: selectedSkill,
		isLoading: isSkillLoading,
		mutate: mutateSkill,
	} = useSWR(skillDetailKey, () => getSkill(selectedMeta?.name ?? ""));
	const [error, setError] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isResetting, setIsResetting] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [newSkillName, setNewSkillName] = useState("");
	const [newSkillDescription, setNewSkillDescription] = useState("");
	const [newSkillPackID, setNewSkillPackID] = useState("");
	const [createError, setCreateError] = useState("");
	const draft = useMemo(
		() =>
			composeSkillMarkdown({
				body: bodyDraft,
				frontmatter: updateSkillDescription(frontmatterDraft, descriptionDraft),
			}),
		[bodyDraft, descriptionDraft, frontmatterDraft],
	);

	useEffect(() => {
		if (!selectableSkills.length) return;
		if (!selectedName || !selectableSkills.some((skill) => skill.name === selectedName)) {
			setSelectedName(selectableSkills[0].name);
		}
	}, [selectableSkills, selectedName]);

	useEffect(() => {
		const parts = splitSkillMarkdown(selectedSkill?.content ?? "");
		setFrontmatterDraft(parts.frontmatter);
		setDescriptionDraft(selectedSkill?.description ?? "");
		setBodyDraft(parts.body);
		setError("");
	}, [selectedSkill]);

	const selectedEntry = selectedSkill ?? selectedMeta;
	const selectedPack = packs.find((pack) => pack.id === (selectedEntry?.packId || "builtin"));
	const selectedPackReadonly = selectedPack?.source !== "local";
	const canDelete = Boolean(selectedEntry) && !selectedPackReadonly;
	const canReset = Boolean(
		!selectedPackReadonly &&
		selectedSkill &&
		(selectedEntry?.source !== "user" || selectedEntry?.overridden),
	);

	useEffect(() => {
		if (!editablePacks.length) {
			setNewSkillPackID("");
			return;
		}
		if (!editablePacks.some((pack) => pack.id === newSkillPackID)) {
			setNewSkillPackID(editablePacks[0].id);
		}
	}, [editablePacks, newSkillPackID]);
	const refreshSkillCaches = () => mutateGlobal(isPromptPackContentCacheKey);
	const cancelCreateSkill = () => {
		setIsCreating(false);
		setNewSkillName("");
		setNewSkillDescription("");
		setNewSkillPackID(editablePacks[0]?.id ?? "");
		setCreateError("");
	};

	const openEditDialog = () => {
		const parts = splitSkillMarkdown(selectedSkill?.content ?? "");
		setFrontmatterDraft(parts.frontmatter);
		setDescriptionDraft(selectedSkill?.description ?? "");
		setBodyDraft(parts.body);
		setError("");
		setEditDialogOpen(true);
	};

	const closeEditDialog = () => {
		const parts = splitSkillMarkdown(selectedSkill?.content ?? "");
		setFrontmatterDraft(parts.frontmatter);
		setDescriptionDraft(selectedSkill?.description ?? "");
		setBodyDraft(parts.body);
		setError("");
		setEditDialogOpen(false);
	};

	const save = async () => {
		if (!selectedSkill) return;
		if (!descriptionDraft.trim()) {
			setError("Skill 描述不能为空");
			return;
		}
		setIsSaving(true);
		setError("");
		try {
			const saved = await updateSkill(selectedSkill.name, draft);
			await mutateSkill(saved, false);
			await refreshSkillCaches();
			const parts = splitSkillMarkdown(saved.content);
			setFrontmatterDraft(parts.frontmatter);
			setDescriptionDraft(saved.description);
			setBodyDraft(parts.body);
			setEditDialogOpen(false);
			toast.success("Skill 已保存");
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("Skill 保存失败", { description: message });
		} finally {
			setIsSaving(false);
		}
	};

	const createNewSkill = async () => {
		const name = sanitizeSkillName(newSkillName);
		if (!name) return;
		setIsSaving(true);
		setCreateError("");
		try {
			const description = newSkillDescription.trim();
			if (!description) {
				setCreateError("Skill 描述不能为空");
				return;
			}
			const created = await createSkill(name, newSkillTemplate(name, description), newSkillPackID);
			await refreshSkillCaches();
			setSelectedName(created.name);
			const parts = splitSkillMarkdown(created.content);
			setFrontmatterDraft(parts.frontmatter);
			setDescriptionDraft(created.description);
			setBodyDraft(parts.body);
			setNewSkillName("");
			setNewSkillDescription("");
			setNewSkillPackID(editablePacks[0]?.id ?? "");
			setIsCreating(false);
			setCreateError("");
			toast.success("Skill 已创建", { description: created.name });
		} catch (err) {
			const message = errorMessage(err);
			setCreateError(message);
			toast.error("Skill 创建失败", { description: message });
		} finally {
			setIsSaving(false);
		}
	};

	const remove = async () => {
		if (!selectedSkill || !canDelete) return false;
		setIsDeleting(true);
		setError("");
		try {
			await deleteSkill(selectedSkill.name);
			const nextSkills = skills.filter((skill) => skill.name !== selectedSkill.name);
			await mutateSkills(nextSkills, false);
			await refreshSkillCaches();
			setSelectedName(nextSkills[0]?.name ?? "");
			toast.success("Skill 已删除");
			return true;
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("Skill 删除失败", { description: message });
			return false;
		} finally {
			setIsDeleting(false);
		}
	};

	const confirmRemove = () => {
		if (!selectedSkill || !canDelete) return;
		const isUserCreated = selectedEntry?.source === "user" && !selectedEntry.overridden;
		void confirmDialog({
			title: "删除 Skill？",
			description: isUserCreated
				? `确定要删除“${selectedSkill.title || selectedSkill.name}”吗？此操作无法撤销。`
				: `确定要删除“${selectedSkill.title || selectedSkill.name}”吗？来自包的 Skill 会从列表中隐藏。`,
			confirmLabel: "删除",
			confirmIcon: <Trash2 className="size-4" />,
			onConfirm: remove,
		});
	};

	const resetToDefault = async () => {
		if (!selectedSkill || !canReset) return false;
		setIsResetting(true);
		setError("");
		try {
			const reset = await resetSkill(selectedSkill.name);
			await mutateSkill(reset, false);
			await refreshSkillCaches();
			const parts = splitSkillMarkdown(reset.content);
			setFrontmatterDraft(parts.frontmatter);
			setDescriptionDraft(reset.description);
			setBodyDraft(parts.body);
			setEditDialogOpen(false);
			toast.success("Skill 已恢复默认", { description: reset.title || reset.name });
			return true;
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("Skill 恢复失败", { description: message });
			return false;
		} finally {
			setIsResetting(false);
		}
	};

	const confirmReset = () => {
		if (!selectedSkill || !canReset) return;
		void confirmDialog({
			title: "恢复 Skill 默认？",
			description: `将“${selectedSkill.title || selectedSkill.name}”恢复为当前技能包中的默认内容。`,
			confirmLabel: "恢复默认",
			confirmIcon: <RotateCcw className="size-4" />,
			variant: "default",
			onConfirm: resetToDefault,
		});
	};

	return (
		<>
			{showActions ? (
				<PromptPackActions>
					<>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setCreateError("");
								setIsCreating(true);
							}}
							disabled={editablePacks.length === 0}
						>
							<Plus className="size-4" />
							<span>新建</span>
						</Button>
						{!selectedPackReadonly ? (
							<>
								<Button type="button" onClick={openEditDialog} disabled={!selectedSkill}>
									<Pencil className="size-4" />
									<span>编辑</span>
								</Button>
								<Button
									type="button"
									variant="outline"
									onClick={confirmReset}
									disabled={!selectedSkill || !canReset || isResetting}
								>
									{isResetting ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<RotateCcw className="size-4" />
									)}
									<span>{isResetting ? "恢复中" : "恢复默认"}</span>
								</Button>
								<Button
									type="button"
									variant="destructive"
									onClick={confirmRemove}
									disabled={!selectedSkill || !canDelete || isDeleting}
								>
									<Trash2 className="size-4" />
									<span>{isDeleting ? "删除中" : "删除"}</span>
								</Button>
							</>
						) : null}
					</>
				</PromptPackActions>
			) : null}

			{showActions ? (
				<SkillCreateDialog
					description={newSkillDescription}
					error={createError}
					isSaving={isSaving}
					name={newSkillName}
					packId={newSkillPackID}
					packs={editablePacks}
					open={isCreating}
					onCancel={cancelCreateSkill}
					onNameChange={(value) => {
						setNewSkillName(value);
						setCreateError("");
					}}
					onPackChange={setNewSkillPackID}
					onDescriptionChange={(value) => {
						setNewSkillDescription(value);
						setCreateError("");
					}}
					onOpenChange={(open) => {
						if (open) {
							setCreateError("");
							setIsCreating(true);
							return;
						}
						cancelCreateSkill();
					}}
					onSave={() => void createNewSkill()}
				/>
			) : null}

			{showActions ? (
				<SkillEditDialog
					bodyDraft={bodyDraft}
					descriptionDraft={descriptionDraft}
					error={error}
					isSaving={isSaving}
					open={editDialogOpen}
					onBodyChange={setBodyDraft}
					onDescriptionChange={setDescriptionDraft}
					onCancel={closeEditDialog}
					onOpenChange={(open) => {
						if (open) {
							openEditDialog();
							return;
						}
						closeEditDialog();
					}}
					onSave={() => void save()}
				/>
			) : null}

			<div className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-5">
				<div className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,16rem)_minmax(0,1fr)] gap-3 md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
					<nav
						aria-label="Skill 列表"
						className="min-h-0 overflow-y-auto rounded-md border border-border"
					>
						{isLoading || isPacksLoading ? (
							<div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								<span>加载中</span>
							</div>
						) : orderedSkills.length === 0 ? (
							<p className="p-3 text-xs text-muted-foreground">没有可用技能。</p>
						) : (
							<>
								{orderedSkills.map((skill) => {
									const title = skill.title || skill.name;
									const imported = Boolean(skill.packId && importedPackIDs.has(skill.packId));
									const selected = selectedMeta?.name === skill.name;
									return (
										<button
											key={skill.name}
											type="button"
											aria-label={`查看 Skill ${title}`}
											aria-current={selected ? "page" : undefined}
											disabled={imported}
											className={cn(
												"flex w-full items-center gap-3 border-l-2 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50",
												selected
													? "border-primary bg-ide-list-hover"
													: "border-transparent enabled:hover:bg-ide-list-hover",
											)}
											onClick={() => setSelectedName(skill.name)}
										>
											<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
												{title}
											</span>
											<PromptPackMembershipBadge
												className="max-w-24 shrink-0"
												packId={skill.packId}
												packs={packs}
											/>
										</button>
									);
								})}
							</>
						)}
					</nav>

					<section
						aria-label="Skill 详情"
						className="flex min-h-0 min-w-0 flex-col overflow-y-auto rounded-md border border-border p-3"
					>
						{!selectedSkill && isSkillLoading ? (
							<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								<span>加载中</span>
							</div>
						) : !selectedMeta ? (
							<p className={skillMessageClassName}>请从左侧选择 Skill。</p>
						) : (
							<div className="flex h-full min-h-0 flex-col gap-3">
								<div className="flex min-w-0 items-center gap-2 border-b border-border pb-3">
									<h3 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
										{selectedEntry?.title || selectedEntry?.name}
									</h3>
									<PromptPackMembershipBadge
										className="max-w-48 shrink-0"
										packId={selectedEntry?.packId}
										packs={packs}
									/>
								</div>
								<div className={settingsFormRowClassName}>
									<Label className="text-sm font-medium text-foreground">Skill 描述</Label>
									<p className="py-2 text-sm leading-5 text-muted-foreground">
										{selectedEntry?.description || "暂无描述。"}
									</p>
								</div>
								<div className={skillBodyRowClassName}>
									<div className="flex items-center justify-between gap-2">
										<Label
											id="skill-body-content-label"
											className="text-sm font-medium text-foreground"
										>
											Skill 内容
										</Label>
										<span className="flex items-center gap-1 text-xs text-muted-foreground">
											<BookOpenCheck className="size-3.5" />
											{countLines(bodyDraft)} 行
										</span>
									</div>
									{error ? (
										<Alert variant="destructive" className="rounded-md">
											<AlertDescription>{error}</AlertDescription>
										</Alert>
									) : null}
									<SettingsMarkdownPreview
										ariaLabelledBy="skill-body-content-label"
										className="min-h-0 flex-1 overflow-y-auto"
										placeholder="暂无 Skill 内容。"
										value={bodyDraft}
									/>
								</div>
							</div>
						)}
					</section>
				</div>
			</div>
		</>
	);
};

const settingsFormRowClassName = cn(
	"py-2",
	"grid gap-3 md:grid-cols-[minmax(var(--settings-label-column-min),var(--settings-label-column-max))_minmax(0,1fr)] md:items-start",
);

const skillBodyRowClassName = "flex min-h-0 flex-1 flex-col gap-2 py-2";
const skillMessageClassName = "py-2 text-sm text-muted-foreground";

const SkillEditDialog: React.FC<{
	bodyDraft: string;
	descriptionDraft: string;
	error: string;
	isSaving: boolean;
	open: boolean;
	onBodyChange: (value: string) => void;
	onDescriptionChange: (value: string) => void;
	onCancel: () => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
}> = ({
	bodyDraft,
	descriptionDraft,
	error,
	isSaving,
	open,
	onBodyChange,
	onCancel,
	onDescriptionChange,
	onOpenChange,
	onSave,
}) => (
	<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
			<DialogPrimitive.Content
				className={cn(
					"fixed left-1/2 top-1/2 z-50 flex max-h-[min(86vh,46rem)] w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
					dialogContentMotion,
				)}
				aria-describedby="skill-edit-description"
			>
				<header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
					<div className="min-w-0">
						<DialogPrimitive.Title className="text-sm font-semibold text-foreground">
							编辑 Skill
						</DialogPrimitive.Title>
						<DialogPrimitive.Description
							id="skill-edit-description"
							className="mt-1 text-xs text-muted-foreground"
						>
							修改 Skill 描述与正文内容。
						</DialogPrimitive.Description>
					</div>
					<DialogClose asChild>
						<Button type="button" variant="ghost" size="icon" aria-label="关闭编辑 Skill">
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
						<div className="grid gap-2">
							<Label
								htmlFor="skill-edit-description-field"
								className="text-sm font-medium text-foreground"
							>
								Skill 描述
							</Label>
							<Textarea
								id="skill-edit-description-field"
								value={descriptionDraft}
								placeholder="说明该 Skill 适用于什么任务，帮助 Agent 判断何时加载。"
								className="min-h-20 resize-y rounded-md"
								onChange={(event) => onDescriptionChange(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								Agent 初始化时会读取此描述，并据此选择需要装载的 Skill。
							</p>
						</div>
						<div className="grid gap-2">
							<div className="flex items-center justify-between gap-2">
								<Label id="skill-edit-body-label" className="text-sm font-medium text-foreground">
									Skill 内容
								</Label>
								<span className="flex items-center gap-1 text-xs text-muted-foreground">
									<BookOpenCheck className="size-3.5" />
									{countLines(bodyDraft)} 行
								</span>
							</div>
							<SettingsMarkdownEditor
								ariaLabelledBy="skill-edit-body-label"
								placeholder="编写 Skill 正文..."
								value={bodyDraft}
								onChange={onBodyChange}
							/>
						</div>
					</div>
				</div>

				<footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
					<DialogDismissButton type="button" variant="ghost" onClick={onCancel}>
						取消
					</DialogDismissButton>
					<DialogDismissButton type="button" onClick={onSave} disabled={isSaving}>
						{isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
						<span>{isSaving ? "保存中" : "保存"}</span>
					</DialogDismissButton>
				</footer>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	</DialogPrimitive.Root>
);

const SkillCreateDialog: React.FC<{
	description: string;
	error: string;
	isSaving: boolean;
	name: string;
	packId: string;
	packs: Array<{ id: string; name: string }>;
	open: boolean;
	onCancel: () => void;
	onDescriptionChange: (value: string) => void;
	onNameChange: (value: string) => void;
	onPackChange: (value: string) => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
}> = ({
	description,
	error,
	isSaving,
	name,
	packId,
	packs,
	open,
	onCancel,
	onDescriptionChange,
	onNameChange,
	onPackChange,
	onOpenChange,
	onSave,
}) => {
	const normalizedName = sanitizeSkillName(name);

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
				<DialogPrimitive.Content
					className={cn(
						"fixed left-1/2 top-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
						dialogContentMotion,
					)}
					aria-describedby="skill-create-description"
				>
					<header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
						<div className="min-w-0">
							<DialogPrimitive.Title className="text-sm font-semibold text-foreground">
								新建 Skill
							</DialogPrimitive.Title>
							<DialogPrimitive.Description
								id="skill-create-description"
								className="mt-1 text-xs text-muted-foreground"
							>
								创建自定义 Skill 文件。
							</DialogPrimitive.Description>
						</div>
						<DialogClose asChild>
							<Button type="button" variant="ghost" size="icon" aria-label="关闭新建 Skill">
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
							<Label className="text-sm font-medium text-foreground">所属技能包</Label>
							<Select value={packId} onValueChange={onPackChange}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{packs.map((pack) => (
										<SelectItem key={pack.id} value={pack.id}>
											{pack.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="new-skill-name" className="text-sm font-medium text-foreground">
								文件名
							</Label>
							<Input
								id="new-skill-name"
								value={name}
								autoFocus
								placeholder="my-custom-guide"
								className="rounded-md"
								onChange={(event) => onNameChange(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && normalizedName && !isSaving) {
										event.preventDefault();
										onSave();
									}
								}}
							/>
							{normalizedName && normalizedName !== name.trim() ? (
								<p className="text-xs text-muted-foreground">将保存为 {normalizedName}.skill.md</p>
							) : null}
						</div>
						<div className="grid gap-2">
							<Label
								htmlFor="new-skill-description"
								className="text-sm font-medium text-foreground"
							>
								Skill 描述
							</Label>
							<Textarea
								id="new-skill-description"
								value={description}
								placeholder="说明适用任务和触发场景"
								className="min-h-20 resize-y rounded-md"
								onChange={(event) => onDescriptionChange(event.target.value)}
							/>
						</div>
					</div>

					<footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
						<DialogDismissButton type="button" variant="ghost" onClick={onCancel}>
							取消
						</DialogDismissButton>
						<DialogDismissButton
							type="button"
							onClick={onSave}
							disabled={!normalizedName || !description.trim() || isSaving}
						>
							{isSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
							<span>{isSaving ? "创建中" : "创建"}</span>
						</DialogDismissButton>
					</footer>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};

const newSkillTemplate = (name: string, description: string) => `---
name: ${name}
description: ${JSON.stringify(description)}
---
# ${name}

`;

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
	return "请检查后端服务是否可写 Skill 文件。";
};
