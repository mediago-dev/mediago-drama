import type { MarkdownSectionContext } from "@/domains/documents/components/tiptap/section-context";
import type { SelectedGenerationResourceType } from "@/domains/generation/api/generation";
import {
	failedResourceGenerationStatus,
	pendingResourceGenerationStatus,
	type ResourceGenerationStatus,
} from "@/domains/generation/lib/resource-generation-status";
import { analytics, AnalyticsEvent } from "@/shared/analytics";
import { createStore } from "@/shared/lib/utils";

// 三类媒体生成弹窗（图片/音频/视频）共用的「打开请求」。section 模式：
// 由 {kind, projectId, section} 完全确定，弹窗内部按 section 自行从 SWR 解析选中资源。
export type MediaGenerationDialogKind = "image" | "audio" | "video";

export interface MediaGenerationDialogRequest {
	kind: MediaGenerationDialogKind;
	projectId?: string;
	section: MarkdownSectionContext;
	// 是否从当前文档实时解析最新的 section（默认 true，沿用弹窗默认）；
	// 通知打开 / 分镜视频等用快照的场景显式传 false。
	resolveLatestSection?: boolean;
	// 列表行的资源 key（= resource.id）。传了之后，host 会在生成开始/完成/失败时
	// 即时更新该资源的乐观状态，让列表无需等 SWR 轮询就显示「生成中」。
	statusResourceKey?: string;
	// 选中音频等参考素材时用于把 asset 持久化回项目资源概览。
	selectedAssetResourceType?: SelectedGenerationResourceType;
}

interface MediaGenerationState {
	// 当前打开的生成弹窗（全局唯一）；null = 未打开。
	activeRequest: MediaGenerationDialogRequest | null;
	// 列表「生成中/失败」的乐观层，按资源 key 索引；与 SWR 任务派生状态合并后展示。
	optimisticStatuses: Record<string, ResourceGenerationStatus>;
	open: (request: MediaGenerationDialogRequest) => void;
	close: () => void;
	markGenerating: (resourceKey: string, options?: { message?: string; taskId?: string }) => void;
	markFailed: (resourceKey: string, options: { message: string; taskId?: string }) => void;
	clearStatus: (resourceKey: string) => void;
	clearStatuses: () => void;
}

export const useMediaGenerationStore = createStore<MediaGenerationState>(
	(set) => ({
		activeRequest: null,
		optimisticStatuses: {},
		open: (request) => {
			analytics.track(AnalyticsEvent.OpenGenerationDialog, {
				kind: request.kind,
				project_id: request.projectId,
				section_id: request.section.blockId,
				selected_asset_resource_type: request.selectedAssetResourceType,
				status_resource_key: request.statusResourceKey,
			});
			set({ activeRequest: request });
		},
		close: () => set({ activeRequest: null }),
		markGenerating: (resourceKey, options = {}) =>
			set((state) => ({
				optimisticStatuses: {
					...state.optimisticStatuses,
					[resourceKey]: pendingResourceGenerationStatus({
						taskId: options.taskId ?? `optimistic:${resourceKey}`,
						message: options.message,
					}),
				},
			})),
		markFailed: (resourceKey, options) =>
			set((state) => ({
				optimisticStatuses: {
					...state.optimisticStatuses,
					[resourceKey]: failedResourceGenerationStatus({
						taskId: options.taskId ?? `optimistic:${resourceKey}`,
						message: options.message,
					}),
				},
			})),
		clearStatus: (resourceKey) =>
			set((state) => {
				if (!(resourceKey in state.optimisticStatuses)) return state;
				const { [resourceKey]: _removed, ...rest } = state.optimisticStatuses;
				return { optimisticStatuses: rest };
			}),
		clearStatuses: () =>
			set((state) =>
				Object.keys(state.optimisticStatuses).length === 0 ? state : { optimisticStatuses: {} },
			),
	}),
	"mediaGenerationStore",
);
