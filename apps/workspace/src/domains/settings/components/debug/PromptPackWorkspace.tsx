import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	BookOpenCheck,
	Check,
	ChevronLeft,
	FileText,
	FilePlus2,
	GripVertical,
	LayoutDashboard,
	Library,
	Loader2,
	PackageOpen,
	PackagePlus,
	Pencil,
	Plus,
	RotateCcw,
	Settings2,
	Trash2,
} from "lucide-react";
import type React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	createPromptPackCategory,
	getPromptPackContents,
	promptPackContentsKey,
	createPromptPackEntry,
	deletePromptPackCategory,
	type PromptPack,
	type PromptPackCategory,
	type PromptPackContents,
	type PromptPackEntry,
	type PromptPackEntryKind,
	removePromptPackEntry,
	resetPromptPackEntry,
	updatePromptPackCategory,
	updatePromptPackEntry,
} from "@/domains/settings/api/packs";
import { isPromptPackContentCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
import {
	SidebarContentLayout,
	useWorkspaceSidebarWidth,
	workspaceSidebarWidth,
} from "@/domains/workspace/components/SidebarContentLayout";
import { SidebarScreenStack } from "@/domains/workspace/components/SidebarScreenStack";
import { useToast } from "@/hooks/useToast";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
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
import { cn } from "@/shared/lib/utils";
import {
	PromptPackEntryEditor,
	type PromptPackEntryDraft,
	promptPackEntryDraft,
	promptPackEntryDraftEquals,
	promptPackEntryUpdate,
	validatePromptPackEntryDraft,
} from "./PromptPackContentEditor";

type WorkspaceView = { type: "idle" } | { type: "categories" } | { entryID: string; type: "entry" };

type NavigatorKind = "skill" | "prompt";

interface PromptPackWorkspaceProps {
	createError?: string;
	creatingPack: boolean;
	header?: React.ReactNode;
	isEditing: boolean;
	isCreatingPack: boolean;
	isLoading?: boolean;
	onCancelCreatePack: () => void;
	onChanged: () => Promise<void>;
	onCreatePack: (input: { description: string; name: string }) => Promise<void>;
	onDirtyChange: (dirty: boolean) => void;
	onSelectedPackChange: (packID?: string) => void;
	onStartCreatePack: () => void;
	packs: PromptPack[];
	selectedPackID?: string;
}

export interface PromptPackWorkspaceHandle {
	discard: () => void;
	flush: () => Promise<boolean>;
	openEntry: (entryID: string) => void;
	save: () => Promise<boolean>;
}

export const PromptPackWorkspace = forwardRef<PromptPackWorkspaceHandle, PromptPackWorkspaceProps>(
	function PromptPackWorkspace(
		{
			createError,
			creatingPack,
			header,
			isEditing,
			isCreatingPack,
			isLoading = false,
			onCancelCreatePack,
			onChanged,
			onCreatePack,
			onDirtyChange,
			onSelectedPackChange,
			onStartCreatePack,
			packs,
			selectedPackID,
		},
		ref,
	) {
		const toast = useToast();
		const { mutate: mutateGlobal } = useSWRConfig();
		const selectedPack = packs.find((pack) => pack.id === selectedPackID);
		const contentsKey =
			selectedPackID && !creatingPack ? promptPackContentsKey(selectedPackID) : null;
		const {
			data: contents,
			isLoading: contentsLoading,
			mutate: mutateContents,
		} = useSWR(contentsKey, () => getPromptPackContents(selectedPackID ?? ""));
		const [view, setView] = useState<WorkspaceView>({ type: "idle" });
		const [navigatorKind, setNavigatorKind] = useState<NavigatorKind>("skill");
		const [createEntryDialogOpen, setCreateEntryDialogOpen] = useState(false);
		const [creatingEntry, setCreatingEntry] = useState(false);
		const [deletingEntryID, setDeletingEntryID] = useState<string>();
		const [resettingEntryID, setResettingEntryID] = useState<string>();
		const [updatingCategoryEntryID, setUpdatingCategoryEntryID] = useState<string>();
		const [drafts, setDrafts] = useState<Record<string, PromptPackEntryDraft>>({});
		const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
		const [navigatorWidth, setNavigatorWidth] = useWorkspaceSidebarWidth();

		const entries = useMemo(() => contents?.entries ?? [], [contents]);
		const categories = useMemo(
			() => packCategories(contents?.categories ?? [], entries),
			[contents?.categories, entries],
		);
		const skillEntries = entries.filter((entry) => entry.kind === "skill");
		const promptEntries = entries.filter((entry) => entry.kind === "prompt");
		const selectedEntry =
			view.type === "entry" ? entries.find((entry) => entry.id === view.entryID) : undefined;
		const changedEntries = useMemo(
			() =>
				entries.filter((entry) => {
					const draft = drafts[entry.id];
					return draft && !promptPackEntryDraftEquals(draft, promptPackEntryDraft(entry));
				}),
			[drafts, entries],
		);

		useEffect(() => {
			if (navigatorKind === "skill" && skillEntries.length === 0 && promptEntries.length > 0) {
				setNavigatorKind("prompt");
			}
		}, [navigatorKind, promptEntries.length, skillEntries.length]);

		useEffect(() => {
			if (!isEditing) {
				setDrafts({});
				setDraftErrors({});
				return;
			}
			setDrafts(
				Object.fromEntries(entries.map((entry) => [entry.id, promptPackEntryDraft(entry)])),
			);
		}, [isEditing]);

		useEffect(() => {
			onDirtyChange(changedEntries.length > 0);
		}, [changedEntries.length, onDirtyChange]);

		useEffect(() => {
			setView({ type: "idle" });
			setCreateEntryDialogOpen(false);
			setNavigatorKind("skill");
		}, [selectedPackID]);

		useEffect(() => {
			if (selectedPackID && !selectedPack && !isLoading && !contentsLoading) {
				onSelectedPackChange(undefined);
			}
		}, [contentsLoading, isLoading, onSelectedPackChange, selectedPack, selectedPackID]);

		useEffect(() => {
			if (view.type === "entry" && contents && !selectedEntry) {
				setView({ type: "idle" });
			}
		}, [contents, selectedEntry, view]);

		const refreshContents = async (): Promise<PromptPackContents | undefined> => {
			await onChanged();
			const refreshed = await mutateContents();
			await mutateGlobal(isPromptPackContentCacheKey);
			return refreshed;
		};

		const openEntry = useCallback((entryID: string) => {
			setView({ entryID, type: "entry" });
		}, []);

		const saveAll = async () => {
			if (!isEditing || changedEntries.length === 0) return true;
			const nextErrors: Record<string, string> = {};
			for (const entry of changedEntries) {
				const issue = validatePromptPackEntryDraft(entry.kind, drafts[entry.id]);
				if (issue) nextErrors[entry.id] = issue;
			}
			if (Object.keys(nextErrors).length > 0) {
				setDraftErrors(nextErrors);
				const firstInvalidEntry = changedEntries.find((entry) => nextErrors[entry.id]);
				if (firstInvalidEntry) setView({ entryID: firstInvalidEntry.id, type: "entry" });
				return false;
			}

			setDraftErrors({});
			try {
				await Promise.all(
					changedEntries.map((entry) =>
						updatePromptPackEntry(
							selectedPack?.id ?? "",
							entry.id,
							promptPackEntryUpdate(entry, drafts[entry.id]),
						),
					),
				);
				const refreshed = await refreshContents();
				if (refreshed) {
					setDrafts(
						Object.fromEntries(
							refreshed.entries.map((entry) => [entry.id, promptPackEntryDraft(entry)]),
						),
					);
				}
				toast.success("技能包已保存", {
					description: `已保存 ${changedEntries.length} 项内容。`,
				});
				return true;
			} catch (error) {
				toast.error("技能包保存失败", { description: errorMessage(error) });
				return false;
			}
		};

		const discard = () => {
			setDrafts({});
			setDraftErrors({});
		};

		useImperativeHandle(ref, () => ({ discard, flush: saveAll, openEntry, save: saveAll }), [
			openEntry,
			saveAll,
		]);

		const navigate = (next: WorkspaceView) => {
			setView(next);
		};

		const blockWhileEditing = () => {
			if (!isEditing) return false;
			toast.info("请先保存或取消编辑", { description: "当前操作会离开正在编辑的技能包。" });
			return true;
		};

		const selectPack = (packID: string) => {
			if (blockWhileEditing()) return;
			onSelectedPackChange(packID);
		};

		const startCreatePack = () => {
			if (blockWhileEditing()) return;
			onStartCreatePack();
		};

		const createEntry = async (
			kind: PromptPackEntryKind,
			categoryID?: string,
		): Promise<boolean> => {
			if (blockWhileEditing()) return false;
			if (!selectedPack || creatingEntry) return false;
			setCreatingEntry(true);
			try {
				const created = await createPromptPackEntry(selectedPack.id, {
					categoryId: kind === "prompt" ? categoryID : undefined,
					kind,
					slug: `${kind}-${globalThis.crypto.randomUUID()}`,
				});
				await refreshContents();
				setView({ entryID: created.id, type: "entry" });
				setCreateEntryDialogOpen(false);
				toast.success(kind === "skill" ? "Skill 已创建" : "提示词已创建");
				return true;
			} catch (error) {
				toast.error("创建失败", { description: errorMessage(error) });
				return false;
			} finally {
				setCreatingEntry(false);
			}
		};

		const removeEntry = async (entry: PromptPackEntry) => {
			if (!selectedPack) return false;
			setDeletingEntryID(entry.id);
			try {
				await removePromptPackEntry(selectedPack.id, entry.id);
				await refreshContents();
				if (view.type === "entry" && view.entryID === entry.id) {
					setView({ type: "idle" });
				}
				toast.success("内容已删除", { description: entryDisplayName(entry) });
				return true;
			} catch (error) {
				toast.error("删除失败", { description: errorMessage(error) });
				return false;
			} finally {
				setDeletingEntryID(undefined);
			}
		};

		const confirmRemoveEntry = (entry: PromptPackEntry) => {
			if (blockWhileEditing()) return;
			void confirmDialog({
				title: "删除技能包内容？",
				description: `将从“${selectedPack?.name ?? "当前技能包"}”永久删除“${entryDisplayName(entry)}”。`,
				confirmLabel: "删除",
				confirmIcon: <Trash2 className="size-4" />,
				variant: "destructive",
				onConfirm: () => removeEntry(entry),
			});
		};

		const resetEntry = async (entry: PromptPackEntry) => {
			if (!selectedPack) return false;
			setResettingEntryID(entry.id);
			try {
				await resetPromptPackEntry(selectedPack.id, entry.id);
				await refreshContents();
				toast.success("内容已恢复默认", { description: entryDisplayName(entry) });
				return true;
			} catch (error) {
				toast.error("恢复失败", { description: errorMessage(error) });
				return false;
			} finally {
				setResettingEntryID(undefined);
			}
		};

		const confirmResetEntry = (entry: PromptPackEntry) => {
			if (blockWhileEditing() || !entryCanReset(entry)) return;
			void confirmDialog({
				title: "恢复内容默认？",
				description: `将撤销“${entryDisplayName(entry)}”的本地修改，并恢复技能包自带内容。`,
				confirmLabel: "恢复默认",
				confirmIcon: <RotateCcw className="size-4" />,
				variant: "default",
				onConfirm: () => resetEntry(entry),
			});
		};

		const changeEntryCategory = async (entry: PromptPackEntry, categoryID: string) => {
			if (!selectedPack || updatingCategoryEntryID || entry.kind !== "prompt") return false;
			if (promptCategoryID(entry) === categoryID) return true;
			const previousContents = contents;
			setUpdatingCategoryEntryID(entry.id);
			await mutateContents(
				(current) =>
					current
						? {
								...current,
								entries: current.entries.map((candidate) =>
									candidate.id === entry.id
										? {
												...candidate,
												metadata: { ...candidate.metadata, category: categoryID },
											}
										: candidate,
								),
							}
						: current,
				{ revalidate: false },
			);
			try {
				await updatePromptPackEntry(
					selectedPack.id,
					entry.id,
					promptPackEntryUpdate(entry, {
						...promptPackEntryDraft(entry),
						category: categoryID,
					}),
				);
				await refreshContents();
				toast.success("分类已更新", {
					description:
						categories.find((category) => category.id === categoryID)?.label ?? categoryID,
				});
				return true;
			} catch (error) {
				await mutateContents(previousContents, { revalidate: false });
				toast.error("更新分类失败", { description: errorMessage(error) });
				return false;
			} finally {
				setUpdatingCategoryEntryID(undefined);
			}
		};

		const createCategoryRecord = async (label: string): Promise<PromptPackCategory | undefined> => {
			if (!selectedPack) return undefined;
			try {
				const created = await createPromptPackCategory(selectedPack.id, {
					id: `category-${globalThis.crypto.randomUUID()}`,
					label: label.trim(),
					order: Math.max(-1, ...categories.map((category) => category.order ?? 0)) + 1,
				});
				await refreshContents();
				toast.success("分组已创建", { description: label.trim() });
				return created;
			} catch (error) {
				toast.error("创建分组失败", { description: errorMessage(error) });
				return undefined;
			}
		};

		const createCategory = async (label: string) =>
			isEditing && Boolean(await createCategoryRecord(label));

		const updateCategory = async (
			category: PromptPackCategory,
			input: { label: string; order: number },
		) => {
			if (!selectedPack || !isEditing) return false;
			try {
				await updatePromptPackCategory(selectedPack.id, category.id, input);
				await refreshContents();
				toast.success("分组已更新", { description: input.label.trim() });
				return true;
			} catch (error) {
				toast.error("更新分组失败", { description: errorMessage(error) });
				return false;
			}
		};

		const reorderCategory = async (category: PromptPackCategory, target: PromptPackCategory) => {
			if (!selectedPack || !isEditing) return false;
			const ordered = [...categories].sort(compareCategories);
			const currentIndex = ordered.findIndex((item) => item.id === category.id);
			const targetIndex = ordered.findIndex((item) => item.id === target.id);
			if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return false;
			const nextOrder = [...ordered];
			const [moved] = nextOrder.splice(currentIndex, 1);
			if (!moved) return false;
			nextOrder.splice(targetIndex, 0, moved);
			const orderSlots = ordered.map((item, index) => item.order ?? index);
			try {
				await Promise.all(
					nextOrder.flatMap((item, index) => {
						const order = orderSlots[index] ?? index;
						if (item.order === order) return [];
						return [
							updatePromptPackCategory(selectedPack.id, item.id, {
								label: item.label,
								order,
							}),
						];
					}),
				);
				await refreshContents();
				return true;
			} catch (error) {
				toast.error("调整分组顺序失败", { description: errorMessage(error) });
				return false;
			}
		};

		const deleteCategory = async (category: PromptPackCategory, replacementCategoryID: string) => {
			if (!selectedPack || !isEditing) return false;
			try {
				await deletePromptPackCategory(selectedPack.id, category.id, replacementCategoryID);
				await refreshContents();
				toast.success("分组已删除", { description: category.label });
				return true;
			} catch (error) {
				toast.error("删除分组失败", { description: errorMessage(error) });
				return false;
			}
		};

		return (
			<>
				<SidebarContentLayout
					className="desktop-window-frame h-full w-full"
					contentClassName="bg-ide-editor text-ide-editor-foreground"
					contentInset
					maxSidebarWidth={workspaceSidebarWidth.max}
					minSidebarWidth={workspaceSidebarWidth.min}
					onSidebarWidthChange={setNavigatorWidth}
					resizeLabel="调整技能包管理侧边栏宽度"
					resizeStep={workspaceSidebarWidth.resizeStep}
					showDesktopDragRegion
					sidebar={
						<PromptPackNavigator
							categories={categories}
							creatingPack={creatingPack}
							deletingEntryID={deletingEntryID}
							isLoading={isLoading}
							navigatorKind={navigatorKind}
							onBackToPacks={() => selectPack("")}
							onCreateEntry={() => setCreateEntryDialogOpen(true)}
							onNavigatorKindChange={(kind) => {
								setNavigatorKind(kind);
								if (view.type === "entry" && selectedEntry?.kind !== kind) {
									setView({ type: "idle" });
								}
							}}
							onOpenCategories={() => navigate({ type: "categories" })}
							onOpenOverview={() => navigate({ type: "idle" })}
							onRemoveEntry={confirmRemoveEntry}
							onResetEntry={confirmResetEntry}
							onSelectEntry={(entryID) => navigate({ entryID, type: "entry" })}
							onSelectPack={selectPack}
							onStartCreatePack={startCreatePack}
							packs={packs}
							promptEntries={promptEntries}
							resettingEntryID={resettingEntryID}
							selectedPack={selectedPack}
							skillEntries={skillEntries}
							view={view}
						/>
					}
					sidebarClassName="bg-ide-sidebar text-ide-sidebar-foreground"
					sidebarWidth={navigatorWidth}
				>
					<div className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
						{header}
						<div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-ide-editor">
							{!selectedPackID ? (
								<WorkspaceStart
									isLoading={isLoading}
									onSelectPack={(packID) => void selectPack(packID)}
									packs={packs}
								/>
							) : contentsLoading || !selectedPack || !contents ? (
								<LoadingState label="加载技能包内容" />
							) : view.type === "entry" && selectedEntry ? (
								<PromptPackEntryEditor
									categories={categories}
									key={selectedEntry.id}
									draft={drafts[selectedEntry.id] ?? promptPackEntryDraft(selectedEntry)}
									entry={selectedEntry}
									error={draftErrors[selectedEntry.id]}
									isEditing={isEditing}
									isUpdatingCategory={updatingCategoryEntryID === selectedEntry.id}
									onCategoryChange={(categoryID) =>
										void changeEntryCategory(selectedEntry, categoryID)
									}
									onChange={(draft) => {
										setDrafts((current) => ({ ...current, [selectedEntry.id]: draft }));
										setDraftErrors((current) => ({ ...current, [selectedEntry.id]: "" }));
									}}
								/>
							) : view.type === "categories" ? (
								<PromptCategoryManager
									categories={categories}
									isEditing={isEditing}
									onCreate={createCategory}
									onDelete={deleteCategory}
									onReorder={reorderCategory}
									onUpdate={updateCategory}
									prompts={promptEntries}
								/>
							) : (
								<WorkspaceIdle contents={contents} pack={selectedPack} />
							)}
						</div>
					</div>
				</SidebarContentLayout>
				<CreateEntryDialog
					busy={creatingEntry}
					categories={categories}
					onCreate={createEntry}
					onCreateCategory={createCategoryRecord}
					onOpenChange={setCreateEntryDialogOpen}
					open={createEntryDialogOpen}
				/>
				<CreatePackDialog
					error={createError}
					isCreating={isCreatingPack}
					onCancel={onCancelCreatePack}
					onCreate={onCreatePack}
					open={creatingPack}
				/>
			</>
		);
	},
);

const PromptPackNavigator: React.FC<{
	categories: PromptPackCategory[];
	creatingPack: boolean;
	deletingEntryID?: string;
	isLoading: boolean;
	navigatorKind: NavigatorKind;
	onBackToPacks: () => void;
	onCreateEntry: () => void;
	onNavigatorKindChange: (kind: NavigatorKind) => void;
	onOpenCategories: () => void;
	onOpenOverview: () => void;
	onRemoveEntry: (entry: PromptPackEntry) => void;
	onResetEntry: (entry: PromptPackEntry) => void;
	onSelectEntry: (entryID: string) => void;
	onSelectPack: (packID: string) => void;
	onStartCreatePack: () => void;
	packs: PromptPack[];
	promptEntries: PromptPackEntry[];
	resettingEntryID?: string;
	selectedPack?: PromptPack;
	skillEntries: PromptPackEntry[];
	view: WorkspaceView;
}> = ({
	categories,
	creatingPack,
	deletingEntryID,
	isLoading,
	navigatorKind,
	onBackToPacks,
	onCreateEntry,
	onNavigatorKindChange,
	onOpenCategories,
	onOpenOverview,
	onRemoveEntry,
	onResetEntry,
	onSelectEntry,
	onSelectPack,
	onStartCreatePack,
	packs,
	promptEntries,
	resettingEntryID,
	selectedPack,
	skillEntries,
	view,
}) => {
	const orderedSkills = orderEntries(skillEntries);
	const promptGroups = groupPromptEntries(categories, orderEntries(promptEntries));

	return (
		<nav
			aria-label="技能包管理导航"
			className="relative h-full min-h-0 w-full overflow-hidden bg-ide-sidebar text-ide-sidebar-foreground"
		>
			<SidebarScreenStack
				activeId={selectedPack ? "pack-detail" : "pack-library"}
				screenClassName="p-0"
				screens={[
					{
						id: "pack-library",
						level: 1,
						node: (
							<PackLibraryNavigator
								creatingPack={creatingPack}
								isLoading={isLoading}
								onSelectPack={onSelectPack}
								onStartCreatePack={onStartCreatePack}
								packs={packs}
							/>
						),
					},
					{
						id: "pack-detail",
						level: 2,
						node: selectedPack ? (
							<>
								<div className="shrink-0 px-2 pb-2 pt-3">
									<div className="flex items-center justify-between gap-2">
										<button
											type="button"
											className={sidebarToolbarIconButtonClassName}
											onClick={onBackToPacks}
											title="返回技能包列表"
											aria-label="返回技能包列表"
										>
											<ChevronLeft className="size-3.5" />
										</button>
										<div className="flex min-w-0 items-center justify-end gap-1">
											<CreateEntryButton onClick={onCreateEntry} />
										</div>
									</div>
								</div>

								<div className="shrink-0 px-2 pb-2">
									<button
										type="button"
										onClick={onOpenOverview}
										className={cn(
											"flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-xs transition-colors",
											view.type === "idle"
												? "bg-ide-list-active text-ide-list-active-foreground"
												: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
										)}
									>
										<LayoutDashboard className="size-3.5 shrink-0" />
										<span className="min-w-0 flex-1 truncate">技能包概览</span>
									</button>
								</div>

								<div
									role="tablist"
									aria-label="技能包内容类型"
									className="mx-2 mb-2 grid grid-cols-2 rounded-sm border border-border bg-ide-toolbar p-0.5"
								>
									<NavigatorKindTab
										active={navigatorKind === "skill"}
										count={skillEntries.length}
										label="Skill"
										onClick={() => onNavigatorKindChange("skill")}
									/>
									<NavigatorKindTab
										active={navigatorKind === "prompt"}
										count={promptEntries.length}
										label="提示词"
										onClick={() => onNavigatorKindChange("prompt")}
									/>
								</div>

								<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
									{navigatorKind === "skill" ? (
										<section>
											<EntryRows
												deletingEntryID={deletingEntryID}
												entries={orderedSkills}
												indented={false}
												onRemove={onRemoveEntry}
												onReset={onResetEntry}
												onSelect={onSelectEntry}
												resettingEntryID={resettingEntryID}
												selectedEntryID={view.type === "entry" ? view.entryID : undefined}
											/>
										</section>
									) : (
										<>
											<button
												type="button"
												onClick={onOpenCategories}
												className={cn(
													"mt-2 flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-xs text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
													view.type === "categories" &&
														"bg-ide-list-active text-ide-list-active-foreground",
												)}
											>
												<Settings2 className="size-3.5" />
												<span>分组管理</span>
											</button>
											{promptGroups.map((group) => (
												<NavigatorGroup
													key={group.id || "uncategorized"}
													icon={<Library className="size-4" />}
													label={`${group.label} · ${group.entries.length}`}
												>
													<EntryRows
														deletingEntryID={deletingEntryID}
														entries={group.entries}
														onRemove={onRemoveEntry}
														onReset={onResetEntry}
														onSelect={onSelectEntry}
														resettingEntryID={resettingEntryID}
														selectedEntryID={view.type === "entry" ? view.entryID : undefined}
													/>
												</NavigatorGroup>
											))}
										</>
									)}
								</div>
							</>
						) : null,
					},
				]}
			/>
		</nav>
	);
};

const PackLibraryNavigator: React.FC<{
	creatingPack: boolean;
	isLoading: boolean;
	onSelectPack: (packID: string) => void;
	onStartCreatePack: () => void;
	packs: PromptPack[];
}> = ({ creatingPack, isLoading, onSelectPack, onStartCreatePack, packs }) => {
	const orderedPacks = orderPacks(packs);

	return (
		<>
			<div className="shrink-0 border-b border-border px-3 py-3">
				<button
					type="button"
					className={cn(
						"flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-ide-sidebar-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground",
						creatingPack && "bg-ide-list-active text-ide-list-active-foreground",
					)}
					onClick={onStartCreatePack}
				>
					<PackagePlus className="size-4 shrink-0" />
					<span className="min-w-0 flex-1 truncate">新建技能包</span>
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
				<p className="mb-1 px-2 text-xs font-medium text-muted-foreground">技能包</p>
				{isLoading ? (
					<div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						<span>加载技能包</span>
					</div>
				) : orderedPacks.length === 0 ? (
					<p className="px-2 py-2 text-xs text-muted-foreground">暂无技能包</p>
				) : (
					<div className="space-y-0.5">
						{orderedPacks.map((pack) => (
							<button
								key={pack.id}
								type="button"
								aria-label={pack.name}
								className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-ide-sidebar-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground"
								onClick={() => onSelectPack(pack.id)}
							>
								<PackageOpen className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{pack.name}</span>
								<span className="shrink-0 text-2xs text-muted-foreground">
									{packSourceLabel(pack.source)}
								</span>
							</button>
						))}
					</div>
				)}
			</div>
		</>
	);
};

const CreateEntryButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
	<button
		type="button"
		className={sidebarToolbarIconButtonClassName}
		title="新建内容"
		aria-label="新建内容"
		onClick={onClick}
	>
		<FilePlus2 className="size-3.5" />
	</button>
);

