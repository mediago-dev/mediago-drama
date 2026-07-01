import type React from "react";
import { useCallback, useEffect, useMemo } from "react";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	type GenerationAsset,
	type SelectedGenerationAsset,
	type UpdateSelectedGenerationAssetRequest,
	updateSelectedGenerationAsset,
} from "@/domains/generation/api/generation";
import { useSelectedGenerationAssets } from "@/domains/generation/hooks/useSelectedGenerationAssets";
import { selectedGenerationAssetSelectionKey } from "@/domains/generation/lib/selected-asset-keys";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import {
	type MediaGenerationDialogRequest,
	useMediaGenerationStore,
} from "@/domains/generation/stores/media-generation";
import { AudioGenerationDialog } from "@/shared/components/generation-dialogs/AudioGenerationDialog";
import { ImageGenerationDialog } from "@/shared/components/generation-dialogs/ImageGenerationDialog";
import { VideoGenerationDialog } from "@/shared/components/generation-dialogs/VideoGenerationDialog";
import { useToast } from "@/hooks/useToast";

// 全局唯一的媒体生成弹窗宿主：按 store.activeRequest.kind 渲染对应的 canonical 弹窗，
// 同一时刻只开一个。生成完成通知的「打开」请求也桥接进同一个 store。
export const MediaGenerationDialogHost: React.FC = () => {
	const toast = useToast();
	const activeRequest = useMediaGenerationStore((state) => state.activeRequest);
	const open = useMediaGenerationStore((state) => state.open);
	const close = useMediaGenerationStore((state) => state.close);
	const markGenerating = useMediaGenerationStore((state) => state.markGenerating);
	const markFailed = useMediaGenerationStore((state) => state.markFailed);
	const clearStatus = useMediaGenerationStore((state) => state.clearStatus);
	const pendingOpenRequest = useGenerationNotificationStore((state) => state.pendingOpenRequest);
	const consumeOpenRequest = useGenerationNotificationStore((state) => state.consumeOpenRequest);

	useEffect(() => {
		if (!pendingOpenRequest) return;
		open({
			kind: pendingOpenRequest.kind,
			projectId: pendingOpenRequest.target.projectId,
			section: pendingOpenRequest.target.section,
			resolveLatestSection: false,
		});
		consumeOpenRequest(pendingOpenRequest.notificationId);
	}, [consumeOpenRequest, open, pendingOpenRequest]);

	const handleOpenChange = useCallback(
		(next: boolean) => {
			if (!next) close();
		},
		[close],
	);
	const projectId = activeRequest?.projectId;
	const resolveLatestSection = activeRequest?.resolveLatestSection;
	const statusResourceKey = activeRequest?.statusResourceKey;
	const { assets: selectedGenerationAssets, mutate: mutateSelectedGenerationAssets } =
		useSelectedGenerationAssets(projectId, {
			enabled: activeRequest?.kind === "audio",
		});
	const selectedAudioAssets = useMemo(() => {
		if (activeRequest?.kind !== "audio") return [];
		return selectedAudioAssetsForSection(
			selectedGenerationAssets,
			activeRequest.section,
			activeRequest.selectedAssetResourceType,
		);
	}, [activeRequest, selectedGenerationAssets]);
	const selectedAudioAssetKeys = useMemo(
		() =>
			selectedAudioAssets
				.map(selectedGenerationAssetSelectionKey)
				.filter((key): key is string => Boolean(key)),
		[selectedAudioAssets],
	);
	const openReferenceGeneration = useCallback(
		(section: MarkdownSectionContext) => open({ kind: "image", projectId, section }),
		[open, projectId],
	);

	// 列表行的即时「生成中/失败」反馈：生成开始即标记，完成清除（交回 SWR 派生状态），失败标记失败。
	const handleGenerationStart = useCallback(() => {
		if (statusResourceKey) markGenerating(statusResourceKey);
	}, [markGenerating, statusResourceKey]);
	const handleGenerationComplete = useCallback(() => {
		if (statusResourceKey) clearStatus(statusResourceKey);
	}, [clearStatus, statusResourceKey]);
	const handleGenerationError = useCallback(() => {
		if (statusResourceKey) markFailed(statusResourceKey, { message: "生成失败，请重试。" });
	}, [markFailed, statusResourceKey]);
	const handleCommitAudioAssetSelection = useCallback(
		async (asset: GenerationAsset | null) => {
			const request = activeRequest;
			const normalizedProjectId = projectId?.trim();
			if (!normalizedProjectId || request?.kind !== "audio" || !request.selectedAssetResourceType) {
				return;
			}
			const selectedAsset = selectedAudioAssets[0];
			if (!asset && !selectedAsset) return;

			try {
				await updateSelectedGenerationAsset(
					normalizedProjectId,
					asset
						? audioAssetSelectionPayload(request, asset, true)
						: selectedAudioAssetClearPayload(request, selectedAsset),
				);
				await mutateSelectedGenerationAssets();
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "音频选择保存失败。");
				throw err;
			}
		},
		[activeRequest, mutateSelectedGenerationAssets, projectId, selectedAudioAssets, toast],
	);

	return (
		<>
			<ImageGenerationDialog
				open={activeRequest?.kind === "image"}
				projectId={projectId}
				resolveLatestSection={resolveLatestSection}
				section={activeRequest?.kind === "image" ? activeRequest.section : null}
				onGenerationComplete={handleGenerationComplete}
				onGenerationError={handleGenerationError}
				onGenerationStart={handleGenerationStart}
				onOpenChange={handleOpenChange}
				onOpenReferenceGeneration={openReferenceGeneration}
			/>
			<VideoGenerationDialog
				open={activeRequest?.kind === "video"}
				projectId={projectId}
				resolveLatestSection={resolveLatestSection}
				section={activeRequest?.kind === "video" ? activeRequest.section : null}
				onGenerationComplete={handleGenerationComplete}
				onGenerationError={handleGenerationError}
				onGenerationStart={handleGenerationStart}
				onOpenChange={handleOpenChange}
				onOpenReferenceGeneration={openReferenceGeneration}
			/>
			<AudioGenerationDialog
				open={activeRequest?.kind === "audio"}
				projectId={projectId}
				resolveLatestSection={resolveLatestSection}
				selectedAssetKeys={selectedAudioAssetKeys}
				selectedGenerationAssets={selectedAudioAssets}
				section={activeRequest?.kind === "audio" ? activeRequest.section : null}
				onGenerationComplete={handleGenerationComplete}
				onGenerationError={handleGenerationError}
				onGenerationStart={handleGenerationStart}
				onCommitAssetSelection={handleCommitAudioAssetSelection}
				onOpenChange={handleOpenChange}
				onOpenReferenceGeneration={openReferenceGeneration}
			/>
		</>
	);
};

