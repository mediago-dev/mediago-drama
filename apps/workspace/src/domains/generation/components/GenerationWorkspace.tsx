import { FileText } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type React from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type GenerationAsset, type GenerationKind } from "@/domains/generation/api/generation";
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
import { LayeredPromptComposer } from "@/domains/generation/components/LayeredPromptComposer";
import { PromptEditor } from "@/domains/generation/components/PromptEditor";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";
import { Button } from "@/shared/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { useGeneratedResultActions } from "@/domains/generation/components/generatedResultActions";
import { resolveParamGroups } from "@/domains/generation/components/mediaGenerationHelpers";
import { promptInsertItemsFromLayers } from "@/domains/generation/lib/prompt-insertions";

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
	uploadIdPrefix?: string;
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
}) => {
	const navigate = useNavigate();
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
				: "描述想生成的视频镜头、运动、机位和节奏";
	const submitLabel =
		activeGenerationKind === "image"
			? "生成图像"
			: activeGenerationKind === "text"
				? "生成文本"
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
	const copyComposerPrompt = () => {
		void resultActions.copyText(ws.fullPrompt, "没有可复制的完整提示词");
	};
	const promptSlashItems = useMemo(
		() => promptInsertItemsFromLayers(ws.composerLayers, ws.kind),
		[ws.composerLayers, ws.kind],
	);

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
					layeredComposer={
						isTextGeneration ? null : (
							<LayeredPromptComposer
								layers={ws.composerLayers}
								variant="composer"
								onSelect={ws.setLayerSelection}
							/>
						)
					}
					leftControls={
						<>
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
					referencePreview={
						isTextGeneration ? null : (
							<ReferencePreviewStrip
								disabled={!ws.hasConfiguredRoutesForKind || !ws.selectedRoute.supportsReferenceUrls}
								enableImagePreview
								references={ws.selectedReferenceAssets}
								simple
								onRemove={ws.toggleReferenceAsset}
							/>
						)
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
					onOpenReferenceDialog={isTextGeneration ? undefined : () => setReferenceDialogOpen(true)}
				/>
			) : (
				<GenerationSetupNotice
					isLoading={!ws.hasLiveCatalog}
					kind={ws.kind}
					onSettingsClick={() => navigate("/settings")}
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

const normalizeGenerationCount = (value: number, min: number, max: number) => {
	const normalizedMin = Math.max(1, Math.floor(min));
	const normalizedMax = Math.max(normalizedMin, Math.floor(max));
	const normalizedValue = Number.isFinite(value) ? Math.round(value) : normalizedMin;

	return Math.min(normalizedMax, Math.max(normalizedMin, normalizedValue));
};
