import {
	ArrowLeft,
	BookOpenCheck,
	ChevronRight,
	CopyPlus,
	FileText,
	Library,
	Loader2,
	PackageOpen,
	Plus,
	Search,
	Trash2,
	X,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	listPromptPresets,
	promptPresetsKey,
	type PromptPreset,
} from "@/domains/generation/api/prompt-presets";
import {
	copyPromptPackEntries,
	getPromptPackContents,
	promptPackContentsKey,
	type PromptPack,
	type PromptPackEntry,
	type PromptPackEntryKind,
	type PromptPackEntryReference,
	removePromptPackEntry,
} from "@/domains/settings/api/packs";
import { listSkills, skillsKey, type SkillMeta } from "@/domains/settings/api/skills";
import { isPromptPackContentCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/shared/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";
import { CreatePackContentSheet, PromptPackEntryEditor } from "./PromptPackContentEditor";

type PackContentSection = "skill" | "prompt";

interface PromptPackWorkspaceProps {
	listActions?: React.ReactNode;
	onChanged: () => Promise<void>;
	onSelectedPackChange: (packID?: string) => void;
	packs: PromptPack[];
	renderPackActions?: (pack: PromptPack) => React.ReactNode;
	selectedPackID?: string;
}

export const PromptPackWorkspace: React.FC<PromptPackWorkspaceProps> = ({
	listActions,
	onChanged,
	onSelectedPackChange,
	packs,
	renderPackActions,
	selectedPackID,
}) => {
	const toast = useToast();
	const { mutate: mutateGlobal } = useSWRConfig();
	const { data: skills = [], isLoading: skillsLoading } = useSWR(skillsKey, listSkills);
	const { data: prompts = [], isLoading: promptsLoading } = useSWR(promptPresetsKey, () =>
		listPromptPresets(),
	);
	const contentsKey = selectedPackID ? promptPackContentsKey(selectedPackID) : null;
	const {
		data: contents,
		isLoading: contentsLoading,
		mutate: mutateContents,
	} = useSWR(contentsKey, () => getPromptPackContents(selectedPackID ?? ""));
	const [activeSection, setActiveSection] = useState<PackContentSection>("skill");
	const [pickerOpen, setPickerOpen] = useState(false);
	const [copying, setCopying] = useState(false);
	const [createKind, setCreateKind] = useState<PromptPackEntryKind>("prompt");
	const [createOpen, setCreateOpen] = useState(false);
	const [deletingSlug, setDeletingSlug] = useState<string>();
	const [selectedEntryID, setSelectedEntryID] = useState<string>();

	const selectedPack = packs.find((pack) => pack.id === selectedPackID);
	const entries = contents?.entries ?? [];
	const skillEntries = entries.filter((entry) => entry.kind === "skill");
	const promptEntries = entries.filter((entry) => entry.kind === "prompt");
	const counts = useMemo(() => packContentCounts(packs, skills, prompts), [packs, prompts, skills]);

	useEffect(() => {
		if (selectedPackID && !selectedPack && !contentsLoading) {
			onSelectedPackChange(undefined);
		}
	}, [contentsLoading, onSelectedPackChange, selectedPack, selectedPackID]);

	const refreshContents = async () => {
		await Promise.all([onChanged(), mutateContents(), mutateGlobal(isPromptPackContentCacheKey)]);
	};

	const copyEntries = async (references: PromptPackEntryReference[]) => {
		if (!selectedPack || references.length === 0) return;
		setCopying(true);
		try {
			const copied = await copyPromptPackEntries(selectedPack.id, references);
			await refreshContents();
			setPickerOpen(false);
			toast.success("内容已加入词包", {
				description: `已引用 ${copied.length} 项到“${selectedPack.name}”`,
			});
		} catch (error) {
			toast.error("添加失败", { description: errorMessage(error) });
		} finally {
			setCopying(false);
		}
	};

	const removeEntry = async (entry: PromptPackEntry) => {
		setDeletingSlug(entry.slug);
		try {
			if (!selectedPack) return false;
			await removePromptPackEntry(selectedPack.id, entry.id);
			await refreshContents();
			toast.success("已从词包移除", { description: entryDisplayName(entry) });
			return true;
		} catch (error) {
			toast.error("移除失败", { description: errorMessage(error) });
			return false;
		} finally {
			setDeletingSlug(undefined);
		}
	};

	const confirmRemoveEntry = (entry: PromptPackEntry) => {
		void confirmDialog({
			title: "从词包移除内容？",
			description: entry.linked
				? `只会从“${selectedPack?.name ?? "当前词包"}”移除引用，原内容仍会保留。`
				: `将删除“${entryDisplayName(entry)}”。此内容也会从全局列表中移除。`,
			confirmLabel: "移除",
			confirmIcon: <Trash2 className="size-4" />,
			onConfirm: () => removeEntry(entry),
		});
	};

	if (!selectedPackID) {
		return (
			<PackList
				actions={listActions}
				counts={counts}
				isLoading={skillsLoading || promptsLoading}
				packs={packs}
				onSelect={onSelectedPackChange}
			/>
		);
	}

	if (contentsLoading && !selectedPack) {
		return <LoadingState label="加载词包内容" />;
	}

	if (!selectedPack) return null;
	const canManageContents = selectedPack.source === "local";
	const canEditEntries = selectedPack.source === "local" || selectedPack.source === "imported";

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<Button
						type="button"
						size="icon"
						variant="ghost"
						aria-label="返回词包列表"
						title="返回词包列表"
						onClick={() => onSelectedPackChange(undefined)}
					>
						<ArrowLeft className="size-4" />
					</Button>
					<div className="min-w-0">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<h3 className="truncate text-sm font-semibold text-foreground">
								{selectedPack.name}
							</h3>
							<Badge variant="outline">{sourceLabel(selectedPack.source)}</Badge>
							{canManageContents ? <Badge variant="secondary">草稿</Badge> : null}
						</div>
						<p className="mt-0.5 truncate text-xs text-muted-foreground">
							{selectedPack.id} · v{selectedPack.version}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{canManageContents ? (
						<>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setCreateKind("skill");
									setCreateOpen(true);
								}}
							>
								<Plus className="size-4" />
								<span>新建 Skill</span>
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setCreateKind("prompt");
									setCreateOpen(true);
								}}
							>
								<Plus className="size-4" />
								<span>新建提示词</span>
							</Button>
							<Button type="button" onClick={() => setPickerOpen(true)}>
								<CopyPlus className="size-4" />
								<span>从已有内容添加</span>
							</Button>
						</>
					) : null}
					{renderPackActions?.(selectedPack)}
				</div>
			</div>

			<Tabs
				value={activeSection}
				onValueChange={(value) => setActiveSection(value as PackContentSection)}
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
			>
				<div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-2">
					<TabsList className="grid w-64 grid-cols-2">
						<TabsTrigger value="skill">
							<BookOpenCheck className="size-3.5" />
							<span>Skills ({skillEntries.length})</span>
						</TabsTrigger>
						<TabsTrigger value="prompt">
							<Library className="size-3.5" />
							<span>提示词 ({promptEntries.length})</span>
						</TabsTrigger>
					</TabsList>
				</div>
				<TabsContent value="skill" className="mt-0 min-h-0 flex-1 overflow-hidden">
					<PackEntryBrowser
						deletingSlug={deletingSlug}
						editable={canEditEntries}
						entries={skillEntries}
						onRemove={confirmRemoveEntry}
						onSelect={setSelectedEntryID}
						onChanged={refreshContents}
						pack={selectedPack}
						removable={canManageContents}
						selectedEntryID={selectedEntryID}
					/>
				</TabsContent>
				<TabsContent value="prompt" className="mt-0 min-h-0 flex-1 overflow-hidden">
					<PackEntryBrowser
						deletingSlug={deletingSlug}
						editable={canEditEntries}
						entries={promptEntries}
						onRemove={confirmRemoveEntry}
						onSelect={setSelectedEntryID}
						onChanged={refreshContents}
						pack={selectedPack}
						removable={canManageContents}
						selectedEntryID={selectedEntryID}
					/>
				</TabsContent>
			</Tabs>

			<AddContentSheet
				copying={copying}
				onCopy={(references) => void copyEntries(references)}
				onOpenChange={setPickerOpen}
				open={pickerOpen}
				packs={packs}
				prompts={prompts}
				skills={skills}
				existingEntries={entries}
				targetPack={selectedPack}
			/>
			<CreatePackContentSheet
				kind={createKind}
				onCreated={async (kind, slug) => {
					setActiveSection(kind);
					await refreshContents();
					const refreshed = await getPromptPackContents(selectedPack.id);
					const created = refreshed.entries.find(
						(entry) => entry.kind === kind && entry.slug === slug,
					);
					setSelectedEntryID(created?.id);
				}}
				onOpenChange={setCreateOpen}
				open={createOpen}
				pack={selectedPack}
			/>
		</div>
	);
};

