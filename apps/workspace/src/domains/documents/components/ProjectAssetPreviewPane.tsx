import { Check, Download, Ellipsis, Loader2, PencilLine, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { updateProjectAsset } from "@/domains/workspace/api/project-assets";
import { useDocumentsStore } from "@/domains/documents/stores";
import { downloadLocalFileWithDirectoryPicker } from "@/domains/workspace/lib/downloads";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import {
	assetKindLabel,
	assetPreviewIcon,
	errorMessage,
	fetchTextAsset,
	formatBytes,
	projectAssetContentURL,
} from "./project-asset-preview.helpers";
import { AssetPreviewBody } from "./project-asset-preview.components";

interface ProjectAssetPreviewPaneProps {
	asset: ProjectAsset;
	projectId?: string | null;
}

export const ProjectAssetPreviewPane: React.FC<ProjectAssetPreviewPaneProps> = ({
	asset,
	projectId,
}) => {
	const toast = useToast();
	const [draftFilename, setDraftFilename] = useState(asset.filename);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [isDownloading, setIsDownloading] = useState(false);
	const [isRenaming, setIsRenaming] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const source = useMemo(() => projectAssetContentURL(asset, projectId), [asset, projectId]);
	const textKey = asset.kind === "text" && source ? source : null;
	const sourceError = useMemo(
		() => (asset.kind === "text" && !source ? new Error("素材地址缺失。") : null),
		[asset.kind, source],
	);
	const {
		data: text,
		error,
		isLoading,
	} = useSWR(textKey, fetchTextAsset, {
		revalidateOnFocus: false,
	});
	const Icon = useMemo(() => assetPreviewIcon(asset.kind), [asset.kind]);
	const isRenamed = draftFilename.trim() !== asset.filename;
	useEffect(() => {
		setDraftFilename(asset.filename);
		setDetailsOpen(false);
		setIsRenaming(false);
	}, [asset.filename, asset.id]);

	const saveFilename = async () => {
		if (!projectId || !isRenamed || isSaving) return false;
		const filename = draftFilename.trim();
		if (!filename) {
			toast.error("文件名不能为空");
			return false;
		}

		setIsSaving(true);
		try {
			// The server may canonicalize the filename (safe characters, restored
			// extension), so the returned asset — not the draft — is authoritative.
			const updated = await updateProjectAsset(projectId, asset.id, { filename });
			useDocumentsStore.getState().applyAssetUpdate(updated);
			setDraftFilename(updated.filename);
			setIsRenaming(false);
			toast.success("素材已重命名", { description: updated.filename });
			return true;
		} catch (err) {
			const message = errorMessage(err, "重命名失败。");
			toast.error("重命名失败", { description: message });
			return false;
		} finally {
			setIsSaving(false);
		}
	};

	const cancelRename = () => {
		setDraftFilename(asset.filename);
		setIsRenaming(false);
	};

	const handleDetailsOpenChange = (open: boolean) => {
		setDetailsOpen(open);
		if (!open) cancelRename();
	};

	const downloadAsset = async () => {
		if (isDownloading) return;
		setIsDownloading(true);
		try {
			const saved = await downloadLocalFileWithDirectoryPicker({
				fallback: asset.filename,
				kind: asset.kind,
				mimeType: asset.mimeType,
				sourcePath: asset.downloadPath,
				title: asset.filename,
			});
			if (!saved) return;
			toast.success("文件已下载", { description: saved.path });
		} catch (err) {
			const message = errorMessage(err, "文件复制到下载位置失败。");
			toast.error("下载失败", { description: message });
		} finally {
			setIsDownloading(false);
		}
	};

	return (
		<main className="h-full min-h-0 flex-1 overflow-hidden bg-ide-editor">
			<div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-4 px-4 py-4">
				<header className="shrink-0">
					<div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
							<Icon className="size-4" />
						</div>
						<div className="min-w-0">
							<h2
								className="truncate text-base font-semibold leading-tight text-foreground sm:text-lg"
								title={asset.filename}
							>
								{asset.filename}
							</h2>
						</div>
						<Popover open={detailsOpen} onOpenChange={handleDetailsOpenChange}>
							<PopoverTrigger asChild>
								<Button
									type="button"
									size="icon"
									variant="outline"
									aria-label="更多文件操作"
									title="文档详情"
								>
									<Ellipsis />
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="end"
								className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden p-0"
							>
								<div className="p-4">
									<h3 className="text-sm font-semibold text-foreground">文档详情</h3>
									<dl className="mt-3 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
										<dt className="pt-1.5 text-muted-foreground">文件名</dt>
										<dd className="min-w-0 text-foreground">
											{isRenaming ? (
												<div className="flex min-w-0 items-center gap-1">
													<Input
														autoFocus
														value={draftFilename}
														className="h-7 min-w-0 flex-1 rounded-sm text-xs"
														aria-label="重命名文件"
														onChange={(event) => setDraftFilename(event.target.value)}
														onKeyDown={(event) => {
															if (event.key === "Enter") {
																event.preventDefault();
																void saveFilename();
															}
															if (event.key === "Escape") {
																event.preventDefault();
																event.stopPropagation();
																cancelRename();
															}
														}}
													/>
													<Button
														type="button"
														size="sm"
														variant="ghost"
														className="size-7 p-0"
														disabled={!isRenamed || isSaving}
														onClick={() => void saveFilename()}
														aria-label="确认重命名"
													>
														{isSaving ? <Loader2 className="animate-spin" /> : <Check />}
													</Button>
													<Button
														type="button"
														size="sm"
														variant="ghost"
														className="size-7 p-0"
														disabled={isSaving}
														onClick={cancelRename}
														aria-label="取消重命名"
													>
														<X />
													</Button>
												</div>
											) : (
												<p className="break-all leading-5">{asset.filename}</p>
											)}
										</dd>
										<dt className="text-muted-foreground">类型</dt>
										<dd className="text-foreground">{assetKindLabel(asset.kind)}</dd>
										<dt className="text-muted-foreground">格式</dt>
										<dd className="break-all text-foreground">{asset.mimeType || "unknown"}</dd>
										<dt className="text-muted-foreground">大小</dt>
										<dd className="text-foreground">{formatBytes(asset.sizeBytes)}</dd>
									</dl>
								</div>
								<div className="grid grid-cols-2 gap-2 border-t border-border bg-muted/20 p-3">
									<Button
										type="button"
										variant="outline"
										disabled={!projectId || isRenaming || isSaving}
										onClick={() => {
											setDraftFilename(asset.filename);
											setIsRenaming(true);
										}}
									>
										<PencilLine />
										<span>重命名</span>
									</Button>
									<Button
										type="button"
										variant="secondary"
										disabled={isDownloading}
										onClick={() => void downloadAsset()}
									>
										{isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
										<span>{isDownloading ? "下载中" : "下载文件"}</span>
									</Button>
								</div>
							</PopoverContent>
						</Popover>
					</div>
				</header>

				<section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="文件预览">
					<AssetPreviewBody
						asset={asset}
						isTextLoading={isLoading}
						source={source}
						text={text}
						textError={error ?? sourceError}
					/>
				</section>
			</div>
		</main>
	);
};
