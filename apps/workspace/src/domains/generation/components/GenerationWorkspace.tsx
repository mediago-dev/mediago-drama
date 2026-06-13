import { ExternalLink, Plus, SendHorizontal, Sparkles } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type React from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type GenerationAsset, type GenerationKind } from "@/domains/generation/api/generation";
import { GenerationChatPanel } from "@/domains/generation/components/GenerationChatPanel";
import {
	GenerationSetupNotice,
	InspectorHeading,
	ModeToggle,
} from "@/domains/generation/components/GenerationSetupNotice";
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
import { MaterialLibrary } from "@/domains/generation/components/MaterialLibrary";
import {
	PrimaryParamControl,
	ReferenceSelectionDialog,
	SecondaryParamsDropdown,
} from "@/domains/generation/components/MediaGenerationDialogs";
import { ModelParamControls } from "@/domains/generation/components/ModelParamControls";
import { PromptLibraryPicker } from "@/domains/generation/components/PromptLibraryPicker";
import { LayeredPromptComposer } from "@/domains/generation/components/LayeredPromptComposer";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";
import { RouteSelectors } from "@/domains/generation/components/RouteSelectors";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { useGeneratedResultActions } from "@/domains/generation/components/generatedResultActions";
import { resolveParamGroups } from "@/domains/generation/components/mediaGenerationHelpers";
import { useToast } from "@/hooks/useToast";
import { settingsInsetRowClassName } from "@/lib/settings-layout";
import { cn } from "@/shared/lib/utils";

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
	onSelectGeneratedAsset?: (asset: GenerationAsset) => void;
	projectHistory?: boolean;
	projectId?: string;
	requireConversation?: boolean;
	selectedGeneratedAssetKey?: string | null;
	showInspector?: boolean;
	uploadIdPrefix?: string;
	variant?: "page" | "settings";
}

export const Generate: React.FC = () => <GenerationWorkspace />;

