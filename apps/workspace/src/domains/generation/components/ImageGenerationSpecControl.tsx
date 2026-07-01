import { ChevronDown, Link2, Sparkles } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import {
	imageGenerationSpecUpdate,
	type ImageGenerationSizePreview,
	type ImageGenerationSpec,
	type SpecAxis,
	type SpecOption,
} from "@/domains/generation/components/imageGenerationSpec";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

export const ImageGenerationSpecControl: React.FC<{
	className?: string;
	label?: string;
	onChange: (name: string, value: unknown) => void;
	showSizePreview?: boolean;
	spec: ImageGenerationSpec;
}> = ({ className, label = "图像规格", onChange, showSizePreview = true, spec }) => {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	// Keep the wide spec popover inside the generation modal when it is opened there.
	const popoverBoundary = open
		? (triggerRef.current?.closest<HTMLElement>("[data-agent-mention-popup-root]") ?? undefined)
		: undefined;

	const applyOption = (axis: SpecAxis, option: SpecOption) => {
		const update = imageGenerationSpecUpdate(spec, axis, option);
		if (!update) return;

		for (const item of update.updates) {
			onChange(item.name, item.value);
		}
	};

	const triggerRatioLabel = spec.selectedRatio ? ratioTriggerLabel(spec.selectedRatio) : "选择比例";
	const triggerResolutionLabel = spec.selectedResolution
		? resolutionTriggerLabel(spec.selectedResolution)
		: "选择分辨率";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					ref={triggerRef}
					type="button"
					aria-label={`${label}：${triggerRatioLabel}，${triggerResolutionLabel}`}
					className={cn(
						"inline-flex min-w-0 items-center gap-2 border font-semibold text-foreground transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						"h-[var(--generation-control-height)] max-w-56 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs shadow-none",
						open && "border-primary bg-ide-list-active text-ide-list-active-foreground shadow-none",
						className,
					)}
				>
					<RatioTriggerGlyph option={spec.selectedRatio} open={open} />
					<span className="min-w-0 truncate">{triggerRatioLabel}</span>
					<span className="h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />
					<span className="min-w-0 truncate">{triggerResolutionLabel}</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="start"
				collisionBoundary={popoverBoundary}
				collisionPadding={16}
				aria-label={label}
				className="grid w-[min(var(--generation-size-popover-width),var(--generation-popover-max-inline))] gap-[var(--generation-popover-gap)] rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding)] text-popover-foreground shadow-xl"
			>
				<SpecOptionGroup
					label="比例"
					options={spec.ratioOptions}
					selectedId={spec.selectedRatio?.id}
					type="ratio"
					onSelect={(option) => applyOption("ratio", option)}
				/>
				<SpecOptionGroup
					label="分辨率"
					options={spec.resolutionOptions}
					selectedId={spec.selectedResolution?.id}
					type="resolution"
					onSelect={(option) => applyOption("resolution", option)}
				/>
				{showSizePreview ? <SizePreview preview={spec.sizePreview} /> : null}
			</PopoverContent>
		</Popover>
	);
};