const PackEntryBrowser: React.FC<{
	deletingSlug?: string;
	editable: boolean;
	entries: PromptPackEntry[];
	onRemove: (entry: PromptPackEntry) => void;
	onSelect: (entryID: string) => void;
	onChanged: (selectedEntryID?: string) => Promise<void>;
	pack: PromptPack;
	removable: boolean;
	selectedEntryID?: string;
}> = ({
	deletingSlug,
	editable,
	entries,
	onChanged,
	onRemove,
	onSelect,
	pack,
	removable,
	selectedEntryID,
}) => {
	if (entries.length === 0) {
		return (
			<div className="flex h-full min-h-48 items-center justify-center px-6 text-sm text-muted-foreground">
				暂无内容
			</div>
		);
	}

	const selectedEntry = entries.find((entry) => entry.id === selectedEntryID) ?? entries[0];
	return (
		<div className="grid h-full min-h-0 grid-rows-[minmax(10rem,40%)_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] lg:grid-rows-1">
			<div className="min-h-0 overflow-y-auto border-b border-border lg:border-b-0 lg:border-r">
				<PackEntryList
					deletingSlug={deletingSlug}
					entries={entries}
					onRemove={onRemove}
					onSelect={onSelect}
					removable={removable}
					selectedEntryID={selectedEntry.id}
				/>
			</div>
			<PromptPackEntryEditor
				editable={editable}
				entry={selectedEntry}
				onChanged={async (nextSelectedID) => {
					await onChanged(nextSelectedID);
					if (nextSelectedID) onSelect(nextSelectedID);
				}}
				pack={pack}
			/>
		</div>
	);
};

