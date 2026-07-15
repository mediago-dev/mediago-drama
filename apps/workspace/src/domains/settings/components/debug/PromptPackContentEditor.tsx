import { Link2, Loader2, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	defaultPromptCategories,
	extraPromptCategory,
} from "@/domains/generation/lib/prompt-categories";
import {
	listPromptCategories,
	promptCategoriesKey,
} from "@/domains/generation/api/prompt-categories";
import { createPromptPreset } from "@/domains/generation/api/prompt-presets";
import { createSkill } from "@/domains/settings/api/skills";
import {
	detachPromptPackEntry,
	type PromptPack,
	type PromptPackEntry,
	type PromptPackEntryKind,
	resetPromptPackEntry,
	updatePromptPackEntry,
} from "@/domains/settings/api/packs";
import { composeSkillMarkdown } from "@/domains/settings/lib/skill-markdown";
import { sanitizeSkillName } from "@/domains/settings/lib/skill-name";
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
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/shared/components/ui/sheet";
import { Textarea } from "@/shared/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { SettingsMarkdownEditor, SettingsMarkdownPreview } from "./SettingsMarkdownEditor";

interface PromptPackEntryEditorProps {
	editable: boolean;
	entry: PromptPackEntry;
	onChanged: (selectedEntryID?: string) => Promise<void>;
	pack: PromptPack;
}

