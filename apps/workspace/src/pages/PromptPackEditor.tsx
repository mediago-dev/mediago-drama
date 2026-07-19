import {
	Copy,
	Download,
	ExternalLink,
	FolderOpen,
	Loader2,
	PackageOpen,
	Pencil,
	Save,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR, { useSWRConfig } from "swr";
import {
	createPromptPack,
	exportPromptPack,
	forkPromptPack,
	getPromptPackContents,
	listPromptPacks,
	promptPackExportFileName,
	promptPacksKey,
	setPromptPackEnabled,
	type PromptPack,
	type PromptPackEntry,
	uninstallPromptPack,
	updatePromptPackMetadata,
} from "@/domains/settings/api/packs";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import {
	PromptPackWorkspace,
	type PromptPackWorkspaceHandle,
} from "@/domains/settings/components/debug/PromptPackWorkspace";
import { isPromptPackContentCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
import { isPersistedPromptPackDraftDirty } from "@/domains/settings/lib/prompt-pack-draft";
import { usePromptPackDraftStore } from "@/domains/settings/stores/prompt-pack-drafts";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
import { useToast } from "@/hooks/useToast";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
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
import { openExternalUrl, revealNativePath } from "@/shared/desktop/actions";

export interface CreateLocalPromptPackInput {
	description: string;
	name: string;
}

export const PromptPackEditor: React.FC = () => {
	const toast = useToast();
	const startWindowDrag = useDesktopWindowDrag();
	const { mutate: mutateGlobal } = useSWRConfig();
	const [searchParams, setSearchParams] = useSearchParams();
	const selectedPackID = searchParams.get("packId") || undefined;
	const {
		data: allPacks = [],
		isLoading: packsLoading,
		mutate: mutatePacks,
	} = useSWR(promptPacksKey, listPromptPacks);
	const packs = allPacks;
	const selectedPack = packs.find(
		(pack) => pack.id === selectedPackID && pack.source !== "imported",
	);
	const [creatingPack, setCreatingPack] = useState(searchParams.get("mode") === "create");
	const [createBusy, setCreateBusy] = useState(false);
	const [createError, setCreateError] = useState("");
	const [deletingPackID, setDeletingPackID] = useState<string>();
	const [exportingPackID, setExportingPackID] = useState<string>();
	const [togglingPackID, setTogglingPackID] = useState<string>();
	const [metadataPack, setMetadataPack] = useState<PromptPack>();
	const [metadataName, setMetadataName] = useState("");
	const [metadataDescription, setMetadataDescription] = useState("");
	const [metadataBusy, setMetadataBusy] = useState(false);
	const [metadataError, setMetadataError] = useState("");
	const [exportCompletion, setExportCompletion] = useState<PromptPackExportCompletion>();
	const [saveAsSourcePack, setSaveAsSourcePack] = useState<PromptPack>();
	const [saveAsName, setSaveAsName] = useState("");
	const [saveAsVersion, setSaveAsVersion] = useState("1.0.0");
	const [saveAsDescription, setSaveAsDescription] = useState("");
	const [saveAsShouldExport, setSaveAsShouldExport] = useState(false);
	const [saveAsBusy, setSaveAsBusy] = useState(false);
	const [saveAsError, setSaveAsError] = useState("");
	const [isEditing, setIsEditing] = useState(false);
	const [savingPack, setSavingPack] = useState(false);
	const workspaceRef = useRef<PromptPackWorkspaceHandle>(null);
	const persistedDraft = usePromptPackDraftStore((state) =>
		selectedPackID ? state.draftsByPackId[selectedPackID] : undefined,
	);
	const persistedDraftDirty = Boolean(
		persistedDraft && isPersistedPromptPackDraftDirty(persistedDraft),
	);
	const removePersistedDraft = usePromptPackDraftStore((state) => state.removeDraft);

	useEffect(() => {
		setIsEditing(false);
	}, [selectedPackID]);

	useEffect(() => {
		const desktop = window.mediagoDesktop;
		if (!desktop?.onPromptPackEditorCloseRequested) return;
		return desktop.onPromptPackEditorCloseRequested((request) => {
			void (async () => {
				try {
					await desktop.completePromptPackEditorClose({
						allow: true,
						requestId: request.requestId,
					});
				} catch (error) {
					toast.error("无法关闭技能包编辑器", { description: errorMessage(error) });
				}
			})();
		});
	}, [toast]);

	const refreshPromptData = async () => {
		await Promise.all([mutatePacks(), mutateGlobal(isPromptPackContentCacheKey)]);
	};

	const startEditing = () => {
		if (workspaceRef.current?.beginEdit()) setIsEditing(true);
	};

	const abandonDraft = () => {
		void confirmDialog({
			title: "放弃全部草稿修改？",
			description: "从点击编辑后产生的新增、修改、删除、分组和排序草稿都会被清除。",
			confirmLabel: "放弃草稿",
			confirmIcon: <Trash2 className="size-4" />,
			variant: "destructive",
			onConfirm: () => {
				workspaceRef.current?.discard();
				setIsEditing(false);
				return true;
			},
		});
	};

	const savePack = useCallback(async () => {
		setSavingPack(true);
		try {
			if ((await workspaceRef.current?.save()) === false) return;
			setIsEditing(false);
		} finally {
			setSavingPack(false);
		}
	}, []);

	useEffect(() => {
		const handleSaveShortcut = (event: KeyboardEvent) => {
			if (
				!isEditing ||
				!persistedDraftDirty ||
				savingPack ||
				!(event.metaKey || event.ctrlKey) ||
				event.key.toLowerCase() !== "s"
			)
				return;
			event.preventDefault();
			void savePack();
		};
		window.addEventListener("keydown", handleSaveShortcut);
		return () => window.removeEventListener("keydown", handleSaveShortcut);
	}, [isEditing, persistedDraftDirty, savePack, savingPack]);

	const selectPack = (packID?: string) => {
		setCreatingPack(false);
		setCreateError("");
		const next = new URLSearchParams(searchParams);
		next.delete("mode");
		if (packID) next.set("packId", packID);
		else next.delete("packId");
		setSearchParams(next, { replace: true });
	};

	const startCreatingPack = () => {
		setCreateError("");
		setCreatingPack(true);
		const next = new URLSearchParams(searchParams);
		next.set("mode", "create");
		setSearchParams(next, { replace: true });
	};

	const cancelCreatingPack = () => {
		setCreatingPack(false);
		setCreateError("");
		const next = new URLSearchParams(searchParams);
		next.delete("mode");
		setSearchParams(next, { replace: true });
	};

	const createPack = async ({ description, name }: CreateLocalPromptPackInput) => {
		setCreateBusy(true);
		setCreateError("");
		try {
			const pack = await createPromptPack({
				description: description.trim(),
				id: `local.${globalThis.crypto.randomUUID()}`,
				name: name.trim(),
				version: "1.0.0",
			});
			await refreshPromptData();
			selectPack(pack.id);
			toast.success("技能包草稿已创建", { description: pack.name });
		} catch (error) {
			setCreateError(errorMessage(error));
		} finally {
			setCreateBusy(false);
		}
	};

	const validatePackForExport = async (pack: PromptPack) => {
		const saved = await workspaceRef.current?.flush();
		if (saved === false) {
			toast.error("请完善当前内容", {
				description: "请先填写当前条目的名称，再导出技能包。",
			});
			return false;
		}
		try {
			const contents = await getPromptPackContents(pack.id);
			const validationIssue = findPromptPackExportIssue(contents.entries);
			if (validationIssue) {
				workspaceRef.current?.openEntry(validationIssue.entryID);
				toast.error("请完善技能包内容", { description: validationIssue.description });
				return false;
			}
			return true;
		} catch (error) {
			const notice = promptPackExportErrorNotice(error);
			toast.error(notice.title, { description: notice.description });
			return false;
		}
	};

	const downloadPack = async (pack: PromptPack) => {
		setExportingPackID(pack.id);
		try {
			const exported = await exportPromptPack(pack.id);
			const fileName = exported.fileName || promptPackExportFileName(pack);
			const saveResult = await savePromptPackBlob(exported.blob, fileName);
			if (saveResult.status === "canceled") return;
			const savedPath = saveResult.status === "saved" ? saveResult.path : undefined;
			setExportCompletion({
				fileName: fileNameFromPath(savedPath) || fileName,
				path: savedPath,
				status: saveResult.status,
			});
		} catch (error) {
			const notice = promptPackExportErrorNotice(error);
			toast.error(notice.title, { description: notice.description });
		} finally {
			setExportingPackID(undefined);
		}
	};

	const exportPack = async (pack: PromptPack) => {
		if (!(await validatePackForExport(pack))) return;
		await downloadPack(pack);
	};

	const openCopyPack = (pack: PromptPack) => {
		setSaveAsName(`${pack.name}副本`);
		setSaveAsVersion(pack.version || "1.0.0");
		setSaveAsDescription(pack.description || "");
		setSaveAsShouldExport(false);
		setSaveAsError("");
		setSaveAsSourcePack(pack);
	};

	const openMetadataEditor = (pack: PromptPack) => {
		if (pack.source !== "local") return;
		setMetadataName(pack.name);
		setMetadataDescription(pack.description || "");
		setMetadataError("");
		setMetadataPack(pack);
	};

	const savePackMetadata = async () => {
		if (!metadataPack || metadataPack.source !== "local" || !metadataName.trim()) return;
		setMetadataBusy(true);
		setMetadataError("");
		try {
			const updated = await updatePromptPackMetadata(metadataPack.id, {
				description: metadataDescription.trim(),
				name: metadataName.trim(),
			});
			await mutatePacks(
				(current) =>
					current?.map((pack) => (pack.id === updated.id ? { ...pack, ...updated } : pack)),
				{ revalidate: false },
			);
			await mutateGlobal(isPromptPackContentCacheKey);
			setMetadataPack(undefined);
			toast.success("技能包信息已更新", { description: updated.name });
		} catch (error) {
			setMetadataError(errorMessage(error));
		} finally {
			setMetadataBusy(false);
		}
	};

	const saveAsPack = async () => {
		if (!saveAsSourcePack || !saveAsName.trim() || !saveAsVersion.trim()) return;
		setSaveAsBusy(true);
		setSaveAsError("");
		let forked: PromptPack;
		try {
			forked = await forkPromptPack(saveAsSourcePack.id, {
				description: saveAsDescription.trim(),
				name: saveAsName.trim(),
				version: saveAsVersion.trim(),
			});
		} catch (error) {
			setSaveAsError(errorMessage(error));
			setSaveAsBusy(false);
			return;
		}

		selectPack(forked.id);
		setSaveAsSourcePack(undefined);
		try {
			await mutatePacks(
				(current) => [...(current ?? []).filter((pack) => pack.id !== forked.id), forked],
				{ revalidate: false },
			);
			await refreshPromptData();
		} catch (error) {
			toast.error("刷新技能包列表失败", { description: errorMessage(error) });
		}
		if (saveAsShouldExport) {
			await downloadPack(forked);
		} else {
			toast.success("技能包已复制", { description: forked.name });
		}
		setSaveAsBusy(false);
	};

	const deletePack = async (pack: PromptPack) => {
		setDeletingPackID(pack.id);
		try {
			await uninstallPromptPack(pack.id);
			removePersistedDraft(pack.id);
			selectPack(undefined);
			await mutatePacks((current) => current?.filter((candidate) => candidate.id !== pack.id), {
				revalidate: false,
			});
			await mutateGlobal(isPromptPackContentCacheKey);
			toast.success("技能包已删除", { description: pack.name });
			return true;
		} catch (error) {
			toast.error("删除失败", { description: errorMessage(error) });
			return false;
		} finally {
			setDeletingPackID(undefined);
		}
	};

	const confirmDeletePack = (pack: PromptPack) => {
		void confirmDialog({
			title: pack.source === "local" ? "删除本地技能包？" : "卸载技能包？",
			description:
				pack.source === "local"
					? `“${pack.name}”及其中的全部 Skill 和提示词将从本机永久删除。`
					: `“${pack.name}”及其中的 Skill 和提示词将从本机卸载。`,
			confirmLabel: pack.source === "local" ? "删除技能包" : "卸载技能包",
			confirmIcon: <Trash2 className="size-4" />,
			variant: "destructive",
			onConfirm: () => deletePack(pack),
		});
	};

	const togglePack = async (pack: PromptPack, enabled: boolean) => {
		setTogglingPackID(pack.id);
		try {
			await setPromptPackEnabled(pack.id, enabled);
			await refreshPromptData();
			toast.success(enabled ? "技能包已启用" : "技能包已停用", {
				description: pack.name,
			});
		} catch (error) {
			toast.error("更新失败", { description: errorMessage(error) });
		} finally {
			setTogglingPackID(undefined);
		}
	};

	const openPublishPage = async () => {
		const url = promptPackPublishURL();
		if (!url) {
			toast.error("未配置技能包发布地址", {
				description: "请设置 VITE_MEDIAGO_PROMPT_PACK_PUBLISH_URL 后重试。",
			});
			return;
		}
		await openExternalUrl(url);
		setExportCompletion(undefined);
	};

	const revealExportedPack = async () => {
		if (!exportCompletion?.path) return;
		try {
			await revealNativePath(exportCompletion.path);
		} catch (error) {
			toast.error("无法定位导出的技能包", { description: errorMessage(error) });
		}
	};

	return (
		<section className="h-screen min-h-0 overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<PromptPackWorkspace
				ref={workspaceRef}
				createError={createError}
				creatingPack={creatingPack}
				header={
					<header
						className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-ide-editor px-5"
						data-desktop-drag-region
						onPointerDown={startWindowDrag}
					>
						<div className="min-w-0" data-desktop-drag-region>
							<div className="flex items-center gap-2">
								<PackageOpen className="size-4 text-muted-foreground" />
								<h1 className="truncate text-sm font-semibold text-foreground">技能包管理</h1>
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								集中管理技能包及其中的 Skill 和提示词。
							</p>
						</div>
						{selectedPack && !creatingPack ? (
							<div className="flex items-center gap-2" data-desktop-no-drag>
								{isEditing ? (
									<>
										<Button
											type="button"
											variant="outline"
											disabled={savingPack}
											onClick={abandonDraft}
										>
											<Trash2 className="size-4" />
											<span>放弃草稿</span>
										</Button>
										<Button
											type="button"
											disabled={!persistedDraftDirty || savingPack}
											onClick={() => void savePack()}
										>
											{savingPack ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<Save className="size-4" />
											)}
											<span>保存</span>
										</Button>
									</>
								) : (
									<>
										{selectedPack.source === "local" && persistedDraftDirty ? (
											<>
												<span className="text-xs text-warning-foreground">发现未保存草稿</span>
												<Button type="button" variant="outline" onClick={startEditing}>
													<Pencil className="size-4" />
													<span>继续编辑</span>
												</Button>
												<Button type="button" variant="ghost" onClick={abandonDraft}>
													<Trash2 className="size-4" />
													<span>放弃草稿</span>
												</Button>
											</>
										) : selectedPack.source === "local" ? (
											<Button type="button" variant="outline" onClick={startEditing}>
												<Pencil className="size-4" />
												<span>编辑</span>
											</Button>
										) : null}
										{selectedPack.source === "local" ? (
											<Button
												type="button"
												variant="outline"
												disabled={
													exportingPackID === selectedPack.id ||
													deletingPackID === selectedPack.id ||
													saveAsBusy
												}
												onClick={() => void exportPack(selectedPack)}
											>
												{exportingPackID === selectedPack.id ? (
													<Loader2 className="size-4 animate-spin" />
												) : (
													<Download className="size-4" />
												)}
												<span>导出</span>
											</Button>
										) : null}
									</>
								)}
							</div>
						) : null}
					</header>
				}
				isCreatingPack={createBusy}
				isEditing={isEditing}
				isLoading={packsLoading}
				onCancelCreatePack={cancelCreatingPack}
				onChanged={refreshPromptData}
				onCreatePack={createPack}
				onCopyPack={openCopyPack}
				onEditPackMetadata={openMetadataEditor}
				onPackEnabledChange={togglePack}
				onSelectedPackChange={selectPack}
				onStartCreatePack={startCreatingPack}
				onUninstallPack={confirmDeletePack}
				packs={packs}
				selectedPackID={selectedPackID}
				togglingPackID={togglingPackID}
			/>
			<PromptPackExportCompleteDialog
				completion={exportCompletion}
				onOpenChange={(open) => {
					if (!open) setExportCompletion(undefined);
				}}
				onOpenPublishPage={() => void openPublishPage()}
				onReveal={() => void revealExportedPack()}
			/>
			<PromptPackSaveAsDialog
				busy={saveAsBusy}
				description={saveAsDescription}
				error={saveAsError}
				exportAfterCopy={saveAsShouldExport}
				name={saveAsName}
				onDescriptionChange={setSaveAsDescription}
				onNameChange={setSaveAsName}
				onOpenChange={(open) => {
					if (!open && !saveAsBusy) setSaveAsSourcePack(undefined);
				}}
				onSubmit={() => void saveAsPack()}
				onVersionChange={setSaveAsVersion}
				open={Boolean(saveAsSourcePack)}
				version={saveAsVersion}
			/>
			<PromptPackMetadataDialog
				busy={metadataBusy}
				description={metadataDescription}
				error={metadataError}
				name={metadataName}
				onDescriptionChange={setMetadataDescription}
				onNameChange={setMetadataName}
				onOpenChange={(open) => {
					if (!open && !metadataBusy) setMetadataPack(undefined);
				}}
				onSubmit={() => void savePackMetadata()}
				open={Boolean(metadataPack)}
			/>
		</section>
	);
};

const PromptPackMetadataDialog: React.FC<{
	busy: boolean;
	description: string;
	error: string;
	name: string;
	onDescriptionChange: (value: string) => void;
	onNameChange: (value: string) => void;
	onOpenChange: (open: boolean) => void;
	onSubmit: () => void;
	open: boolean;
}> = ({
	busy,
	description,
	error,
	name,
	onDescriptionChange,
	onNameChange,
	onOpenChange,
	onSubmit,
	open,
}) => (
	<AlertDialog open={open} onOpenChange={onOpenChange}>
		<AlertDialogContent>
			<form
				className="contents"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>编辑技能包信息</AlertDialogTitle>
					<AlertDialogDescription>修改列表卡片上展示的名称和描述。</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
				<div className="space-y-4 py-1">
					<div className="space-y-2">
						<Label htmlFor="edit-pack-name">名称</Label>
						<Input
							id="edit-pack-name"
							maxLength={160}
							value={name}
							onChange={(event) => onNameChange(event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="edit-pack-description">描述</Label>
						<Textarea
							id="edit-pack-description"
							rows={4}
							value={description}
							onChange={(event) => onDescriptionChange(event.target.value)}
						/>
					</div>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
					<Button type="submit" disabled={busy || !name.trim()}>
						{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
						<span>{busy ? "保存中" : "保存"}</span>
					</Button>
				</AlertDialogFooter>
			</form>
		</AlertDialogContent>
	</AlertDialog>
);

const PromptPackSaveAsDialog: React.FC<{
	busy: boolean;
	description: string;
	error: string;
	exportAfterCopy: boolean;
	name: string;
	onDescriptionChange: (value: string) => void;
	onNameChange: (value: string) => void;
	onOpenChange: (open: boolean) => void;
	onSubmit: () => void;
	onVersionChange: (value: string) => void;
	open: boolean;
	version: string;
}> = ({
	busy,
	description,
	error,
	exportAfterCopy,
	name,
	onDescriptionChange,
	onNameChange,
	onOpenChange,
	onSubmit,
	onVersionChange,
	open,
	version,
}) => (
	<AlertDialog open={open} onOpenChange={onOpenChange}>
		<AlertDialogContent>
			<form
				className="contents"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>{exportAfterCopy ? "另存为并导出" : "复制技能包"}</AlertDialogTitle>
					<AlertDialogDescription>
						{exportAfterCopy
							? "默认技能包将复制为具有独立 ID 的本地技能包，然后导出。"
							: "当前技能包将复制为具有独立 ID、可单独编辑的本地技能包。"}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
				<div className="space-y-4 py-1">
					<div className="space-y-2">
						<Label htmlFor="save-as-pack-name">名称</Label>
						<Input
							id="save-as-pack-name"
							value={name}
							onChange={(event) => onNameChange(event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="save-as-pack-version">版本</Label>
						<Input
							id="save-as-pack-version"
							value={version}
							onChange={(event) => onVersionChange(event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="save-as-pack-description">简介</Label>
						<Textarea
							id="save-as-pack-description"
							value={description}
							onChange={(event) => onDescriptionChange(event.target.value)}
						/>
					</div>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
					<Button type="submit" disabled={busy || !name.trim() || !version.trim()}>
						{busy ? (
							<Loader2 className="size-4 animate-spin" />
						) : exportAfterCopy ? (
							<Download className="size-4" />
						) : (
							<Copy className="size-4" />
						)}
						<span>{busy ? "复制中" : exportAfterCopy ? "创建并导出" : "复制"}</span>
					</Button>
				</AlertDialogFooter>
			</form>
		</AlertDialogContent>
	</AlertDialog>
);

interface PromptPackExportCompletion {
	fileName: string;
	path?: string;
	status: "download-started" | "saved";
}

const PromptPackExportCompleteDialog: React.FC<{
	completion?: PromptPackExportCompletion;
	onOpenChange: (open: boolean) => void;
	onOpenPublishPage: () => void;
	onReveal: () => void;
}> = ({ completion, onOpenChange, onOpenPublishPage, onReveal }) => (
	<AlertDialog open={Boolean(completion)} onOpenChange={onOpenChange}>
		<AlertDialogContent>
			<AlertDialogHeader>
				<AlertDialogTitle>技能包已导出</AlertDialogTitle>
				<AlertDialogDescription>
					{completion?.status === "download-started"
						? `“${completion.fileName}”下载已开始。保存后前往 MediaGo「我的技能包」上传，设置公开售卖或席位分发并提交审核。`
						: `“${completion?.fileName ?? "技能包"}”已保存。前往 MediaGo「我的技能包」上传，设置公开售卖或席位分发并提交审核。`}
				</AlertDialogDescription>
			</AlertDialogHeader>
			<AlertDialogFooter className="sm:items-center">
				{completion?.path ? (
					<Button type="button" variant="outline" onClick={onReveal}>
						<FolderOpen />
						<span>在文件夹中显示</span>
					</Button>
				) : null}
				<AlertDialogCancel>稍后处理</AlertDialogCancel>
				<Button type="button" onClick={onOpenPublishPage}>
					<ExternalLink />
					<span>前往发布</span>
				</Button>
			</AlertDialogFooter>
		</AlertDialogContent>
	</AlertDialog>
);

const downloadBlob = (blob: Blob, fileName: string) => {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(url);
};

type PromptPackSaveResult =
	| { status: "canceled" }
	| { path?: string; status: "saved" }
	| { status: "download-started" };

const savePromptPackBlob = async (blob: Blob, fileName: string): Promise<PromptPackSaveResult> => {
	const desktop = window.mediagoDesktop;
	if (desktop?.savePromptPack) {
		const result = await desktop.savePromptPack({
			data: new Uint8Array(await blob.arrayBuffer()),
			filename: fileName,
		});
		return result.canceled ? { status: "canceled" } : { path: result.path, status: "saved" };
	}

	downloadBlob(blob, fileName);
	return { status: "download-started" };
};

const fileNameFromPath = (path?: string) => path?.split(/[\\/]/).at(-1)?.trim();

const DEFAULT_PROMPT_PACK_PUBLISH_URL = "https://mediago.torchstellar.com/account#promptPacks";

const promptPackPublishURL = () => {
	const configured = import.meta.env.VITE_MEDIAGO_PROMPT_PACK_PUBLISH_URL?.trim();
	const candidate = configured || DEFAULT_PROMPT_PACK_PUBLISH_URL;
	try {
		const url = new URL(candidate);
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
};

const errorMessage = (error: unknown) =>
	error instanceof Error && error.message.trim() ? error.message : "请稍后重试。";

interface PromptPackExportIssue {
	description: string;
	entryID: string;
}

const findPromptPackExportIssue = (
	entries: PromptPackEntry[],
): PromptPackExportIssue | undefined => {
	for (const entry of entries) {
		const effectiveName =
			entry.kind === "skill" && entry.title?.trim() ? entry.title.trim() : entry.name.trim();
		const missingFields: string[] = [];
		if (!effectiveName) missingFields.push("名称");
		if (entry.kind === "skill" && !entry.description?.trim()) missingFields.push("用途描述");
		if (!entry.body.trim()) missingFields.push("正文内容");
		if (missingFields.length === 0) continue;

		const fallbackName = entry.kind === "skill" ? "未命名 Skill" : "未命名提示词";
		return {
			description: `“${effectiveName || fallbackName}”缺少${formatChineseList(missingFields)}，请补充后再导出。`,
			entryID: entry.id,
		};
	}
	return undefined;
};

const formatChineseList = (values: string[]) => {
	if (values.length <= 1) return values[0] ?? "必填内容";
	return `${values.slice(0, -1).join("、")}和${values.at(-1)}`;
};

const promptPackExportErrorNotice = (error: unknown) => {
	const message = errorMessage(error);
	if (/invalid prompt pack: skill [^\n]+ description is required/i.test(message)) {
		return {
			description: "当前 Skill 缺少用途描述，请补充后再导出。",
			title: "请完善技能包内容",
		};
	}
	if (/invalid prompt pack: skill [^\n]+ is incomplete/i.test(message)) {
		return {
			description: "当前 Skill 缺少名称或正文内容，请补充后再导出。",
			title: "请完善技能包内容",
		};
	}
	if (/invalid prompt pack: prompt [^\n]+ is incomplete/i.test(message)) {
		return {
			description: "当前提示词缺少名称或正文内容，请补充后再导出。",
			title: "请完善技能包内容",
		};
	}
	if (/invalid prompt pack/i.test(message)) {
		return {
			description: "技能包中仍有内容未填写完整，请检查后再导出。",
			title: "请完善技能包内容",
		};
	}
	return { description: message, title: "导出失败" };
};
