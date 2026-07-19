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
	ChevronLeft,
	Copy,
	FileText,
	GripVertical,
	Library,
	Loader2,
	PackageOpen,
	PackagePlus,
	Pencil,
	Plus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import type React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	getPromptPackContents,
	promptPackContentsKey,
	savePromptPackDraft,
	type PromptPack,
	type PromptPackCategory,
	type PromptPackEntry,
	type PromptPackEntryKind,
} from "@/domains/settings/api/packs";
import { isPromptPackContentCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
import {
	createDraftEntry,
	isPersistedPromptPackDraftDirty,
	moveDraftPromptToCategory,
	reorderDraftCategories,
	removeDraftCategory,
	removeDraftEntry,
	serializePromptPackDraft,
	updateDraftEntry,
	upsertDraftCategory,
	validatePromptPackDraft,
} from "@/domains/settings/lib/prompt-pack-draft";
import { usePromptPackDraftStore } from "@/domains/settings/stores/prompt-pack-drafts";
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
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
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
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";
import {
	PromptPackEntryEditor,
	promptPackEntryDraft,
	promptPackEntryUpdate,
} from "./PromptPackContentEditor";

type WorkspaceView = { type: "idle" } | { entryID: string; type: "entry" };

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
	onCopyPack: (pack: PromptPack) => void;
	onEditPackMetadata: (pack: PromptPack) => void;
	onPackEnabledChange: (pack: PromptPack, enabled: boolean) => Promise<void>;
	onSelectedPackChange: (packID?: string) => void;
	onStartCreatePack: () => void;
	onUninstallPack: (pack: PromptPack) => void;
	packs: PromptPack[];
	selectedPackID?: string;
	togglingPackID?: string;
}

