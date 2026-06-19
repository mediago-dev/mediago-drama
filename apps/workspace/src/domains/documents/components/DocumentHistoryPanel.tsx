import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { GitCompare, History, Loader2, RotateCcw } from "lucide-react";
import useSWR from "swr";
import {
	type DocumentHistoryDiffLine,
	type DocumentHistoryItem,
	getWorkspaceDocumentHistory,
	getWorkspaceDocumentHistoryDiff,
	restoreWorkspaceDocumentHistoryVersion,
} from "@/domains/workspace/api/workspace";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import { Button } from "@/shared/components/ui/button";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/shared/components/ui/sheet";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";

interface DocumentHistoryPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId?: string | null;
	document: MarkdownDocument | null;
}

export const DocumentHistoryPanel: React.FC<DocumentHistoryPanelProps> = ({
	open,
	onOpenChange,
	projectId,
	document,
}) => {
	const toast = useToast();
	const [selectedHash, setSelectedHash] = useState<string | null>(null);
	const [restoringHash, setRestoringHash] = useState<string | null>(null);
	const documentId = document?.id ?? null;
	const historyKey =
		open && projectId && documentId ? ["document-history", projectId, documentId] : null;
	const {
		data: history,
		error: historyError,
		isLoading: isHistoryLoading,
		mutate: mutateHistory,
	} = useSWR(historyKey, () => getWorkspaceDocumentHistory(documentId ?? "", projectId, 50), {
		revalidateOnFocus: false,
	});
	const items = history?.items ?? [];

	useEffect(() => {
		if (!open) {
			setSelectedHash(null);
			return;
		}
		if (!items.length) {
			setSelectedHash(null);
			return;
		}
		if (!selectedHash || !items.some((item) => item.hash === selectedHash)) {
			setSelectedHash(items[0]?.hash ?? null);
		}
	}, [items, open, selectedHash]);

	useEffect(() => {
		setSelectedHash(null);
	}, [documentId]);

	const selectedItem = useMemo(
		() => items.find((item) => item.hash === selectedHash) ?? null,
		[items, selectedHash],
	);
	const diffKey =
		open && projectId && documentId && selectedHash
			? ["document-history-diff", projectId, documentId, selectedHash]
			: null;
	const {
		data: diffResponse,
		error: diffError,
		isLoading: isDiffLoading,
	} = useSWR(
		diffKey,
		() => getWorkspaceDocumentHistoryDiff(documentId ?? "", selectedHash ?? "", projectId),
		{ revalidateOnFocus: false },
	);
	const diff = diffResponse?.diff ?? null;

	const restoreSelectedVersion = async (hash: string) => {
		if (!projectId || !documentId || restoringHash) return false;
		setRestoringHash(hash);
		try {
			const response = await restoreWorkspaceDocumentHistoryVersion(documentId, hash, projectId);
			useDocumentsStore.getState().hydrateWorkspaceDocuments(response.state);
			await mutateHistory();
			toast.success("已恢复历史版本", { description: response.document.title });
			return true;
		} catch (error) {
			toast.error("恢复失败", { description: historyErrorMessage(error) });
			return false;
		} finally {
			setRestoringHash(null);
		}
	};

	const confirmRestoreSelectedVersion = (hash: string | null) => {
		if (!hash) return;
		void confirmDialog({
			title: "恢复这个历史版本？",
			description: "当前文档内容会被替换，恢复动作会写入一条新的变更记录。",
			confirmLabel: "恢复",
			onConfirm: () => restoreSelectedVersion(hash),
		});
	};

	return (
		<>
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent side="right" className="flex w-[min(92vw,760px)] flex-col p-0">
					<SheetHeader className="border-b border-border px-4 py-3">
						<div className="flex min-w-0 items-center gap-2">
							<div className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
								<History className="size-4" />
							</div>
							<div className="min-w-0">
								<SheetTitle>变更记录</SheetTitle>
								<SheetDescription className="truncate">
									{document?.title ?? "未选择文档"}
								</SheetDescription>
							</div>
						</div>
					</SheetHeader>

					<div className="flex min-h-0 flex-1 flex-col">
						<div className="max-h-56 overflow-y-auto border-b border-border p-2">
							{isHistoryLoading ? (
								<div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									<span>加载中</span>
								</div>
							) : historyError ? (
								<p className="px-2 py-3 text-xs text-destructive">变更记录加载失败。</p>
							) : items.length === 0 ? (
								<p className="px-2 py-3 text-xs text-muted-foreground">暂无变更记录。</p>
							) : (
								<div className="grid gap-1">
									{items.map((item) => (
										<button
											key={item.hash}
											type="button"
											className={cn(
												"grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border border-transparent px-2.5 py-2 text-left transition-colors hover:bg-ide-list-hover",
												item.hash === selectedHash &&
													"border-border bg-ide-list-hover text-foreground",
											)}
											onClick={() => setSelectedHash(item.hash)}
											aria-selected={item.hash === selectedHash}
										>
											<span className="min-w-0">
												<span className="block truncate text-xs font-medium text-foreground">
													{historySummary(item)}
												</span>
												<span className="mt-1 block truncate text-2xs text-muted-foreground">
													{historySourceLabel(item)} · {shortHash(item.hash)}
												</span>
											</span>
											<span className="text-2xs text-muted-foreground">
												{formatHistoryTime(item.createdAt)}
											</span>
										</button>
									))}
								</div>
							)}
						</div>

						<div className="flex min-h-0 flex-1 flex-col">
							<div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
								<div className="flex min-w-0 items-center gap-2">
									<GitCompare className="size-4 shrink-0 text-muted-foreground" />
									<p className="truncate text-xs font-medium text-foreground">
										{selectedItem ? historySummary(selectedItem) : "未选择版本"}
									</p>
								</div>
								<Button
									type="button"
									size="sm"
									variant="outline"
									className="h-7 shrink-0"
									disabled={!selectedHash || Boolean(restoringHash)}
									onClick={() => confirmRestoreSelectedVersion(selectedHash)}
								>
									{restoringHash === selectedHash ? (
										<Loader2 className="animate-spin" />
									) : (
										<RotateCcw />
									)}
									<span>恢复</span>
								</Button>
							</div>

							<div className="min-h-0 flex-1 overflow-auto bg-ide-editor">
								{isDiffLoading ? (
									<div className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
										<Loader2 className="size-4 animate-spin" />
										<span>加载中</span>
									</div>
								) : diffError ? (
									<p className="px-4 py-4 text-xs text-destructive">版本差异加载失败。</p>
								) : diff ? (
									<DiffLines lines={diff.lines} />
								) : (
									<p className="px-4 py-4 text-xs text-muted-foreground">选择一个版本查看差异。</p>
								)}
							</div>
						</div>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
};

const DiffLines: React.FC<{ lines: DocumentHistoryDiffLine[] }> = ({ lines }) => {
	if (lines.length === 0) {
		return <p className="px-4 py-4 text-xs text-muted-foreground">这个版本没有内容差异。</p>;
	}
	return (
		<div className="min-w-full py-2 font-mono text-2xs leading-5">
			{lines.map((line, index) => (
				<div
					key={`${index}-${line.type}-${line.oldLine ?? 0}-${line.newLine ?? 0}`}
					className={cn(
						"grid grid-cols-[3rem_3rem_minmax(0,1fr)] px-2",
						line.type === "added" && "bg-emerald-500/10 text-emerald-700",
						line.type === "removed" && "bg-red-500/10 text-red-700",
						line.type === "context" && "text-muted-foreground",
					)}
				>
					<span className="select-none pr-2 text-right text-muted-foreground/70">
						{line.oldLine ?? ""}
					</span>
					<span className="select-none pr-2 text-right text-muted-foreground/70">
						{line.newLine ?? ""}
					</span>
					<span className="min-w-0 whitespace-pre-wrap break-words">
						{linePrefix(line.type)}
						{line.text || " "}
					</span>
				</div>
			))}
		</div>
	);
};

const historySummary = (item: DocumentHistoryItem) =>
	item.summary || operationLabel(item.operation);

const operationLabel = (operation?: string) => {
	switch (operation) {
		case "workspace_save":
			return "文档更新";
		default:
			return operation?.trim() || "文档更新";
	}
};

const historySourceLabel = (item: DocumentHistoryItem) => {
	switch (item.source) {
		case "agent":
			return "agent";
		case "user":
			return "用户";
		case "system":
			return operationLabel(item.operation);
		default:
			return item.source?.trim() || operationLabel(item.operation);
	}
};

const formatHistoryTime = (value: string) => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
};

const shortHash = (hash: string) => hash.slice(0, 7);

const linePrefix = (type: DocumentHistoryDiffLine["type"]) => {
	switch (type) {
		case "added":
			return "+ ";
		case "removed":
			return "- ";
		default:
			return "  ";
	}
};

const historyErrorMessage = (error: unknown) => {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请稍后重试。";
};
