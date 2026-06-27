import type { MediaPlayerInstance } from "@vidstack/react";
import { ArrowLeft, Clapperboard, Download, GitBranch, Loader2, Rows3 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useSWR from "swr";
import {
	getWorkspaceResolvedEpisode,
	updateWorkspaceEpisode,
	exportWorkspaceEpisodeJianyingDraft,
	workspaceEpisodePreviewStreamURL,
	workspaceResolvedEpisodeKey,
} from "@/domains/workspace/api/workspace";
import {
	getJianyingDraftSettings,
	jianyingDraftSettingsKey,
} from "@/domains/settings/api/settings";
import { getMediaAssets } from "@/domains/workspace/api/media";
import { EpisodeCompanionGenerationDialog } from "@/domains/episode/components/EpisodeCompanionGenerationDialog";
import { EpisodeCanvasView } from "@/domains/episode/components/EpisodeCanvasView";
import { EpisodeTimelineEditor } from "@/domains/episode/components/EpisodeTimelineEditor";
import { EpisodePreviewPlayer } from "@/domains/episode/components/EpisodePreviewPlayer";
import {
	buildEpisodeVideoContext,
	EpisodeVideoGenerationDialog,
	findEpisodeVideoSourceSection,
	firstVideoAssetSource,
} from "@/domains/episode/components/EpisodeVideoGenerationDialog";
import { downloadGeneratedAssetToDirectory } from "@/domains/generation/components/generatedResultActions";
import { pickDownloadDirectory } from "@/domains/workspace/lib/downloads";
import {
	generationTasksQueryKey,
	getGenerationTasks,
	projectGenerationConversation,
	type GenerationTask,
} from "@/domains/generation/api/generation";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/hooks/useToast";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { findDocumentById, selectDocumentById } from "@/domains/documents/lib/filters";
import { latestMarkdownSectionContextFromDocuments } from "@/domains/documents/lib/markdown-section-context";
import {
	findEpisodeClip,
	findEpisodeTrackForClip,
	findEpisodeVideoClip,
} from "@/domains/episode/lib/filters";
import {
	buildEpisodeClipMedia,
	buildEpisodeVideoClipPlaybackRanges,
	episodeClipPosterUrl,
	findEpisodeClipPlaybackRange,
	findEpisodeClipPlaybackRangeAtTime,
	isEpisodeVideoClipPlayable,
} from "@/domains/episode/lib/media-assets";
import type { Episode, TimelineClip, TimelineClipStatus } from "@/domains/episode/lib/sample";
import { useDocumentsStore } from "@/domains/documents/stores";
import { type TimelineCompanionTrackType, useEpisodeStore } from "@/domains/episode/stores";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
import {
	agentProjectPath,
	agentProjectRouteState,
	getRouteDocumentWorkbench,
	isAgentProjectViewState,
	type AgentDocumentWorkbench,
} from "@/domains/workspace/lib/workbench-route";
import { ImageGenerationDialog } from "@/shared/components/generation-dialogs/ImageGenerationDialog";

interface EpisodeTimelineViewProps {
	documentId?: string;
}

interface CompanionGenerationTarget {
	trackType: TimelineCompanionTrackType;
	videoClipId: string;
}

const isJianyingDraftExportButtonVisible =
	import.meta.env.VITE_ENABLE_JIANYING_DRAFT_EXPORT === "true";

export const EpisodeTimelineView: React.FC<EpisodeTimelineViewProps> = ({ documentId }) => {
	const navigate = useNavigate();
	const location = useLocation();
	const toast = useToast();
	const episode = useEpisodeStore((state) => state.episode);
	const currentTime = useEpisodeStore((state) => state.currentTime);
	const isPlaying = useEpisodeStore((state) => state.isPlaying);
	const selectedClipId = useEpisodeStore((state) => state.selectedClipId);
	const zoom = useEpisodeStore((state) => state.zoom);
	const documents = useDocumentsStore((state) => state.documents);
	const assets = useDocumentsStore((state) => state.assets);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const projectId = useDocumentsStore((state) => state.projectId);
	const addCompanionTextClip = useEpisodeStore((state) => state.addCompanionTextClip);
	const selectClip = useEpisodeStore((state) => state.selectClip);
	const setCurrentTime = useEpisodeStore((state) => state.setCurrentTime);
	const setEpisode = useEpisodeStore((state) => state.setEpisode);
	const setVideoClipVideoUrl = useEpisodeStore((state) => state.setVideoClipVideoUrl);
	const pause = useEpisodeStore((state) => state.pause);
	const play = useEpisodeStore((state) => state.play);
	const startWindowDrag = useDesktopWindowDrag();
	const [companionGenerationTarget, setCompanionGenerationTarget] =
		useState<CompanionGenerationTarget | null>(null);
	const [referenceSectionGeneration, setReferenceSectionGeneration] =
		useState<MarkdownSectionContext | null>(null);
	const [videoGenerationOpen, setVideoGenerationOpen] = useState(false);
	const [downloadingVideoClipIds, setDownloadingVideoClipIds] = useState<string[]>([]);
	const [isExportingAllStoryboards, setIsExportingAllStoryboards] = useState(false);
	const [isExportingJianyingDraft, setIsExportingJianyingDraft] = useState(false);
	const [previewPlaybackActive, setPreviewPlaybackActive] = useState(false);
	const [isSavingTaskSyncedEpisode, setIsSavingTaskSyncedEpisode] = useState(false);
	const previewPlayerRef = useRef<MediaPlayerInstance | null>(null);
	const lastPreviewErrorKey = useRef("");
	const activeWorkbench = getRouteDocumentWorkbench(location.search) ?? "timeline";
	const isCanvasWorkbench = activeWorkbench === "canvas";
	const activeDocument =
		findDocumentById(documents, documentId) ?? selectDocumentById(documents, activeDocumentId);
	const episodeDocumentId = activeDocument?.id ?? "";
	const shouldReturnToOverview = isAgentProjectViewState(location.state, "overview");
	const returnProjectView = shouldReturnToOverview ? "overview" : "document";
	const returnPath = projectId
		? agentProjectPath(projectId, shouldReturnToOverview ? {} : { documentId })
		: "/";
	const mediaAssetProjectId = projectId?.trim() ?? "";
	const { data: resolvedEpisodeState, mutate: mutateEpisodeState } = useSWR(
		episodeDocumentId ? workspaceResolvedEpisodeKey(episodeDocumentId, projectId) : null,
		() => getWorkspaceResolvedEpisode(episodeDocumentId, projectId),
	);
	const { data: mediaAssetsData, mutate: mutateMediaAssets } = useSWR(
		["episode-media-assets", mediaAssetProjectId],
		() => getMediaAssets({ projectId: mediaAssetProjectId || undefined }),
	);
	const { data: jianyingDraftSettings } = useSWR(
		jianyingDraftSettingsKey,
		getJianyingDraftSettings,
	);
	const storyboardVideoConversation = useMemo(
		() => projectGenerationConversation(projectId, "video"),
		[projectId],
	);
	const { data: storyboardVideoTasksData } = useSWR(
		storyboardVideoConversation && mediaAssetProjectId
			? generationTasksQueryKey(
					storyboardVideoConversation.conversationId,
					"video",
					storyboardVideoConversation.conversationScopeId,
					mediaAssetProjectId,
				)
			: null,
		() =>
			getGenerationTasks(
				storyboardVideoConversation?.conversationId,
				"video",
				storyboardVideoConversation?.conversationScopeId,
				mediaAssetProjectId,
			),
	);
	const resolvedEpisode = resolvedEpisodeState?.episode ?? null;

	const selectedClip = useMemo(
		() => findEpisodeClip(episode, selectedClipId),
		[episode, selectedClipId],
	);
	const openReferenceSectionGeneration = useCallback(
		(section: MarkdownSectionContext) =>
			setReferenceSectionGeneration(latestMarkdownSectionContextFromDocuments(documents, section)),
		[documents],
	);
	const clipMedia = useMemo(
		() => buildEpisodeClipMedia(episode, mediaAssetsData?.assets),
		[episode, mediaAssetsData?.assets],
	);
	const clipPlaybackRanges = useMemo(
		() => buildEpisodeVideoClipPlaybackRanges(episode, clipMedia),
		[clipMedia, episode],
	);
	const actualTimelineDuration = useMemo(() => {
		if (clipPlaybackRanges.length === 0) return undefined;
		return clipPlaybackRanges.at(-1)?.end ?? 0;
	}, [clipPlaybackRanges]);
	const playablePreviewRanges = useMemo(
		() => clipPlaybackRanges.filter((range) => isEpisodeVideoClipPlayable(range.clip)),
		[clipPlaybackRanges],
	);
	const previewStreamVersion = useMemo(
		() =>
			playablePreviewRanges
				.map((range) => `${range.clip.id}:${range.clip.videoUrl ?? ""}`)
				.join("|"),
		[playablePreviewRanges],
	);
	const previewStreamUrl = useMemo(() => {
		if (
			!episodeDocumentId ||
			!projectId?.trim() ||
			isSavingTaskSyncedEpisode ||
			playablePreviewRanges.length < 1
		) {
			return "";
		}
		return workspaceEpisodePreviewStreamURL(
			episodeDocumentId,
			projectId,
			previewStreamVersion || undefined,
		);
	}, [
		episodeDocumentId,
		isSavingTaskSyncedEpisode,
		playablePreviewRanges.length,
		previewStreamVersion,
		projectId,
	]);
	const playbackVideoUrl = previewStreamUrl || undefined;
	const playbackPosterUrl = useMemo(() => {
		const posterClip = previewStreamUrl ? playablePreviewRanges[0]?.clip : selectedClip;
		const posterMedia = posterClip ? clipMedia?.[posterClip.id] : undefined;
		return episodeClipPosterUrl(posterClip, posterMedia);
	}, [clipMedia, playablePreviewRanges, previewStreamUrl, selectedClip]);
	const playbackTitle = episode.title;
	const playbackTime = previewPlaybackActive ? currentTime : 0;
	const companionGenerationClip = useMemo(
		() =>
			companionGenerationTarget
				? findEpisodeVideoClip(episode, companionGenerationTarget.videoClipId)
				: null,
		[companionGenerationTarget, episode],
	);
	const downloadingVideoClipIdSet = useMemo(
		() => new Set(downloadingVideoClipIds),
		[downloadingVideoClipIds],
	);
	const storyboardVideoClips = useMemo(
		() => clipPlaybackRanges.map((range) => range.clip),
		[clipPlaybackRanges],
	);
	const exportableStoryboardVideoClips = useMemo(
		() => storyboardVideoClips.filter(hasClipVideoUrl),
		[storyboardVideoClips],
	);
	const clipIdByGenerationSectionId = useMemo(() => {
		const sections = new Map<string, string>();
		for (const clip of storyboardVideoClips) {
			const sourceSection = findEpisodeVideoSourceSection(
				activeDocument?.content ?? "",
				clip,
				activeDocument?.id ?? episodeDocumentId,
			);
			const context = buildEpisodeVideoContext(episode, clip, sourceSection);
			if (context.blockId.trim()) sections.set(context.blockId.trim(), clip.id);
		}
		return sections;
	}, [
		activeDocument?.content,
		activeDocument?.id,
		episode,
		episodeDocumentId,
		storyboardVideoClips,
	]);
	const latestStoryboardVideoTaskByClipId = useMemo(
		() =>
			latestStoryboardVideoTasksByClip(
				storyboardVideoTasksData?.tasks ?? [],
				clipIdByGenerationSectionId,
				episodeDocumentId,
			),
		[clipIdByGenerationSectionId, episodeDocumentId, storyboardVideoTasksData?.tasks],
	);
	const markVideoClipDownloading = useCallback((clipId: string, downloading: boolean) => {
		setDownloadingVideoClipIds((current) => {
			if (downloading) return current.includes(clipId) ? current : [...current, clipId];
			return current.filter((item) => item !== clipId);
		});
	}, []);
	const handleGeneratedVideoReady = useCallback(
		async (clipId: string, videoUrl: string | null) => {
			const previousEpisode = useEpisodeStore.getState().episode;
			const nextEpisode = setVideoClipVideoUrl(clipId, videoUrl);
			if (!nextEpisode || !episodeDocumentId) return;

			try {
				await updateWorkspaceEpisode(episodeDocumentId, nextEpisode, projectId);
				await mutateEpisodeState();
				await mutateMediaAssets();
			} catch (error) {
				setEpisode(previousEpisode);
				toast.error(videoUrl ? "视频素材保存失败" : "视频素材取消失败", {
					description: toErrorMessage(error),
				});
			}
		},
		[
			episodeDocumentId,
			mutateEpisodeState,
			mutateMediaAssets,
			projectId,
			setEpisode,
			setVideoClipVideoUrl,
			toast,
		],
	);
	const handleTimelineClipSelect = useCallback(
		(clipId: string) => {
			setPreviewPlaybackActive(false);
			selectClip(clipId);
			const range = findEpisodeClipPlaybackRange(clipPlaybackRanges, clipId);
			if (range) setCurrentTime(range.start);
		},
		[clipPlaybackRanges, selectClip, setCurrentTime],
	);
	const handleTimelineClipGenerate = useCallback(
		(clipId: string) => {
			setPreviewPlaybackActive(false);
			selectClip(clipId);
			const range = findEpisodeClipPlaybackRange(clipPlaybackRanges, clipId);
			if (range) setCurrentTime(range.start);
			const track = findEpisodeTrackForClip(episode, clipId);
			if (track?.type === "video") setVideoGenerationOpen(true);
		},
		[clipPlaybackRanges, episode, selectClip, setCurrentTime],
	);
	const handleTimelineClipDownload = useCallback(
		async (clip: TimelineClip) => {
			if (downloadingVideoClipIdSet.has(clip.id)) return;

			const videoUrl = clip.videoUrl?.trim();
			if (!videoUrl) {
				toast.warning("暂无可下载视频", { description: "当前分镜还没有生成视频。" });
				return;
			}

			markVideoClipDownloading(clip.id, true);
			try {
				const savedPath = await downloadGeneratedAssetToDirectory(
					{
						kind: "video",
						url: videoUrl,
						mimeType: "video/mp4",
						downloadPath: clipMedia?.[clip.id]?.downloadPath,
					},
					videoUrl,
					episodeClipVideoFilename(clip),
				);
				if (!savedPath) return;

				toast.success("文件已保存", { description: savedPath });
			} catch (error) {
				toast.error("保存失败", { description: toErrorMessage(error) });
			} finally {
				markVideoClipDownloading(clip.id, false);
			}
		},
		[clipMedia, downloadingVideoClipIdSet, markVideoClipDownloading, toast],
	);
	const handleExportAllStoryboards = useCallback(async () => {
		if (isExportingAllStoryboards) return;

		const clips = exportableStoryboardVideoClips;
		const skippedCount = Math.max(storyboardVideoClips.length - clips.length, 0);
		if (clips.length === 0) {
			toast.warning("暂无可导出分镜", {
				description: "生成视频后再导出全部分镜。",
			});
			return;
		}

		const directory = await pickDownloadDirectory();
		if (!directory) return;

		setIsExportingAllStoryboards(true);
		try {
			let savedCount = 0;
			const failedTitles: string[] = [];
			for (const [index, clip] of clips.entries()) {
				const videoUrl = clip.videoUrl?.trim();
				if (!videoUrl) continue;

				try {
					const savedPath = await downloadGeneratedAssetToDirectory(
						{
							kind: "video",
							url: videoUrl,
							mimeType: "video/mp4",
							downloadPath: clipMedia?.[clip.id]?.downloadPath,
						},
						videoUrl,
						episodeClipVideoFilename(clip, index),
						{ directory },
					);
					if (!savedPath) continue;
					savedCount += 1;
				} catch {
					failedTitles.push(clip.title || `第 ${index + 1} 个分镜`);
				}
			}

			if (savedCount === 0 && failedTitles.length > 0) {
				toast.error("导出失败", {
					description: exportStoryboardsSummary(savedCount, skippedCount, failedTitles),
				});
				return;
			}

			const description = exportStoryboardsSummary(savedCount, skippedCount, failedTitles);
			if (failedTitles.length > 0) {
				toast.warning("部分分镜已导出", { description });
				return;
			}

			toast.success(skippedCount > 0 ? "可用分镜已导出" : "全部分镜已导出", {
				description,
			});
		} catch (error) {
			toast.error("导出失败", { description: toErrorMessage(error) });
		} finally {
			setIsExportingAllStoryboards(false);
		}
	}, [
		clipMedia,
		exportableStoryboardVideoClips,
		isExportingAllStoryboards,
		storyboardVideoClips.length,
		toast,
	]);
	const handleExportJianyingDraft = useCallback(async () => {
		if (isExportingJianyingDraft) return;
		if (!projectId || !episodeDocumentId) return;

		const clips = exportableStoryboardVideoClips;
		if (clips.length === 0) {
			toast.warning("暂无可导出分镜", {
				description: "生成视频后再导出剪映草稿。",
			});
			return;
		}
		if (!jianyingDraftSettings?.draftsRoot?.trim()) {
			toast.warning("未设置剪映草稿文件夹", {
				description: "在设置里的“剪映草稿”选择文件夹后再导出。",
			});
			return;
		}

		setIsExportingJianyingDraft(true);
		try {
			const result = await exportWorkspaceEpisodeJianyingDraft(episodeDocumentId, {}, projectId);
			const skipped = result.skippedCount > 0 ? `，跳过 ${result.skippedCount} 个未生成分镜` : "";
			toast.success("剪映草稿已导出", {
				description: `${result.draftName} · ${result.shotCount} 个分镜${skipped}`,
			});
		} catch (error) {
			toast.error("导出剪映草稿失败", { description: toJianyingDraftErrorMessage(error) });
		} finally {
			setIsExportingJianyingDraft(false);
		}
	}, [
		episodeDocumentId,
		exportableStoryboardVideoClips,
		isExportingJianyingDraft,
		jianyingDraftSettings?.draftsRoot,
		projectId,
		toast,
	]);
	const handleWorkbenchSwitch = useCallback(
		(workbench: AgentDocumentWorkbench) => {
			if (!projectId || !episodeDocumentId) return;
			navigate(
				agentProjectPath(projectId, {
					documentId: episodeDocumentId,
					workbench,
				}),
				{ state: location.state },
			);
		},
		[episodeDocumentId, location.state, navigate, projectId],
	);
	const handleTimelineSeek = useCallback(
		(time: number) => {
			const range = findEpisodeClipPlaybackRangeAtTime(clipPlaybackRanges, time);
			if (range) selectClip(range.clip.id);
			setCurrentTime(time);
		},
		[clipPlaybackRanges, selectClip, setCurrentTime],
	);
	const handlePreviewPlaybackError = useCallback(
		(message: string) => {
			setPreviewPlaybackActive(false);
			pause();
			const description = message.trim() || "整条时间轴预览暂时无法播放，请稍后重试。";
			const errorKey = `${previewStreamUrl}:${description}`;
			if (lastPreviewErrorKey.current === errorKey) return;
			lastPreviewErrorKey.current = errorKey;
			toast.error("预览播放失败", { description });
		},
		[pause, previewStreamUrl, toast],
	);
	const startPreviewPlaybackAt = useCallback(
		(startTime: number, event?: React.MouseEvent<HTMLButtonElement>) => {
			const player = previewPlayerRef.current;
			setPreviewPlaybackActive(true);
			setCurrentTime(startTime);
			if (!player) {
				handlePreviewPlaybackError("预览播放器尚未准备好");
				return;
			}
			if (Math.abs(player.currentTime - startTime) > 0.3) {
				player.currentTime = startTime;
			}
			const nativeVideo = mediaPlayerVideoElement(player);
			const playbackRequest =
				nativeVideo?.play() ?? player.provider?.play() ?? player.play(event?.nativeEvent);
			void playbackRequest.catch((error: unknown) => {
				handlePreviewPlaybackError(toErrorMessage(error));
			});
			play();
		},
		[handlePreviewPlaybackError, play, setCurrentTime],
	);
	const handleTimelinePlaybackToggle = useCallback(
		(event?: React.MouseEvent<HTMLButtonElement>) => {
			if (isPlaying) {
				const player = previewPlayerRef.current;
				const nativeVideo = player ? mediaPlayerVideoElement(player) : null;
				nativeVideo?.pause();
				if (!nativeVideo) void player?.pause(event?.nativeEvent);
				pause();
				return;
			}

			if (previewStreamUrl) {
				const shouldRestart =
					typeof actualTimelineDuration === "number" &&
					actualTimelineDuration > 0 &&
					currentTime >= actualTimelineDuration - 0.05;
				const playbackStartTime = shouldRestart || !previewPlaybackActive ? 0 : currentTime;
				startPreviewPlaybackAt(playbackStartTime, event);
				return;
			}

			pause();
		},
		[
			actualTimelineDuration,
			currentTime,
			isPlaying,
			pause,
			previewPlaybackActive,
			previewStreamUrl,
			startPreviewPlaybackAt,
		],
	);
	const handleTimelineClipPlay = useCallback(
		(clipId: string) => {
			selectClip(clipId);
			const range = findEpisodeClipPlaybackRange(clipPlaybackRanges, clipId);
			const startTime = range?.start ?? 0;
			if (range && previewStreamUrl && isEpisodeVideoClipPlayable(range.clip)) {
				startPreviewPlaybackAt(startTime);
				return;
			}
			setPreviewPlaybackActive(false);
			pause();
			setCurrentTime(startTime);
		},
		[
			clipPlaybackRanges,
			pause,
			previewStreamUrl,
			selectClip,
			setCurrentTime,
			startPreviewPlaybackAt,
		],
	);
	const handlePreviewPlayingChange = useCallback(
		(playing: boolean) => {
			if (playing) {
				if (!previewPlaybackActive && currentTime > 0.05) setCurrentTime(0);
				setPreviewPlaybackActive(true);
				play();
				return;
			}
			pause();
		},
		[currentTime, pause, play, previewPlaybackActive, setCurrentTime],
	);
	const handlePreviewTimeUpdate = useCallback(
		(localTime: number) => {
			setCurrentTime(localTime);
		},
		[setCurrentTime],
	);
	const handlePreviewEnded = useCallback(() => {
		if (typeof actualTimelineDuration === "number") setCurrentTime(actualTimelineDuration);
		setPreviewPlaybackActive(false);
		pause();
	}, [actualTimelineDuration, pause, setCurrentTime]);
	const handleCompanionGenerationRequest = useCallback(
		(videoClipId: string, trackType: TimelineCompanionTrackType) => {
			setCompanionGenerationTarget({ trackType, videoClipId });
		},
		[],
	);
	const handleCompanionGenerationCommit = useCallback(
		async (videoClipId: string, trackType: TimelineCompanionTrackType, content: string) => {
			const previousEpisode = episode;
			const nextEpisode = addCompanionTextClip(videoClipId, trackType, content);
			setCompanionGenerationTarget(null);
			if (!nextEpisode || !episodeDocumentId) return;

			try {
				await updateWorkspaceEpisode(episodeDocumentId, nextEpisode, projectId);
				await mutateEpisodeState();
			} catch (error) {
				setEpisode(previousEpisode);
				toast.error("剪辑台保存失败", {
					description: toErrorMessage(error),
				});
			}
		},
		[
			addCompanionTextClip,
			episode,
			episodeDocumentId,
			mutateEpisodeState,
			projectId,
			setEpisode,
			toast,
		],
	);

	useEffect(() => {
		if (!resolvedEpisode) return;
		setEpisode(resolvedEpisode);
		setPreviewPlaybackActive(false);
	}, [resolvedEpisode, setEpisode]);

	useEffect(() => {
		if (latestStoryboardVideoTaskByClipId.size === 0) return;

		const currentEpisode = useEpisodeStore.getState().episode;
		const syncedEpisode = episodeWithStoryboardVideoTaskStatuses(
			currentEpisode,
			latestStoryboardVideoTaskByClipId,
		);
		if (!syncedEpisode.changed) return;

		setEpisode(syncedEpisode.episode);
		if (!episodeDocumentId || !syncedEpisode.hasReadyVideo) return;

		setIsSavingTaskSyncedEpisode(true);
		void updateWorkspaceEpisode(episodeDocumentId, syncedEpisode.episode, projectId)
			.then(async () => {
				await mutateEpisodeState();
				await mutateMediaAssets();
			})
			.catch((error) => {
				toast.error("剪辑台状态同步失败", {
					description: toErrorMessage(error),
				});
			})
			.finally(() => {
				setIsSavingTaskSyncedEpisode(false);
			});
	}, [
		episodeDocumentId,
		latestStoryboardVideoTaskByClipId,
		mutateEpisodeState,
		mutateMediaAssets,
		projectId,
		setEpisode,
		toast,
	]);

	useEffect(() => {
		if (previewStreamUrl) return;
		setPreviewPlaybackActive(false);
	}, [previewStreamUrl]);

	useEffect(() => {
		lastPreviewErrorKey.current = "";
	}, [previewStreamUrl]);

	useEffect(() => {
		if (typeof actualTimelineDuration !== "number") return;
		if (currentTime <= actualTimelineDuration) return;
		setCurrentTime(actualTimelineDuration);
	}, [actualTimelineDuration, currentTime, setCurrentTime]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-ide-editor text-ide-editor-foreground">
			<header
				className="episode-workbench-header flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-ide-toolbar px-2 text-ide-toolbar-foreground"
				onPointerDown={startWindowDrag}
			>
				<div className="flex min-w-0 flex-1 items-center gap-2" data-desktop-drag-region>
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="size-7 rounded-sm"
						aria-label={shouldReturnToOverview ? "返回概览" : "返回文档"}
						onClick={() =>
							navigate(returnPath, {
								state: agentProjectRouteState(returnProjectView),
							})
						}
					>
						<ArrowLeft />
					</Button>
					<div className="min-w-0">
						<h1 className="truncate text-sm font-semibold text-foreground">{episode.title}</h1>
					</div>
				</div>
				<div className="flex shrink-0 items-center overflow-hidden rounded-sm border border-border bg-ide-editor p-0.5">
					<Button
						type="button"
						variant={activeWorkbench === "timeline" ? "secondary" : "ghost"}
						size="sm"
						className="h-7 rounded-sm px-2"
						onClick={() => handleWorkbenchSwitch("timeline")}
					>
						<Rows3 className="size-4" />
						<span>预览</span>
					</Button>
					<Button
						type="button"
						variant={activeWorkbench === "canvas" ? "secondary" : "ghost"}
						size="sm"
						className="h-7 rounded-sm px-2"
						onClick={() => handleWorkbenchSwitch("canvas")}
					>
						<GitBranch className="size-4" />
						<span>总线</span>
					</Button>
				</div>
			</header>

			<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
				{isCanvasWorkbench ? (
					<EpisodeCanvasView
						activeDocument={activeDocument ?? null}
						assets={assets}
						documents={documents}
						episode={episode}
						selectedClipId={selectedClipId}
						storyboardMarkdown={activeDocument?.content ?? ""}
						onGenerateClip={handleTimelineClipGenerate}
						onOpenReferenceGeneration={openReferenceSectionGeneration}
						onRequestCompanionGeneration={handleCompanionGenerationRequest}
						onSelectClip={handleTimelineClipSelect}
					/>
				) : (
					<section className="grid min-h-0 flex-1 grid-cols-1 border-b border-border">
						<div className="flex min-h-0 flex-1 flex-col gap-2 bg-ide-preview p-2">
							<div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden border border-border bg-ide-editor">
								<div className="absolute right-4 top-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap justify-end gap-2">
									{isJianyingDraftExportButtonVisible ? (
										<Button
											type="button"
											variant="secondary"
											size="sm"
											className="h-8 px-3 shadow-sm max-sm:px-2"
											disabled={
												isExportingJianyingDraft || exportableStoryboardVideoClips.length === 0
											}
											aria-label="导出剪映草稿"
											title={
												exportableStoryboardVideoClips.length > 0
													? "导出剪映草稿"
													: "暂无可导出的分镜视频"
											}
											onClick={handleExportJianyingDraft}
										>
											{isExportingJianyingDraft ? (
												<Loader2 className="animate-spin" />
											) : (
												<Clapperboard />
											)}
											<span className="hidden sm:inline">
												{isExportingJianyingDraft ? "导出中" : "导出剪映草稿"}
											</span>
										</Button>
									) : null}
									<Button
										type="button"
										variant="secondary"
										size="sm"
										className="h-8 px-3 shadow-sm max-sm:px-2"
										disabled={
											isExportingAllStoryboards || exportableStoryboardVideoClips.length === 0
										}
										aria-label="导出全部分镜"
										title={
											exportableStoryboardVideoClips.length > 0
												? "导出全部已生成分镜视频"
												: "暂无可导出的分镜视频"
										}
										onClick={handleExportAllStoryboards}
									>
										{isExportingAllStoryboards ? (
											<Loader2 className="animate-spin" />
										) : (
											<Download />
										)}
										<span className="hidden sm:inline">
											{isExportingAllStoryboards ? "导出中" : "导出全部分镜"}
										</span>
									</Button>
								</div>
								<EpisodePreviewPlayer
									videoUrl={playbackVideoUrl}
									posterUrl={playbackPosterUrl}
									title={playbackTitle}
									currentTime={playbackTime}
									isPlaying={isPlaying && Boolean(playbackVideoUrl)}
									onEnded={handlePreviewEnded}
									onPlayingChange={handlePreviewPlayingChange}
									onPlaybackError={handlePreviewPlaybackError}
									onTimeUpdate={handlePreviewTimeUpdate}
									playerRef={previewPlayerRef}
								/>
							</div>
						</div>
					</section>
				)}

				<EpisodeTimelineEditor
					episode={episode}
					clipMedia={clipMedia}
					currentTime={currentTime}
					isPlaying={isPlaying}
					selectedClipId={selectedClipId}
					timelineDuration={actualTimelineDuration}
					downloadingClipIds={downloadingVideoClipIds}
					zoom={zoom}
					onRequestCompanionGeneration={handleCompanionGenerationRequest}
					onDownloadClip={handleTimelineClipDownload}
					onGenerateClip={handleTimelineClipGenerate}
					onPlayClip={handleTimelineClipPlay}
					onSeek={handleTimelineSeek}
					onSelectClip={handleTimelineClipSelect}
					onTogglePlayback={handleTimelinePlaybackToggle}
				/>
			</main>
			<EpisodeCompanionGenerationDialog
				episode={episode}
				open={Boolean(companionGenerationTarget && companionGenerationClip)}
				trackType={companionGenerationTarget?.trackType ?? null}
				videoClip={companionGenerationClip}
				onOpenChange={(open) => {
					if (!open) setCompanionGenerationTarget(null);
				}}
				onCommit={handleCompanionGenerationCommit}
			/>
			<EpisodeVideoGenerationDialog
				documentId={episodeDocumentId}
				documentTitle={activeDocument?.title ?? episode.title}
				episode={episode}
				open={videoGenerationOpen}
				projectId={projectId ?? undefined}
				selectedClip={selectedClip}
				selectedVideoUrl={selectedClip?.videoUrl ?? null}
				onOpenChange={setVideoGenerationOpen}
				onOpenReferenceGeneration={openReferenceSectionGeneration}
				onGeneratedVideoReady={handleGeneratedVideoReady}
			/>
			<ImageGenerationDialog
				open={Boolean(referenceSectionGeneration)}
				projectId={projectId ?? undefined}
				section={referenceSectionGeneration}
				onGenerationComplete={() => undefined}
				onGenerationError={() => undefined}
				onGenerationStart={() => undefined}
				onOpenChange={(open) => {
					if (!open) setReferenceSectionGeneration(null);
				}}
				onOpenReferenceGeneration={openReferenceSectionGeneration}
			/>
		</div>
	);
};

const episodeClipVideoFilename = (clip: TimelineClip, index?: number) => {
	const title = clip.title
		.replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const prefix = typeof index === "number" ? `${String(index + 1).padStart(2, "0")}-` : "";
	return `${prefix}${(title || "分镜视频").slice(0, 40)}-video`;
};

const hasClipVideoUrl = (clip: TimelineClip) => Boolean(clip.videoUrl?.trim());

const latestStoryboardVideoTasksByClip = (
	tasks: GenerationTask[],
	clipIdBySectionId: Map<string, string>,
	documentId: string,
) => {
	const latestByClipId = new Map<string, GenerationTask>();
	const normalizedDocumentId = documentId.trim();

	for (const task of tasks) {
		if (task.kind !== "video") continue;
		if (normalizedDocumentId && task.documentId?.trim() !== normalizedDocumentId) continue;

		const sectionId = task.sectionId?.trim() ?? "";
		const clipId = sectionId ? clipIdBySectionId.get(sectionId) : undefined;
		if (!clipId) continue;

		const current = latestByClipId.get(clipId);
		if (!current || generationTaskTime(task) >= generationTaskTime(current)) {
			latestByClipId.set(clipId, task);
		}
	}

	return latestByClipId;
};

const episodeWithStoryboardVideoTaskStatuses = (
	episode: Episode,
	taskByClipId: Map<string, GenerationTask>,
) => {
	let changed = false;
	let hasReadyVideo = false;
	const tracks = episode.tracks.map((track) => {
		if (track.type !== "video") return track;

		let trackChanged = false;
		const clips = track.clips.map((clip) => {
			const task = taskByClipId.get(clip.id);
			if (!task) return clip;

			const nextClip = clipWithStoryboardVideoTask(clip, task);
			if (nextClip === clip) return clip;

			trackChanged = true;
			changed = true;
			if (nextClip.status === "ready" && nextClip.videoUrl?.trim()) hasReadyVideo = true;
			return nextClip;
		});

		return trackChanged ? { ...track, clips } : track;
	});

	return {
		changed,
		episode: changed ? { ...episode, tracks } : episode,
		hasReadyVideo,
	};
};

const clipWithStoryboardVideoTask = (clip: TimelineClip, task: GenerationTask) => {
	const videoAsset = task.assets.find(
		(asset) => asset.kind === "video" && firstVideoAssetSource([asset]),
	);
	const videoUrl = videoAsset ? firstVideoAssetSource([videoAsset]) : "";
	const nextStatus = storyboardTaskClipStatus(task, videoUrl);
	const nextClip: TimelineClip = {
		...clip,
		status: nextStatus,
		...(videoUrl
			? {
					videoUrl,
					...(videoAsset?.posterUrl ? { posterUrl: videoAsset.posterUrl } : {}),
				}
			: {}),
	};

	return sameTimelineClipGenerationState(clip, nextClip) ? clip : nextClip;
};

const storyboardTaskClipStatus = (task: GenerationTask, videoUrl: string): TimelineClipStatus => {
	if (videoUrl) return "ready";
	if (isFailedGenerationTaskStatus(task.status)) return "error";
	if (isPendingGenerationTaskStatus(task.status)) return "generating";
	if (["completed", "succeeded", "success"].includes(task.status.toLowerCase())) return "error";
	return "draft";
};

const isPendingGenerationTaskStatus = (status: string) =>
	["loading", "submitting", "submitted", "running", "pending", "processing", "queued"].includes(
		status.toLowerCase(),
	);

const isFailedGenerationTaskStatus = (status: string) =>
	["failed", "error", "cancelled", "canceled"].includes(status.toLowerCase());

const generationTaskTime = (task: Pick<GenerationTask, "createdAt" | "updatedAt">) => {
	const time = Date.parse(task.updatedAt || task.createdAt || "");
	return Number.isNaN(time) ? 0 : time;
};

const sameTimelineClipGenerationState = (left: TimelineClip, right: TimelineClip) =>
	left.status === right.status &&
	(left.videoUrl ?? "") === (right.videoUrl ?? "") &&
	(left.posterUrl ?? "") === (right.posterUrl ?? "") &&
	(left.thumbnailUrl ?? "") === (right.thumbnailUrl ?? "");

const exportStoryboardsSummary = (
	savedCount: number,
	skippedCount: number,
	failedTitles: string[],
) => {
	const parts = [`已保存 ${savedCount} 个视频`];
	if (skippedCount > 0) parts.push(`跳过 ${skippedCount} 个未生成分镜`);
	if (failedTitles.length > 0) {
		const names = failedTitles.slice(0, 2).join("、");
		parts.push(
			`${failedTitles.length} 个保存失败${names ? `（${names}${failedTitles.length > 2 ? " 等" : ""}）` : ""}`,
		);
	}
	return `${parts.join("，")}。`;
};

const mediaPlayerVideoElement = (player: MediaPlayerInstance) => {
	const querySelector = (
		player as unknown as { querySelector?: (selector: string) => Element | null }
	).querySelector;
	const element = querySelector?.call(player, "video");
	return element instanceof HTMLVideoElement ? element : null;
};

const toErrorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return "请稍后重试，或返回文档后重新进入剪辑工作台。";
};

const toJianyingDraftErrorMessage = (error: unknown) => {
	const message = toErrorMessage(error);
	if (message.includes("draft root is not configured")) {
		return "先在设置里的“剪映草稿”选择草稿文件夹。";
	}
	if (message.includes("draft already exists")) {
		return "同名剪映草稿已存在，请稍后重试或清理目标文件夹。";
	}
	if (message.includes("no exportable storyboard videos")) {
		return "当前没有已生成的视频分镜。";
	}
	if (message.includes("unsupported media asset url")) {
		return "分镜视频不是本地媒体库素材，无法写入剪映草稿。";
	}
	return message;
};
