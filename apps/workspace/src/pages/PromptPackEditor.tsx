import { Download, ExternalLink, FolderOpen, Loader2, PackageOpen, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR, { useSWRConfig } from "swr";
import {
	createPromptPack,
	exportPromptPack,
	getPromptPackContents,
	listPromptPacks,
	promptPackExportFileName,
	promptPacksKey,
	type PromptPack,
	type PromptPackEntry,
	uninstallPromptPack,
} from "@/domains/settings/api/packs";
import {
	PromptPackWorkspace,
	type PromptPackWorkspaceHandle,
} from "@/domains/settings/components/debug/PromptPackWorkspace";
import { isPromptPackContentCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
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
	const packs = useMemo(() => allPacks.filter((pack) => pack.source === "local"), [allPacks]);
	const selectedPack = packs.find((pack) => pack.id === selectedPackID);
	const [creatingPack, setCreatingPack] = useState(searchParams.get("mode") === "create");
	const [createBusy, setCreateBusy] = useState(false);
	const [createError, setCreateError] = useState("");
	const [deletingPackID, setDeletingPackID] = useState<string>();
	const [exportingPackID, setExportingPackID] = useState<string>();
	const [exportCompletion, setExportCompletion] = useState<PromptPackExportCompletion>();
	const workspaceRef = useRef<PromptPackWorkspaceHandle>(null);

	useEffect(() => {
		const desktop = window.mediagoDesktop;
		if (!desktop?.onPromptPackEditorCloseRequested) return;
		return desktop.onPromptPackEditorCloseRequested((request) => {
			void (async () => {
				let allow = false;
				try {
					allow = (await workspaceRef.current?.flush()) !== false;
				} catch (error) {
					toast.error("关闭前保存失败", { description: errorMessage(error) });
				}
				try {
					await desktop.completePromptPackEditorClose({ allow, requestId: request.requestId });
				} catch (error) {
					toast.error("无法关闭词包编辑器", { description: errorMessage(error) });
				}
			})();
		});
	}, [toast]);

	const refreshPromptData = async () => {
		await Promise.all([mutatePacks(), mutateGlobal(isPromptPackContentCacheKey)]);
	};

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
		next.delete("packId");
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
			toast.success("词包草稿已创建", { description: pack.name });
		} catch (error) {
			setCreateError(errorMessage(error));
		} finally {
			setCreateBusy(false);
		}
	};

	const exportPack = async (pack: PromptPack) => {
		const saved = await workspaceRef.current?.flush();
		if (saved === false) {
			toast.error("请完善当前内容", {
				description: "请先填写当前条目的名称，再导出词包。",
			});
			return;
		}
		setExportingPackID(pack.id);
		try {
			const contents = await getPromptPackContents(pack.id);
			const validationIssue = findPromptPackExportIssue(contents.entries);
			if (validationIssue) {
				workspaceRef.current?.openEntry(validationIssue.entryID);
				toast.error("请完善词包内容", { description: validationIssue.description });
				return;
			}
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

	const deletePack = async (pack: PromptPack) => {
		setDeletingPackID(pack.id);
		try {
			await uninstallPromptPack(pack.id);
			selectPack(undefined);
			await mutatePacks((current) => current?.filter((candidate) => candidate.id !== pack.id), {
				revalidate: false,
			});
			await mutateGlobal(isPromptPackContentCacheKey);
			toast.success("词包已删除", { description: pack.name });
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
			title: "删除本地词包？",
			description: `“${pack.name}”及其中的全部 Skill 和提示词将从本机永久删除。`,
			confirmLabel: "删除词包",
			confirmIcon: <Trash2 className="size-4" />,
			variant: "destructive",
			onConfirm: () => deletePack(pack),
		});
	};

	const openPublishPage = async () => {
		const url = promptPackPublishURL();
		if (!url) {
			toast.error("未配置词包发布地址", {
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
			toast.error("无法定位导出的词包", { description: errorMessage(error) });
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
								<h1 className="truncate text-sm font-semibold text-foreground">提示词包编辑器</h1>
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								在本机制作内容，完成后导出 .mgpack。
							</p>
						</div>
						{selectedPack && !creatingPack ? (
							<div className="flex items-center gap-2" data-desktop-no-drag>
								<Button
									type="button"
									variant="outline"
									disabled={
										exportingPackID === selectedPack.id || deletingPackID === selectedPack.id
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
								<Button
									type="button"
									variant="outline"
									className="text-destructive hover:bg-error-surface hover:text-error-foreground"
									disabled={
										deletingPackID === selectedPack.id || exportingPackID === selectedPack.id
									}
									onClick={() => confirmDeletePack(selectedPack)}
								>
									{deletingPackID === selectedPack.id ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Trash2 className="size-4" />
									)}
									<span>删除词包</span>
								</Button>
							</div>
						) : null}
					</header>
				}
				isCreatingPack={createBusy}
				isLoading={packsLoading}
				onCancelCreatePack={cancelCreatingPack}
				onChanged={refreshPromptData}
				onCreatePack={createPack}
				onSelectedPackChange={selectPack}
				onStartCreatePack={startCreatingPack}
				packs={packs}
				selectedPackID={selectedPackID}
			/>
			<PromptPackExportCompleteDialog
				completion={exportCompletion}
				onOpenChange={(open) => {
					if (!open) setExportCompletion(undefined);
				}}
				onOpenPublishPage={() => void openPublishPage()}
				onReveal={() => void revealExportedPack()}
			/>
		</section>
	);
};

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
				<AlertDialogTitle>词包已导出</AlertDialogTitle>
				<AlertDialogDescription>
					{completion?.status === "download-started"
						? `“${completion.fileName}”下载已开始。保存后前往 MediaGo「我的词包」上传，设置公开售卖或席位分发并提交审核。`
						: `“${completion?.fileName ?? "词包"}”已保存。前往 MediaGo「我的词包」上传，设置公开售卖或席位分发并提交审核。`}
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

const DEFAULT_PROMPT_PACK_PUBLISH_URL = "https://mediago-api.torchstellar.com/account#promptPacks";

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
			title: "请完善词包内容",
		};
	}
	if (/invalid prompt pack: skill [^\n]+ is incomplete/i.test(message)) {
		return {
			description: "当前 Skill 缺少名称或正文内容，请补充后再导出。",
			title: "请完善词包内容",
		};
	}
	if (/invalid prompt pack: prompt [^\n]+ is incomplete/i.test(message)) {
		return {
			description: "当前提示词缺少名称或正文内容，请补充后再导出。",
			title: "请完善词包内容",
		};
	}
	if (/invalid prompt pack/i.test(message)) {
		return {
			description: "词包中仍有内容未填写完整，请检查后再导出。",
			title: "请完善词包内容",
		};
	}
	return { description: message, title: "导出失败" };
};
