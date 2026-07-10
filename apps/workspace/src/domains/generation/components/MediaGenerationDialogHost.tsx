import type React from "react";
import { useCallback, useEffect } from "react";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";
import { MediaGenerationDialog } from "./MediaGenerationDialog";

// 真正跨页面的媒体生成入口只保留一个全局请求。具体弹窗状态由受控组件所有，
// Radix 负责其内部子弹窗的层级、焦点和关闭顺序。
export const MediaGenerationDialogHost: React.FC = () => {
	const activeRequest = useMediaGenerationStore((state) => state.activeRequest);
	const open = useMediaGenerationStore((state) => state.open);
	const close = useMediaGenerationStore((state) => state.close);
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
		(nextOpen: boolean) => {
			if (!nextOpen) close();
		},
		[close],
	);

	return (
		<MediaGenerationDialog
			open={Boolean(activeRequest)}
			request={activeRequest}
			onOpenChange={handleOpenChange}
		/>
	);
};