const selectedAudioAssetsForSection = (
	assets: readonly SelectedGenerationAsset[],
	section: MarkdownSectionContext,
	resourceType?: string,
) => {
	const documentId = section.documentId.trim();
	const sectionId = section.blockId.trim();
	const normalizedResourceType = resourceType?.trim();
	if (!documentId || !sectionId) return [];

	return assets.filter((asset) => {
		if (asset.kind !== "audio" || asset.resourceId?.trim() !== sectionId) return false;
		if (normalizedResourceType && asset.resourceType !== normalizedResourceType) return false;

		const sourceDocumentId = asset.sourceDocumentId?.trim();
		return !sourceDocumentId || sourceDocumentId === documentId;
	});
};

const audioAssetSelectionPayload = (
	request: MediaGenerationDialogRequest,
	asset: GenerationAsset,
	selected: boolean,
): UpdateSelectedGenerationAssetRequest => {
	if (request.kind !== "audio" || !request.selectedAssetResourceType) {
		throw new Error("audio asset selection requires an audio request");
	}

	const sourceType = selectedAssetSourceType(asset.sourceType);
	return {
		assetIndex: 0,
		base64: asset.base64,
		kind: "audio",
		mimeType: asset.mimeType,
		resourceId: request.section.blockId,
		resourceTitle: request.section.headingText,
		resourceType: request.selectedAssetResourceType,
		selected,
		sourceAssetIndex: 0,
		sourceDocumentId: request.section.documentId,
		sourceKey: asset.url?.trim() || asset.title?.trim() || undefined,
		...(sourceType ? { sourceType } : {}),
		title: asset.title?.trim() || request.section.headingText,
		url: asset.url,
	};
};

const selectedAudioAssetClearPayload = (
	request: MediaGenerationDialogRequest,
	asset: SelectedGenerationAsset,
): UpdateSelectedGenerationAssetRequest => {
	if (request.kind !== "audio" || !request.selectedAssetResourceType) {
		throw new Error("audio asset selection requires an audio request");
	}

	const sourceType = selectedAssetSourceType(asset.sourceType);
	const sourceAssetIndex = asset.sourceAssetIndex ?? asset.assetIndex ?? 0;
	return {
		assetIndex: asset.assetIndex ?? 0,
		base64: asset.base64,
		kind: "audio",
		mediaAssetId: asset.mediaAssetId,
		mimeType: asset.mimeType,
		resourceId: request.section.blockId,
		resourceTitle: request.section.headingText,
		resourceType: request.selectedAssetResourceType,
		selected: false,
		sourceAssetIndex,
		sourceDocumentId: asset.sourceDocumentId || request.section.documentId,
		sourceKey: asset.sourceKey || asset.url || asset.mediaAssetId,
		sourceTaskId: asset.sourceTaskId || asset.taskId,
		...(sourceType ? { sourceType } : {}),
		title: asset.title?.trim() || request.section.headingText,
		url: asset.url,
	};
};

const selectedAssetSourceType = (
	value: string | undefined,
): UpdateSelectedGenerationAssetRequest["sourceType"] | undefined => {
	switch (value?.trim()) {
		case "generated":
		case "edited":
		case "uploaded":
		case "document":
		case "imported":
			return value.trim() as UpdateSelectedGenerationAssetRequest["sourceType"];
		default:
			return undefined;
	}
};
