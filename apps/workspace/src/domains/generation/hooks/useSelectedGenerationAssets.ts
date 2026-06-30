import useSWR from "swr";
import {
	getSelectedGenerationAssets,
	type SelectedGenerationAsset,
	type SelectedGenerationAssetsFilters,
	selectedGenerationAssetsQueryKey,
} from "@/domains/generation/api/generation";

interface UseSelectedGenerationAssetsOptions {
	// 关闭时不发起请求（沿用各调用方原先的 `open && projectId ? key : null` 写法）。
	enabled?: boolean;
	filters?: SelectedGenerationAssetsFilters;
}

// 项目「选中资源」的统一读入口：所有列表/弹窗共用同一个 SWR 缓存键，
// SWR 自动去重成一份，替代各处重复的 useSWR(selectedGenerationAssetsQueryKey, ...) 样板。
export const useSelectedGenerationAssets = (
	projectId: string | null | undefined,
	options: UseSelectedGenerationAssetsOptions = {},
) => {
	const { enabled = true, filters } = options;
	const normalizedProjectId = projectId?.trim() ?? "";
	const shouldFetch = enabled && Boolean(normalizedProjectId);

	const swr = useSWR(
		shouldFetch ? selectedGenerationAssetsQueryKey(normalizedProjectId, filters) : null,
		() => getSelectedGenerationAssets(normalizedProjectId, filters),
	);

	const assets: SelectedGenerationAsset[] = swr.data?.assets ?? [];

	return { ...swr, assets };
};
