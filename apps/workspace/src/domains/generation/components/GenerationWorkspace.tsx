import { FileText } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { mutate as mutateSWR } from "swr";
import {
	generationModelsKey,
	type GenerationAsset,
	type GenerationKind,
	previewGenerationVoice,
} from "@/domains/generation/api/generation";
import { GenerationChatPanel } from "@/domains/generation/components/GenerationChatPanel";
import {
	GenerationSetupNotice,
	ModeToggle,
} from "@/domains/generation/components/GenerationSetupNotice";
import {
	GenerationComposerPanel,
	generationComposerPromptInputClassName,
	generationComposerSelectClassName,
	generationComposerToolbarGhostButtonClassName,
} from "@/domains/generation/components/GenerationComposerPanel";
import {
	GenerationBrandMark,
	generationFamilyBrand,
	generationModelBrand,
} from "@/domains/generation/components/GenerationBrandMark";
import { GenerationModelRoutePicker } from "@/domains/generation/components/GenerationModelRoutePicker";
import {
	filterImageGenerationSpecParams,
	resolveImageGenerationSpec,
} from "@/domains/generation/components/imageGenerationSpec";
import { ImageGenerationSpecControl } from "@/domains/generation/components/ImageGenerationSpecControl";
import {
	GenerationCountControl,
	PrimaryParamControl,
	ReferenceSelectionDialog,
	SecondaryParamsDropdown,
} from "@/domains/generation/components/MediaGenerationDialogs";
import { PromptEditor } from "@/domains/generation/components/PromptEditor";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";
import { Button } from "@/shared/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { useGeneratedResultActions } from "@/domains/generation/components/generatedResultActions";
import { resolveParamGroups } from "@/domains/generation/components/mediaGenerationHelpers";
import { generationAssetSource } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { useToast } from "@/hooks/useToast";
import { openExternalUrl } from "@/shared/desktop/actions";

