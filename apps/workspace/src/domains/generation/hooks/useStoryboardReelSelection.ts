import { useMemo } from "react";
import type {
	SelectedGenerationAsset,
	SelectedGenerationResourceType,
} from "@/domains/generation/api/generation";
import { useSelectedGenerationAssets } from "@/domains/generation/hooks/useSelectedGenerationAssets";
import { selectedGenerationAssetKeysForSection } from "@/domains/generation/lib/selected-asset-keys";

// 成片选中契约：一条分镜 reel 的视频「成片」= 该 section 下 kind=video / resourceType=storyboard
// 的已选资源。列表 / 画布 / 预览三处共用这一份映射，避免各自拼 resourceId、算 selectedAssetKeys
// 而漂移（resourceType 在这里固定为 storyboard，不再依赖 taskType 间接推导）。
export const storyboardReelSelectionResourceType: SelectedGenerationResourceType = "storyboard";
export const storyboardReelSelectionKind = "video" as const;

export interface StoryboardReelSelectionTarget {
	documentId: string;
	// reel 的 section 标识（= reel.blockId / reel.sectionId）。
	sectionId: string;
	title?: string;
}

interface UseStoryboardReelSelectionOptions {
	// 外部已加载好的选中资源；传了就复用、不再自拉，避免重复 SWR 请求。
	selectedGenerationAssets?: SelectedGenerationAsset[];
	enabled?: boolean;
}

export interface StoryboardReelSelection {
	// 该 section 下已选 video 资源的选中键（喂给 MediaGenerationWorkspace.selectedAssetKeys）。
	selectedAssetKeys: string[];
	selectedAssetResourceId?: string;
	selectedAssetResourceType?: SelectedGenerationResourceType;
	selectedAssetSourceDocumentId?: string;
	selectedAssetTitle?: string;
	// 是否具备选中所需的 section 身份（documentId + sectionId 都有）。
	canSelect: boolean;
	// 解析出的项目选中资源（自拉或外部传入），供调用方复用（如解析 mention 引用）。
	selectedGenerationAssets: SelectedGenerationAsset[];
}

// 把「为某条分镜 reel 选用视频成片」的契约收口成一个 hook：固定 resourceId/documentId/kind/
// resourceType 的映射 + 选中键计算 + 选中资源读入。选中后的持久化与列表刷新由
// MediaGenerationWorkspace 统一处理（updateSelectedGenerationAsset + 三个 mutate key）。
export const useStoryboardReelSelection = (
	projectId: string | null | undefined,
	target: StoryboardReelSelectionTarget | null,
	options: UseStoryboardReelSelectionOptions = {},
): StoryboardReelSelection => {
	const { selectedGenerationAssets: provided, enabled = true } = options;
	const { assets: loaded } = useSelectedGenerationAssets(projectId, {
		enabled: enabled && provided === undefined,
	});
	const selectedGenerationAssets = provided ?? loaded;

	const documentId = target?.documentId.trim() ?? "";
	const sectionId = target?.sectionId.trim() ?? "";
	const canSelect = Boolean(documentId && sectionId);

	const selectedAssetKeys = useMemo(
		() =>
			canSelect
				? selectedGenerationAssetKeysForSection(
						selectedGenerationAssets,
						{ blockId: sectionId, documentId },
						storyboardReelSelectionKind,
					)
				: [],
		[canSelect, documentId, sectionId, selectedGenerationAssets],
	);

	return {
		selectedAssetKeys,
		selectedAssetResourceId: canSelect ? sectionId : undefined,
		selectedAssetResourceType: canSelect ? storyboardReelSelectionResourceType : undefined,
		selectedAssetSourceDocumentId: canSelect ? documentId : undefined,
		selectedAssetTitle: target?.title?.trim() || undefined,
		canSelect,
		selectedGenerationAssets,
	};
};