const createEntryOptions: Array<{
	description: string;
	icon: React.ComponentType<{ className?: string }>;
	kind: PromptPackEntryKind;
	label: string;
}> = [
	{
		description: "编写可复用的提示词正文",
		icon: FileText,
		kind: "prompt",
		label: "提示词",
	},
	{
		description: "编写带说明的 Skill 内容",
		icon: BookOpenCheck,
		kind: "skill",
		label: "Skill",
	},
];

const CreateEntryDialog: React.FC<{
	busy: boolean;
	categories: PromptPackCategory[];
	onCreate: (kind: PromptPackEntryKind, categoryID?: string) => Promise<boolean>;
	onCreateCategory: (label: string) => Promise<PromptPackCategory | undefined>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}> = ({ busy, categories, onCreate, onCreateCategory, onOpenChange, open }) => {
	const [kind, setKind] = useState<PromptPackEntryKind>("prompt");
	const [categoryID, setCategoryID] = useState("");
	const [createdCategories, setCreatedCategories] = useState<PromptPackCategory[]>([]);
	const [newCategoryLabel, setNewCategoryLabel] = useState("");
	const [showCreateCategory, setShowCreateCategory] = useState(false);
	const [creatingCategory, setCreatingCategory] = useState(false);
	const availableCategories = useMemo(() => {
		const merged = new Map(categories.map((category) => [category.id, category]));
		for (const category of createdCategories) merged.set(category.id, category);
		return [...merged.values()].filter((category) => category.id).sort(compareCategories);
	}, [categories, createdCategories]);

	useEffect(() => {
		if (!open) return;
		setKind("prompt");
		setCreatedCategories([]);
		setNewCategoryLabel("");
		setShowCreateCategory(false);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		setCategoryID((current) =>
			availableCategories.some((category) => category.id === current)
				? current
				: (availableCategories[0]?.id ?? ""),
		);
	}, [availableCategories, open]);

	const selected = createEntryOptions.find((option) => option.kind === kind);
	const dialogBusy = busy || creatingCategory;
	const createSelectedCategory = async () => {
		const label = newCategoryLabel.trim();
		if (!label || creatingCategory) return;
		setCreatingCategory(true);
		try {
			const created = await onCreateCategory(label);
			if (!created) return;
			setCreatedCategories((current) => [...current, created]);
			setCategoryID(created.id);
			setNewCategoryLabel("");
			setShowCreateCategory(false);
		} finally {
			setCreatingCategory(false);
		}
	};

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!dialogBusy) onOpenChange(nextOpen);
			}}
		>
			<AlertDialogContent
				className="max-w-xl gap-5 p-5"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					document.getElementById(`prompt-pack-entry-${kind}`)?.focus();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>新建技能包内容</AlertDialogTitle>
					<AlertDialogDescription>选择一种内容类型开始创作。</AlertDialogDescription>
				</AlertDialogHeader>

				<div role="radiogroup" aria-label="技能包内容类型" className="grid gap-2 sm:grid-cols-2">
					{createEntryOptions.map((option) => {
						const OptionIcon = option.icon;
						const optionSelected = option.kind === kind;
						return (
							<button
								id={`prompt-pack-entry-${option.kind}`}
								key={option.kind}
								type="button"
								role="radio"
								aria-checked={optionSelected}
								tabIndex={optionSelected ? 0 : -1}
								disabled={dialogBusy}
								onClick={() => setKind(option.kind)}
								onKeyDown={(event) => {
									if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
										return;
									}
									event.preventDefault();
									const nextKind = option.kind === "prompt" ? "skill" : "prompt";
									setKind(nextKind);
									document.getElementById(`prompt-pack-entry-${nextKind}`)?.focus();
								}}
								className={cn(
									"grid min-h-24 grid-cols-[2.5rem_minmax(0,1fr)_1rem] items-start gap-3 rounded-sm border p-3 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60",
									optionSelected
										? "border-primary bg-ide-list-active shadow-sm"
										: "border-border bg-ide-editor hover:bg-ide-list-hover",
								)}
							>
								<span className="flex size-10 items-center justify-center rounded-sm bg-ide-toolbar text-primary">
									<OptionIcon className="size-5" />
								</span>
								<span className="min-w-0 pt-0.5">
									<span className="block text-sm font-semibold text-foreground">
										{option.label}
									</span>
									<span className="mt-1 block text-xs leading-5 text-muted-foreground">
										{option.description}
									</span>
								</span>
								<span
									className={cn(
										"mt-1 flex size-4 items-center justify-center rounded-full border",
										optionSelected
											? "border-primary bg-primary text-primary-foreground"
											: "border-border",
									)}
									aria-hidden="true"
								>
									{optionSelected ? <Check className="size-3" strokeWidth={2.5} /> : null}
								</span>
							</button>
						);
					})}
				</div>

				{kind === "prompt" ? (
					<div className="rounded-sm border border-border bg-muted/30 p-3">
						<div className="flex items-center justify-between gap-3">
							<Label htmlFor="prompt-pack-create-category">提示词分组</Label>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={dialogBusy}
								onClick={() => setShowCreateCategory((current) => !current)}
							>
								<Plus className="size-4" />
								<span>新建分组</span>
							</Button>
						</div>
						<Select
							value={categoryID}
							disabled={dialogBusy || availableCategories.length === 0}
							onValueChange={setCategoryID}
						>
							<SelectTrigger
								id="prompt-pack-create-category"
								className="mt-2 h-9 w-full bg-background px-3 text-sm"
							>
								<SelectValue placeholder="请先新建分组" />
							</SelectTrigger>
							<SelectContent>
								{availableCategories.map((category) => (
									<SelectItem key={category.id} value={category.id}>
										{category.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{showCreateCategory ? (
							<div className="mt-3 border-t border-border pt-3">
								<Label htmlFor="prompt-pack-create-category-name">新分组名称</Label>
								<div className="mt-2 flex gap-2">
									<Input
										id="prompt-pack-create-category-name"
										value={newCategoryLabel}
										disabled={dialogBusy}
										placeholder="例如：分镜"
										onChange={(event) => setNewCategoryLabel(event.target.value)}
										onKeyDown={(event) => {
											if (event.key !== "Enter") return;
											event.preventDefault();
											void createSelectedCategory();
										}}
									/>
									<Button
										type="button"
										variant="outline"
										disabled={dialogBusy || !newCategoryLabel.trim()}
										onClick={() => void createSelectedCategory()}
									>
										{creatingCategory ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<Plus className="size-4" />
										)}
										<span>{creatingCategory ? "创建中" : "创建并选择"}</span>
									</Button>
								</div>
							</div>
						) : null}
					</div>
				) : null}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={dialogBusy} className="rounded-sm">
						取消
					</AlertDialogCancel>
					<Button
						type="button"
						disabled={dialogBusy || (kind === "prompt" && !categoryID)}
						onClick={() => void onCreate(kind, kind === "prompt" ? categoryID : undefined)}
					>
						{busy ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
						<span>{busy ? "创建中" : `创建${selected?.label ?? "内容"}`}</span>
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

const NavigatorKindTab: React.FC<{
	active: boolean;
	count: number;
	label: string;
	onClick: () => void;
}> = ({ active, count, label, onClick }) => (
	<button
		type="button"
		role="tab"
		aria-label={`${label} ${count}`}
		aria-selected={active}
		className={cn(
			"flex h-7 items-center justify-center gap-1.5 rounded-sm px-2 text-xs text-muted-foreground transition-colors hover:text-foreground",
			active && "bg-ide-list-active text-ide-list-active-foreground shadow-sm",
		)}
		onClick={onClick}
	>
		<span>{label}</span>
		<span className="text-2xs opacity-70">{count}</span>
	</button>
);

const sidebarToolbarIconButtonClassName =
	"flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

const NavigatorGroup: React.FC<{
	children: React.ReactNode;
	icon: React.ReactNode;
	label: string;
}> = ({ children, icon, label }) => (
	<section className="mt-4">
		<div className="mb-1 flex h-7 items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
			<span className="text-muted-foreground">{icon}</span>
			<span className="flex-1">{label}</span>
		</div>
		{children}
	</section>
);

const EntryRows: React.FC<{
	deletingEntryID?: string;
	entries: PromptPackEntry[];
	indented?: boolean;
	onRemove: (entry: PromptPackEntry) => void;
	onReset: (entry: PromptPackEntry) => void;
	onSelect: (entryID: string) => void;
	resettingEntryID?: string;
	selectedEntryID?: string;
}> = ({
	deletingEntryID,
	entries,
	indented = true,
	onRemove,
	onReset,
	onSelect,
	resettingEntryID,
	selectedEntryID,
}) => {
	if (entries.length === 0) {
		return <p className="px-8 py-1 text-xs text-muted-foreground">暂无内容</p>;
	}

	return (
		<div className="space-y-0.5">
			{entries.map((entry) => (
				<div
					key={entry.id}
					className={cn(
						"group flex h-8 items-center rounded-md pr-1 hover:bg-ide-list-hover",
						selectedEntryID === entry.id && "bg-ide-list-active",
					)}
				>
					<button
						type="button"
						className={cn(
							"flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs text-foreground",
							indented && "pl-8",
						)}
						onClick={() => onSelect(entry.id)}
					>
						{entry.kind === "skill" ? (
							<BookOpenCheck className="size-3.5 shrink-0 text-muted-foreground" />
						) : (
							<FileText className="size-3.5 shrink-0 text-muted-foreground" />
						)}
						<span className="truncate">{entryDisplayName(entry)}</span>
					</button>
					{entryCanReset(entry) ? (
						<Button
							type="button"
							size="icon"
							variant="ghost"
							className="size-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
							aria-label={`恢复默认 ${entryDisplayName(entry)}`}
							disabled={resettingEntryID === entry.id}
							onClick={() => onReset(entry)}
						>
							{resettingEntryID === entry.id ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<RotateCcw className="size-3.5" />
							)}
						</Button>
					) : null}
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-6 shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
						aria-label={`删除 ${entryDisplayName(entry)}`}
						disabled={deletingEntryID === entry.id}
						onClick={() => onRemove(entry)}
					>
						{deletingEntryID === entry.id ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<Trash2 className="size-3.5" />
						)}
					</Button>
				</div>
			))}
		</div>
	);
};

const CreatePackDialog: React.FC<{
	error?: string;
	isCreating: boolean;
	onCancel: () => void;
	onCreate: (input: { description: string; name: string }) => Promise<void>;
	open: boolean;
}> = ({ error, isCreating, onCancel, onCreate, open }) => {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	useEffect(() => {
		if (!open) return;
		setName("");
		setDescription("");
	}, [open]);

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && !isCreating) onCancel();
			}}
		>
			<AlertDialogContent
				className="max-w-lg gap-5 p-5"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					document.getElementById("prompt-pack-name")?.focus();
				}}
			>
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						if (!name.trim() || isCreating) return;
						void onCreate({ description, name });
					}}
				>
					<AlertDialogHeader>
						<div className="flex items-center gap-2">
							<span className="flex size-8 items-center justify-center rounded-sm bg-ide-toolbar text-primary">
								<PackagePlus className="size-4" />
							</span>
							<AlertDialogTitle className="text-base">创建本地技能包</AlertDialogTitle>
						</div>
						<AlertDialogDescription className="text-sm leading-6">
							创建后即可在左侧添加 Skill 和提示词。Package ID 和初始版本由系统生成。
						</AlertDialogDescription>
					</AlertDialogHeader>

					{error ? (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}

					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="prompt-pack-name" className="text-sm font-medium text-foreground">
								名称
							</Label>
							<Input
								id="prompt-pack-name"
								autoFocus
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="例如：角色视觉风格"
								className="h-10 text-sm"
							/>
						</div>
						<div className="space-y-2">
							<Label
								htmlFor="prompt-pack-description"
								className="text-sm font-medium text-foreground"
							>
								简介
							</Label>
							<Textarea
								id="prompt-pack-description"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								placeholder="说明这个技能包适合解决什么问题（选填）"
								className="min-h-24 resize-y text-sm"
							/>
						</div>
					</div>

					<AlertDialogFooter className="border-t border-border pt-4">
						<Button type="button" variant="ghost" disabled={isCreating} onClick={onCancel}>
							取消
						</Button>
						<Button type="submit" disabled={isCreating || !name.trim()}>
							{isCreating ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<PackagePlus className="size-4" />
							)}
							<span>{isCreating ? "创建中" : "创建并开始编辑"}</span>
						</Button>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
};