export {
	generationAssetSelectionKey,
	generationAssetSource,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
export { GenerationHistoryPanel } from "@/domains/generation/components/GenerationHistoryPanel";
export { MaterialLibrary } from "@/domains/generation/components/MaterialLibrary";

export interface GenerationWorkspaceProps {
	activeEntryId?: string | null;
	conversationId?: string | null;
	conversationScopeId?: string | null;
	conversationTitle?: string | null;
	focusActiveEntry?: boolean;
	historyScopeId?: string;
	initialKind?: GenerationKind;
	initialPrompt?: string;
	lockKind?: boolean;
	mediaAssetProjectId?: string | null;
	onActiveEntryChange?: (entryId: string | null) => void;
	onOpenSettings?: () => void;
	onSelectGeneratedAsset?: (asset: GenerationAsset) => void;
	projectHistory?: boolean;
	projectId?: string;
	requireConversation?: boolean;
	selectedGeneratedAssetKey?: string | null;
	uploadIdPrefix?: string;
}

export const Generate: React.FC = () => <GenerationWorkspace />;

const openDocumentationUrl = async (url: string) => {
	await openExternalUrl(url);
};

const voicePreviewPlaybackBlockedMessage = "浏览器拦截了自动播放，请再点一次播放。";

const errorMessage = (err: unknown) =>
	err && typeof err === "object" && "message" in err
		? String((err as { message?: unknown }).message || "")
		: "";

const isPlaybackBlockedError = (err: unknown) =>
	err instanceof DOMException
		? err.name === "NotAllowedError"
		: err && typeof err === "object" && "name" in err
			? String((err as { name?: unknown }).name || "") === "NotAllowedError"
			: false;

export const GenerationWorkspace: React.FC<GenerationWorkspaceProps> = ({
	activeEntryId,
	conversationId,
	conversationScopeId,
	conversationTitle,
	focusActiveEntry = false,
	historyScopeId,
	initialKind,
	initialPrompt = "",
	lockKind = false,
	mediaAssetProjectId,
	onActiveEntryChange,
	onOpenSettings,
	onSelectGeneratedAsset,
	projectHistory = false,
	projectId,
	requireConversation = false,
	selectedGeneratedAssetKey,
	uploadIdPrefix,
}) => {
	const navigate = useNavigate();
	const toast = useToast();
	const ws = useGenerationWorkspace({
		activeEntryId,
		conversationId,
		conversationScopeId,
		conversationTitle,
		historyScopeId,
		initialKind,
		initialPrompt,
		mediaAssetProjectId,
		projectHistory,
		projectId,
		requireConversation,
		uploadIdPrefix: uploadIdPrefix ?? "generation",
		onActiveEntryIdChange: onActiveEntryChange,
	});
	const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
	const voicePreviewSourceCacheRef = useRef(new Map<string, string>());
	const voicePreviewCatalogRefreshRef = useRef("");
	const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
	const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
	const resolvedMediaAssetProjectId =
		mediaAssetProjectId === undefined ? (projectId?.trim() ?? "") : (mediaAssetProjectId ?? "");
	const resultActions = useGeneratedResultActions({
		mediaAssetProjectId: resolvedMediaAssetProjectId,
		mutateMediaAssets: ws.mutateMediaAssets,
		projectId,
	});
	const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);

	const activeGenerationKind = ws.kind;
	const isTextGeneration = activeGenerationKind === "text";
	const compactPromptPlaceholder =
		activeGenerationKind === "image"
			? "描述想生成的图像内容、风格、主体和光线"
			: activeGenerationKind === "text"
				? "描述你想生成的文本..."
				: activeGenerationKind === "audio"
					? "输入要转成语音的旁白、台词或配音文案"
					: "描述想生成的视频镜头、运动、机位和节奏";
	const submitLabel =
		activeGenerationKind === "image"
			? "生成图像"
			: activeGenerationKind === "text"
				? "生成文本"
				: activeGenerationKind === "audio"
					? "生成音频"
					: "生成视频";
	const selectedFamilyBrand = generationModelBrand({
		family: ws.selectedFamily,
		route: ws.selectedRoute,
		version: ws.selectedVersion,
	});
	const routeParamGroups = useMemo(() => resolveParamGroups(ws.selectedRoute), [ws.selectedRoute]);
	const sizeGroupParams = useMemo(
		() => routeParamGroups.find((group) => group.id === "size")?.params ?? [],
		[routeParamGroups],
	);
	const countGroupParams = useMemo(
		() => routeParamGroups.find((group) => group.id === "count")?.params ?? [],
		[routeParamGroups],
	);
	const otherParamGroup = useMemo(
		() => routeParamGroups.find((group) => group.id === "other") ?? null,
		[routeParamGroups],
	);
	const imageSpec = useMemo(
		() =>
			resolveImageGenerationSpec(sizeGroupParams, ws.selectedParams, ws.selectedRoute.paramCombos),
		[sizeGroupParams, ws.selectedParams, ws.selectedRoute.paramCombos],
	);
	const routeGenerationCountParam = countGroupParams.find(
		(param) => param.name === "n" && param.type === "number",
	);
	const imageSpecControlledParamNames = useMemo(
		() => new Set(imageSpec?.controlledParamNames ?? []),
		[imageSpec],
	);
	const primaryParamGroups = useMemo(
		() =>
			routeParamGroups.filter(
				(group) =>
					group.id !== "size" &&
					group.id !== "count" &&
					group.id !== "other" &&
					group.params.length === 1 &&
					group.params[0]?.type === "select",
			),
		[routeParamGroups],
	);
	const renderedPrimaryParamNames = useMemo(() => {
		const names = new Set(imageSpecControlledParamNames);
		if (routeGenerationCountParam) names.add(routeGenerationCountParam.name);
		for (const group of primaryParamGroups) {
			const param = group.params[0];
			if (param) names.add(param.name);
		}
		return names;
	}, [imageSpecControlledParamNames, primaryParamGroups, routeGenerationCountParam]);
	const secondaryRouteParams = useMemo(
		() =>
			filterImageGenerationSpecParams(
				[
					...(otherParamGroup?.params ?? []),
					...routeParamGroups.flatMap((group) =>
						group.id === "other"
							? []
							: group.params.filter((param) => !renderedPrimaryParamNames.has(param.name)),
					),
				],
				imageSpec,
			),
		[imageSpec, otherParamGroup, renderedPrimaryParamNames, routeParamGroups],
	);
	const generationCountMin = routeGenerationCountParam?.min ?? 1;
	const generationCountMax = routeGenerationCountParam?.max ?? 4;
	const selectedGenerationCount = routeGenerationCountParam
		? normalizeGenerationCount(
				Number(
					ws.selectedParams[routeGenerationCountParam.name] ?? routeGenerationCountParam.default,
				),
				generationCountMin,
				generationCountMax,
			)
		: 1;
	const sessionRequiredMessage = ws.needsConversation ? "请先从左侧新建或选择一个 session。" : "";
	const canSelectReferenceAssets =
		ws.hasConfiguredRoutesForKind && ws.selectedRoute.supportsReferenceUrls;
	const referenceDialogTitle = activeGenerationKind === "video" ? "选择参考素材" : "选择参考图";
	const referenceButtonLabel = activeGenerationKind === "video" ? "参考素材" : "参考图";
	const updateComposerGenerationCount = (value: string) => {
		if (!routeGenerationCountParam) return;

		const nextCount = normalizeGenerationCount(
			Number(value),
			generationCountMin,
			generationCountMax,
		);
		ws.updateParam(routeGenerationCountParam.name, nextCount);
	};
	useEffect(
		() => () => {
			voicePreviewAudioRef.current?.pause();
			if (voicePreviewAudioRef.current) voicePreviewAudioRef.current.onended = null;
			voicePreviewAudioRef.current = null;
			voicePreviewSourceCacheRef.current.clear();
		},
		[],
	);
	const voicePreviewRouteIds = useMemo(() => {
		const routeIds = new Set<string>();
		if (ws.selectedRoute.kind !== "audio") return routeIds;

		routeIds.add(ws.selectedRoute.id);
		for (const route of ws.visibleFamilyRoutes) {
			if (route.kind === "audio" && route.familyId === ws.selectedRoute.familyId) {
				routeIds.add(route.id);
			}
		}
		return routeIds;
	}, [
		ws.selectedRoute.familyId,
		ws.selectedRoute.id,
		ws.selectedRoute.kind,
		ws.visibleFamilyRoutes,
	]);
	const voicePreviewAssetsByVoiceId = useMemo(() => {
		const assets = new Map<string, NonNullable<typeof ws.catalog.voicePreviews>[number]>();
		for (const preview of ws.catalog?.voicePreviews ?? []) {
			if (!voicePreviewRouteIds.has(preview.routeId)) continue;
			const current = assets.get(preview.voiceId);
			if (!current || preview.routeId === ws.selectedRoute.id) {
				assets.set(preview.voiceId, preview);
			}
		}
		return assets;
	}, [voicePreviewRouteIds, ws.catalog?.voicePreviews, ws.selectedRoute.id]);
	const previewableVoiceIds = useMemo(
		() => new Set(voicePreviewAssetsByVoiceId.keys()),
		[voicePreviewAssetsByVoiceId],
	);
	useEffect(() => {
		if (ws.selectedRoute.kind !== "audio" || voicePreviewAssetsByVoiceId.size > 0) return;
		if (voicePreviewCatalogRefreshRef.current === ws.selectedRoute.id) return;

		voicePreviewCatalogRefreshRef.current = ws.selectedRoute.id;
		void mutateSWR(generationModelsKey);
	}, [voicePreviewAssetsByVoiceId.size, ws.selectedRoute.id, ws.selectedRoute.kind]);
	const stopVoicePreview = useCallback((voiceID?: string) => {
		voicePreviewAudioRef.current?.pause();
		if (voicePreviewAudioRef.current) voicePreviewAudioRef.current.onended = null;
		voicePreviewAudioRef.current = null;
		setPlayingVoiceId((current) => (!voiceID || current === voiceID ? null : current));
	}, []);
	const playVoicePreviewSource = useCallback(
		async (source: string, voiceID: string) => {
			stopVoicePreview();
			const audio = new Audio(source);
			audio.onended = () => {
				if (voicePreviewAudioRef.current !== audio) return;

				voicePreviewAudioRef.current = null;
				setPlayingVoiceId((current) => (current === voiceID ? null : current));
			};
			voicePreviewAudioRef.current = audio;
			try {
				await audio.play();
				setPlayingVoiceId(voiceID);
			} catch (err) {
				if (voicePreviewAudioRef.current === audio) {
					audio.onended = null;
					voicePreviewAudioRef.current = null;
				}
				setPlayingVoiceId((current) => (current === voiceID ? null : current));
				throw err;
			}
		},
		[stopVoicePreview],
	);
	const previewVoice = useCallback(
		async (voiceID: string) => {
			const normalizedVoiceID = voiceID.trim();
			if (!normalizedVoiceID) return;
			if (playingVoiceId === normalizedVoiceID) {
				stopVoicePreview(normalizedVoiceID);
				return;
			}
			if (!ws.hasConfiguredRoutesForKind || ws.selectedRoute.kind !== "audio") {
				toast.warning("当前模型不支持音色预览。");
				return;
			}
			const previewAsset = voicePreviewAssetsByVoiceId.get(normalizedVoiceID);
			if (!previewAsset) {
				toast.warning("这个音色暂无本地试听。");
				return;
			}

			const cacheKey = JSON.stringify({
				routeId: previewAsset.routeId,
				voiceId: normalizedVoiceID,
			});
			const cachedSource = voicePreviewSourceCacheRef.current.get(cacheKey);
			if (cachedSource) {
				try {
					await playVoicePreviewSource(cachedSource, normalizedVoiceID);
				} catch (err) {
					const message = errorMessage(err);
					toast.error("音色预览失败", {
						description: message || "浏览器暂时无法播放这个试听音频。",
					});
				}
				return;
			}

			setPreviewingVoiceId(normalizedVoiceID);
			try {
				const response = await previewGenerationVoice({
					routeId: previewAsset.routeId,
					voiceId: normalizedVoiceID,
				});
				const source = generationAssetSource(response.asset);
				if (!source) throw new Error("音色预览未返回可播放音频。");

				voicePreviewSourceCacheRef.current.set(cacheKey, source);
				try {
					await playVoicePreviewSource(source, normalizedVoiceID);
				} catch (err) {
					if (isPlaybackBlockedError(err)) {
						toast.warning("试听已生成", {
							description: voicePreviewPlaybackBlockedMessage,
						});
						return;
					}
					throw err;
				}
			} catch (err) {
				const message = errorMessage(err);
				toast.error("音色预览失败", {
					description: message || "这个音色暂无可播放的本地试听文件。",
				});
			} finally {
				setPreviewingVoiceId((current) => (current === normalizedVoiceID ? null : current));
			}
		},
		[
			playingVoiceId,
			playVoicePreviewSource,
			stopVoicePreview,
			toast,
			voicePreviewAssetsByVoiceId,
			ws.hasConfiguredRoutesForKind,
			ws.selectedRoute.kind,
		],
	);
	const primaryParamControls = useMemo(
		() =>
			primaryParamGroups.map((group) => {
				const param = group.params[0];
				if (!param) return null;

				return (
					<PrimaryParamControl
						key={`${group.id}:${param.name}`}
						label={group.label}
						param={param}
						playingVoiceId={param.name === "voiceId" ? playingVoiceId : undefined}
						previewableVoiceIds={param.name === "voiceId" ? previewableVoiceIds : undefined}
						previewingVoiceId={previewingVoiceId}
						value={ws.selectedParams[param.name]}
						onChange={(value) => ws.updateParam(param.name, value)}
						onPreviewVoice={previewVoice}
					/>
				);
			}),
		[
			previewVoice,
			playingVoiceId,
			previewableVoiceIds,
			previewingVoiceId,
			primaryParamGroups,
			ws.selectedParams,
			ws.updateParam,
		],
	);
	const copyComposerPrompt = () => {
		void resultActions.copyText(ws.fullPrompt, "没有可复制的完整提示词");
	};
	const openSettings = () => {
		onOpenSettings?.();
		navigate("/settings");
	};
	const promptSlashItems = ws.promptInsertItems;

	const generationComposer = (
		<form onSubmit={ws.submit} className="shrink-0">
			{ws.hasConfiguredRoutesForKind ? (
				<GenerationComposerPanel
					canCopyPrompt={Boolean(ws.fullPrompt.trim())}
					canSelectReference={canSelectReferenceAssets}
					canSubmit={ws.canSubmit}
					error={ws.error || sessionRequiredMessage}
					errorTone={ws.error ? "error" : "warning"}
					isSubmitting={ws.isSubmitting}
					leftControls={
						<>
							{lockKind ? null : <ModeToggle compact kind={ws.kind} onChange={ws.setKind} />}
							<Select value={ws.selectedFamily.id} onValueChange={ws.updateFamily}>
								<SelectTrigger
									aria-label="模型名称"
									className={generationComposerSelectClassName()}
								>
									<GenerationBrandMark
										brand={selectedFamilyBrand}
										className="size-4 text-[0.5rem]"
									/>
									<span>{ws.selectedFamily.label}</span>
								</SelectTrigger>
								<SelectContent align="start">
									{ws.visibleFamilies.map((family) => (
										<SelectItem key={family.id} value={family.id} textValue={family.label}>
											<span className="flex min-w-0 items-center gap-2">
												<GenerationBrandMark
													brand={generationFamilyBrand(family)}
													className="size-4 text-[0.5rem]"
												/>
												<span className="min-w-0 truncate">{family.label}</span>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<GenerationModelRoutePicker
								routes={ws.visibleFamilyRoutes}
								selectedRoute={ws.selectedRoute}
								selectedVersion={ws.selectedVersion}
								versions={ws.visibleVersions}
								onSelect={ws.updateModelRoute}
							/>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								aria-label="打开模型文档"
								className={generationComposerToolbarGhostButtonClassName()}
								onClick={() => void openDocumentationUrl(ws.selectedRoute.docUrl)}
							>
								<FileText className="size-4 shrink-0 text-muted-foreground" />
								<span>文档</span>
							</Button>
						</>
					}
					promptInput={
						<PromptEditor
							value={ws.prompt}
							onChange={ws.setPrompt}
							placeholder={compactPromptPlaceholder}
							className={generationComposerPromptInputClassName}
							slashItems={promptSlashItems}
						/>
					}
					referenceButtonLabel={referenceButtonLabel}
					referencePreview={
						canSelectReferenceAssets ? (
							<ReferencePreviewStrip
								disabled={!ws.hasConfiguredRoutesForKind || !ws.selectedRoute.supportsReferenceUrls}
								enableImagePreview
								references={ws.selectedReferenceAssets}
								simple
								onRemove={ws.toggleReferenceAsset}
							/>
						) : null
					}
					rightControls={
						<>
							{imageSpec ? (
								<ImageGenerationSpecControl
									label={activeGenerationKind === "video" ? "视频大小" : "图片大小"}
									showSizePreview={activeGenerationKind === "image"}
									spec={imageSpec}
									onChange={ws.updateParam}
								/>
							) : null}
							{primaryParamControls}
							{isTextGeneration || !routeGenerationCountParam ? null : (
								<GenerationCountControl
									max={generationCountMax}
									min={generationCountMin}
									value={selectedGenerationCount}
									onChange={(value) => updateComposerGenerationCount(String(value))}
								/>
							)}
							{secondaryRouteParams.length > 0 ? (
								<SecondaryParamsDropdown
									label={otherParamGroup?.label}
									params={secondaryRouteParams}
									values={ws.selectedParams}
									onChange={ws.updateParam}
								/>
							) : null}
						</>
					}
					submitLabel={submitLabel}
					submitTone={activeGenerationKind}
					onCopyPrompt={copyComposerPrompt}
					onOpenReferenceDialog={
						canSelectReferenceAssets ? () => setReferenceDialogOpen(true) : undefined
					}
				/>
			) : (
				<GenerationSetupNotice
					isLoading={!ws.hasLiveCatalog}
					kind={ws.kind}
					onSettingsClick={openSettings}
				/>
			)}
		</form>
	);

	const visibleGenerationEntries =
		focusActiveEntry && ws.activeEntry ? [ws.activeEntry] : ws.generationEntries;

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<main className="flex min-h-0 min-w-0 flex-1 flex-col">
				<GenerationChatPanel
					entries={visibleGenerationEntries}
					canSaveText={resultActions.canSaveText}
					savedKeys={resultActions.savedKeys}
					savingKeys={resultActions.savingKeys}
					selectedGeneratedAssetKey={selectedGeneratedAssetKey}
					onCopyPrompt={resultActions.copyPrompt}
					onCopyResult={(entry) =>
						void resultActions.copyText(entry.content, "没有可复制的 AI 返回")
					}
					onRefreshVideo={(message) => ws.refreshVideo(message)}
					onSaveAsset={resultActions.saveAsset}
					onSaveText={resultActions.saveText}
					onSelectEntry={ws.setActiveEntryId}
					onSelectGeneratedAsset={onSelectGeneratedAsset}
				/>
				{generationComposer}
			</main>

			<ReferenceSelectionDialog
				disabled={!canSelectReferenceAssets}
				entries={ws.generationEntries}
				inputId={`${ws.uploadIdPrefix}-reference-dialog-upload`}
				isUploading={ws.isUploadingAsset}
				mediaAssets={ws.mediaAssets}
				open={referenceDialogOpen}
				references={ws.selectedReferenceAssets}
				requiresReference={false}
				selectableKinds={ws.selectableReferenceKinds}
				selectedAssetIds={ws.selectedReferenceAssetIds}
				title={referenceDialogTitle}
				onOpenChange={setReferenceDialogOpen}
				onRefreshAssets={() => {
					void ws.mutateMediaAssets();
				}}
				onRemoveReference={ws.toggleReferenceAsset}
				onToggleReference={ws.toggleReferenceAsset}
				onUpload={ws.uploadReferenceAsset}
			/>
		</div>
	);
};

const normalizeGenerationCount = (value: number, min: number, max: number) => {
	const normalizedMin = Math.max(1, Math.floor(min));
	const normalizedMax = Math.max(normalizedMin, Math.floor(max));
	const normalizedValue = Number.isFinite(value) ? Math.round(value) : normalizedMin;

	return Math.min(normalizedMax, Math.max(normalizedMin, normalizedValue));
};
