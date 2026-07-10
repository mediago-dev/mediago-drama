import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	type GenerationAsset,
	type SelectedGenerationAsset,
	type UpdateSelectedGenerationAssetRequest,
	updateSelectedGenerationAsset,
} from "@/domains/generation/api/generation";
import { useSelectedGenerationAssets } from "@/domains/generation/hooks/useSelectedGenerationAssets";
import { selectedGenerationAssetSelectionKey } from "@/domains/generation/lib/selected-asset-keys";
import {
	type MediaGenerationDialogRequest,
	useMediaGenerationStore,
} from "@/domains/generation/stores/media-generation";
import { AudioGenerationDialog } from "@/shared/components/generation-dialogs/AudioGenerationDialog";
import { ImageGenerationDialog } from "@/shared/components/generation-dialogs/ImageGenerationDialog";
import { VideoGenerationDialog } from "@/shared/components/generation-dialogs/VideoGenerationDialog";
import { useToast } from "@/hooks/useToast";

interface MediaGenerationDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	request: MediaGenerationDialogRequest | null;
}

// 一个组件实例只拥有一个根生成弹窗。视频引用图片是这个根弹窗的局部子状态，
// 由 Radix 负责两个 Dialog 的焦点、inert 和关闭顺序，不进入全局 UI 栈。
export const MediaGenerationDialog: React.FC<MediaGenerationDialogProps> = ({
	onOpenChange,
	open,
	request,
}) => {
	const toast = useToast();
	const markGenerating = useMediaGenerationStore((state) => state.markGenerating);
	const markFailed = useMediaGenerationStore((state) => state.markFailed);
	const clearStatus = useMediaGenerationStore((state) => state.clearStatus);
	const [referenceImageSection, setReferenceImageSection] = useState<MarkdownSectionContext | null>(
		null,
	);
	const projectId = request?.projectId;
	const resolveLatestSection = request?.resolveLatestSection;
	const statusResourceKey = request?.statusResourceKey;
	const requestKey = request ? mediaGenerationDialogRequestKey(request) : "";

	useEffect(() => {
		setReferenceImageSection(null);
	}, [open, requestKey]);

	const { assets: selectedGenerationAssets, mutate: mutateSelectedGenerationAssets } =
		useSelectedGenerationAssets(projectId, {
			enabled: open && request?.kind === "audio",
		});
	const selectedAudioAssets = useMemo(() => {
		if (request?.kind !== "audio") return [];
		return selectedAudioAssetsForSection(
			selectedGenerationAssets,
			request.section,
			request.selectedAssetResourceType,
		);
	}, [request, selectedGenerationAssets]);
	const selectedAudioAssetKeys = useMemo(
		() =>
			selectedAudioAssets
				.map(selectedGenerationAssetSelectionKey)
				.filter((key): key is string => Boolean(key)),
		[selectedAudioAssets],
	);
	const openReferenceGeneration = useCallback((section: MarkdownSectionContext) => {
		setReferenceImageSection(section);
	}, []);

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
		[mutateSelectedGenerationAssets, projectId, request, selectedAudioAssets, toast],
	);

	return (
		<>
			{request?.kind === "image" ? (
				<ImageGenerationDialog
					open={open}
					projectId={projectId}
					resolveLatestSection={resolveLatestSection}
					section={request.section}
					onGenerationComplete={handleGenerationComplete}
					onGenerationError={handleGenerationError}
					onGenerationStart={handleGenerationStart}
					onOpenChange={onOpenChange}
				/>
			) : null}

			{request?.kind === "video" ? (
				<VideoGenerationDialog
					open={open}
					projectId={projectId}
					resolveLatestSection={resolveLatestSection}
					section={request.section}
					onGenerationComplete={handleGenerationComplete}
					onGenerationError={handleGenerationError}
					onGenerationStart={handleGenerationStart}
					onOpenChange={onOpenChange}
					onOpenReferenceGeneration={openReferenceGeneration}
				/>
			) : null}

			{request?.kind === "audio" ? (
				<AudioGenerationDialog
					open={open}
					projectId={projectId}
					resolveLatestSection={resolveLatestSection}
					selectedAssetKeys={selectedAudioAssetKeys}
					selectedGenerationAssets={selectedAudioAssets}
					section={request.section}
					onGenerationComplete={handleGenerationComplete}
					onGenerationError={handleGenerationError}
					onGenerationStart={handleGenerationStart}
					onCommitAssetSelection={handleCommitAudioAssetSelection}
					onOpenChange={onOpenChange}
				/>
			) : null}

			{referenceImageSection ? (
				<ImageGenerationDialog
					open
					projectId={projectId}
					section={referenceImageSection}
					onGenerationComplete={noop}
					onGenerationError={noop}
					onGenerationStart={noop}
					onOpenChange={(nextOpen) => {
						if (!nextOpen) setReferenceImageSection(null);
					}}
				/>
			) : null}
		</>
	);
};

const noop = () => undefined;

const mediaGenerationDialogRequestKey = (request: MediaGenerationDialogRequest) =>
	[
		request.kind,
		request.projectId?.trim() ?? "",
		request.section.documentId.trim(),
		request.section.blockId.trim(),
	].join("\u0000");

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