const PromptCategorySortableCard: React.FC<{
	category: PromptPackCategory;
	children: React.ReactNode;
	disabled: boolean;
	isEditing: boolean;
	onKeyboardMove: (direction: -1 | 1) => void;
}> = ({ category, children, disabled, isEditing, onKeyboardMove }) => {
	const {
		attributes,
		isDragging,
		listeners,
		setActivatorNodeRef,
		setNodeRef: setDraggableNodeRef,
		transform,
	} = useDraggable({ disabled, id: category.id });
	const { isOver, setNodeRef: setDroppableNodeRef } = useDroppable({ disabled, id: category.id });

	return (
		<div
			ref={(node) => {
				setDraggableNodeRef(node);
				setDroppableNodeRef(node);
			}}
			style={
				transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
			}
			className={cn(
				"rounded-sm border border-border bg-card p-4 transition-[border-color,box-shadow,opacity]",
				isDragging && "relative z-10 opacity-60 shadow-lg",
				isOver && !isDragging && "border-primary ring-2 ring-primary/15",
			)}
		>
			<div className="flex items-start gap-3">
				{isEditing ? (
					<Button
						ref={setActivatorNodeRef}
						type="button"
						variant="ghost"
						size="icon"
						className="size-8 shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
						disabled={disabled}
						{...attributes}
						{...listeners}
						aria-label={`拖动分组 ${category.label}`}
						title={disabled ? "该分组不可调整顺序" : "拖动调整顺序"}
						onKeyDown={(event) => {
							if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
							event.preventDefault();
							onKeyboardMove(event.key === "ArrowUp" ? -1 : 1);
						}}
					>
						<GripVertical className="size-4" />
					</Button>
				) : null}
				<div className="min-w-0 flex-1">{children}</div>
			</div>
		</div>
	);
};

