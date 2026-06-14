import { Download, Loader2, Save } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { updateProjectAsset } from "@/domains/workspace/api/project-assets";
import { getWorkspaceDocuments } from "@/domains/workspace/api/workspace";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
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
	}, [asset.filename, asset.id]);

	const saveFilename = async () => {
		if (!projectId || !isRenamed || isSaving) return;
		const filename = draftFilename.trim();
		if (!filename) {
			toast.error("文件名不能为空");
			return;
		}

		setIsSaving(true);
		try {
			await updateProjectAsset(projectId, asset.id, { filename });
			const state = await getWorkspaceDocuments(projectId);
			useDocumentsStore.getState().hydrateWorkspaceDocuments(state);
			toast.success("素材已重命名", { description: filename });
		} catch (err) {
			const message = errorMessage(err, "重命名失败。");
			toast.error("重命名失败", { description: message });
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<main className="h-full min-h-0 flex-1 overflow-y-auto bg-ide-editor">
			<div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-4 px-4 py-4">
				<header className="border-b border-border pb-4">
					<div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3">
						<div className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
							<Icon className="size-5" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
								<div className="min-w-0">
									<Input
										value={draftFilename}
										onChange={(event) => setDraftFilename(event.target.value)}
										className="h-9 min-w-0 flex-1 truncate border-0 bg-transparent px-0 text-lg font-semibold leading-tight shadow-none focus-visible:ring-0 sm:text-xl"
										aria-label="素材文件名"
									/>
									<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
										<span className="font-medium text-foreground">{asset.kind}</span>
										<span className="text-muted-foreground/60">·</span>
										<span>{asset.mimeType || "unknown"}</span>
										<span className="text-muted-foreground/60">·</span>
										<span>{formatBytes(asset.sizeBytes)}</span>
									</div>
								</div>
								<div className="flex w-full flex-wrap items-start gap-2 sm:w-auto lg:justify-end">
									<Button
										type="button"
										size="sm"
										variant="outline"
										className="w-fit"
										disabled={!projectId || !isRenamed || isSaving}
										onClick={saveFilename}
										aria-label="保存文件名"
									>
										{isSaving ? <Loader2 className="animate-spin" /> : <Save />}
										<span>保存</span>
									</Button>
									<Button asChild type="button" size="sm" variant="secondary">
										<a href={source || asset.url} download={asset.filename}>
											<Download />
											<span>下载</span>
										</a>
									</Button>
								</div>
							</div>
						</div>
					</div>
				</header>

				<section className="min-h-0 flex-1">
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
