import { Check, Link2, Scan } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clampNumber } from "@/domains/generation/components/mediaGenerationHelpers";
import {
	imageGenerationSpecUpdate,
	type ImageGenerationSizePreview,
	type ImageGenerationSpec,
	type SpecAxis,
	type SpecOption,
} from "@/domains/generation/components/imageGenerationSpec";
import { cn } from "@/shared/lib/utils";

export const ImageGenerationSpecControl: React.FC<{
	className?: string;
	onChange: (name: string, value: unknown) => void;
	spec: ImageGenerationSpec;
	variant?: "compact" | "toolbar";
}> = ({ className, onChange, spec, variant = "compact" }) => {
	const [open, setOpen] = useState(false);
	const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(
		null,
	);
	const rootRef = useRef<HTMLDivElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const updatePopoverPosition = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;

		const rect = trigger.getBoundingClientRect();
		const popoverRect = popoverRef.current?.getBoundingClientRect();
		const popoverWidth = popoverRect?.width ?? 520;
		const popoverHeight = popoverRect?.height ?? 328;
		const margin = 8;
		const preferredLeft = rect.left;
		const preferredTop = rect.top - popoverHeight - margin;

		setPopoverPosition({
			left: clampNumber(preferredLeft, margin, window.innerWidth - popoverWidth - margin),
			top: clampNumber(preferredTop, margin, window.innerHeight - popoverHeight - margin),
		});
	}, []);

	useEffect(() => {
		if (!open) return;

		updatePopoverPosition();
		const animationFrameId = window.requestAnimationFrame(updatePopoverPosition);
		const closeOnOutsidePointerDown = (event: PointerEvent) => {
			if (rootRef.current?.contains(event.target as Node)) return;

			setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};

		document.addEventListener("pointerdown", closeOnOutsidePointerDown);
		document.addEventListener("keydown", closeOnEscape);
		window.addEventListener("resize", updatePopoverPosition);
		window.addEventListener("scroll", updatePopoverPosition, true);
		return () => {
			window.cancelAnimationFrame(animationFrameId);
			document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
			document.removeEventListener("keydown", closeOnEscape);
			window.removeEventListener("resize", updatePopoverPosition);
			window.removeEventListener("scroll", updatePopoverPosition, true);
		};
	}, [open, updatePopoverPosition]);

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
		<div ref={rootRef} className={cn("relative shrink-0", className)}>
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={`图像规格：${triggerRatioLabel}，${triggerResolutionLabel}`}
				className={cn(
					"inline-flex min-w-0 items-center gap-2 border border-border bg-ide-editor font-medium text-foreground shadow-sm transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					variant === "toolbar"
						? "h-9 max-w-72 rounded-md px-3 text-xs"
						: "h-7 max-w-64 rounded-full px-2.5 text-2xs",
					open && "border-primary bg-ide-list-active text-ide-list-active-foreground",
				)}
				onClick={() => setOpen((current) => !current)}
			>
				<Scan className={variant === "toolbar" ? "size-4 shrink-0" : "size-3.5 shrink-0"} />
				<span className="min-w-0 truncate">{triggerRatioLabel}</span>
				<span className="h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />
				<span className="min-w-0 truncate">{triggerResolutionLabel}</span>
			</button>
			{open && popoverPosition ? (
				<div
					ref={popoverRef}
					role="dialog"
					aria-label="图像规格"
					className="fixed z-50 grid w-[min(34rem,calc(100vw-1rem))] gap-4 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
					style={{
						left: popoverPosition.left,
						top: popoverPosition.top,
					}}
				>
					<SpecOptionGroup
						label="选择比例"
						options={spec.ratioOptions}
						selectedId={spec.selectedRatio?.id}
						type="ratio"
						onSelect={(option) => applyOption("ratio", option)}
					/>
					<SpecOptionGroup
						label="选择分辨率"
						options={spec.resolutionOptions}
						selectedId={spec.selectedResolution?.id}
						type="resolution"
						onSelect={(option) => applyOption("resolution", option)}
					/>
					<SizePreview preview={spec.sizePreview} />
				</div>
			) : null}
		</div>
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
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<div
				className={cn(
					"grid overflow-hidden rounded-md border border-border bg-muted/70 p-0.5",
					type === "ratio"
						? "grid-cols-[repeat(auto-fit,minmax(3.875rem,1fr))]"
						: "grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]",
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
								"relative flex min-w-0 items-center justify-center gap-2 rounded-sm px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								type === "ratio" ? "h-14 flex-col" : "h-10",
								option.disabled && "cursor-not-allowed opacity-40",
								selected
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
								option.disabled && "hover:bg-transparent hover:text-muted-foreground",
							)}
							onClick={() => onSelect(option)}
						>
							{type === "ratio" ? <RatioGlyph option={option} selected={selected} /> : null}
							<span className="min-w-0 truncate">
								{type === "ratio" ? ratioOptionLabel(option) : resolutionOptionLabel(option)}
							</span>
							{selected && type === "resolution" ? (
								<Check className="absolute right-2 size-3.5 text-primary" />
							) : null}
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
			<Scan className={cn("size-4", selected ? "text-foreground" : "text-muted-foreground")} />
		);
	}

	const { width, height } = ratioGlyphSize(option.ratio ?? option.label);
	return (
		<span className="flex h-5 items-center justify-center" aria-hidden="true">
			<span
				className={cn(
					"rounded-[3px] border-2",
					selected ? "border-foreground" : "border-muted-foreground",
				)}
				style={{ height, width }}
			/>
		</span>
	);
};

const SizePreview: React.FC<{ preview: ImageGenerationSizePreview | null }> = ({ preview }) => (
	<div className="grid gap-2">
		<p className="text-xs font-medium text-muted-foreground">尺寸</p>
		<div className="grid grid-cols-[minmax(0,1fr)_2.25rem_minmax(0,1fr)_2rem] items-center gap-3">
			<PreviewBox label="宽度预览" prefix="W" value={preview?.width} />
			<Link2 className="mx-auto size-4 text-muted-foreground" aria-hidden="true" />
			<PreviewBox label="高度预览" prefix="H" value={preview?.height} />
			<span className="text-xs font-semibold text-muted-foreground">PX</span>
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
		className="flex h-10 min-w-0 items-center justify-between gap-2 rounded-md bg-muted px-3 text-xs text-muted-foreground"
	>
		<span>{prefix}</span>
		<span className="truncate text-foreground/75">{value ? String(value) : "--"}</span>
	</div>
);

const ratioGlyphSize = (ratio: string) => {
	const [rawWidth, rawHeight] = ratio.split(":").map(Number);
	if (!rawWidth || !rawHeight) return { height: 14, width: 14 };

	const max = 22;
	const min = 10;
	if (rawWidth >= rawHeight) {
		return {
			width: max,
			height: clampNumber(Math.round((max * rawHeight) / rawWidth), min, max),
		};
	}

	return {
		width: clampNumber(Math.round((max * rawWidth) / rawHeight), min, max),
		height: max,
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