const PromptCategoryManager: React.FC<{
	categories: PromptPackCategory[];
	isEditing: boolean;
	onCreate: (label: string) => Promise<boolean>;
	onDelete: (category: PromptPackCategory, replacementCategoryID: string) => Promise<boolean>;
	onReorder: (category: PromptPackCategory, target: PromptPackCategory) => Promise<boolean>;
	onUpdate: (
		category: PromptPackCategory,
		input: { label: string; order: number },
	) => Promise<boolean>;
	prompts: PromptPackEntry[];
}> = ({ categories, isEditing, onCreate, onDelete, onReorder, onUpdate, prompts }) => {
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [deletingCategoryID, setDeletingCategoryID] = useState("");
	const [editingCategoryID, setEditingCategoryID] = useState("");
	const [editLabel, setEditLabel] = useState("");
	const [newLabel, setNewLabel] = useState("");
	const [replacements, setReplacements] = useState<Record<string, string>>({});
	const [busyID, setBusyID] = useState("");
	const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
	const categoriesByID = new Map(categories.map((category) => [category.id, category]));
	const orderedCategories = [
		...categoryOrder.flatMap((categoryID) => {
			const category = categoriesByID.get(categoryID);
			return category ? [category] : [];
		}),
		...categories
			.filter((category) => !categoryOrder.includes(category.id))
			.sort(compareCategories),
	];
	const deletingCategory = categories.find((category) => category.id === deletingCategoryID);
	const editingCategory = categories.find((category) => category.id === editingCategoryID);

	useEffect(() => {
		setCategoryOrder([...categories].sort(compareCategories).map((category) => category.id));
		setReplacements((current) =>
			Object.fromEntries(
				categories.map((category) => {
					const available = categories.filter((candidate) => candidate.id !== category.id);
					const currentValue = current[category.id];
					return [
						category.id,
						available.some((candidate) => candidate.id === currentValue)
							? currentValue
							: (available.find((candidate) => candidate.id === "extra")?.id ??
								available[0]?.id ??
								""),
					];
				}),
			),
		);
	}, [categories]);

	const create = async () => {
		const label = newLabel.trim();
		if (!label || busyID === "create") return;
		setBusyID("create");
		try {
			if (!(await onCreate(label))) return;
			setNewLabel("");
			setCreateDialogOpen(false);
		} finally {
			setBusyID("");
		}
	};

	const update = async () => {
		const label = editLabel.trim();
		if (!editingCategory || !label || label === editingCategory.label) return;
		setBusyID(editingCategory.id);
		try {
			if (!(await onUpdate(editingCategory, { label, order: editingCategory.order ?? 0 }))) return;
			setEditingCategoryID("");
			setEditLabel("");
		} finally {
			setBusyID("");
		}
	};

	const reorder = async (category: PromptPackCategory, target: PromptPackCategory) => {
		if (category.id === target.id || busyID) {
			return;
		}
		const previousOrder = orderedCategories.map((item) => item.id);
		const currentIndex = previousOrder.indexOf(category.id);
		const targetIndex = previousOrder.indexOf(target.id);
		if (currentIndex < 0 || targetIndex < 0) return;
		const nextOrder = [...previousOrder];
		const [movedCategoryID] = nextOrder.splice(currentIndex, 1);
		if (!movedCategoryID) return;
		nextOrder.splice(targetIndex, 0, movedCategoryID);
		setCategoryOrder(nextOrder);
		setBusyID(category.id);
		try {
			if (!(await onReorder(category, target))) setCategoryOrder(previousOrder);
		} finally {
			setBusyID("");
		}
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const category = categoriesByID.get(String(event.active.id));
		const target = event.over ? categoriesByID.get(String(event.over.id)) : undefined;
		if (category && target) void reorder(category, target);
	};

	const remove = async (category: PromptPackCategory) => {
		const replacementID = replacements[category.id];
		if (!replacementID || busyID === category.id) return;
		setBusyID(category.id);
		try {
			if (!(await onDelete(category, replacementID))) return;
			setDeletingCategoryID("");
		} finally {
			setBusyID("");
		}
	};

	return (
		<section className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-4xl px-10 py-8 xl:px-14">
				<div className="flex items-center justify-between gap-4">
					<h2 className="text-2xl font-semibold text-foreground">提示词分组管理</h2>
					{isEditing ? (
						<Button type="button" onClick={() => setCreateDialogOpen(true)}>
							<Plus className="size-4" />
							<span>新建分组</span>
						</Button>
					) : null}
				</div>

				<AlertDialog
					open={createDialogOpen}
					onOpenChange={(open) => {
						if (busyID === "create") return;
						setCreateDialogOpen(open);
						if (!open) setNewLabel("");
					}}
				>
					<AlertDialogContent className="max-w-md">
						<AlertDialogHeader>
							<AlertDialogTitle>新建提示词分组</AlertDialogTitle>
							<AlertDialogDescription>为当前技能包创建一个新的提示词分组。</AlertDialogDescription>
						</AlertDialogHeader>
						<form
							className="space-y-5"
							onSubmit={(event) => {
								event.preventDefault();
								void create();
							}}
						>
							<div className="space-y-2">
								<Label htmlFor="new-prompt-category">分组名称</Label>
								<Input
									id="new-prompt-category"
									value={newLabel}
									onChange={(event) => setNewLabel(event.target.value)}
									placeholder="例如：角色风格"
									autoFocus
								/>
							</div>
							<AlertDialogFooter>
								<AlertDialogCancel type="button" disabled={busyID === "create"}>
									取消
								</AlertDialogCancel>
								<Button type="submit" disabled={!newLabel.trim() || busyID === "create"}>
									{busyID === "create" ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Plus className="size-4" />
									)}
									<span>{busyID === "create" ? "创建中" : "创建分组"}</span>
								</Button>
							</AlertDialogFooter>
						</form>
					</AlertDialogContent>
				</AlertDialog>

				<AlertDialog
					open={Boolean(editingCategory)}
					onOpenChange={(open) => {
						if (editingCategory && busyID === editingCategory.id) return;
						if (!open) {
							setEditingCategoryID("");
							setEditLabel("");
						}
					}}
				>
					<AlertDialogContent className="max-w-md">
						<AlertDialogHeader>
							<AlertDialogTitle>修改分组名称</AlertDialogTitle>
							<AlertDialogDescription>
								修改“{editingCategory?.label}”在当前技能包中的显示名称。
							</AlertDialogDescription>
						</AlertDialogHeader>
						{editingCategory ? (
							<form
								className="space-y-5"
								onSubmit={(event) => {
									event.preventDefault();
									void update();
								}}
							>
								<div className="space-y-2">
									<Label htmlFor="edit-prompt-category">新的分组名称</Label>
									<Input
										id="edit-prompt-category"
										value={editLabel}
										onChange={(event) => setEditLabel(event.target.value)}
										autoFocus
									/>
								</div>
								<AlertDialogFooter>
									<AlertDialogCancel type="button" disabled={busyID === editingCategory.id}>
										取消
									</AlertDialogCancel>
									<Button
										type="submit"
										disabled={
											busyID === editingCategory.id ||
											!editLabel.trim() ||
											editLabel.trim() === editingCategory.label
										}
									>
										{busyID === editingCategory.id ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<Pencil className="size-4" />
										)}
										<span>{busyID === editingCategory.id ? "保存中" : "保存修改"}</span>
									</Button>
								</AlertDialogFooter>
							</form>
						) : null}
					</AlertDialogContent>
				</AlertDialog>

				<AlertDialog
					open={Boolean(deletingCategory)}
					onOpenChange={(open) => {
						if (deletingCategory && busyID === deletingCategory.id) return;
						if (!open) setDeletingCategoryID("");
					}}
				>
					<AlertDialogContent className="max-w-md">
						<AlertDialogHeader>
							<AlertDialogTitle>删除提示词分组？</AlertDialogTitle>
							<AlertDialogDescription>
								删除“{deletingCategory?.label}
								”后，该分组中的提示词将移动到所选分组。此操作无法撤销。
							</AlertDialogDescription>
						</AlertDialogHeader>
						{deletingCategory ? (
							<div className="space-y-5">
								<div className="space-y-2">
									<Label htmlFor="delete-category-replacement">删除后移动到</Label>
									<Select
										value={replacements[deletingCategory.id] ?? ""}
										onValueChange={(value) =>
											setReplacements((current) => ({
												...current,
												[deletingCategory.id]: value,
											}))
										}
										disabled={busyID === deletingCategory.id}
									>
										<SelectTrigger
											id="delete-category-replacement"
											className="h-9 w-full bg-background px-3 text-sm"
										>
											<SelectValue placeholder="选择迁移分组" />
										</SelectTrigger>
										<SelectContent>
											{categories
												.filter((candidate) => candidate.id !== deletingCategory.id)
												.map((candidate) => (
													<SelectItem key={candidate.id} value={candidate.id}>
														{candidate.label}
													</SelectItem>
												))}
										</SelectContent>
									</Select>
								</div>
								<AlertDialogFooter>
									<AlertDialogCancel type="button" disabled={busyID === deletingCategory.id}>
										取消
									</AlertDialogCancel>
									<Button
										type="button"
										variant="destructive"
										disabled={busyID === deletingCategory.id || !replacements[deletingCategory.id]}
										onClick={() => void remove(deletingCategory)}
									>
										{busyID === deletingCategory.id ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<Trash2 className="size-4" />
										)}
										<span>{busyID === deletingCategory.id ? "删除中" : "删除分组"}</span>
									</Button>
								</AlertDialogFooter>
							</div>
						) : null}
					</AlertDialogContent>
				</AlertDialog>

				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
					<div className="mt-4 space-y-3">
						{orderedCategories.length === 0 ? (
							<div className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
								当前技能包还没有分组，请先创建一个分组。
							</div>
						) : (
							orderedCategories.map((category, index) => {
								const promptCount = prompts.filter(
									(prompt) => promptCategoryID(prompt) === category.id,
								).length;
								const busy = busyID === category.id;
								const builtIn = category.source !== "user";
								return (
									<PromptCategorySortableCard
										key={category.id}
										category={category}
										disabled={!isEditing || Boolean(busyID)}
										isEditing={isEditing}
										onKeyboardMove={(direction) => {
											const target = orderedCategories[index + direction];
											if (target) void reorder(category, target);
										}}
									>
										<div className="flex items-center justify-between gap-4">
											<div className="min-w-0">
												<p className="truncate text-sm font-medium text-foreground">
													{category.label}
												</p>
												<p className="mt-1 text-xs text-muted-foreground">
													{builtIn ? "技能包内置 · " : ""}
													{promptCount} 条提示词
												</p>
											</div>
											<div className="flex shrink-0 items-center gap-2">
												{isEditing ? (
													<Button
														type="button"
														variant="outline"
														aria-label={`修改分组 ${category.label}`}
														disabled={busy}
														onClick={() => {
															setEditingCategoryID(category.id);
															setEditLabel(category.label);
														}}
													>
														<Pencil className="size-4" />
														<span>修改</span>
													</Button>
												) : null}
												{isEditing && categories.length > 1 ? (
													<Button
														type="button"
														variant="destructive"
														aria-label={`删除分组 ${category.label}`}
														disabled={busy}
														onClick={() => setDeletingCategoryID(category.id)}
													>
														<Trash2 className="size-4" />
														<span>删除</span>
													</Button>
												) : null}
											</div>
										</div>
									</PromptCategorySortableCard>
								);
							})
						)}
					</div>
				</DndContext>
			</div>
		</section>
	);
};