const openDocumentationUrl = async (url: string) => {
	try {
		await openUrl(url);
		return;
	} catch {
		window.open(url, "_blank", "noopener,noreferrer");
	}
};

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
	onSelectGeneratedAsset,
	projectHistory = false,
	projectId,
	requireConversation = false,
	selectedGeneratedAssetKey,
	uploadIdPrefix,
	variant = "page",
}) => {
	const navigate = useNavigate();
	const toast = useToast();
	const isSettingsVariant = variant === "settings";
	const resolvedUploadIdPrefix =
		uploadIdPrefix ?? (isSettingsVariant ? "settings-generation" : "generation");
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
		uploadIdPrefix: resolvedUploadIdPrefix,
		onActiveEntryIdChange: onActiveEntryChange,
		onSubmitSuccess: isSettingsVariant
			? (requestKind) => {
					toast.success("生成请求已提交", {
						description:
							requestKind === "image"
								? "图像生成请求已发送。"
								: requestKind === "text"
									? "文本生成请求已发送。"
									: "视频任务已提交。",
					});
				}
			: undefined,
		onSubmitError: isSettingsVariant
			? (message) => {
					toast.error("生成请求失败", { description: message });
				}
			: undefined,
	});
	const resolvedMediaAssetProjectId =
		mediaAssetProjectId === undefined ? (projectId?.trim() ?? "") : (mediaAssetProjectId ?? "");
	const resultActions = useGeneratedResultActions({
		mediaAssetProjectId: resolvedMediaAssetProjectId,
		mutateMediaAssets: ws.mutateMediaAssets,
		projectId,
	});
	const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);

	const documentationButton = ws.hasConfiguredRoutesForKind ? (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={() => void openDocumentationUrl(ws.selectedRoute.docUrl)}
		>
			<ExternalLink className="size-4" />
			<span>文档</span>
		</Button>
	) : null;
	const activeGenerationKind = ws.kind;
	const isTextGeneration = activeGenerationKind === "text";
	const promptLibraryKind = activeGenerationKind === "video" ? "video" : "image";

	const promptPlaceholder =
		activeGenerationKind === "image"
			? "描述图像内容、风格、主体、光线和输出数量"
			: activeGenerationKind === "text"
				? "描述你想生成的文本、语气、结构和约束"
				: "描述视频镜头、运动、机位、时长、画幅和质量";
	const compactPromptPlaceholder =
		activeGenerationKind === "image"
			? "描述想生成的图像内容、风格、主体和光线"
			: activeGenerationKind === "text"
				? "描述你想生成的文本..."
				: "描述想生成的视频镜头、运动、机位和节奏";
	const submitLabel =
		activeGenerationKind === "image"
			? "生成图像"
			: activeGenerationKind === "text"
				? "生成文本"
				: "生成视频";
	const generationSummary = isTextGeneration
		? ws.selectedRoute.model
		: `${ws.selectedRoute.model} · ${ws.referenceCount} 个参考素材`;
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
	const generationCountOptions = generationCountOptionValues(
		generationCountMin,
		generationCountMax,
	);
	const sessionRequiredMessage = ws.needsConversation ? "请先从左侧新建或选择一个 session。" : "";
	const canSelectReferenceAssets =
		ws.hasConfiguredRoutesForKind && ws.selectedRoute.supportsReferenceUrls;
	const updateComposerGenerationCount = (value: string) => {
		if (!routeGenerationCountParam) return;

		const nextCount = normalizeGenerationCount(
			Number(value),
			generationCountMin,
			generationCountMax,
		);
		ws.updateParam(routeGenerationCountParam.name, nextCount);
	};
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
						value={ws.selectedParams[param.name]}
						onChange={(value) => ws.updateParam(param.name, value)}
					/>
				);
			}),
		[primaryParamGroups, ws.selectedParams, ws.updateParam],
	);

	const generationForm = (
		<form
			onSubmit={ws.submit}
			className={cn(
				"grid gap-4",
				isSettingsVariant ? undefined : "rounded-sm border border-border bg-ide-panel p-4",
			)}
		>
			{isSettingsVariant ? null : (
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-sm font-semibold text-foreground">Prompt 生成</h1>
					{documentationButton}
				</div>
			)}
			{ws.hasConfiguredRoutesForKind ? (
				<div className="grid gap-4">
					<RouteSelectors
						compact
						kind={ws.kind}
						families={ws.visibleFamilies}
						versions={ws.visibleVersions}
						routes={ws.visibleRoutes}
						selectedFamily={ws.selectedFamily}
						selectedVersion={ws.selectedVersion}
						selectedRoute={ws.selectedRoute}
						onKindChange={ws.setKind}
						onFamilyChange={ws.updateFamily}
						onVersionChange={ws.updateVersion}
						onRouteChange={ws.updateRoute}
						showKindToggle={!lockKind}
					/>
					{ws.selectedRoute.params.length > 0 ? (
						<div className="border-t border-border pt-4">
							<Label className="mb-2 block text-xs text-muted-foreground">参数</Label>
							<ModelParamControls
								compact
								params={ws.selectedRoute.params}
								values={ws.selectedParams}
								onChange={ws.updateParam}
							/>
						</div>
					) : null}
					<div className="border-t border-border pt-4">
						{isTextGeneration ? null : (
							<div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
								<PromptLibraryPicker
									kind={promptLibraryKind}
									prompt={ws.prompt}
									onPromptChange={ws.setPrompt}
								/>
							</div>
						)}
						<Label className="mb-2 block text-xs text-muted-foreground">Prompt</Label>
						<Textarea
							value={ws.prompt}
							onChange={(event) => ws.setPrompt(event.target.value)}
							placeholder={promptPlaceholder}
							className="min-h-36 resize-y rounded-md bg-ide-editor text-foreground"
						/>
					</div>
					{isTextGeneration ? null : (
						<ReferencePreviewStrip
							disabled={!ws.hasConfiguredRoutesForKind || !ws.selectedRoute.supportsReferenceUrls}
							references={ws.selectedReferenceAssets}
							onRemove={ws.toggleReferenceAsset}
						/>
					)}
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
						<p className="text-xs text-muted-foreground">{generationSummary}</p>
						<div className="flex items-center gap-3">
							{sessionRequiredMessage ? (
								<span className="text-xs text-warning-foreground">{sessionRequiredMessage}</span>
							) : null}
							{ws.error ? <span className="text-xs text-error-foreground">{ws.error}</span> : null}
							<Button type="submit" disabled={!ws.canSubmit}>
								<SendHorizontal />
								<span>{submitLabel}</span>
							</Button>
						</div>
					</div>
				</div>
			) : (
				<div className="grid gap-4">
					{lockKind ? null : (
						<div className="max-w-xs">
							<Label className="mb-2 block text-xs text-muted-foreground">模式</Label>
							<ModeToggle kind={ws.kind} onChange={ws.setKind} />
						</div>
					)}
					<GenerationSetupNotice
						isLoading={!ws.hasLiveCatalog}
						kind={ws.kind}
						onSettingsClick={() => navigate("/settings")}
					/>
				</div>
			)}
		</form>
	);

	const referenceMediaSection = isTextGeneration ? null : (
		<>
			<InspectorHeading title="参考媒体" />
			<MaterialLibrary
				activeAssetId={ws.activeMediaAssetId}
				assets={ws.filteredMediaAssets}
				disabled={!ws.selectedRoute.supportsReferenceUrls}
				kindFilter={ws.mediaKindFilter}
				inputId={`${ws.uploadIdPrefix}-media-upload`}
				isUploading={ws.isUploadingAsset}
				query={ws.mediaQuery}
				selectableKinds={ws.selectableReferenceKinds}
				selectedAssetIds={ws.selectedReferenceAssetIds}
				separated={false}
				onDelete={ws.removeMediaAsset}
				onKindFilterChange={ws.setMediaKindFilter}
				onQueryChange={ws.setMediaQuery}
				onRename={ws.renameMediaAsset}
				onToggle={ws.toggleReferenceAsset}
				onUpload={ws.uploadReferenceAsset}
			/>
		</>
	);

	const generationComposer = (
		<form onSubmit={ws.submit} className="shrink-0 border-t border-border bg-ide-panel p-4">
			{ws.hasConfiguredRoutesForKind ? (
				<div className="grid gap-3">
					{isTextGeneration ? null : (
						<ReferencePreviewStrip
							disabled={!ws.hasConfiguredRoutesForKind || !ws.selectedRoute.supportsReferenceUrls}
							enableImagePreview
							references={ws.selectedReferenceAssets}
							simple
							onRemove={ws.toggleReferenceAsset}
						/>
					)}
					{isTextGeneration ? null : (
						<LayeredPromptComposer layers={ws.composerLayers} onSelect={ws.setLayerSelection} />
					)}
					<div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
						<Textarea
							value={ws.prompt}
							onChange={(event) => ws.setPrompt(event.target.value)}
							placeholder={compactPromptPlaceholder}
							className="max-h-52 min-h-20 min-w-0 flex-1 resize-y rounded-md bg-ide-editor text-foreground"
						/>
						<Button type="submit" className="h-10 shrink-0 sm:w-auto" disabled={!ws.canSubmit}>
							<SendHorizontal />
							<span>{submitLabel}</span>
						</Button>
					</div>
					<div className="flex min-w-0 items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2 overflow-x-auto">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label="选择参考素材"
								title="选择参考素材"
								disabled={!canSelectReferenceAssets}
								className="size-9 shrink-0 rounded-md border border-border bg-ide-editor text-muted-foreground shadow-none hover:bg-ide-list-hover hover:text-foreground disabled:bg-ide-editor disabled:text-muted-foreground [&_svg]:size-4"
								onClick={() => setReferenceDialogOpen(true)}
							>
								<Plus />
							</Button>
							{lockKind ? null : <ModeToggle compact kind={ws.kind} onChange={ws.setKind} />}
							<Select value={ws.selectedFamily.id} onValueChange={ws.updateFamily}>
								<SelectTrigger
									aria-label="模型类型"
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
								variant="outline"
								size="sm"
								aria-label="打开模型文档"
								className={generationComposerSelectClassName("shrink-0")}
								onClick={() => void openDocumentationUrl(ws.selectedRoute.docUrl)}
							>
								<ExternalLink className="size-4 shrink-0" />
								<span>文档</span>
							</Button>
							{imageSpec ? (
								<ImageGenerationSpecControl
									label={activeGenerationKind === "video" ? "视频大小" : "图片大小"}
									showSizePreview={activeGenerationKind === "image"}
									spec={imageSpec}
									variant="toolbar"
									onChange={ws.updateParam}
								/>
							) : null}
							{primaryParamControls}
							{isTextGeneration || !routeGenerationCountParam ? null : (
								<Select
									value={String(selectedGenerationCount)}
									onValueChange={updateComposerGenerationCount}
								>
									<SelectTrigger
										aria-label="生成数量"
										className={generationComposerSelectClassName()}
									>
										<span>数量: {selectedGenerationCount}</span>
									</SelectTrigger>
									<SelectContent align="start">
										{generationCountOptions.map((count) => (
											<SelectItem key={count} value={String(count)}>
												{count} 个
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
							{secondaryRouteParams.length > 0 ? (
								<SecondaryParamsDropdown
									label={otherParamGroup?.label}
									params={secondaryRouteParams}
									values={ws.selectedParams}
									variant="toolbar"
									onChange={ws.updateParam}
								/>
							) : null}
						</div>
						{sessionRequiredMessage ? (
							<span className="text-warning-foreground">{sessionRequiredMessage}</span>
						) : ws.error ? (
							<span className="text-error-foreground">{ws.error}</span>
						) : null}
					</div>
				</div>
			) : (
				<GenerationSetupNotice
					isLoading={!ws.hasLiveCatalog}
					kind={ws.kind}
					onSettingsClick={() => navigate("/settings")}
				/>
			)}
		</form>
	);

	if (isSettingsVariant) {
		return (
			<div>
				<header className="mb-3 flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<Sparkles className="size-4 text-muted-foreground" />
							<h2 className="truncate text-sm font-semibold text-foreground">生成</h2>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">配置模型接入并发送生成请求。</p>
					</div>
					{documentationButton}
				</header>
				<main className="min-w-0">
					<div className="space-y-3">
						<div className={settingsInsetRowClassName}>{generationForm}</div>
						{referenceMediaSection ? (
							<div className={settingsInsetRowClassName}>{referenceMediaSection}</div>
						) : null}
					</div>
				</main>
			</div>
		);
	}

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

const generationComposerSelectClassName = (toneClassName?: string) =>
	cn(
		"h-9 w-auto max-w-60 rounded-md border-border bg-ide-editor px-3 text-xs font-medium shadow-none hover:bg-ide-list-hover [&_svg]:size-4",
		toneClassName,
	);

const normalizeGenerationCount = (value: number, min: number, max: number) => {
	const normalizedMin = Math.max(1, Math.floor(min));
	const normalizedMax = Math.max(normalizedMin, Math.floor(max));
	const normalizedValue = Number.isFinite(value) ? Math.round(value) : normalizedMin;

	return Math.min(normalizedMax, Math.max(normalizedMin, normalizedValue));
};

const generationCountOptionValues = (min: number, max: number) => {
	const normalizedMin = Math.max(1, Math.floor(min));
	const normalizedMax = Math.min(10, Math.max(normalizedMin, Math.floor(max)));

	return Array.from(
		{ length: normalizedMax - normalizedMin + 1 },
		(_, index) => normalizedMin + index,
	);
};
