import type React from "react";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	GenerationComposerPanel,
	type GenerationComposerSubmitTone,
} from "@/domains/generation/components/GenerationComposerPanel";
import { GenerationCountControl } from "@/domains/generation/components/MediaGenerationDialogs";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";

export interface MediaGenerationCountControlConfig {
	max: number;
	min: number;
	onChange: (value: number) => void;
	value: number;
}

export const MediaGenerationInputPanel: React.FC<{
	canSelectReferenceImages: boolean;
	canCopyPrompt?: boolean;
	canSubmit: boolean;
	error?: string | null;
	generationCountControl?: MediaGenerationCountControlConfig | null;
	imageSpecControl?: React.ReactNode;
	isSubmitting: boolean;
	modelSummary: string;
	modelControls?: React.ReactNode;
	onCopyPrompt?: () => void;
	onOpenReferenceDialog: () => void;
	onRemoveReferencePreview: (asset: MediaAsset) => void;
	previewReferenceAssets: MediaAsset[];
	referenceButtonLabel?: string;
	layeredComposer?: React.ReactNode;
	primaryParamControls?: React.ReactNode;
	promptEditor: React.ReactNode;
	promptExtras: React.ReactNode;
	referenceBadges?: Record<string, string>;
	requiresReference: boolean;
	secondaryParamControls?: React.ReactNode;
	showReferencePreviewStrip: boolean;
	submitLabel: string;
	submitTone?: GenerationComposerSubmitTone;
}> = ({
	canSelectReferenceImages,
	canCopyPrompt = false,
	canSubmit,
	error,
	generationCountControl,
	imageSpecControl,
	isSubmitting,
	modelSummary,
	modelControls,
	layeredComposer,
	onCopyPrompt,
	onOpenReferenceDialog,
	onRemoveReferencePreview,
	previewReferenceAssets,
	promptEditor,
	promptExtras,
	referenceButtonLabel,
	primaryParamControls,
	referenceBadges,
	requiresReference,
	secondaryParamControls,
	showReferencePreviewStrip,
	submitLabel,
	submitTone = "image",
}) => (
	<GenerationComposerPanel
		canCopyPrompt={canCopyPrompt}
		canSelectReference={canSelectReferenceImages}
		canSubmit={canSubmit}
		className="bg-card"
		error={error}
		errorTone="error"
		isSubmitting={isSubmitting}
		layeredComposer={layeredComposer}
		leftControls={
			<>
				{modelControls ?? <p className="truncate text-xs text-muted-foreground">{modelSummary}</p>}
			</>
		}
		promptExtras={promptExtras}
		promptInput={promptEditor}
		referencePreview={
			showReferencePreviewStrip ? (
				<ReferencePreviewStrip
					disabled={!canSelectReferenceImages}
					enableImagePreview
					referenceBadges={referenceBadges}
					references={previewReferenceAssets}
					requiresReference={requiresReference}
					simple
					onRemove={onRemoveReferencePreview}
				/>
			) : null
		}
		referenceButtonLabel={referenceButtonLabel}
		rightControls={
			<>
				{imageSpecControl}
				{primaryParamControls}
				{generationCountControl ? (
					<GenerationCountControl
						max={generationCountControl.max}
						min={generationCountControl.min}
						value={generationCountControl.value}
						onChange={generationCountControl.onChange}
					/>
				) : null}
				{secondaryParamControls}
			</>
		}
		submitLabel={submitLabel}
		submitTone={submitTone}
		onCopyPrompt={onCopyPrompt}
		onOpenReferenceDialog={onOpenReferenceDialog}
	/>
);