export interface PromptPackWorkspaceHandle {
	beginEdit: () => boolean;
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
			onCopyPack,
			onEditPackMetadata,
			onPackEnabledChange,
			onSelectedPackChange,
			onStartCreatePack,
			onUninstallPack,
			packs,
			selectedPackID,
			togglingPackID,
		},
		ref,
	) {
		const toast = useToast();
		const { mutate: mutateGlobal } = useSWRConfig();
		const selectedPack = packs.find(
			(pack) => pack.id === selectedPackID && pack.source !== "imported",
		);
		const contentsKey =
			selectedPackID && selectedPack && !creatingPack
				? promptPackContentsKey(selectedPackID)
				: null;
		const {
			data: contents,
			isLoading: contentsLoading,
			mutate: mutateContents,
		} = useSWR(contentsKey, () => getPromptPackContents(selectedPackID ?? ""));
		const [view, setView] = useState<WorkspaceView>({ type: "idle" });
		const [navigatorKind, setNavigatorKind] = useState<NavigatorKind>("skill");
		const [createCategoryDialogOpen, setCreateCategoryDialogOpen] = useState(false);
		const [creatingEntryTarget, setCreatingEntryTarget] = useState("");
		const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
		const [navigatorWidth, setNavigatorWidth] = useWorkspaceSidebarWidth();
		const persistedDraft = usePromptPackDraftStore((state) =>
			selectedPackID ? state.draftsByPackId[selectedPackID] : undefined,
		);
		const startDraft = usePromptPackDraftStore((state) => state.startDraft);
		const updateWorking = usePromptPackDraftStore((state) => state.updateWorking);
		const removePersistedDraft = usePromptPackDraftStore((state) => state.removeDraft);

		const displayedContents = isEditing && persistedDraft ? persistedDraft.working : contents;
		const entries = useMemo(() => displayedContents?.entries ?? [], [displayedContents]);
		const categories = useMemo(
			() => packCategories(displayedContents?.categories ?? [], entries),
			[displayedContents?.categories, entries],
		);
		const skillEntries = entries.filter((entry) => entry.kind === "skill");
		const promptEntries = entries.filter((entry) => entry.kind === "prompt");
		const selectedPackReadonly = selectedPack?.source !== "local";
		const selectedEntry =
			view.type === "entry" ? entries.find((entry) => entry.id === view.entryID) : undefined;
		const draftDirty = Boolean(persistedDraft && isPersistedPromptPackDraftDirty(persistedDraft));

		useEffect(() => {
			if (navigatorKind === "skill" && skillEntries.length === 0 && promptEntries.length > 0) {
				setNavigatorKind("prompt");
			}
		}, [navigatorKind, promptEntries.length, skillEntries.length]);

		useEffect(() => {
			if (!isEditing) setDraftErrors({});
		}, [isEditing]);

		useEffect(() => {
			setView({ type: "idle" });
			setCreateCategoryDialogOpen(false);
			setNavigatorKind("skill");
		}, [selectedPackID]);

		useEffect(() => {
			if (!isEditing) setCreateCategoryDialogOpen(false);
		}, [isEditing]);

		useEffect(() => {
			if (selectedPackID && !selectedPack && !isLoading && !contentsLoading) {
				onSelectedPackChange(undefined);
			}
		}, [contentsLoading, isLoading, onSelectedPackChange, selectedPack, selectedPackID]);

		useEffect(() => {
			if (view.type === "entry" && contents && !selectedEntry) {
				const nextEntry = entries.find((entry) => entry.kind === navigatorKind) ?? entries[0];
				setView(nextEntry ? { entryID: nextEntry.id, type: "entry" } : { type: "idle" });
			}
		}, [contents, entries, navigatorKind, selectedEntry, view]);

		useEffect(() => {
			if (!contents || view.type !== "idle") return;
			const nextEntry = entries.find((entry) => entry.kind === navigatorKind) ?? entries[0];
			if (nextEntry) setView({ entryID: nextEntry.id, type: "entry" });
		}, [contents, entries, navigatorKind, view.type]);

		const openEntry = useCallback((entryID: string) => {
			setView({ entryID, type: "entry" });
		}, []);

		const saveAll = async () => {
			if (!isEditing || !persistedDraft || !selectedPack) return true;
			const issue = validatePromptPackDraft(persistedDraft.working);
			if (issue) {
				setDraftErrors(issue.entryId ? { [issue.entryId]: issue.message } : {});
				if (issue.entryId) setView({ entryID: issue.entryId, type: "entry" });
				toast.error("请完善技能包草稿", { description: issue.message });
				return false;
			}
			if (!draftDirty) {
				removePersistedDraft(selectedPack.id);
				return true;
			}
			setDraftErrors({});
			try {
				const saved = await savePromptPackDraft(
					selectedPack.id,
					serializePromptPackDraft(persistedDraft),
				);
				await mutateContents(saved, { revalidate: false });
				removePersistedDraft(selectedPack.id);
				await onChanged();
				await mutateGlobal(isPromptPackContentCacheKey);
				toast.success("技能包已保存", { description: "草稿中的全部修改已一次性生效。" });
				return true;
			} catch (error) {
				const conflict = apiErrorCode(error) === 409;
				toast.error(conflict ? "技能包内容已变化" : "技能包保存失败", {
					description: conflict
						? "服务器内容已被更新。草稿仍保留，请放弃旧草稿后重新编辑。"
						: errorMessage(error),
				});
				return false;
			}
		};

		const discard = () => {
			if (selectedPackID) removePersistedDraft(selectedPackID);
			setDraftErrors({});
		};

		const beginEdit = () => {
			if (!contents || selectedPack?.source !== "local") return false;
			if (persistedDraft && persistedDraft.baseRevision !== (contents.revision ?? "")) {
				toast.error("旧草稿无法继续编辑", {
					description: "服务器内容已变化，请先放弃旧草稿，再基于最新内容编辑。",
				});
				return false;
			}
			if (!persistedDraft) startDraft(contents);
			return true;
		};

		useImperativeHandle(
			ref,
			() => ({ beginEdit, discard, flush: saveAll, openEntry, save: saveAll }),
			[beginEdit, openEntry, saveAll],
		);

		const blockWhileEditing = () => {
			if (!isEditing) return false;
			toast.info("请先保存或取消编辑", { description: "当前操作会离开正在编辑的技能包。" });
			return true;
		};

		const selectPack = (packID: string) => {
			if (packs.some((pack) => pack.id === packID && pack.source === "imported")) return;
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
			const target = kind === "skill" ? "skill" : `prompt:${categoryID ?? ""}`;
			if (!isEditing || !selectedPack || !persistedDraft || creatingEntryTarget) return false;
			setCreatingEntryTarget(target);
			try {
				const slug = `${kind}-${globalThis.crypto.randomUUID()}`;
				const next = createDraftEntry(persistedDraft.working, kind, slug, categoryID);
				updateWorking(selectedPack.id, next);
				setView({ entryID: `${selectedPack.id}/${kind}/${slug}`, type: "entry" });
				toast.success(kind === "skill" ? "Skill 已创建" : "提示词已创建");
				return true;
			} catch (error) {
				toast.error("创建失败", { description: errorMessage(error) });
				return false;
			} finally {
				setCreatingEntryTarget("");
			}
		};

		const removeEntry = async (entry: PromptPackEntry) => {
			if (!selectedPack || !persistedDraft || !isEditing) return false;
			const next = removeDraftEntry(persistedDraft.working, entry.id);
			updateWorking(selectedPack.id, next);
			if (view.type === "entry" && view.entryID === entry.id) {
				const nextEntry =
					next.entries.find((candidate) => candidate.kind === navigatorKind) ?? next.entries[0];
				setView(nextEntry ? { entryID: nextEntry.id, type: "entry" } : { type: "idle" });
			}
			return true;
		};

		const confirmRemoveEntry = (entry: PromptPackEntry) => {
			if (!isEditing) return;
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
			if (!selectedPack || !persistedDraft || !contents || !isEditing) return false;
			const original = contents.entries.find((candidate) => candidate.id === entry.id);
			const next = original
				? {
						...persistedDraft.working,
						entries: persistedDraft.working.entries.map((candidate) =>
							candidate.id === entry.id ? structuredClone(original) : candidate,
						),
					}
				: removeDraftEntry(persistedDraft.working, entry.id);
			updateWorking(selectedPack.id, next);
			return true;
		};

		const confirmResetEntry = (entry: PromptPackEntry) => {
			if (!isEditing || !entryCanReset(entry)) return;
			void confirmDialog({
				title: "恢复内容默认？",
				description: `将撤销“${entryDisplayName(entry)}”的本地修改，并恢复技能包自带内容。`,
				confirmLabel: "恢复默认",
				confirmIcon: <RotateCcw className="size-4" />,
				variant: "default",
				onConfirm: () => resetEntry(entry),
			});
		};

		const movePromptToCategory = async (entry: PromptPackEntry, categoryID: string) => {
			if (!isEditing || entry.kind !== "prompt" || promptCategoryID(entry) === categoryID) {
				return false;
			}
			if (!selectedPack || !persistedDraft) return false;
			updateWorking(
				selectedPack.id,
				moveDraftPromptToCategory(persistedDraft.working, entry.id, categoryID),
			);
			setDraftErrors((current) => ({ ...current, [entry.id]: "" }));
			return true;
		};

		const createCategoryRecord = async (label: string): Promise<PromptPackCategory | undefined> => {
			if (!selectedPack || !persistedDraft || !isEditing) return undefined;
			const created: PromptPackCategory = {
				id: `category-${globalThis.crypto.randomUUID()}`,
				label: label.trim(),
				order: Math.max(-1, ...categories.map((category) => category.order ?? 0)) + 1,
				packId: selectedPack.id,
				source: "user",
			};
			updateWorking(selectedPack.id, upsertDraftCategory(persistedDraft.working, created));
			return created;
		};

		const createCategory = async (label: string) =>
			isEditing && Boolean(await createCategoryRecord(label));

		const updateCategory = async (
			category: PromptPackCategory,
			input: { label: string; order: number },
		) => {
			if (!selectedPack || !persistedDraft || !isEditing) return false;
			updateWorking(
				selectedPack.id,
				upsertDraftCategory(persistedDraft.working, { ...category, ...input }),
			);
			return true;
		};

		const deleteCategory = async (category: PromptPackCategory, replacementCategoryID: string) => {
			if (!selectedPack || !persistedDraft || !isEditing) return false;
			updateWorking(
				selectedPack.id,
				removeDraftCategory(persistedDraft.working, category.id, replacementCategoryID),
			);
			return true;
		};

		const reorderCategories = async (orderedCategoryIDs: string[]) => {
			if (!selectedPack || !persistedDraft || !isEditing) return false;
			updateWorking(
				selectedPack.id,
				reorderDraftCategories(persistedDraft.working, orderedCategoryIDs),
			);
			return true;
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
							creatingEntryTarget={creatingEntryTarget}
							isEditing={isEditing}
							isLoading={isLoading}
							navigatorKind={navigatorKind}
							onBackToPacks={() => selectPack("")}
							onNavigatorKindChange={(kind) => {
								setNavigatorKind(kind);
								if (view.type === "entry" && selectedEntry?.kind !== kind) {
									const nextEntry = entries.find((entry) => entry.kind === kind);
									setView(nextEntry ? { entryID: nextEntry.id, type: "entry" } : { type: "idle" });
								}
							}}
							onCreateCategory={() => setCreateCategoryDialogOpen(true)}
							onCreatePrompt={(categoryID) => void createEntry("prompt", categoryID)}
							onCreateSkill={() => void createEntry("skill")}
							onDeleteCategory={deleteCategory}
							onRemoveEntry={confirmRemoveEntry}
							onResetEntry={confirmResetEntry}
							onMovePrompt={movePromptToCategory}
							onReorderCategories={reorderCategories}
							onSelectEntry={(entryID) => setView({ entryID, type: "entry" })}
							onSelectPack={selectPack}
							onStartCreatePack={startCreatePack}
							onPackEnabledChange={onPackEnabledChange}
							onUninstallPack={onUninstallPack}
							onUpdateCategory={updateCategory}
							packs={packs}
							promptEntries={promptEntries}
							readOnly={selectedPackReadonly || !isEditing}
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
									onCopyPack={onCopyPack}
									onEditPackMetadata={onEditPackMetadata}
									onPackEnabledChange={onPackEnabledChange}
									onSelectPack={(packID) => void selectPack(packID)}
									onUninstallPack={onUninstallPack}
									packs={packs}
									togglingPackID={togglingPackID}
								/>
							) : contentsLoading || !selectedPack || !contents ? (
								<LoadingState label="加载技能包内容" />
							) : view.type === "entry" && selectedEntry ? (
								<PromptPackEntryEditor
									key={selectedEntry.id}
									draft={promptPackEntryDraft(selectedEntry)}
									entry={selectedEntry}
									error={draftErrors[selectedEntry.id]}
									isEditing={isEditing}
									onChange={(draft) => {
										if (!selectedPack || !persistedDraft || !isEditing) return;
										const update = promptPackEntryUpdate(selectedEntry, draft);
										updateWorking(
											selectedPack.id,
											updateDraftEntry(persistedDraft.working, selectedEntry.id, {
												body: update.body,
												description: update.description,
												metadata: update.metadata,
												...(selectedEntry.kind === "skill"
													? { title: update.name }
													: { name: update.name, title: update.name }),
											}),
										);
										setDraftErrors((current) => ({ ...current, [selectedEntry.id]: "" }));
									}}
								/>
							) : (
								<WorkspaceEmpty />
							)}
						</div>
					</div>
				</SidebarContentLayout>
				<CreateCategoryDialog
					onCreate={createCategory}
					onOpenChange={setCreateCategoryDialogOpen}
					open={createCategoryDialogOpen}
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
	creatingEntryTarget: string;
	creatingPack: boolean;
	deletingEntryID?: string;
	isEditing: boolean;
	isLoading: boolean;
	navigatorKind: NavigatorKind;
	onBackToPacks: () => void;
	onCreateCategory: () => void;
	onCreatePrompt: (categoryID: string) => void;
	onCreateSkill: () => void;
	onDeleteCategory: (
		category: PromptPackCategory,
		replacementCategoryID: string,
	) => Promise<boolean>;
	onNavigatorKindChange: (kind: NavigatorKind) => void;
	onMovePrompt: (entry: PromptPackEntry, categoryID: string) => Promise<boolean>;
	onReorderCategories: (orderedCategoryIDs: string[]) => Promise<boolean>;
	onRemoveEntry: (entry: PromptPackEntry) => void;
	onResetEntry: (entry: PromptPackEntry) => void;
	onSelectEntry: (entryID: string) => void;
	onSelectPack: (packID: string) => void;
	onStartCreatePack: () => void;
	onPackEnabledChange: (pack: PromptPack, enabled: boolean) => Promise<void>;
	onUninstallPack: (pack: PromptPack) => void;
	onUpdateCategory: (
		category: PromptPackCategory,
		input: { label: string; order: number },
	) => Promise<boolean>;
	packs: PromptPack[];
	promptEntries: PromptPackEntry[];
	readOnly: boolean;
	resettingEntryID?: string;
	updatingCategoryEntryID?: string;
	selectedPack?: PromptPack;
	skillEntries: PromptPackEntry[];
	view: WorkspaceView;
}> = ({
	categories,
	creatingEntryTarget,
	creatingPack,
	deletingEntryID,
	isEditing,
	isLoading,
	navigatorKind,
	onBackToPacks,
	onCreateCategory,
	onCreatePrompt,
	onCreateSkill,
	onDeleteCategory,
	onNavigatorKindChange,
	onMovePrompt,
	onReorderCategories,
	onRemoveEntry,
	onResetEntry,
	onSelectEntry,
	onSelectPack,
	onStartCreatePack,
	onPackEnabledChange,
	onUninstallPack,
	onUpdateCategory,
	packs,
	promptEntries,
	readOnly,
	resettingEntryID,
	updatingCategoryEntryID,
	selectedPack,
	skillEntries,
	view,
}) => {
	const orderedSkills = orderEntries(skillEntries);

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
								onPackEnabledChange={onPackEnabledChange}
								onSelectPack={onSelectPack}
								onStartCreatePack={onStartCreatePack}
								onUninstallPack={onUninstallPack}
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
										<div className="min-w-0" />
									</div>
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
												readOnly={readOnly}
												onRemove={onRemoveEntry}
												onReset={onResetEntry}
												onSelect={onSelectEntry}
												resettingEntryID={resettingEntryID}
												selectedEntryID={view.type === "entry" ? view.entryID : undefined}
											/>
										</section>
									) : (
										<PromptCategoryNavigatorGroups
											categories={categories}
											creatingEntryTarget={creatingEntryTarget}
											isEditing={isEditing && !readOnly}
											dragDisabled={Boolean(updatingCategoryEntryID)}
											onCreatePrompt={onCreatePrompt}
											onDelete={onDeleteCategory}
											onMovePrompt={onMovePrompt}
											onReorder={onReorderCategories}
											onUpdate={onUpdateCategory}
											prompts={promptEntries}
											renderEntries={(groupEntries, onKeyboardMove) => (
												<EntryRows
													dragDisabled={Boolean(updatingCategoryEntryID)}
													draggable={isEditing && !readOnly}
													deletingEntryID={deletingEntryID}
													entries={groupEntries}
													onRemove={onRemoveEntry}
													readOnly={readOnly}
													onReset={onResetEntry}
													onKeyboardMove={onKeyboardMove}
													onSelect={onSelectEntry}
													resettingEntryID={resettingEntryID}
													selectedEntryID={view.type === "entry" ? view.entryID : undefined}
												/>
											)}
										/>
									)}
								</div>

								{isEditing && !readOnly ? (
									<div className="shrink-0 border-t border-border px-2 py-2">
										<button
											type="button"
											className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-xs font-medium text-muted-foreground hover:bg-ide-list-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
											disabled={Boolean(creatingEntryTarget)}
											onClick={navigatorKind === "skill" ? onCreateSkill : onCreateCategory}
										>
											{navigatorKind === "skill" && creatingEntryTarget === "skill" ? (
												<Loader2 className="size-3.5 animate-spin" />
											) : (
												<Plus className="size-3.5" />
											)}
											<span>{navigatorKind === "skill" ? "新建 Skill" : "新建分组"}</span>
										</button>
									</div>
								) : null}
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
	onPackEnabledChange: (pack: PromptPack, enabled: boolean) => Promise<void>;
	onUninstallPack: (pack: PromptPack) => void;
	packs: PromptPack[];
}> = ({
	creatingPack,
	isLoading,
	onPackEnabledChange,
	onSelectPack,
	onStartCreatePack,
	onUninstallPack,
	packs,
}) => {
	const manageablePacks = orderPacks(packs.filter((pack) => pack.source !== "imported"));
	const importedPacks = orderPacks(packs.filter((pack) => pack.source === "imported"));

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
				) : manageablePacks.length === 0 ? (
					<p className="px-2 py-2 text-xs text-muted-foreground">暂无技能包</p>
				) : (
					<div className="space-y-0.5">
						{manageablePacks.map((pack) => (
							<PackLibraryRow
								key={pack.id}
								onPackEnabledChange={onPackEnabledChange}
								onSelectPack={onSelectPack}
								onUninstallPack={onUninstallPack}
								pack={pack}
							/>
						))}
					</div>
				)}
				{!isLoading && importedPacks.length > 0 ? (
					<section aria-label="已导入技能包导航" className="mt-5 border-t border-border pt-3">
						<p className="mb-1 px-2 text-xs font-medium text-muted-foreground">已导入</p>
						<div className="space-y-0.5">
							{importedPacks.map((pack) => (
								<PackLibraryRow
									key={pack.id}
									onPackEnabledChange={onPackEnabledChange}
									onSelectPack={onSelectPack}
									onUninstallPack={onUninstallPack}
									pack={pack}
								/>
							))}
						</div>
					</section>
				) : null}
			</div>
		</>
	);
};

