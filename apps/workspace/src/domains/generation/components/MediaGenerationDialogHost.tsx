import type React from "react";
import { useCallback, useEffect } from "react";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";
import { AudioGenerationDialog } from "@/shared/components/generation-dialogs/AudioGenerationDialog";
import { ImageGenerationDialog } from "@/shared/components/generation-dialogs/ImageGenerationDialog";
import { VideoGenerationDialog } from "@/shared/components/generation-dialogs/VideoGenerationDialog";

// 全局唯一的媒体生成弹窗宿主：按 store.activeRequest.kind 渲染对应的 canonical 弹窗，
// 同一时刻只开一个。生成完成通知的「打开」请求也桥接进同一个 store。
export const MediaGenerationDialogHost: React.FC = () => {
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
				section={activeRequest?.kind === "audio" ? activeRequest.section : null}
				onGenerationComplete={handleGenerationComplete}
				onGenerationError={handleGenerationError}
				onGenerationStart={handleGenerationStart}
				onOpenChange={handleOpenChange}
				onOpenReferenceGeneration={openReferenceGeneration}
			/>
		</>
	);
};
