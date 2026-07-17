import {
	BookOpenCheck,
	Check,
	ChevronLeft,
	FileText,
	FilePlus2,
	FolderTree,
	LayoutDashboard,
	LayoutList,
	Library,
	Loader2,
	PackageOpen,
	PackagePlus,
	RotateCcw,
	Search,
	Trash2,
	X,
} from "lucide-react";
import type React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	getPromptPackContents,
	promptPackContentsKey,
	createPromptPackEntry,
	type PromptPack,
	type PromptPackContents,
	type PromptPackEntry,
	type PromptPackEntryKind,
	removePromptPackEntry,
	resetPromptPackEntry,
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

type WorkspaceView = { type: "idle" } | { entryID: string; type: "entry" };

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
		const [entrySearch, setEntrySearch] = useState("");
		const [packSearch, setPackSearch] = useState("");
		const [searchOpen, setSearchOpen] = useState(false);
		const [navigatorMode, setNavigatorMode] = useState<"flat" | "grouped">("grouped");
		const [createEntryDialogOpen, setCreateEntryDialogOpen] = useState(false);
		const [creatingEntry, setCreatingEntry] = useState(false);
		const [deletingEntryID, setDeletingEntryID] = useState<string>();
		const [resettingEntryID, setResettingEntryID] = useState<string>();
		const [drafts, setDrafts] = useState<Record<string, PromptPackEntryDraft>>({});
		const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
		const [navigatorWidth, setNavigatorWidth] = useWorkspaceSidebarWidth();

		const entries = useMemo(() => contents?.entries ?? [], [contents]);
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
			setEntrySearch("");
			setSearchOpen(false);
			setNavigatorMode("grouped");
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

		const createEntry = async (kind: PromptPackEntryKind): Promise<boolean> => {
			if (blockWhileEditing()) return false;
			if (!selectedPack || creatingEntry) return false;
			setCreatingEntry(true);
			try {
				const created = await createPromptPackEntry(selectedPack.id, {
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
							creatingPack={creatingPack}
							deletingEntryID={deletingEntryID}
							entrySearch={entrySearch}
							isLoading={isLoading}
							navigatorMode={navigatorMode}
							onBackToPacks={() => selectPack("")}
							onCancelCreatePack={onCancelCreatePack}
							onCreateEntry={() => setCreateEntryDialogOpen(true)}
							onEntrySearchChange={setEntrySearch}
							onNavigatorModeChange={setNavigatorMode}
							onOpenOverview={() => navigate({ type: "idle" })}
							onPackSearchChange={setPackSearch}
							onRemoveEntry={confirmRemoveEntry}
							onResetEntry={confirmResetEntry}
							onSelectEntry={(entryID) => navigate({ entryID, type: "entry" })}
							onSelectPack={selectPack}
							onStartCreatePack={startCreatePack}
							packs={packs}
							packSearch={packSearch}
							promptEntries={promptEntries}
							resettingEntryID={resettingEntryID}
							searchOpen={searchOpen}
							selectedPack={selectedPack}
							onSearchOpenChange={setSearchOpen}
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
									search={packSearch}
								/>
							) : contentsLoading || !selectedPack || !contents ? (
								<LoadingState label="加载技能包内容" />
							) : view.type === "entry" && selectedEntry ? (
								<PromptPackEntryEditor
									key={selectedEntry.id}
									draft={drafts[selectedEntry.id] ?? promptPackEntryDraft(selectedEntry)}
									entry={selectedEntry}
									error={draftErrors[selectedEntry.id]}
									isEditing={isEditing}
									onChange={(draft) => {
										setDrafts((current) => ({ ...current, [selectedEntry.id]: draft }));
										setDraftErrors((current) => ({ ...current, [selectedEntry.id]: "" }));
									}}
								/>
							) : (
								<WorkspaceIdle contents={contents} pack={selectedPack} />
							)}
						</div>
					</div>
				</SidebarContentLayout>
				<CreateEntryDialog
					busy={creatingEntry}
					onCreate={createEntry}
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
	creatingPack: boolean;
	deletingEntryID?: string;
	entrySearch: string;
	isLoading: boolean;
	navigatorMode: "flat" | "grouped";
	onBackToPacks: () => void;
	onCancelCreatePack: () => void;
	onCreateEntry: () => void;
	onEntrySearchChange: (value: string) => void;
	onNavigatorModeChange: (mode: "flat" | "grouped") => void;
	onOpenOverview: () => void;
	onPackSearchChange: (value: string) => void;
	onRemoveEntry: (entry: PromptPackEntry) => void;
	onResetEntry: (entry: PromptPackEntry) => void;
	onSearchOpenChange: (open: boolean) => void;
	onSelectEntry: (entryID: string) => void;
	onSelectPack: (packID: string) => void;
	onStartCreatePack: () => void;
	packSearch: string;
	packs: PromptPack[];
	promptEntries: PromptPackEntry[];
	resettingEntryID?: string;
	searchOpen: boolean;
	selectedPack?: PromptPack;
	skillEntries: PromptPackEntry[];
	view: WorkspaceView;
}> = ({
	creatingPack,
	deletingEntryID,
	entrySearch,
	isLoading,
	navigatorMode,
	onBackToPacks,
	onCancelCreatePack,
	onCreateEntry,
	onEntrySearchChange,
	onNavigatorModeChange,
	onOpenOverview,
	onPackSearchChange,
	onRemoveEntry,
	onResetEntry,
	onSearchOpenChange,
	onSelectEntry,
	onSelectPack,
	onStartCreatePack,
	packSearch,
	packs,
	promptEntries,
	resettingEntryID,
	searchOpen,
	selectedPack,
	skillEntries,
	view,
}) => {
	const filteredSkills = filterEntries(skillEntries, entrySearch);
	const filteredPrompts = filterEntries(promptEntries, entrySearch);
	const filteredEntries = filterEntries([...skillEntries, ...promptEntries], entrySearch);

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
								onCancelCreatePack={onCancelCreatePack}
								onSearchChange={onPackSearchChange}
								onSelectPack={onSelectPack}
								onStartCreatePack={onStartCreatePack}
								packs={packs}
								search={packSearch}
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
											<button
												type="button"
												className={cn(
													sidebarToolbarIconButtonClassName,
													searchOpen && "bg-ide-list-active text-ide-list-active-foreground",
												)}
												onClick={() => onSearchOpenChange(!searchOpen)}
												title="搜索当前技能包"
												aria-label="搜索当前技能包"
												aria-pressed={searchOpen}
											>
												<Search className="size-3.5" />
											</button>
											<CreateEntryButton onClick={onCreateEntry} />
											<NavigatorViewModeSwitcher
												mode={navigatorMode}
												onSelectMode={onNavigatorModeChange}
											/>
										</div>
									</div>
									{searchOpen ? (
										<div className="relative mt-2">
											<Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
											<Input
												autoFocus
												aria-label="搜索技能包内容"
												value={entrySearch}
												onChange={(event) => onEntrySearchChange(event.target.value)}
												placeholder="搜索 Skill 或提示词"
												className="h-8 pl-7 pr-7 text-xs"
											/>
											{entrySearch ? (
												<button
													type="button"
													className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-ide-list-hover hover:text-foreground"
													onClick={() => onEntrySearchChange("")}
													title="清除搜索"
													aria-label="清除搜索"
												>
													<X className="size-3" />
												</button>
											) : null}
										</div>
									) : null}
								</div>

								<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
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

									{navigatorMode === "grouped" ? (
										<>
											<NavigatorGroup icon={<BookOpenCheck className="size-4" />} label="Skills">
												<EntryRows
													deletingEntryID={deletingEntryID}
													entries={filteredSkills}
													onRemove={onRemoveEntry}
													onReset={onResetEntry}
													onSelect={onSelectEntry}
													resettingEntryID={resettingEntryID}
													selectedEntryID={view.type === "entry" ? view.entryID : undefined}
												/>
											</NavigatorGroup>
											<NavigatorGroup icon={<Library className="size-4" />} label="提示词">
												<EntryRows
													deletingEntryID={deletingEntryID}
													entries={filteredPrompts}
													onRemove={onRemoveEntry}
													onReset={onResetEntry}
													onSelect={onSelectEntry}
													resettingEntryID={resettingEntryID}
													selectedEntryID={view.type === "entry" ? view.entryID : undefined}
												/>
											</NavigatorGroup>
										</>
									) : (
										<section className="mt-3">
											<p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
												全部内容
											</p>
											<EntryRows
												deletingEntryID={deletingEntryID}
												entries={filteredEntries}
												indented={false}
												onRemove={onRemoveEntry}
												onReset={onResetEntry}
												onSelect={onSelectEntry}
												resettingEntryID={resettingEntryID}
												selectedEntryID={view.type === "entry" ? view.entryID : undefined}
											/>
										</section>
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
	onCancelCreatePack: () => void;
	onSearchChange: (value: string) => void;
	onSelectPack: (packID: string) => void;
	onStartCreatePack: () => void;
	packs: PromptPack[];
	search: string;
}> = ({
	creatingPack,
	isLoading,
	onCancelCreatePack,
	onSearchChange,
	onSelectPack,
	onStartCreatePack,
	packs,
	search,
}) => {
	const [searchOpen, setSearchOpen] = useState(false);
	const filteredPacks = filterPacks(packs, search);
	const startCreatePack = () => {
		setSearchOpen(false);
		onSearchChange("");
		onStartCreatePack();
	};
	const toggleSearch = () => {
		const nextOpen = !searchOpen;
		setSearchOpen(nextOpen);
		if (nextOpen && creatingPack) onCancelCreatePack();
		if (!nextOpen) onSearchChange("");
	};

	return (
		<>
			<div className="shrink-0 space-y-1 border-b border-border px-3 py-3">
				<button
					type="button"
					className={cn(
						"flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-ide-sidebar-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground",
						creatingPack && "bg-ide-list-active text-ide-list-active-foreground",
					)}
					onClick={startCreatePack}
				>
					<PackagePlus className="size-4 shrink-0" />
					<span className="min-w-0 flex-1 truncate">新建技能包</span>
				</button>
				<button
					type="button"
					className={cn(
						"flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground",
						searchOpen && "bg-ide-list-active text-ide-list-active-foreground",
					)}
					onClick={toggleSearch}
					aria-expanded={searchOpen}
				>
					<Search className="size-4 shrink-0" />
					<span className="min-w-0 flex-1 truncate">搜索技能包</span>
				</button>
				{searchOpen ? (
					<Input
						autoFocus
						aria-label="搜索技能包"
						value={search}
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder="输入技能包名称"
						className="h-8 text-xs"
					/>
				) : null}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
				<p className="mb-1 px-2 text-xs font-medium text-muted-foreground">技能包</p>
				{isLoading ? (
					<div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						<span>加载技能包</span>
					</div>
				) : filteredPacks.length === 0 ? (
					<p className="px-2 py-2 text-xs text-muted-foreground">
						{search ? "没有匹配的技能包" : "暂无技能包"}
					</p>
				) : (
					<div className="space-y-0.5">
						{filteredPacks.map((pack) => (
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
	onCreate: (kind: PromptPackEntryKind) => Promise<boolean>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}> = ({ busy, onCreate, onOpenChange, open }) => {
	const [kind, setKind] = useState<PromptPackEntryKind>("prompt");

	useEffect(() => {
		if (open) setKind("prompt");
	}, [open]);

	const selected = createEntryOptions.find((option) => option.kind === kind);

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!busy) onOpenChange(nextOpen);
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
								disabled={busy}
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

				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy} className="rounded-sm">
						取消
					</AlertDialogCancel>
					<Button type="button" disabled={busy} onClick={() => void onCreate(kind)}>
						{busy ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
						<span>{busy ? "创建中" : `创建${selected?.label ?? "内容"}`}</span>
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

const NavigatorViewModeSwitcher: React.FC<{
	mode: "flat" | "grouped";
	onSelectMode: (mode: "flat" | "grouped") => void;
}> = ({ mode, onSelectMode }) => (
	<div className="flex h-7 shrink-0 items-center rounded-sm border border-border bg-ide-toolbar p-0.5">
		<button
			type="button"
			className={cn(
				"flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground",
				mode === "flat" && "bg-ide-list-active text-ide-list-active-foreground",
			)}
			onClick={() => onSelectMode("flat")}
			title="列表视图"
			aria-label="列表视图"
			aria-pressed={mode === "flat"}
		>
			<LayoutList className="size-3.5" />
		</button>
		<button
			type="button"
			className={cn(
				"flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground",
				mode === "grouped" && "bg-ide-list-active text-ide-list-active-foreground",
			)}
			onClick={() => onSelectMode("grouped")}
			title="分组视图"
			aria-label="分组视图"
			aria-pressed={mode === "grouped"}
		>
			<FolderTree className="size-3.5" />
		</button>
	</div>
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

const WorkspaceStart: React.FC<{
	isLoading: boolean;
	onSelectPack: (packID: string) => void;
	packs: PromptPack[];
	search: string;
}> = ({ isLoading, onSelectPack, packs, search }) => {
	if (isLoading) return <LoadingState label="加载技能包" />;
	const filteredPacks = filterPacks(packs, search);

	return (
		<div className="h-full overflow-y-auto py-8">
			<div className="mx-auto w-full max-w-5xl">
				<div className="border-b border-border pb-5">
					<h2 className="text-xl font-semibold text-foreground">选择技能包</h2>
					<p className="mt-1 text-sm text-muted-foreground">全部已安装与本地创作</p>
				</div>

				{filteredPacks.length > 0 ? (
					<div className="mt-6 divide-y divide-border border-y border-border">
						{filteredPacks.map((pack) => (
							<div key={pack.id} className="flex min-h-24 items-center gap-4 px-4 py-4">
								<span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-ide-toolbar text-muted-foreground">
									<PackageOpen className="size-5" />
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<h3 className="truncate text-sm font-semibold text-foreground">{pack.name}</h3>
										<span className="rounded-sm border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">
											{packSourceLabel(pack.source)}
										</span>
									</div>
									<p className="mt-1 truncate text-xs text-muted-foreground">
										{pack.description || pack.id}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{pack.skillCount ?? 0} Skills · {pack.promptCount ?? 0} 提示词 · v{pack.version}
									</p>
								</div>
								<Button type="button" variant="outline" onClick={() => onSelectPack(pack.id)}>
									<PackageOpen className="size-4" />
									<span>打开</span>
								</Button>
							</div>
						))}
					</div>
				) : (
					<div className="py-16 text-center">
						<PackageOpen className="mx-auto size-8 text-muted-foreground" />
						<h3 className="mt-4 text-sm font-medium text-foreground">
							{search ? "没有匹配的技能包" : "还没有技能包"}
						</h3>
						<p className="mt-1 text-xs text-muted-foreground">
							{search ? "请调整左侧搜索条件。" : "使用左侧的新建技能包入口开始制作。"}
						</p>
					</div>
				)}
			</div>
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

const filterPacks = (packs: PromptPack[], search: string) => {
	const query = search.trim().toLocaleLowerCase();
	const ordered = orderPacks(packs);
	if (!query) return ordered;
	return ordered.filter((pack) =>
		[pack.name, pack.description, pack.id].some((value) =>
			value?.toLocaleLowerCase().includes(query),
		),
	);
};

const filterEntries = (entries: PromptPackEntry[], search: string) => {
	const query = search.trim().toLocaleLowerCase();
	const ordered = [...entries].sort((first, second) =>
		entryDisplayName(first).localeCompare(entryDisplayName(second), "zh-CN"),
	);
	if (!query) return ordered;
	return ordered.filter((entry) =>
		[entryDisplayName(entry), entry.slug, entry.description].some((value) =>
			value?.toLocaleLowerCase().includes(query),
		),
	);
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