const WorkspaceStart: React.FC<{
	isLoading: boolean;
	onSelectPack: (packID: string) => void;
	packs: PromptPack[];
}> = ({ isLoading, onSelectPack, packs }) => {
	if (isLoading) return <LoadingState label="加载技能包" />;
	const orderedPacks = orderPacks(packs);

	return (
		<div className="h-full overflow-y-auto px-6 py-8 xl:px-8">
			<section aria-label="技能包列表" className="mx-auto w-full max-w-5xl">
				{orderedPacks.length > 0 ? (
					<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
						{orderedPacks.map((pack) => (
							<article
								key={pack.id}
								className="group flex min-h-40 flex-col rounded-md border border-border bg-card p-4 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-ring/60 hover:shadow-md focus-within:border-ring focus-within:shadow-md"
							>
								<div className="flex min-w-0 items-start gap-3">
									<span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-ide-toolbar text-muted-foreground transition-colors group-hover:text-primary">
										<PackageOpen className="size-5" />
									</span>
									<div className="min-w-0 flex-1">
										<div className="flex min-w-0 flex-wrap items-center gap-2">
											<h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
												{pack.name}
											</h3>
											<span className="shrink-0 rounded-sm border border-border bg-background px-1.5 py-0.5 text-2xs text-muted-foreground">
												{packSourceLabel(pack.source)}
											</span>
										</div>
										<p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
											{pack.description || pack.id}
										</p>
									</div>
								</div>
								<div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
									<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
										<span>{pack.skillCount ?? 0} Skills</span>
										<span>{pack.promptCount ?? 0} 提示词</span>
										<span>v{pack.version}</span>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="shrink-0"
										aria-label={`打开技能包 ${pack.name}`}
										onClick={() => onSelectPack(pack.id)}
									>
										<span>打开</span>
									</Button>
								</div>
							</article>
						))}
					</div>
				) : (
					<div className="py-16 text-center">
						<PackageOpen className="mx-auto size-8 text-muted-foreground" />
						<h3 className="mt-4 text-sm font-medium text-foreground">还没有技能包</h3>
						<p className="mt-1 text-xs text-muted-foreground">使用左侧的新建技能包入口开始制作。</p>
					</div>
				)}
			</section>
		</div>
	);
};

