import { Clipboard, Loader2, Plus, SendHorizontal } from "lucide-react";
import type React from "react";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { GenerationCountControl } from "@/domains/generation/components/MediaGenerationDialogs";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";
import { Button } from "@/shared/components/ui/button";

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
	onCopyPrompt?: () => void;
	onOpenReferenceDialog: () => void;
	onRemoveReferencePreview: (asset: MediaAsset) => void;
	previewReferenceAssets: MediaAsset[];
	layeredComposer?: React.ReactNode;
	primaryParamControls?: React.ReactNode;
	promptEditor: React.ReactNode;
	promptExtras: React.ReactNode;
	promptLibraryPicker?: React.ReactNode;
	referenceBadges?: Record<string, string>;
	requiresReference: boolean;
	secondaryParamControls?: React.ReactNode;
	showReferencePreviewStrip: boolean;
	submitLabel: string;
}> = ({
	canSelectReferenceImages,
	canCopyPrompt = false,
	canSubmit,
	error,
	generationCountControl,
	imageSpecControl,
	isSubmitting,
	modelSummary,
	layeredComposer,
	onCopyPrompt,
	onOpenReferenceDialog,
	onRemoveReferencePreview,
	previewReferenceAssets,
	promptEditor,
	promptExtras,
	promptLibraryPicker,
	primaryParamControls,
	referenceBadges,
	requiresReference,
	secondaryParamControls,
	showReferencePreviewStrip,
	submitLabel,
}) => (
	<section className="flex min-h-0 min-w-0 flex-col bg-card">
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-ide-editor">
			{promptExtras}
			{showReferencePreviewStrip ? (
				<div className="shrink-0 px-4 pt-3">
					<ReferencePreviewStrip
						tone="card"
						disabled={!canSelectReferenceImages}
						enableImagePreview
						referenceBadges={referenceBadges}
						references={previewReferenceAssets}
						requiresReference={requiresReference}
						simple
						onRemove={onRemoveReferencePreview}
					/>
				</div>
			) : null}
			{layeredComposer || onCopyPrompt ? (
				<div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-2">
					<div className="min-w-0 flex-1">{layeredComposer}</div>
					{onCopyPrompt ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="复制完整提示词"
							title="复制完整提示词"
							disabled={!canCopyPrompt}
							className="size-7 shrink-0 rounded-sm border border-border bg-card text-muted-foreground shadow-none hover:bg-ide-list-hover hover:text-foreground disabled:bg-card disabled:text-muted-foreground [&_svg]:size-3.5"
							onClick={onCopyPrompt}
						>
							<Clipboard />
						</Button>
					) : null}
				</div>
			) : null}
			{promptEditor}
			{error ? (
				<p className="mx-4 mb-4 shrink-0 rounded-sm border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
					{error}
				</p>
			) : null}
			<div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="选择参考图"
						title="选择参考图"
						disabled={!canSelectReferenceImages}
						className="size-7 rounded-full border border-border bg-card text-muted-foreground shadow-none hover:bg-ide-list-hover hover:text-foreground [&_svg]:size-3.5"
						onClick={onOpenReferenceDialog}
					>
						<Plus />
					</Button>
					{promptLibraryPicker}
					<p className="truncate text-xs text-muted-foreground">{modelSummary}</p>
				</div>
				<div className="flex min-w-0 shrink-0 items-center gap-2">
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
					<Button
						type="submit"
						size="icon"
						aria-label={submitLabel}
						title={submitLabel}
						disabled={!canSubmit}
						className="size-7 rounded-full bg-foreground text-background shadow-none hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground [&_svg]:size-3.5"
					>
						{isSubmitting ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
					</Button>
				</div>
			</div>
		</div>
	</section>
);
