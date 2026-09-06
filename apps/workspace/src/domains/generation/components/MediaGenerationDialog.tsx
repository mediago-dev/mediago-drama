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
import { refreshSelectedGenerationAssetDependents } from "@/domains/generation/lib/refresh-selected-assets";
import {
	type MediaGenerationDialogRequest,
	useMediaGenerationStore,
} from "@/domains/generation/stores/media-generation";
import {
	getWorkspaceDocumentResources,
	type WorkspaceDocumentResource,
} from "@/domains/workspace/api/workspace";
import { AudioGenerationDialog } from "@/shared/components/generation-dialogs/AudioGenerationDialog";
import { ImageGenerationDialog } from "@/shared/components/generation-dialogs/ImageGenerationDialog";
import { VideoGenerationDialog } from "@/shared/components/generation-dialogs/VideoGenerationDialog";
import { useToast } from "@/hooks/useToast";

interface MediaGenerationDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	request: MediaGenerationDialogRequest | null;
}

const generationFailureNotice = (rawMessage?: string) => {
	const message = rawMessage?.trim() ?? "";
	const looksLikeMissingCredential = /dmx\s*api\s*key|api\s*key|credential|凭据|密钥|未配置/i.test(
		message,
	);
	if (looksLikeMissingCredential) {
		return {
			title: "生成被阻断",
			description:
				"图片服务未配置或凭据不可用，任务没有提交，原 Prompt、模型和参考图仍已保留。请到“设置 → 模型 API 配置”补齐图片服务后再生成。",
		};
	}

	// 服务端错误可能意外包含令牌；只把经过清洗的短消息展示给用户。
	const safeMessage = message
		.replace(/sk-[A-Za-z0-9_-]+/g, "[已隐藏凭据]")
		.replace(/Bearer\s+[^\s]+/gi, "Bearer [已隐藏凭据]")
		.slice(0, 240);
	return {
		title: "生成失败",
		description:
			safeMessage || "生成服务未返回明确原因。任务没有提交，原 Prompt 和参考图仍已保留。",
	};
};

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
	const shotIds = request?.shotIds;
	const selectedAssetKeys = request?.selectedAssetKeys;
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
	const handleGenerationComplete = useCallback(
		(_pendingId: string, assets: GenerationAsset[], sourceTaskId: string) => {
			if (statusResourceKey) clearStatus(statusResourceKey);
			// 第 04 步从资产卡发起时，不能只停在“生成历史”。首张结果会成为
			// 当前资产版本，同时镜像绑定到同名的项目资源节点（角色/场景/道具），
			// 让项目总览的资源树立即展示缩略图和可用镜头。
			if (
				request?.kind !== "image" ||
				!projectId?.trim() ||
				!statusResourceKey?.trim() ||
				!request.selectedAssetResourceType
			) {
				return;
			}
			const asset = assets.find((item) => item.kind === "image" && Boolean(item.assetId?.trim()));
			if (!asset) return;
			void archiveProductionImageToResourceTree({
				asset,
				projectId,
				request,
				sourceTaskId,
			});
		},
		[clearStatus, projectId, request, statusResourceKey],
	);
	const handleGenerationError = useCallback(
		(_pendingId: string, rawMessage?: string) => {
			const notice = generationFailureNotice(rawMessage);
			if (statusResourceKey) markFailed(statusResourceKey, { message: notice.description });
			toast.error(notice.title, { description: notice.description });
		},
		[markFailed, statusResourceKey, toast],
	);
	const handleImageGenerationError = useCallback(
		(_section: MarkdownSectionContext, pendingId: string, rawMessage?: string) =>
			handleGenerationError(pendingId, rawMessage),
		[handleGenerationError],
	);
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
					forceSingleOutput={request.forceSingleOutput}
					open={open}
					projectId={projectId}
					resolveLatestSection={resolveLatestSection}
					section={request.section}
					selectedAssetResourceType={request.selectedAssetResourceType}
					selectedAssetKeys={selectedAssetKeys}
					shotIds={shotIds}
					onGenerationComplete={(_section, pendingId, assets, sourceTaskId) =>
						handleGenerationComplete(pendingId, assets, sourceTaskId)
					}
					onGenerationError={handleImageGenerationError}
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

const archiveProductionImageToResourceTree = async ({
	asset,
	projectId,
	request,
	sourceTaskId,
}: {
	asset: GenerationAsset;
	projectId: string;
	request: MediaGenerationDialogRequest;
	sourceTaskId: string;
}) => {
	const normalizedProjectId = projectId.trim();
	const resourceId = request.statusResourceKey?.trim();
	const resourceType = request.selectedAssetResourceType;
	const mediaAssetId = asset.assetId?.trim();
	if (!normalizedProjectId || !resourceId || !resourceType || !mediaAssetId) return;

	const basePayload: UpdateSelectedGenerationAssetRequest = {
		assetIndex: asset.slotIndex,
		kind: "image",
		mediaAssetId,
		mimeType: asset.mimeType,
		resourceId,
		resourceTitle: request.section.headingText,
		resourceType,
		selected: true,
		sourceAssetIndex: asset.slotIndex,
		sourceTaskId: sourceTaskId || asset.taskId,
		sourceType: "generated",
		taskId: sourceTaskId || asset.taskId,
		title: asset.title || request.section.headingText,
		url: asset.url,
		shotIds: request.shotIds,
	};

	try {
		const primary = await updateSelectedGenerationAsset(normalizedProjectId, basePayload);
		refreshSelectedGenerationAssetDependents(normalizedProjectId, primary.asset);

		const documentResources = await getWorkspaceDocumentResources(normalizedProjectId);
		const linkedResource = findLinkedDocumentResource(
			documentResources.resources,
			resourceType,
			request.section.headingText,
		);
		if (!linkedResource) return;

		const linked = await updateSelectedGenerationAsset(normalizedProjectId, {
			...basePayload,
			resourceId: linkedResource.sectionId,
			resourceTitle: linkedResource.title,
			sourceDocumentId: linkedResource.documentId,
		});
		refreshSelectedGenerationAssetDependents(normalizedProjectId, linked.asset);
	} catch {
		// 生成结果已经保存在任务和素材库中；归档同步失败不应把成功的生成误报为失败。
	}
};

const findLinkedDocumentResource = (
	resources: WorkspaceDocumentResource[],
	resourceType: string,
	assetTitle: string,
) => {
	const target = normalizedResourceIdentity(assetTitle);
	if (!target) return undefined;
	return resources.find((resource) => {
		if (resource.type !== resourceType) return false;
		const candidate = normalizedResourceIdentity(resource.title);
		return candidate !== "" && (candidate.includes(target) || target.includes(candidate));
	});
};

const normalizedResourceIdentity = (value: string) =>
	value
		.replace(/\b(?:CHR|CHAR|SCN|SCENE|PRD|PROP|FX|STYLE)[-_]?\d{1,3}\b/gi, "")
		.replace(/[（(].*?[)）]/g, "")
		.replace(/(?:身份模型|角色模型|标准资产|资产|模型|造型|场景|背景|道具|产品|特效|风格)/g, "")
		.replace(/[^\p{L}\p{N}]/gu, "")
		.trim();

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