export const PromptPackEntryEditor: React.FC<PromptPackEntryEditorProps> = ({
	editable,
	entry,
	onChanged,
	pack,
}) => {
	const toast = useToast();
	const { data: categories = defaultPromptCategories } = useSWR(
		promptCategoriesKey,
		listPromptCategories,
	);
	const categoryOptions = useMemo(
		() =>
			Array.from(
				new Map(
					[...defaultPromptCategories, ...categories].map((category) => [category.id, category]),
				).values(),
			),
		[categories],
	);
	const [editing, setEditing] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [localOnly, setLocalOnly] = useState(false);
	const [name, setName] = useState("");
	const [category, setCategory] = useState(extraPromptCategory);
	const [description, setDescription] = useState("");
	const [body, setBody] = useState("");
	const isImportedOverride = Boolean(
		pack.source === "imported" && entry.source === "user" && entry.overriddenFrom,
	);

	useEffect(() => {
		setEditing(false);
		setError("");
		setLocalOnly(Boolean(entry.linked && !entry.referenceEditable));
		setName(entryDisplayName(entry));
		setCategory(metadataText(entry.metadata, "category") || extraPromptCategory);
		setDescription(entry.description || "");
		setBody(entry.body || "");
	}, [entry]);

	const startEditing = () => {
		setEditing(true);
		setError("");
		setLocalOnly(Boolean(entry.linked && !entry.referenceEditable));
		setName(entryDisplayName(entry));
		setCategory(metadataText(entry.metadata, "category") || extraPromptCategory);
		setDescription(entry.description || "");
		setBody(entry.body || "");
	};

	const save = async () => {
		if (!body.trim()) {
			setError(entry.kind === "skill" ? "Skill 内容不能为空" : "提示词不能为空");
			return;
		}
		if (entry.kind === "skill" && !description.trim()) {
			setError("Skill 描述不能为空");
			return;
		}
		if (entry.kind === "prompt" && !name.trim()) {
			setError("提示词名称不能为空");
			return;
		}
		setSaving(true);
		setError("");
		try {
			let target = entry;
			const shouldDetach = Boolean(entry.linked && (localOnly || !entry.referenceEditable));
			if (shouldDetach) {
				target = await detachPromptPackEntry(pack.id, entry.id);
			}
			const editsSource = Boolean(entry.linked && !shouldDetach);
			const targetPackID = editsSource ? entry.referencePackId : target.packId;
			const targetEntryID = editsSource ? entry.referenceEntryId : target.id;
			if (!targetPackID || !targetEntryID) throw new Error("词包内容来源不存在");
			await updatePromptPackEntry(targetPackID, targetEntryID, {
				name: entry.kind === "prompt" ? name.trim() : undefined,
				description: entry.kind === "skill" ? description.trim() : undefined,
				body,
				metadata: entry.kind === "prompt" ? { category } : undefined,
			});
			await onChanged(entry.id);
			setEditing(false);
			toast.success(
				shouldDetach
					? "已创建词包专用版本"
					: pack.source === "imported"
						? "本机修改已保存"
						: "内容已保存",
			);
		} catch (cause) {
			const message = errorMessage(cause);
			setError(message);
			toast.error("保存失败", { description: message });
		} finally {
			setSaving(false);
		}
	};

	const resetToFormalRelease = async () => {
		setResetting(true);
		setError("");
		try {
			await resetPromptPackEntry(pack.id, entry.id);
			await onChanged(entry.id);
			toast.success("已恢复正式包内容");
			return true;
		} catch (cause) {
			const message = errorMessage(cause);
			setError(message);
			toast.error("恢复失败", { description: message });
			return false;
		} finally {
			setResetting(false);
		}
	};

	const confirmResetToFormalRelease = () => {
		void confirmDialog({
			title: "恢复正式包内容？",
			description: "当前本机修改将被删除，并恢复为已导入正式版本中的内容。",
			confirmLabel: "恢复原版",
			confirmIcon: <RotateCcw className="size-4" />,
			variant: "destructive",
			onConfirm: resetToFormalRelease,
		});
	};

	if (editing) {
		return (
			<section className="flex min-h-0 flex-col overflow-y-auto px-5 py-4">
				<div className="mb-4 flex shrink-0 items-center justify-between gap-3 border-b border-border pb-3">
					<div>
						<h4 className="text-sm font-semibold text-foreground">
							编辑{entry.kind === "skill" ? " Skill" : "提示词"}
						</h4>
						<p className="mt-1 text-xs text-muted-foreground">
							{pack.source === "imported"
								? "保存为本机修改，不改变正式包和其他用户的内容。"
								: "保存后立即用于本机草稿。"}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => setEditing(false)}
							disabled={saving}
						>
							<X className="size-4" />
							<span>取消</span>
						</Button>
						<Button type="button" onClick={() => void save()} disabled={saving}>
							{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
							<span>{saving ? "保存中" : "保存"}</span>
						</Button>
					</div>
				</div>

				{error ? (
					<Alert variant="destructive" className="mb-4 rounded-md">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}

				{entry.linked ? (
					<div className="mb-4 rounded-md border border-border bg-ide-toolbar px-3 py-2.5">
						<div className="flex items-start gap-2">
							<Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-foreground">
									来源：{entry.referenceSlug || entry.referenceEntryId}
								</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									{entry.referenceEditable
										? "默认修改原内容，并同步到引用它的其他草稿词包。"
										: "来源内容不可直接修改，保存时会创建当前词包的独立版本。"}
								</p>
								{entry.referenceEditable ? (
									<label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-foreground">
										<input
											type="checkbox"
											checked={localOnly}
											onChange={(event) => setLocalOnly(event.target.checked)}
											className="size-4 accent-primary"
										/>
										<span>仅修改当前词包</span>
									</label>
								) : null}
							</div>
						</div>
					</div>
				) : null}

				<div className="grid gap-4">
					{entry.kind === "prompt" ? (
						<>
							<Field label="名称">
								<Input
									aria-label="名称"
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							</Field>
							<Field label="分类">
								<Select value={category} onValueChange={setCategory}>
									<SelectTrigger aria-label="分类">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{categoryOptions.map((option) => (
											<SelectItem key={option.id} value={option.id}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						</>
					) : (
						<Field label="Skill 描述">
							<Textarea
								aria-label="Skill 描述"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								className="min-h-20 resize-y"
							/>
						</Field>
					)}
					<div className="grid gap-2">
						<Label>{entry.kind === "skill" ? "Skill 内容" : "提示词"}</Label>
						<SettingsMarkdownEditor
							ariaLabel={entry.kind === "skill" ? "编辑 Skill 内容" : "编辑提示词内容"}
							className="min-h-64"
							value={body}
							onChange={setBody}
						/>
					</div>
				</div>
			</section>
		);
	}

	const contentLabel = entry.kind === "skill" ? "Skill 内容" : "提示词内容";
	return (
		<section className="flex min-h-0 flex-col overflow-hidden px-5 py-4">
			<div className="shrink-0 border-b border-border pb-4">
				<div className="flex min-w-0 items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<h4 className="text-base font-semibold text-foreground">{entryDisplayName(entry)}</h4>
							<Badge variant="outline">{entry.kind === "skill" ? "Skill" : "提示词"}</Badge>
							{entry.linked ? <Badge variant="secondary">同步引用</Badge> : null}
							{isImportedOverride ? <Badge variant="secondary">本地修改</Badge> : null}
						</div>
						{entry.description ? (
							<p className="mt-1 text-sm leading-6 text-muted-foreground">{entry.description}</p>
						) : null}
						<p className="mt-2 break-all font-mono text-xs text-muted-foreground">{entry.slug}</p>
						{entry.linked ? (
							<p className="mt-1 text-xs text-muted-foreground">
								来源：{entry.referenceSlug || entry.referenceEntryId}
								{entry.referenceMissing ? "（来源不可用，当前保留最后内容）" : ""}
							</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{isImportedOverride ? (
							<Button
								type="button"
								variant="outline"
								disabled={resetting}
								onClick={confirmResetToFormalRelease}
							>
								{resetting ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<RotateCcw className="size-4" />
								)}
								<span>恢复原版</span>
							</Button>
						) : null}
						{editable ? (
							<Button type="button" variant="outline" onClick={startEditing}>
								<Pencil className="size-4" />
								<span>编辑</span>
							</Button>
						) : null}
					</div>
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col pt-4">
				<div className="flex shrink-0 items-center justify-between gap-3">
					<h5 className="text-sm font-medium text-foreground">{contentLabel}</h5>
					<span className="text-xs text-muted-foreground">{countLines(entry.body)} 行</span>
				</div>
				<SettingsMarkdownPreview
					ariaLabel={contentLabel}
					className="mt-2 min-h-0 flex-1 rounded-none border-0 bg-transparent p-0"
					editorClassName="pb-6"
					placeholder={`暂无${contentLabel}。`}
					value={entry.body}
				/>
			</div>
		</section>
	);
};

interface CreatePackContentSheetProps {
	kind?: PromptPackEntryKind;
	onCreated: (kind: PromptPackEntryKind, slug: string) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	pack: PromptPack;
}

export const CreatePackContentSheet: React.FC<CreatePackContentSheetProps> = ({
	kind = "prompt",
	onCreated,
	onOpenChange,
	open,
	pack,
}) => {
	const toast = useToast();
	const { data: categories = defaultPromptCategories } = useSWR(
		promptCategoriesKey,
		listPromptCategories,
	);
	const categoryOptions = useMemo(
		() =>
			Array.from(
				new Map(
					[...defaultPromptCategories, ...categories].map((category) => [category.id, category]),
				).values(),
			),
		[categories],
	);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [category, setCategory] = useState(extraPromptCategory);
	const [body, setBody] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!open) return;
		setName("");
		setDescription("");
		setCategory(extraPromptCategory);
		setBody("");
		setError("");
	}, [kind, open]);

	const save = async () => {
		if (!name.trim()) {
			setError(kind === "skill" ? "请输入 Skill 名称" : "请输入提示词名称");
			return;
		}
		if (kind === "skill" && !description.trim()) {
			setError("请输入 Skill 描述");
			return;
		}
		if (!body.trim()) {
			setError(kind === "skill" ? "请输入 Skill 内容" : "请输入提示词");
			return;
		}
		setSaving(true);
		setError("");
		try {
			let slug = "";
			if (kind === "skill") {
				slug = sanitizeSkillName(name);
				if (!slug) throw new Error("Skill 名称无法生成有效文件名");
				await createSkill(
					slug,
					composeSkillMarkdown({
						frontmatter: `name: ${slug}\ndescription: ${JSON.stringify(description.trim())}`,
						body,
					}),
					pack.id,
				);
			} else {
				slug = `prompt-${globalThis.crypto.randomUUID()}`;
				await createPromptPreset({
					id: slug,
					name: name.trim(),
					category,
					prompt: body.trim(),
					packId: pack.id,
				});
			}
			await onCreated(kind, slug);
			onOpenChange(false);
			toast.success(kind === "skill" ? "Skill 已创建" : "提示词已创建");
		} catch (cause) {
			const message = errorMessage(cause);
			setError(message);
			toast.error("创建失败", { description: message });
		} finally {
			setSaving(false);
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full max-w-xl flex-col p-0 sm:w-[34rem]">
				<SheetHeader className="shrink-0 border-b border-border px-5 py-4">
					<div className="flex items-start justify-between gap-3">
						<div>
							<SheetTitle>{kind === "skill" ? "新建 Skill" : "新建提示词"}</SheetTitle>
							<SheetDescription>保存到“{pack.name}”，并出现在全局内容列表。</SheetDescription>
						</div>
						<SheetClose asChild>
							<Button type="button" size="icon" variant="ghost" aria-label="关闭新建内容">
								<X className="size-4" />
							</Button>
						</SheetClose>
					</div>
				</SheetHeader>
				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
					{error ? (
						<Alert variant="destructive" className="rounded-md">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}
					<Field label={kind === "skill" ? "Skill 名称" : "名称"}>
						<Input
							aria-label={kind === "skill" ? "Skill 名称" : "名称"}
							value={name}
							autoFocus
							onChange={(event) => setName(event.target.value)}
						/>
					</Field>
					{kind === "skill" ? (
						<Field label="Skill 描述">
							<Textarea
								aria-label="Skill 描述"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								className="min-h-20 resize-y"
							/>
						</Field>
					) : (
						<Field label="分类">
							<Select value={category} onValueChange={setCategory}>
								<SelectTrigger aria-label="分类">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{categoryOptions.map((option) => (
										<SelectItem key={option.id} value={option.id}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					)}
					<div className="grid gap-2">
						<Label>{kind === "skill" ? "Skill 内容" : "提示词"}</Label>
						<SettingsMarkdownEditor
							ariaLabel={kind === "skill" ? "新建 Skill 内容" : "新建提示词内容"}
							className="min-h-64"
							value={body}
							onChange={setBody}
						/>
					</div>
				</div>
				<SheetFooter className="shrink-0 border-t border-border px-5 py-3">
					<SheetClose asChild>
						<Button type="button" variant="ghost" disabled={saving}>
							取消
						</Button>
					</SheetClose>
					<Button type="button" disabled={saving} onClick={() => void save()}>
						{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
						<span>{saving ? "创建中" : "创建"}</span>
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
};

const Field: React.FC<{ children: React.ReactNode; label: string }> = ({ children, label }) => (
	<div className="grid gap-2">
		<Label>{label}</Label>
		{children}
	</div>
);

const entryDisplayName = (entry: PromptPackEntry) => entry.title || entry.name || entry.slug;

const metadataText = (metadata: Record<string, unknown> | undefined, key: string) => {
	const value = metadata?.[key];
	return typeof value === "string" ? value.trim() : "";
};

const countLines = (value: string) => (value ? value.split(/\r?\n/).length : 0);

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请稍后重试。";
};