const WorkspaceIdle: React.FC<{ contents: PromptPackContents; pack: PromptPack }> = ({
	contents,
	pack,
}) => (
	<div className="h-full overflow-y-auto py-10">
		<div className="mx-auto w-full max-w-4xl">
			<div className="flex items-start gap-4 border-b border-border pb-6">
				<span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-ide-toolbar text-primary">
					<PackageOpen className="size-5" />
				</span>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="truncate text-2xl font-semibold text-foreground">{pack.name}</h2>
						<span className="rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
							{packSourceLabel(pack.source)}
						</span>
					</div>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						{pack.description || "这个技能包还没有简介。"}
					</p>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-6 py-7">
				<div className="border-b border-border pb-4">
					<p className="text-xs text-muted-foreground">Skills</p>
					<p className="mt-2 text-2xl font-semibold text-foreground">
						{contents.entries.filter((entry) => entry.kind === "skill").length}
					</p>
				</div>
				<div className="border-b border-border pb-4">
					<p className="text-xs text-muted-foreground">提示词</p>
					<p className="mt-2 text-2xl font-semibold text-foreground">
						{contents.entries.filter((entry) => entry.kind === "prompt").length}
					</p>
				</div>
			</div>
			<p className="text-sm text-muted-foreground">使用左侧顶部的新建图标添加内容。</p>
		</div>
	</div>
);

