import { useMemo } from "react";
import type { GenerationTask } from "@/domains/generation/api/generation";
import {
	generationStatusForSection,
	mergeResourceGenerationStatusMaps,
	type ResourceGenerationStatus,
} from "@/domains/generation/lib/resource-generation-status";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";

export interface ResourceGenerationStatusInput {
	id: string;
	documentId: string;
	sectionId: string;
}

// 列表「生成中/失败」状态：SWR 任务派生（按 documentId + sectionId 匹配）⊕ 全局 store 的乐观层。
// 返回按 resource.id 索引的 Map，供列表行直接查询。任意列表都能复用，无需各自重写合并逻辑。
export const useResourceGenerationStatuses = (
	resources: readonly ResourceGenerationStatusInput[],
	tasks: readonly GenerationTask[],
): Map<string, ResourceGenerationStatus> => {
	const optimisticStatuses = useMediaGenerationStore((state) => state.optimisticStatuses);

	const taskStatuses = useMemo(() => {
		const next = new Map<string, ResourceGenerationStatus>();
		for (const resource of resources) {
			const status = generationStatusForSection(
				tasks as GenerationTask[],
				resource.documentId,
				resource.sectionId,
			);
			if (status) next.set(resource.id, status);
		}
		return next;
	}, [resources, tasks]);

	return useMemo(
		() =>
			mergeResourceGenerationStatusMaps(taskStatuses, new Map(Object.entries(optimisticStatuses))),
		[optimisticStatuses, taskStatuses],
	);
};
