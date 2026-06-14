import {
	Clipboard,
	ImagePlus,
	Loader2,
	SendHorizontal,
	Sparkles,
	type LucideIcon,
} from "lucide-react";
import type React from "react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export type GenerationComposerSubmitTone = "image" | "text" | "video";

export interface GenerationComposerPanelProps {
	canCopyPrompt?: boolean;
	canSelectReference?: boolean;
	canSubmit: boolean;
	cardClassName?: string;
	className?: string;
	error?: React.ReactNode;
	errorTone?: "error" | "warning";
	fillHeight?: boolean;
	isSubmitting: boolean;
	layeredComposer?: React.ReactNode;
	leftControls?: React.ReactNode;
	onCopyPrompt?: () => void;
	onOpenReferenceDialog?: () => void;
	promptExtras?: React.ReactNode;
	promptInput: React.ReactNode;
	referenceButtonLabel?: string;
	referencePreview?: React.ReactNode;
	rightControls?: React.ReactNode;
	submitLabel: string;
	submitTone?: GenerationComposerSubmitTone;
}

export const GenerationComposerPanel: React.FC<GenerationComposerPanelProps> = ({
	canCopyPrompt = false,
	canSelectReference = true,
	canSubmit,
	cardClassName,
	className,
	error,
	errorTone = "error",
	fillHeight = false,
	isSubmitting,
	layeredComposer,
	leftControls,
	onCopyPrompt,
	onOpenReferenceDialog,
	promptExtras,
	promptInput,
	referenceButtonLabel = "参考图",
	referencePreview,
	rightControls,
	submitLabel,
	submitTone = "text",
}) => {
	const SubmitIcon = submitToneIconByTone[submitTone];

	return (
		<section
			className={cn(
				"shrink-0 bg-transparent p-[var(--generation-composer-padding)]",
				fillHeight && "h-full min-h-0",
				className,
			)}
		>
			<div
				className={cn(
					"gap-[var(--generation-composer-gap)] rounded-[var(--generation-popover-radius)] border border-input bg-card p-[var(--generation-composer-padding)] shadow-sm",
					fillHeight ? "flex h-full min-h-0 flex-col overflow-hidden" : "grid",
					cardClassName,
				)}
			>
				{promptExtras}
				{referencePreview}
				{layeredComposer || onCopyPrompt ? (
					<div className="flex min-w-0 items-start justify-between gap-3">
						<div className="min-w-0 flex-1">{layeredComposer}</div>
						{onCopyPrompt ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={!canCopyPrompt}
								className="h-[var(--generation-control-height)] shrink-0 rounded-[var(--generation-control-radius)] border-input bg-card px-[var(--generation-control-padding-x)] text-2xs font-semibold text-muted-foreground shadow-none hover:bg-ide-list-hover hover:text-foreground disabled:bg-card"
								onClick={onCopyPrompt}
							>
								<Clipboard className="size-4" />
								<span>复制 Prompt</span>
							</Button>
						) : null}
					</div>
				) : null}
				{fillHeight ? (
					<div className="min-h-0 flex-1 overflow-hidden">{promptInput}</div>
				) : (
					promptInput
				)}
				{error ? (
					<p
						className={cn(
							"mx-2 rounded-lg px-3 py-2 text-xs",
							errorTone === "error"
								? "bg-error-surface text-error-foreground"
								: "bg-warning-surface text-warning-foreground",
						)}
					>
						{error}
					</p>
				) : null}
				<div className="flex min-w-0 flex-col gap-[var(--generation-popover-padding)] lg:flex-row lg:items-center lg:justify-between">
					<div className="flex min-w-0 flex-wrap items-center gap-[var(--generation-composer-toolbar-gap)] lg:flex-1">
						{onOpenReferenceDialog ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								aria-label="选择参考素材"
								title="选择参考素材"
								disabled={!canSelectReference}
								className={generationComposerToolbarButtonClassName()}
								onClick={onOpenReferenceDialog}
							>
								<ImagePlus className="size-4 text-primary" />
								<span>{referenceButtonLabel}</span>
							</Button>
						) : null}
						{leftControls}
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-[var(--generation-composer-toolbar-gap)] lg:justify-end">
						{rightControls}
						<Button
							type="submit"
							className="h-[var(--generation-control-height-lg)] shrink-0 rounded-[var(--generation-control-radius)] bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
							disabled={!canSubmit}
						>
							{isSubmitting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<SubmitIcon className="size-4" />
							)}
							<span>{submitLabel}</span>
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
};

export const generationComposerPromptInputClassName =
	"max-h-[var(--generation-composer-textarea-max-height)] min-h-[var(--generation-composer-textarea-min-height)] min-w-0 resize-none overflow-y-auto border-0 bg-transparent px-[var(--generation-control-padding-x)] py-[var(--generation-composer-padding)] text-sm leading-5 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0";

export const generationComposerPromptInputFillClassName = cn(
	generationComposerPromptInputClassName,
	"h-full flex-1",
);

export const generationComposerSelectClassName = (toneClassName?: string) =>
	cn(
		"h-[var(--generation-control-height)] w-auto max-w-56 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover [&_svg]:size-3.5",
		toneClassName,
	);

export const generationComposerToolbarButtonClassName = (className?: string) =>
	cn(
		"h-[var(--generation-control-height)] shrink-0 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover disabled:bg-muted disabled:text-muted-foreground [&_svg]:size-4",
		className,
	);

export const generationComposerToolbarGhostButtonClassName = (className?: string) =>
	cn(
		"h-[var(--generation-control-height)] shrink-0 rounded-[var(--generation-control-radius)] border-0 bg-transparent px-[var(--generation-composer-padding)] text-2xs font-semibold text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground [&_svg]:size-3.5",
		className,
	);

const submitToneIconByTone: Record<GenerationComposerSubmitTone, LucideIcon> = {
	image: Sparkles,
	text: SendHorizontal,
	video: SendHorizontal,
};