const PackList: React.FC<{
	actions?: React.ReactNode;
	counts: Map<string, { prompts: number; skills: number }>;
	isLoading: boolean;
	onSelect: (packID: string) => void;
	packs: PromptPack[];
}> = ({ actions, counts, isLoading, onSelect, packs }) => {
	const orderedPacks = useMemo(
		() =>
			[...packs].sort((first, second) => {
				const priority = { local: 0, imported: 1, default: 2 };
				return (
					priority[first.source] - priority[second.source] || first.name.localeCompare(second.name)
				);
			}),
		[packs],
	);

	if (isLoading && packs.length === 0) return <LoadingState label="加载词包" />;

	return (
		<div className="h-full min-h-0 overflow-y-auto px-5 py-4">
			{actions ? (
				<div className="mx-auto mb-3 flex w-full max-w-5xl justify-end">{actions}</div>
			) : null}
			<div className="mx-auto w-full max-w-5xl overflow-hidden rounded-md border border-border bg-background">
				<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border bg-ide-toolbar px-4 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_11rem_7rem_auto]">
					<span>词包</span>
					<span className="hidden sm:block">内容</span>
					<span className="hidden sm:block">状态</span>
					<span className="sr-only">操作</span>
				</div>
				{orderedPacks.map((pack) => {
					const count = counts.get(pack.id) ?? { prompts: 0, skills: 0 };
					const actionLabel =
						pack.source === "local" ? "编辑" : pack.source === "imported" ? "查看与编辑" : "查看";
					return (
						<div
							key={pack.id}
							className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_11rem_7rem_auto]"
						>
							<div className="flex min-w-0 items-center gap-3">
								<div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-ide-toolbar text-muted-foreground">
									<PackageOpen className="size-4" />
								</div>
								<div className="min-w-0">
									<p className="truncate text-sm font-medium text-foreground">{pack.name}</p>
									<p className="mt-0.5 truncate text-xs text-muted-foreground">
										{pack.id} · v{pack.version}
									</p>
								</div>
							</div>
							<div className="hidden text-xs text-muted-foreground sm:block">
								{count.skills} Skills · {count.prompts} 提示词
							</div>
							<div className="hidden sm:block">
								<Badge variant={pack.source === "local" ? "secondary" : "outline"}>
									{pack.source === "local" ? "草稿" : sourceLabel(pack.source)}
								</Badge>
							</div>
							<Button
								type="button"
								variant="ghost"
								aria-label={`${actionLabel} ${pack.name}`}
								onClick={() => onSelect(pack.id)}
							>
								<span>{actionLabel}</span>
								<ChevronRight className="size-4" />
							</Button>
						</div>
					);
				})}
			</div>
		</div>
	);
};