const PackLibraryRow: React.FC<{
	onPackEnabledChange: (pack: PromptPack, enabled: boolean) => Promise<void>;
	onSelectPack: (packID: string) => void;
	onUninstallPack: (pack: PromptPack) => void;
	pack: PromptPack;
}> = ({ onPackEnabledChange, onSelectPack, onUninstallPack, pack }) => {
	const imported = pack.source === "imported";
	const row = (
		<button
			type="button"
			aria-label={pack.name}
			className={cn(
				"flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-ide-sidebar-foreground transition-colors",
				imported
					? "cursor-not-allowed opacity-60"
					: "hover:bg-ide-list-hover hover:text-foreground",
			)}
			disabled={imported}
			onClick={() => onSelectPack(pack.id)}
		>
			<PackageOpen className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate">{pack.name}</span>
			{imported ? null : (
				<span className="shrink-0 text-2xs text-muted-foreground">
					{packSourceLabel(pack.source)}
				</span>
			)}
		</button>
	);
	if (!imported) return row;
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div>{row}</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => void onPackEnabledChange(pack, !pack.enabled)}>
					{pack.enabled ? "停用技能包" : "启用技能包"}
				</ContextMenuItem>
				<ContextMenuItem
					className="text-destructive focus:bg-error-surface focus:text-error-foreground"
					onSelect={() => onUninstallPack(pack)}
				>
					卸载技能包
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};

