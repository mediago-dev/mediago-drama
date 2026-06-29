import { BookOpenCheck, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	createSkill,
	deleteSkill,
	getSkill,
	listSkills,
	skillsKey,
	updateSkill,
} from "@/domains/settings/api/skills";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
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
import { composeSkillMarkdown, splitSkillMarkdown } from "@/domains/settings/lib/skill-markdown";
import { orderSkillsForPrimaryFlows } from "@/domains/settings/lib/skill-order";
import { useToast } from "@/hooks/useToast";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { cn } from "@/shared/lib/utils";
import { PromptPackActions } from "./PromptPackActionsSlot";
import { SettingsMarkdownEditor, SettingsMarkdownPreview } from "./SettingsMarkdownEditor";

export const SkillsEditorPanel: React.FC = () => {
	const toast = useToast();
	const { data: skills = [], isLoading, mutate: mutateSkills } = useSWR(skillsKey, listSkills);
	const orderedSkills = useMemo(() => orderSkillsForPrimaryFlows(skills), [skills]);
	const [selectedName, setSelectedName] = useState("");
	const [frontmatterDraft, setFrontmatterDraft] = useState("");
	const [bodyDraft, setBodyDraft] = useState("");
	const selectedMeta = useMemo(
		() => orderedSkills.find((skill) => skill.name === selectedName) ?? orderedSkills[0],
		[selectedName, orderedSkills],
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
	const [isCreating, setIsCreating] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [newSkillName, setNewSkillName] = useState("");
	const [createError, setCreateError] = useState("");
	const draft = useMemo(
		() => composeSkillMarkdown({ body: bodyDraft, frontmatter: frontmatterDraft }),
		[bodyDraft, frontmatterDraft],
	);

	useEffect(() => {
		if (!orderedSkills.length) return;
		if (!selectedName || !orderedSkills.some((skill) => skill.name === selectedName)) {
			setSelectedName(orderedSkills[0].name);
		}
	}, [selectedName, orderedSkills]);

	useEffect(() => {
		const parts = splitSkillMarkdown(selectedSkill?.content ?? "");
		setFrontmatterDraft(parts.frontmatter);
		setBodyDraft(parts.body);
		setError("");
	}, [selectedSkill]);

	const selectedEntry = selectedSkill ?? selectedMeta;
	const canDelete = Boolean(selectedEntry);
	const cancelCreateSkill = () => {
		setIsCreating(false);
		setNewSkillName("");
		setCreateError("");
	};

	const openEditDialog = () => {
		const parts = splitSkillMarkdown(selectedSkill?.content ?? "");
		setFrontmatterDraft(parts.frontmatter);
		setBodyDraft(parts.body);
		setError("");
		setEditDialogOpen(true);
	};

	const closeEditDialog = () => {
		const parts = splitSkillMarkdown(selectedSkill?.content ?? "");
		setFrontmatterDraft(parts.frontmatter);
		setBodyDraft(parts.body);
		setError("");
		setEditDialogOpen(false);
	};

	const save = async () => {
		if (!selectedSkill) return;
		setIsSaving(true);
		setError("");
		try {
			const saved = await updateSkill(selectedSkill.name, draft);
			await mutateSkill(saved, false);
			await mutateSkills();
			const parts = splitSkillMarkdown(saved.content);
			setFrontmatterDraft(parts.frontmatter);
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
			const created = await createSkill(name, newSkillTemplate(name));
			await mutateSkills();
			setSelectedName(created.name);
			await mutateSkill(created, false);
			const parts = splitSkillMarkdown(created.content);
			setFrontmatterDraft(parts.frontmatter);
			setBodyDraft(parts.body);
			setNewSkillName("");
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

	return (
		<>
			<PromptPackActions>
				<>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							setCreateError("");
							setIsCreating(true);
						}}
					>
						<Plus className="size-4" />
						<span>新建</span>
					</Button>
					<Button type="button" onClick={openEditDialog} disabled={!selectedSkill}>
						<Pencil className="size-4" />
						<span>编辑</span>
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
			</PromptPackActions>

			<SkillCreateDialog
				error={createError}
				isSaving={isSaving}
				name={newSkillName}
				open={isCreating}
				onCancel={cancelCreateSkill}
				onNameChange={(value) => {
					setNewSkillName(value);
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

			<SkillEditDialog
				bodyDraft={bodyDraft}
				error={error}
				isSaving={isSaving}
				open={editDialogOpen}
				onBodyChange={setBodyDraft}
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

			<div className="h-full min-h-0 overflow-y-auto px-5 py-5">
				<div className="space-y-3">
					{isLoading && skills.length === 0 ? (
						<p className={skillMessageClassName}>正在加载技能。</p>
					) : !selectedSkill && isSkillLoading ? (
						<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							<span>加载中</span>
						</div>
					) : !selectedMeta ? (
						<p className={skillMessageClassName}>没有可用技能。</p>
					) : (
						<>
							<div className={settingsFormRowClassName}>
								<Label htmlFor="skill-select" className="text-sm font-medium text-foreground">
									当前 Skill
								</Label>
								<Select value={selectedMeta.name} onValueChange={setSelectedName}>
									<SelectTrigger id="skill-select" className="rounded-md text-foreground">
										<SelectValue placeholder="选择 Skill" />
									</SelectTrigger>
									<SelectContent align="start">
										{orderedSkills.map((skill) => (
											<SelectItem key={skill.name} value={skill.name}>
												<span className="truncate">{skill.title || skill.name}</span>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
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
									className="min-h-72"
									placeholder="暂无 Skill 内容。"
									value={bodyDraft}
								/>
							</div>
						</>
					)}
				</div>
			</div>
		</>
	);
};

const settingsFormRowClassName = cn(
	"py-2",
	"grid gap-3 md:grid-cols-[minmax(var(--settings-label-column-min),var(--settings-label-column-max))_minmax(0,1fr)] md:items-start",
);

const skillBodyRowClassName = "grid gap-2 py-2";
const skillMessageClassName = "py-2 text-sm text-muted-foreground";

const SkillEditDialog: React.FC<{
	bodyDraft: string;
	error: string;
	isSaving: boolean;
	open: boolean;
	onBodyChange: (value: string) => void;
	onCancel: () => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
}> = ({ bodyDraft, error, isSaving, open, onBodyChange, onCancel, onOpenChange, onSave }) => (
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
							修改当前 Skill 正文内容。
						</DialogPrimitive.Description>
					</div>
					<DialogPrimitive.Close asChild>
						<Button type="button" variant="ghost" size="icon" aria-label="关闭编辑 Skill">
							<X className="size-4" />
						</Button>
					</DialogPrimitive.Close>
				</header>

				<div className="min-h-0 overflow-y-auto p-4">
					<div className="space-y-3">
						{error ? (
							<Alert variant="destructive" className="rounded-md">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}
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
					<Button type="button" variant="ghost" onClick={onCancel}>
						取消
					</Button>
					<Button type="button" onClick={onSave} disabled={isSaving}>
						{isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
						<span>{isSaving ? "保存中" : "保存"}</span>
					</Button>
				</footer>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	</DialogPrimitive.Root>
);

const SkillCreateDialog: React.FC<{
	error: string;
	isSaving: boolean;
	name: string;
	open: boolean;
	onCancel: () => void;
	onNameChange: (value: string) => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
}> = ({ error, isSaving, name, open, onCancel, onNameChange, onOpenChange, onSave }) => {
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
						<DialogPrimitive.Close asChild>
							<Button type="button" variant="ghost" size="icon" aria-label="关闭新建 Skill">
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</header>

					<div className="space-y-3 p-4">
						{error ? (
							<Alert variant="destructive" className="rounded-md">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}
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
					</div>

					<footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
						<Button type="button" variant="ghost" onClick={onCancel}>
							取消
						</Button>
						<Button type="button" onClick={onSave} disabled={!normalizedName || isSaving}>
							{isSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
							<span>{isSaving ? "创建中" : "创建"}</span>
						</Button>
					</footer>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};

const sanitizeSkillName = (value: string) =>
	value
		.trim()
		.replace(/\.skill\.md$/i, "")
		.replace(/[^a-zA-Z0-9_-]/g, "-")
		.replace(/^[-_]+/, "");

const newSkillTemplate = (name: string) => `---
name: ${name}
description: 自定义写作指导
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