const SpecOptionGroup: React.FC<{
	label: string;
	onSelect: (option: SpecOption) => void;
	options: SpecOption[];
	selectedId?: string;
	type: SpecAxis;
}> = ({ label, onSelect, options, selectedId, type }) => {
	if (options.length === 0) return null;

	return (
		<div className="grid gap-2">
			<p className="text-xs font-semibold text-muted-foreground">{label}</p>
			<div
				className={cn(
					type === "ratio"
						? "grid grid-cols-6 gap-[var(--generation-composer-toolbar-gap)]"
						: "grid overflow-hidden rounded-lg bg-muted p-1",
					type === "resolution" && "grid-cols-[repeat(auto-fit,minmax(6rem,1fr))]",
				)}
			>
				{options.map((option) => {
					const selected = option.id === selectedId;

					return (
						<button
							key={option.id}
							type="button"
							disabled={option.disabled}
							className={cn(
								"relative flex min-w-0 items-center justify-center gap-2 px-2 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								type === "ratio"
									? "h-[var(--generation-size-ratio-option-height)] flex-col rounded-[var(--generation-control-radius)] border text-2xs"
									: "h-[var(--generation-size-resolution-option-height)] rounded-[var(--generation-control-radius)] text-2xs",
								option.disabled && "cursor-not-allowed opacity-40",
								type === "ratio" && selected
									? "border-primary bg-ide-list-active text-ide-list-active-foreground"
									: type === "ratio"
										? "border-input bg-card text-muted-foreground hover:border-primary/60 hover:bg-ide-list-hover hover:text-foreground"
										: selected
											? "bg-card text-foreground shadow-sm"
											: "text-muted-foreground hover:bg-card/70 hover:text-foreground",
								option.disabled && "hover:bg-transparent hover:text-muted-foreground",
							)}
							onClick={() => onSelect(option)}
						>
							{type === "ratio" ? <RatioGlyph option={option} selected={selected} /> : null}
							<span className="min-w-0 truncate">
								{type === "ratio" ? ratioOptionLabel(option) : resolutionOptionLabel(option)}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
};

const RatioGlyph: React.FC<{ option: SpecOption; selected: boolean }> = ({ option, selected }) => {
	if (option.smart) {
		return (
			<Sparkles className={cn("size-3.5", selected ? "text-primary" : "text-muted-foreground")} />
		);
	}

	const glyphStyle = ratioGlyphStyle(option.ratio ?? option.label);
	return (
		<span className="flex h-5 items-center justify-center" aria-hidden="true">
			<span
				className={cn("block rounded-[4px]", selected ? "bg-primary" : "bg-muted-foreground")}
				style={glyphStyle}
			/>
		</span>
	);
};

const RatioTriggerGlyph: React.FC<{ open: boolean; option: SpecOption | null }> = ({
	open,
	option,
}) => {
	if (option?.smart) {
		return (
			<Sparkles
				className={cn("size-4 shrink-0", open ? "text-primary" : "text-muted-foreground")}
				aria-hidden="true"
			/>
		);
	}

	const glyphStyle = ratioGlyphStyle(option?.ratio ?? option?.label ?? "");
	return (
		<span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
			<span
				data-ratio-glyph="trigger"
				data-ratio-value={option?.ratio ?? option?.label ?? ""}
				className={cn(
					"block rounded-[3px] border-[1.5px] border-current bg-transparent",
					open ? "text-primary" : "text-foreground",
				)}
				style={glyphStyle}
			/>
		</span>
	);
};

const SizePreview: React.FC<{ preview: ImageGenerationSizePreview | null }> = ({ preview }) => (
	<div className="grid gap-2">
		<p className="text-xs font-semibold text-muted-foreground">尺寸</p>
		<div className="grid grid-cols-[minmax(0,1fr)_var(--generation-size-preview-link-size)_minmax(0,1fr)] items-center gap-2">
			<PreviewBox label="宽度预览" prefix="W" value={preview?.width} />
			<span className="flex size-[var(--generation-size-preview-link-size)] items-center justify-center rounded-[var(--generation-control-radius)] bg-muted text-muted-foreground">
				<Link2 className="size-3.5" aria-hidden="true" />
			</span>
			<PreviewBox label="高度预览" prefix="H" value={preview?.height} />
		</div>
	</div>
);

const PreviewBox: React.FC<{ label: string; prefix: string; value?: number }> = ({
	label,
	prefix,
	value,
}) => (
	<div
		aria-label={label}
		className="flex h-[var(--generation-size-preview-control-height)] min-w-0 items-center gap-2 rounded-[var(--generation-control-radius)] border border-input bg-card px-2.5 text-2xs text-muted-foreground"
	>
		<span className="font-semibold">{prefix}</span>
		<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
			{value ? String(value) : "--"}
		</span>
		<span className="shrink-0 font-semibold">px</span>
	</div>
);

const ratioGlyphStyle = (ratio: string): React.CSSProperties => {
	const [rawWidth, rawHeight] = ratio.split(":").map(Number);
	if (!rawWidth || !rawHeight) {
		return {
			height: "var(--generation-size-ratio-glyph-max)",
			width: "var(--generation-size-ratio-glyph-max)",
		};
	}

	const aspectRatio = `${rawWidth} / ${rawHeight}`;
	if (rawWidth >= rawHeight) {
		return {
			aspectRatio,
			minHeight: "var(--generation-size-ratio-glyph-min)",
			width: "var(--generation-size-ratio-glyph-max)",
		};
	}

	return {
		aspectRatio,
		height: "var(--generation-size-ratio-glyph-max)",
		minWidth: "var(--generation-size-ratio-glyph-min)",
	};
};

const ratioTriggerLabel = (option: SpecOption) => {
	if (option.smart) return "智能比例";
	return option.ratio ?? option.label;
};

const ratioOptionLabel = (option: SpecOption) => {
	if (option.smart) return "智能";
	return option.ratio ?? option.label;
};

const resolutionTriggerLabel = (option: SpecOption) =>
	option.resolution ? resolutionDisplayLabel(option.resolution) : option.label;

const resolutionOptionLabel = (option: SpecOption) =>
	option.resolution ? resolutionDisplayLabel(option.resolution) : option.label;

const resolutionDisplayLabel = (resolution: string) => {
	switch (resolution.toUpperCase()) {
		case "1K":
			return "标准 1K";
		case "2K":
			return "高清 2K";
		case "3K":
			return "精细 3K";
		case "4K":
			return "超清 4K";
		default:
			return resolution;
	}
};