const CreateCategoryDialog: React.FC<{
	onCreate: (label: string) => Promise<boolean>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}> = ({ onCreate, onOpenChange, open }) => {
	const [label, setLabel] = useState("");
	const [busy, setBusy] = useState(false);

	const create = async () => {
		const trimmedLabel = label.trim();
		if (!trimmedLabel || busy) return;
		setBusy(true);
		try {
			if (!(await onCreate(trimmedLabel))) return;
			setLabel("");
			onOpenChange(false);
		} finally {
			setBusy(false);
		}
	};

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (busy) return;
				onOpenChange(nextOpen);
				if (!nextOpen) setLabel("");
			}}
		>
			<AlertDialogContent className="max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>新建提示词分组</AlertDialogTitle>
					<AlertDialogDescription>输入分组名称后即可在侧边栏中添加提示词。</AlertDialogDescription>
				</AlertDialogHeader>
				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						void create();
					}}
				>
					<div className="space-y-2">
						<Label htmlFor="new-sidebar-prompt-category">分组名称</Label>
						<Input
							id="new-sidebar-prompt-category"
							autoFocus
							disabled={busy}
							placeholder="例如：角色风格"
							value={label}
							onChange={(event) => setLabel(event.target.value)}
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel type="button" disabled={busy}>
							取消
						</AlertDialogCancel>
						<Button type="submit" disabled={busy || !label.trim()}>
							{busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
							<span>{busy ? "创建中" : "创建分组"}</span>
						</Button>
					</AlertDialogFooter>
				</form>
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

const EntryRows: React.FC<{
	dragDisabled?: boolean;
	draggable?: boolean;
	deletingEntryID?: string;
	entries: PromptPackEntry[];
	indented?: boolean;
	onRemove: (entry: PromptPackEntry) => void;
	onReset: (entry: PromptPackEntry) => void;
	onKeyboardMove?: (entry: PromptPackEntry, direction: -1 | 1) => void;
	onSelect: (entryID: string) => void;
	readOnly: boolean;
	resettingEntryID?: string;
	selectedEntryID?: string;
}> = ({
	dragDisabled = false,
	draggable = false,
	deletingEntryID,
	entries,
	indented = true,
	onRemove,
	onReset,
	onKeyboardMove,
	onSelect,
	readOnly,
	resettingEntryID,
	selectedEntryID,
}) => {
	if (entries.length === 0) {
		return <p className="px-8 py-1 text-xs text-muted-foreground">暂无内容</p>;
	}

	return (
		<div className="space-y-0.5">
			{entries.map((entry) => (
				<EntryRow
					key={entry.id}
					disabled={dragDisabled}
					draggable={draggable && entry.kind === "prompt"}
					entry={entry}
					indented={indented}
					onKeyboardMove={onKeyboardMove}
					selected={selectedEntryID === entry.id}
					onSelect={onSelect}
				>
					{!readOnly && entryCanReset(entry) ? (
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
					{readOnly ? null : (
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
					)}
				</EntryRow>
			))}
		</div>
	);
};

const EntryRow: React.FC<{
	children: React.ReactNode;
	disabled: boolean;
	draggable: boolean;
	entry: PromptPackEntry;
	indented: boolean;
	onKeyboardMove?: (entry: PromptPackEntry, direction: -1 | 1) => void;
	onSelect: (entryID: string) => void;
	selected: boolean;
}> = ({ children, disabled, draggable, entry, indented, onKeyboardMove, onSelect, selected }) => {
	const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef, transform } =
		useDraggable({
			data: { entryID: entry.id, type: "prompt" },
			disabled: disabled || !draggable,
			id: `prompt-drag:${entry.id}`,
		});

	return (
		<div
			ref={setNodeRef}
			style={
				transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
			}
			className={cn(
				"group flex h-8 items-center rounded-md pr-1 hover:bg-ide-list-hover",
				selected && "bg-ide-list-active",
				isDragging && "relative z-20 bg-ide-list-hover opacity-60 shadow-md",
			)}
		>
			{draggable ? (
				<button
					ref={setActivatorNodeRef}
					type="button"
					className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50"
					disabled={disabled}
					{...attributes}
					{...listeners}
					aria-label={`拖动提示词 ${entryDisplayName(entry)}`}
					title="拖动到其他分组"
					onKeyDown={(event) => {
						if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
						event.preventDefault();
						onKeyboardMove?.(entry, event.key === "ArrowUp" ? -1 : 1);
					}}
				>
					<GripVertical className="size-3.5" />
				</button>
			) : null}
			<button
				type="button"
				className={cn(
					"flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs text-foreground",
					indented && !draggable && "pl-8",
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
			{children}
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

const PromptCategoryDropGroup: React.FC<{
	category: PromptPackCategory;
	children: React.ReactNode;
	disabled: boolean;
}> = ({ category, children, disabled }) => {
	const { isOver, setNodeRef } = useDroppable({
		data: { categoryID: category.id, type: "category" },
		disabled,
		id: `category-drop:${category.id}`,
	});

	return (
		<section
			aria-label={`提示词分组 ${category.label}`}
			ref={setNodeRef}
			className={cn(
				"mt-3 rounded-sm transition-[background-color,box-shadow]",
				isOver && "bg-ide-list-hover ring-1 ring-primary/30",
			)}
		>
			{children}
		</section>
	);
};

const PromptCategoryDragHandle: React.FC<{
	category: PromptPackCategory;
	disabled: boolean;
	onKeyboardMove: (direction: -1 | 1) => void;
}> = ({ category, disabled, onKeyboardMove }) => {
	const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
		data: { categoryID: category.id, type: "category" },
		disabled,
		id: `category-drag:${category.id}`,
	});
	return (
		<button
			ref={setNodeRef}
			type="button"
			aria-label={`拖动分组 ${category.label}`}
			title="拖拽移动分组"
			className={cn(
				"flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm hover:bg-ide-list-hover hover:text-foreground active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50",
				isDragging && "opacity-40",
			)}
			disabled={disabled}
			{...attributes}
			{...listeners}
			onKeyDown={(event) => {
				if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
				event.preventDefault();
				onKeyboardMove(event.key === "ArrowUp" ? -1 : 1);
			}}
		>
			<GripVertical className="size-3.5" />
		</button>
	);
};

const PromptCategoryNavigatorGroups: React.FC<{
	categories: PromptPackCategory[];
	creatingEntryTarget: string;
	dragDisabled: boolean;
	isEditing: boolean;
	onCreatePrompt: (categoryID: string) => void;
	onDelete: (category: PromptPackCategory, replacementCategoryID: string) => Promise<boolean>;
	onMovePrompt: (entry: PromptPackEntry, categoryID: string) => Promise<boolean>;
	onReorder: (orderedCategoryIDs: string[]) => Promise<boolean>;
	onUpdate: (
		category: PromptPackCategory,
		input: { label: string; order: number },
	) => Promise<boolean>;
	prompts: PromptPackEntry[];
	renderEntries: (
		entries: PromptPackEntry[],
		onKeyboardMove: (entry: PromptPackEntry, direction: -1 | 1) => void,
	) => React.ReactNode;
}> = ({
	categories,
	creatingEntryTarget,
	dragDisabled,
	isEditing,
	onCreatePrompt,
	onDelete,
	onMovePrompt,
	onReorder,
	onUpdate,
	prompts,
	renderEntries,
}) => {
	const [deletingCategoryID, setDeletingCategoryID] = useState("");
	const [editingCategoryID, setEditingCategoryID] = useState("");
	const [editLabel, setEditLabel] = useState("");
	const [replacements, setReplacements] = useState<Record<string, string>>({});
	const [busyID, setBusyID] = useState("");
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
	const orderedCategories = [...categories].sort(compareCategories);
	const deletingCategory = categories.find((category) => category.id === deletingCategoryID);
	const editingCategory = categories.find((category) => category.id === editingCategoryID);

	useEffect(() => {
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

	const handleDragEnd = (event: DragEndEvent) => {
		const activeData = event.active.data.current;
		const targetCategoryID = event.over?.data.current?.categoryID;
		if (typeof targetCategoryID !== "string") return;
		if (activeData?.type === "category" && typeof activeData.categoryID === "string") {
			const fromIndex = orderedCategories.findIndex(
				(category) => category.id === activeData.categoryID,
			);
			const toIndex = orderedCategories.findIndex((category) => category.id === targetCategoryID);
			if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
			const reordered = [...orderedCategories];
			const [moved] = reordered.splice(fromIndex, 1);
			reordered.splice(toIndex, 0, moved);
			void onReorder(reordered.map((category) => category.id));
			return;
		}
		if (activeData?.type === "prompt" && typeof activeData.entryID === "string") {
			const entry = prompts.find((candidate) => candidate.id === activeData.entryID);
			if (entry) void onMovePrompt(entry, targetCategoryID);
		}
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
		<>
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
				<div>
					{isEditing && orderedCategories.length > 1 ? (
						<p className="px-2 pt-2 text-2xs text-muted-foreground">拖拽移动分组</p>
					) : null}
					{orderedCategories.length === 0 ? (
						<p className="px-2 py-3 text-xs text-muted-foreground">当前还没有分组</p>
					) : (
						orderedCategories.map((category, index) => {
							const groupEntries = orderEntries(
								prompts.filter((prompt) => promptCategoryID(prompt) === category.id),
							);
							const busy = busyID === category.id;
							return (
								<PromptCategoryDropGroup
									key={category.id}
									category={category}
									disabled={!isEditing || dragDisabled || Boolean(busyID)}
								>
									<div className="mb-1 flex h-7 items-center gap-1 pr-1 text-xs font-medium text-muted-foreground">
										{isEditing ? (
											<PromptCategoryDragHandle
												category={category}
												disabled={busy || dragDisabled}
												onKeyboardMove={(direction) => {
													const target = orderedCategories[index + direction];
													if (!target) return;
													const reordered = [...orderedCategories];
													const [moved] = reordered.splice(index, 1);
													reordered.splice(index + direction, 0, moved);
													void onReorder(reordered.map((item) => item.id));
												}}
											/>
										) : null}
										<Library className="size-3.5 shrink-0" />
										<span className="min-w-0 flex-1 truncate">{category.label}</span>
										<div className="flex shrink-0 items-center gap-0.5">
											{isEditing ? (
												<button
													type="button"
													aria-label={`修改分组 ${category.label}`}
													className="flex size-6 items-center justify-center rounded-sm hover:bg-ide-list-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
													disabled={busy}
													onClick={() => {
														setEditingCategoryID(category.id);
														setEditLabel(category.label);
													}}
												>
													<Pencil className="size-3.5" />
												</button>
											) : null}
											{isEditing && categories.length > 1 ? (
												<button
													type="button"
													aria-label={`删除分组 ${category.label}`}
													className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-error-surface hover:text-error-foreground disabled:pointer-events-none disabled:opacity-50"
													disabled={busy}
													onClick={() => setDeletingCategoryID(category.id)}
												>
													<Trash2 className="size-3.5" />
												</button>
											) : null}
											{isEditing && category.id ? (
												<button
													type="button"
													aria-label={`在${category.label}分组中新建提示词`}
													className="flex size-6 items-center justify-center rounded-sm hover:bg-ide-list-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
													disabled={Boolean(creatingEntryTarget)}
													onClick={() => onCreatePrompt(category.id)}
												>
													{creatingEntryTarget === `prompt:${category.id}` ? (
														<Loader2 className="size-3.5 animate-spin" />
													) : (
														<Plus className="size-3.5" />
													)}
												</button>
											) : null}
										</div>
									</div>
									{renderEntries(groupEntries, (entry, direction) => {
										const target = orderedCategories[index + direction];
										if (target) void onMovePrompt(entry, target.id);
									})}
								</PromptCategoryDropGroup>
							);
						})
					)}
				</div>
			</DndContext>
		</>
	);
};

const WorkspaceStart: React.FC<{
	isLoading: boolean;
	onCopyPack: (pack: PromptPack) => void;
	onEditPackMetadata: (pack: PromptPack) => void;
	onPackEnabledChange: (pack: PromptPack, enabled: boolean) => Promise<void>;
	onSelectPack: (packID: string) => void;
	onUninstallPack: (pack: PromptPack) => void;
	packs: PromptPack[];
	togglingPackID?: string;
}> = ({
	isLoading,
	onCopyPack,
	onEditPackMetadata,
	onPackEnabledChange,
	onSelectPack,
	onUninstallPack,
	packs,
	togglingPackID,
}) => {
	if (isLoading) return <LoadingState label="加载技能包" />;
	const manageablePacks = orderPacks(packs.filter((pack) => pack.source !== "imported"));
	const importedPacks = orderPacks(packs.filter((pack) => pack.source === "imported"));

	return (
		<div className="h-full overflow-y-auto px-6 py-8 xl:px-8">
			<section aria-label="技能包列表" className="mx-auto w-full max-w-5xl">
				<section aria-label="默认和本地技能包">
					<h2 className="mb-3 text-sm font-semibold text-foreground">技能包</h2>
					{manageablePacks.length > 0 ? (
						<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
							{manageablePacks.map((pack) => (
								<article
									key={pack.id}
									className="group relative flex min-h-40 cursor-pointer flex-col rounded-md border border-border bg-card p-4 transition-[border-color,box-shadow] duration-150 hover:border-ring/60 hover:shadow-md focus-within:border-ring focus-within:shadow-md"
								>
									<button
										type="button"
										className="absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
										aria-label={`打开技能包 ${pack.name}`}
										onClick={() => onSelectPack(pack.id)}
									/>
									<div className="pointer-events-none relative z-10 flex min-w-0 items-start gap-3">
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
												{packCardDescription(pack)}
											</p>
										</div>
										<Switch
											checked={pack.enabled}
											className="pointer-events-auto mt-1 shrink-0"
											disabled={togglingPackID === pack.id}
											aria-label={`${pack.enabled ? "停用" : "启用"}技能包 ${pack.name}`}
											onCheckedChange={(enabled) => void onPackEnabledChange(pack, enabled)}
										/>
									</div>
									<div className="pointer-events-none relative z-10 mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
										<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
											<span>{pack.skillCount ?? 0} Skills</span>
											<span>{pack.promptCount ?? 0} 提示词</span>
											<span>v{pack.version}</span>
										</div>
										<div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
											<Button
												type="button"
												variant="outline"
												size="icon"
												className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
												aria-label={`复制技能包 ${pack.name}`}
												title={`复制 ${pack.name}`}
												onClick={() => onCopyPack(pack)}
											>
												<Copy className="size-3.5" />
											</Button>
											{pack.source === "local" ? (
												<Button
													type="button"
													variant="outline"
													size="icon"
													className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
													aria-label={`编辑技能包信息 ${pack.name}`}
													title={`编辑 ${pack.name}`}
													onClick={() => onEditPackMetadata(pack)}
												>
													<Pencil className="size-3.5" />
												</Button>
											) : null}
											{pack.source === "local" ? (
												<Button
													type="button"
													variant="outline"
													size="icon"
													className="size-7 shrink-0 text-destructive hover:bg-error-surface hover:text-error-foreground"
													aria-label={`卸载技能包 ${pack.name}`}
													title={`卸载 ${pack.name}`}
													onClick={() => onUninstallPack(pack)}
												>
													<Trash2 className="size-3.5" />
												</Button>
											) : null}
										</div>
									</div>
								</article>
							))}
						</div>
					) : (
						<div className="py-16 text-center">
							<PackageOpen className="mx-auto size-8 text-muted-foreground" />
							<h3 className="mt-4 text-sm font-medium text-foreground">还没有技能包</h3>
							<p className="mt-1 text-xs text-muted-foreground">
								使用左侧的新建技能包入口开始制作。
							</p>
						</div>
					)}
				</section>
				{importedPacks.length > 0 ? (
					<section aria-label="已导入技能包" className="mt-8 border-t border-border pt-6">
						<h2 className="mb-3 text-sm font-semibold text-foreground">已导入</h2>
						<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
							{importedPacks.map((pack) => (
								<article
									key={pack.id}
									className="relative flex min-h-40 flex-col rounded-md border border-border bg-card p-4"
								>
									<div className="flex min-w-0 items-start gap-3">
										<span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-ide-toolbar text-muted-foreground">
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
												{packCardDescription(pack)}
											</p>
										</div>
										<Switch
											checked={pack.enabled}
											className="mt-1 shrink-0"
											disabled={togglingPackID === pack.id}
											aria-label={`${pack.enabled ? "停用" : "启用"}技能包 ${pack.name}`}
											onCheckedChange={(enabled) => void onPackEnabledChange(pack, enabled)}
										/>
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
											size="icon"
											className="size-7 shrink-0 text-destructive hover:bg-error-surface hover:text-error-foreground"
											aria-label={`卸载技能包 ${pack.name}`}
											title={`卸载 ${pack.name}`}
											onClick={() => onUninstallPack(pack)}
										>
											<Trash2 className="size-3.5" />
										</Button>
									</div>
								</article>
							))}
						</div>
					</section>
				) : null}
			</section>
		</div>
	);
};

const WorkspaceEmpty: React.FC = () => (
	<div className="flex h-full items-center justify-center px-6 text-center">
		<div className="max-w-sm">
			<PackagePlus className="mx-auto size-8 text-muted-foreground" />
			<h2 className="mt-4 text-sm font-medium text-foreground">技能包中还没有内容</h2>
			<p className="mt-1 text-xs leading-5 text-muted-foreground">
				使用左侧顶部的新建按钮添加 Skill 或提示词。
			</p>
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
		const sourceDifference = packSourceOrder(first.source) - packSourceOrder(second.source);
		if (sourceDifference !== 0) return sourceDifference;
		const firstTime = Date.parse(first.updatedAt || first.createdAt || "");
		const secondTime = Date.parse(second.updatedAt || second.createdAt || "");
		if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
			return secondTime - firstTime;
		}
		return first.name.localeCompare(second.name, "zh-CN");
	});

const packSourceOrder = (source: PromptPack["source"]) => {
	switch (source) {
		case "default":
			return 0;
		case "local":
			return 1;
		case "imported":
			return 2;
	}
};

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

const packCardDescription = (pack: PromptPack) => {
	if (
		pack.source === "default" ||
		pack.description?.trim() === "Default agent skills, reusable prompt presets, and visual styles."
	) {
		return "这是系统内置的默认技能包，包含常用的 Skill 和提示词。";
	}
	const description = pack.description?.trim();
	if (description) return description;
	return pack.source === "imported" ? "这个导入技能包还没有描述。" : "这个技能包还没有描述。";
};

const errorMessage = (error: unknown) =>
	error instanceof Error && error.message.trim() ? error.message : "请稍后重试。";

const apiErrorCode = (error: unknown) => {
	if (!error || typeof error !== "object") return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "number" ? code : undefined;
};