const LoadingState: React.FC<{ label: string }> = ({ label }) => (
	<div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
		<Loader2 className="size-4 animate-spin" />
		<span>{label}</span>
	</div>
);

const orderPacks = (packs: PromptPack[]) =>
	[...packs].sort((first, second) => {
		const firstTime = Date.parse(first.updatedAt || first.createdAt || "");
		const secondTime = Date.parse(second.updatedAt || second.createdAt || "");
		if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
			return secondTime - firstTime;
		}
		return first.name.localeCompare(second.name, "zh-CN");
	});

const orderEntries = (entries: PromptPackEntry[]) =>
	[...entries].sort((first, second) =>
		entryDisplayName(first).localeCompare(entryDisplayName(second), "zh-CN"),
	);

const promptCategoryID = (entry: PromptPackEntry) => {
	const value = entry.metadata?.category;
	return typeof value === "string" ? value.trim() : "";
};

const compareCategories = (first: PromptPackCategory, second: PromptPackCategory) => {
	const orderDifference = (first.order ?? 0) - (second.order ?? 0);
	return orderDifference || first.label.localeCompare(second.label, "zh-CN");
};

const packCategories = (
	categories: PromptPackCategory[],
	entries: PromptPackEntry[],
): PromptPackCategory[] => {
	const merged = new Map(categories.map((category) => [category.id, category]));
	for (const entry of entries) {
		if (entry.kind !== "prompt") continue;
		const id = promptCategoryID(entry);
		if (merged.has(id)) continue;
		merged.set(id, {
			id,
			label: id || "未分类",
			order: merged.size + 10_000,
			packId: entry.packId,
			source: entry.source,
		});
	}
	return [...merged.values()].sort(compareCategories);
};

const groupPromptEntries = (categories: PromptPackCategory[], entries: PromptPackEntry[]) => {
	const entriesByCategory = new Map<string, PromptPackEntry[]>();
	for (const entry of entries) {
		const categoryID = promptCategoryID(entry);
		entriesByCategory.set(categoryID, [...(entriesByCategory.get(categoryID) ?? []), entry]);
	}
	return categories.map((category) => ({
		id: category.id,
		label: category.label,
		entries: entriesByCategory.get(category.id) ?? [],
	}));
};

const entryDisplayName = (entry: PromptPackEntry) => entry.title || entry.name || entry.slug;

const entryCanReset = (entry: PromptPackEntry) =>
	entry.source !== "user" || Boolean(entry.overriddenFrom);

const packSourceLabel = (source: PromptPack["source"]) => {
	switch (source) {
		case "default":
			return "默认技能包";
		case "imported":
			return "已导入";
		case "local":
			return "本地创作";
	}
};

const errorMessage = (error: unknown) =>
	error instanceof Error && error.message.trim() ? error.message : "请稍后重试。";