const PackEntryList: React.FC<{
	deletingSlug?: string;
	entries: PromptPackEntry[];
	onRemove: (entry: PromptPackEntry) => void;
	onSelect: (entryID: string) => void;
	removable: boolean;
	selectedEntryID: string;
}> = ({ deletingSlug, entries, onRemove, onSelect, removable, selectedEntryID }) => {
	return (
		<div className="divide-y divide-border">
			{entries.map((entry) => {
				const selected = entry.id === selectedEntryID;
				return (
					<div
						key={entry.id}
						className={cn("flex min-w-0 items-center", selected && "bg-ide-list-active")}
					>
						<button
							type="button"
							className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left outline-none hover:bg-ide-list-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
							aria-label={`查看 ${entryDisplayName(entry)}`}
							aria-pressed={selected}
							onClick={() => onSelect(entry.id)}
						>
							<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ide-toolbar text-muted-foreground">
								{entry.kind === "skill" ? (
									<BookOpenCheck className="size-4" />
								) : (
									<FileText className="size-4" />
								)}
							</div>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium text-foreground">
									{entryDisplayName(entry)}
								</p>
								<p className="mt-0.5 truncate text-xs text-muted-foreground">
									{entry.slug}
									{entry.description ? ` · ${entry.description}` : ""}
								</p>
							</div>
						</button>
						{removable ? (
							<Button
								type="button"
								size="icon"
								variant="ghost"
								className="mr-3 text-muted-foreground hover:bg-error-surface hover:text-error-foreground"
								aria-label={`移除 ${entryDisplayName(entry)}`}
								title="从词包移除"
								disabled={Boolean(deletingSlug)}
								onClick={() => onRemove(entry)}
							>
								{deletingSlug === entry.slug ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Trash2 className="size-4" />
								)}
							</Button>
						) : null}
					</div>
				);
			})}
		</div>
	);
};

interface PickerItem {
	description: string;
	key: string;
	kind: PromptPackEntryKind;
	reference: PromptPackEntryReference;
	title: string;
}

