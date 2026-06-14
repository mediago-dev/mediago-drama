import type React from "react";
import { useCallback, useMemo } from "react";
import useSWR from "swr";
import type {
	GenerationAsset,
	GenerationNotificationOpenTarget,
} from "@/domains/generation/api/generation";
import { projectGenerationConversation } from "@/domains/generation/api/generation";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import { MediaGenerationWorkspace } from "@/domains/generation/components/MediaGenerationWorkspace";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import { formatTimelineTime, type Episode, type TimelineClip } from "@/domains/episode/lib/sample";
import {
	generationAssetSelectionKey,
	generationAssetSource,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

interface EpisodeVideoGenerationDialogProps {
	documentId?: string;
	documentTitle?: string;
	episode: Episode;
	onGeneratedVideoReady?: (clipId: string, videoUrl: string | null) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	projectId?: string;
	selectedClip: TimelineClip | null;
	selectedVideoUrl?: string | null;
}

interface EpisodeVideoGenerationContext {
	blockId: string;
	prompt: string;
}

const titleId = "episode-video-generation-title";

export const EpisodeVideoGenerationDialog: React.FC<EpisodeVideoGenerationDialogProps> = ({
	documentId,
	documentTitle,
	episode,
	onGeneratedVideoReady,
	onOpenChange,
	open,
	projectId,
	selectedClip,
	selectedVideoUrl,
}) => {
	const generationContext = useMemo(
		() => buildEpisodeVideoContext(episode, selectedClip),
		[episode, selectedClip],
	);
	// 项目内的视频生成统一归到「项目级命名会话」，让创作台可见；非项目场景回退到按分镜片段的 scope。
	const normalizedProjectId = projectId?.trim() ?? "";
	const { data: projectsData } = useSWR(normalizedProjectId ? projectsKey : null, getProjects);
	const projectName = useMemo(
		() => projectsData?.projects.find((project) => project.id === normalizedProjectId)?.name ?? "",
		[projectsData, normalizedProjectId],
	);
	const projectConversation = useMemo(
		() => projectGenerationConversation(projectId, "video", projectName),
		[projectId, projectName],
	);
	const conversationScopeId = projectConversation?.conversationScopeId ?? generationContext.blockId;
	// 本地乐观缓存按分镜片段隔离；项目级会话里用 sectionId(=blockId) 过滤出当前片段的服务端任务。
	const historyScopeId = generationContext.blockId;
	const sectionId = projectConversation ? generationContext.blockId : undefined;
	const notificationTarget = useMemo<GenerationNotificationOpenTarget | undefined>(() => {
		const normalizedProjectId = projectId?.trim();
		const normalizedDocumentId = documentId?.trim();
		if (!normalizedProjectId || !normalizedDocumentId) return undefined;

		const headingText = selectedClip?.title.trim() || episode.title;
		const plainText = selectedClip?.content.trim() || episode.title;
		return {
			kind: "document-section",
			projectId: normalizedProjectId,
			documentId: normalizedDocumentId,
			documentTitle: documentTitle?.trim() || episode.title,
			section: {
				blockId: generationContext.blockId,
				documentId: normalizedDocumentId,
				headingLevel: 2,
				headingOccurrence: 1,
				headingText,
				markdown: [`## ${headingText}`, "", plainText].filter(Boolean).join("\n"),
				plainText,
				prompt: generationContext.prompt,
			},
		};
	}, [documentId, documentTitle, episode.title, generationContext, projectId, selectedClip]);
	const selectedAssetKeys = useMemo(() => {
		if (!selectedVideoUrl) return [];

		const assetKey = generationAssetSelectionKey({ kind: "video", url: selectedVideoUrl });
		return assetKey ? [assetKey] : [];
	}, [selectedVideoUrl]);
	const toggleGeneratedVideo = useCallback(
		(asset: GenerationAsset, selected: boolean) => {
			if (!selectedClip) return;

			const videoUrl = firstVideoAssetSource([asset]);
			if (!videoUrl) return;

			onGeneratedVideoReady?.(selectedClip.id, selected ? videoUrl : null);
		},
		[onGeneratedVideoReady, selectedClip],
	);

	return (
		<GenerationModalShell
			open={open}
			title={`生成视频素材 · ${selectedClip?.title ?? episode.title}`}
			titleId={titleId}
			onOpenChange={onOpenChange}
		>
			<MediaGenerationWorkspace
				className="min-h-0 flex-1"
				kind="video"
				emptyResultText="生成后会在这里显示可预览的视频素材。"
				conversationId={projectConversation?.conversationId}
				conversationScopeId={conversationScopeId}
				conversationTitle={projectConversation?.conversationTitle}
				historyScopeId={historyScopeId}
				sectionId={sectionId}
				taskType="storyboard"
				initialPrompt={generationContext.prompt}
				notificationTarget={notificationTarget}
				promptPlaceholder="描述当前组的视频镜头、运动、机位、时长、画幅和质量"
				projectId={projectId}
				submitLabel="生成视频"
				uploadIdPrefix="episode-video-generation"
				selectedAssetKeys={selectedAssetKeys}
				viewMode="history"
				onToggleAsset={toggleGeneratedVideo}
				onGenerationComplete={(_, assets) => {
					const videoUrl = firstVideoAssetSource(assets);
					if (selectedClip && videoUrl) onGeneratedVideoReady?.(selectedClip.id, videoUrl);
				}}
			/>
		</GenerationModalShell>
	);
};

const buildEpisodeVideoContext = (
	episode: Episode,
	selectedClip: TimelineClip | null,
): EpisodeVideoGenerationContext => {
	const blockId = `episode-video:${episode.id}:${selectedClip?.id ?? "episode"}`;

	return {
		blockId,
		prompt: buildEpisodeVideoPrompt(episode, selectedClip),
	};
};

const buildEpisodeVideoPrompt = (episode: Episode, selectedClip: TimelineClip | null) => {
	if (!selectedClip) {
		return [
			`为《${episode.title}》生成一段可用于剪辑工作台预览的视频镜头。`,
			`画幅比例：${episode.aspectRatio}`,
			`剧集时长：${formatTimelineTime(episode.duration)}`,
			"要求：镜头运动自然，画面清晰，适合作为时间线中的视频素材。",
		].join("\n");
	}

	const duration = Math.max(1, Math.round(selectedClip.end - selectedClip.start));
	return [
		selectedClip.prompt || selectedClip.content,
		"",
		`分组标题：${selectedClip.title}`,
		`画面内容：${selectedClip.content}`,
		`时间位置：${formatTimelineTime(selectedClip.start)} - ${formatTimelineTime(selectedClip.end)}`,
		`目标时长：${duration} 秒`,
		`画幅比例：${episode.aspectRatio}`,
		"要求：作为当前组的视频素材，动作连续，构图稳定，避免文字水印。",
	].join("\n");
};

const firstVideoAssetSource = (assets: GenerationAsset[]) => {
	const asset = assets.find((item) => item.kind === "video" && generationAssetSource(item));

	return asset ? generationAssetSource(asset) : "";
};