const AddContentSheet: React.FC<{
	copying: boolean;
	existingEntries: PromptPackEntry[];
	onCopy: (references: PromptPackEntryReference[]) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	packs: PromptPack[];
	prompts: PromptPreset[];
	skills: SkillMeta[];
	targetPack: PromptPack;
}> = ({
	copying,
	existingEntries,
	onCopy,
	onOpenChange,
	open,
	packs,
	prompts,
	skills,
	targetPack,
}) => {
	const [activeSection, setActiveSection] = useState<PackContentSection>("skill");
	const [query, setQuery] = useState("");
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
	const packNames = useMemo(() => new Map(packs.map((pack) => [pack.id, pack.name])), [packs]);
	const items = useMemo(
		() => pickerItems(skills, prompts, targetPack.id, packNames, existingEntries),
		[existingEntries, packNames, prompts, skills, targetPack.id],
	);
	const visibleItems = useMemo(() => {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		return items.filter((item) => {
			if (item.kind !== activeSection) return false;
			if (!normalizedQuery) return true;
			return `${item.title} ${item.description}`.toLocaleLowerCase().includes(normalizedQuery);
		});
	}, [activeSection, items, query]);
	const selectedItems = items.filter((item) => selectedKeys.has(item.key));

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setSelectedKeys(new Set());
	}, [open]);

	const toggleItem = (key: string) => {
		setSelectedKeys((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const allVisibleSelected =
		visibleItems.length > 0 && visibleItems.every((item) => selectedKeys.has(item.key));
	const toggleVisible = () => {
		setSelectedKeys((current) => {
			const next = new Set(current);
			for (const item of visibleItems) {
				if (allVisibleSelected) next.delete(item.key);
				else next.add(item.key);
			}
			return next;
		});
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full max-w-xl flex-col p-0 sm:w-[34rem]">
				<SheetHeader className="shrink-0 border-b border-border px-5 py-4">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<SheetTitle>添加到“{targetPack.name}”</SheetTitle>
							<SheetDescription className="sr-only">添加现有 Skills 和提示词</SheetDescription>
						</div>
						<SheetClose asChild>
							<Button type="button" size="icon" variant="ghost" aria-label="关闭内容选择">
								<X className="size-4" />
							</Button>
						</SheetClose>
					</div>
				</SheetHeader>

				<div className="shrink-0 space-y-3 border-b border-border px-5 py-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="搜索内容"
							className="pl-9"
						/>
					</div>
					<Tabs
						value={activeSection}
						onValueChange={(value) => setActiveSection(value as PackContentSection)}
					>
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="skill">Skills</TabsTrigger>
							<TabsTrigger value="prompt">提示词</TabsTrigger>
						</TabsList>
					</Tabs>
				</div>

				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-2">
						<span className="text-xs text-muted-foreground">{visibleItems.length} 项</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={visibleItems.length === 0}
							onClick={toggleVisible}
						>
							{allVisibleSelected ? "取消全选" : "全选"}
						</Button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto">
						{visibleItems.length === 0 ? (
							<div className="flex min-h-40 items-center justify-center px-6 text-sm text-muted-foreground">
								没有可添加的内容
							</div>
						) : (
							<div className="divide-y divide-border">
								{visibleItems.map((item) => (
									<label
										key={item.key}
										className={cn(
											"flex cursor-pointer items-start gap-3 px-5 py-3 hover:bg-ide-list-hover",
											selectedKeys.has(item.key) && "bg-ide-list-active",
										)}
									>
										<input
											type="checkbox"
											className="mt-0.5 size-4 shrink-0 accent-primary"
											checked={selectedKeys.has(item.key)}
											onChange={() => toggleItem(item.key)}
										/>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium text-foreground">
												{item.title}
											</span>
											<span className="mt-0.5 block truncate text-xs text-muted-foreground">
												{item.description}
											</span>
										</span>
									</label>
								))}
							</div>
						)}
					</div>
				</div>

				<SheetFooter className="shrink-0 border-t border-border px-5 py-3">
					<SheetClose asChild>
						<Button type="button" variant="ghost" disabled={copying}>
							取消
						</Button>
					</SheetClose>
					<Button
						type="button"
						disabled={copying || selectedItems.length === 0}
						onClick={() => onCopy(selectedItems.map((item) => item.reference))}
					>
						{copying ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<CopyPlus className="size-4" />
						)}
						<span>添加 {selectedItems.length || ""} 项</span>
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
};

const pickerItems = (
	skills: SkillMeta[],
	prompts: PromptPreset[],
	targetPackID: string,
	packNames: Map<string, string>,
	existingEntries: PromptPackEntry[],
): PickerItem[] => {
	const existingReferences = new Set(
		existingEntries.map((entry) => {
			const packID = entry.linked ? entry.referencePackId : entry.packId;
			const slug = entry.linked ? entry.referenceSlug : entry.slug;
			return `${entry.kind}/${packID}/${slug}`;
		}),
	);
	const skillItems = skills
		.filter(
			(skill) =>
				skill.packId &&
				skill.packId !== targetPackID &&
				!existingReferences.has(`skill/${skill.packId}/${skill.name}`),
		)
		.map((skill) => ({
			key: `skill/${skill.packId}/${skill.name}`,
			kind: "skill" as const,
			title: skill.title || skill.name,
			description: `${packNames.get(skill.packId ?? "") ?? skill.packId} · ${skill.description}`,
			reference: { packId: skill.packId ?? "", kind: "skill" as const, slug: skill.name },
		}));
	const promptItems = prompts
		.filter(
			(prompt) =>
				prompt.packId &&
				prompt.packId !== targetPackID &&
				!existingReferences.has(`prompt/${prompt.packId}/${prompt.id}`),
		)
		.map((prompt) => ({
			key: `prompt/${prompt.packId}/${prompt.id}`,
			kind: "prompt" as const,
			title: prompt.name,
			description: `${packNames.get(prompt.packId ?? "") ?? prompt.packId} · ${prompt.category}`,
			reference: { packId: prompt.packId ?? "", kind: "prompt" as const, slug: prompt.id },
		}));
	return [...skillItems, ...promptItems];
};

const packContentCounts = (packs: PromptPack[], skills: SkillMeta[], prompts: PromptPreset[]) => {
	const counts = new Map<string, { prompts: number; skills: number }>();
	const serverCountPacks = new Set<string>();
	for (const pack of packs) {
		const hasServerCounts = pack.promptCount !== undefined || pack.skillCount !== undefined;
		if (hasServerCounts) serverCountPacks.add(pack.id);
		counts.set(pack.id, {
			prompts: pack.promptCount ?? 0,
			skills: pack.skillCount ?? 0,
		});
	}
	for (const skill of skills) {
		if (!skill.packId) continue;
		if (serverCountPacks.has(skill.packId)) continue;
		const count = counts.get(skill.packId) ?? { prompts: 0, skills: 0 };
		count.skills++;
		counts.set(skill.packId, count);
	}
	for (const prompt of prompts) {
		if (!prompt.packId) continue;
		if (serverCountPacks.has(prompt.packId)) continue;
		const count = counts.get(prompt.packId) ?? { prompts: 0, skills: 0 };
		count.prompts++;
		counts.set(prompt.packId, count);
	}
	return counts;
};

const LoadingState: React.FC<{ label: string }> = ({ label }) => (
	<div className="flex h-full min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
		<Loader2 className="size-4 animate-spin" />
		<span>{label}</span>
	</div>
);

const entryDisplayName = (entry: PromptPackEntry) => entry.title || entry.name || entry.slug;

const sourceLabel = (source: PromptPack["source"]) => {
	switch (source) {
		case "default":
			return "默认包";
		case "imported":
			return "已导入";
		case "local":
			return "本地创作";
	}
};

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请稍后重试。";
};
