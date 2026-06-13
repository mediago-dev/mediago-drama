import {
	Check,
	ChevronDown,
	Film,
	LayoutGrid,
	Loader2,
	SlidersHorizontal,
	UploadCloud,
	X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationParam } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	buildGeneratedReferenceOptions,
	clampNumber,
	entryPromptText,
	type GeneratedReferenceOption,
} from "@/domains/generation/components/mediaGenerationHelpers";
import { GenerationVideoThumbnail } from "@/domains/generation/components/GenerationVideoThumbnail";
import { ModelParamControls } from "@/domains/generation/components/ModelParamControls";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import {
	generationStatusLabel,
	paramHelp,
	paramLabel,
	paramOptionLabel,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export const GenerationCountControl: React.FC<{
	max: number;
	min: number;
	onChange: (value: number) => void;
	value: number;
}> = ({ max, min, onChange, value }) => {
	const [open, setOpen] = useState(false);
	const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(
		null,
	);
	const rootRef = useRef<HTMLDivElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const options = useMemo(
		() => Array.from({ length: max - min + 1 }, (_, index) => min + index),
		[max, min],
	);
	const updatePopoverPosition = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;

		const rect = trigger.getBoundingClientRect();
		const popoverRect = popoverRef.current?.getBoundingClientRect();
		const popoverWidth = popoverRect?.width ?? 224;
		const popoverHeight = popoverRect?.height ?? 236;
		const margin = 8;
		setPopoverPosition({
			left: clampNumber(
				rect.left + rect.width / 2 - popoverWidth / 2,
				margin,
				window.innerWidth - popoverWidth - margin,
			),
			top: clampNumber(
				rect.top - popoverHeight - margin,
				margin,
				window.innerHeight - popoverHeight - margin,
			),
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

	return (
		<div ref={rootRef} className="relative shrink-0">
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-haspopup="dialog"
				className={cn(
					"flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors",
					open
						? "border-primary bg-primary text-primary-foreground"
						: "border-border bg-card text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
				)}
				onClick={() => setOpen((current) => !current)}
			>
				<LayoutGrid className="size-3.5" />
				<span>{value}x</span>
			</button>
			{open && popoverPosition ? (
				<div
					ref={popoverRef}
					role="dialog"
					aria-label="生成数量"
					className="fixed z-50 w-56 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl"
					style={{
						left: popoverPosition.left,
						top: popoverPosition.top,
					}}
				>
					<div className="mb-3">
						<p className="text-sm font-semibold">生成数量</p>
						<p className="mt-0.5 text-xs text-muted-foreground">一次生成多个候选结果</p>
					</div>
					<div className="mb-2 text-2xs font-semibold text-muted-foreground">候选数量</div>
					<div className="grid grid-cols-2 gap-1.5">
						{options.map((option) => {
							const selected = option === value;

							return (
								<button
									key={option}
									type="button"
									className={cn(
										"flex h-8 items-center justify-center rounded-md border text-xs font-medium transition-colors",
										selected
											? "border-primary bg-primary text-primary-foreground"
											: "border-border bg-card text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
									)}
									onClick={() => {
										onChange(option);
										setOpen(false);
									}}
								>
									{option === 1 ? "1" : `${option}x`}
								</button>
							);
						})}
					</div>
				</div>
			) : null}
		</div>
	);
};

export const PrimaryParamControl: React.FC<{
	label?: string;
	onChange: (value: string) => void;
	param: GenerationParam;
	value: unknown;
}> = ({ label: triggerLabel, onChange, param, value }) => {
	const [open, setOpen] = useState(false);
	const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(
		null,
	);
	const rootRef = useRef<HTMLDivElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const options = param.options ?? [];
	const selectedValue = String(value ?? param.default ?? options[0]?.value ?? "");
	const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0];
	const label = paramLabel(param.label);
	const controlLabel = triggerLabel ?? label;
	const selectedLabel = selectedOption ? paramOptionLabel(selectedOption.label) : "未选择";

	const updatePopoverPosition = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;

		const rect = trigger.getBoundingClientRect();
		const popoverRect = popoverRef.current?.getBoundingClientRect();
		const popoverWidth = popoverRect?.width ?? 224;
		const popoverHeight = popoverRect?.height ?? 280;
		const margin = 8;
		setPopoverPosition({
			left: clampNumber(
				rect.left + rect.width / 2 - popoverWidth / 2,
				margin,
				window.innerWidth - popoverWidth - margin,
			),
			top: clampNumber(
				rect.top - popoverHeight - margin,
				margin,
				window.innerHeight - popoverHeight - margin,
			),
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

	if (options.length === 0) return null;

	return (
		<div ref={rootRef} className="relative shrink-0">
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={`${controlLabel}：${selectedLabel}`}
				className={cn(
					"flex h-7 max-w-36 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors",
					open
						? "border-primary bg-primary text-primary-foreground"
						: "border-border bg-card text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
				)}
				onClick={() => setOpen((current) => !current)}
			>
				<span className="truncate">
					{controlLabel}: {selectedLabel}
				</span>
				<ChevronDown className="size-3 shrink-0" />
			</button>
			{open && popoverPosition ? (
				<div
					ref={popoverRef}
					role="dialog"
					aria-label={label}
					className="fixed z-50 w-56 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl"
					style={{
						left: popoverPosition.left,
						top: popoverPosition.top,
					}}
				>
					<div className="mb-3">
						<p className="text-sm font-semibold">{label}</p>
						{param.help ? (
							<p className="mt-0.5 text-xs text-muted-foreground">{paramHelp(param.help)}</p>
						) : null}
					</div>
					<div className="grid grid-cols-2 gap-1.5">
						{options.map((option) => {
							const optionLabel = paramOptionLabel(option.label);
							const selected = option.value === selectedValue;

							return (
								<button
									key={option.value}
									type="button"
									className={cn(
										"flex h-8 min-w-0 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors",
										selected
											? "border-primary bg-primary text-primary-foreground"
											: "border-border bg-card text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
									)}
									onClick={() => {
										onChange(option.value);
										setOpen(false);
									}}
								>
									<span className="truncate">{optionLabel}</span>
								</button>
							);
						})}
					</div>
				</div>
			) : null}
		</div>
	);
};

export const SecondaryParamsDropdown: React.FC<{
	label?: string;
	onChange: (name: string, value: unknown) => void;
	params: GenerationParam[];
	values: Record<string, unknown>;
	variant?: "compact" | "toolbar";
}> = ({ label = "其他", onChange, params, values, variant = "compact" }) => {
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
		const popoverWidth = popoverRect?.width ?? 384;
		const popoverHeight = popoverRect?.height ?? 360;
		const margin = 8;
		const preferredTop = rect.top - popoverHeight - margin;
		setPopoverPosition({
			left: clampNumber(
				rect.right - popoverWidth,
				margin,
				window.innerWidth - popoverWidth - margin,
			),
			top:
				preferredTop >= margin
					? preferredTop
					: clampNumber(rect.bottom + margin, margin, window.innerHeight - popoverHeight - margin),
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

	if (params.length === 0) return null;

	return (
		<div ref={rootRef} className="relative shrink-0">
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={label}
				className={cn(
					"inline-flex min-w-0 items-center gap-1.5 border font-medium transition-colors",
					variant === "toolbar"
						? "h-9 max-w-60 rounded-md border-border bg-ide-editor px-3 text-xs text-foreground shadow-none hover:bg-ide-list-hover"
						: "h-7 rounded-full border-border bg-card px-2 text-2xs text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
					open && "border-primary bg-ide-list-active text-ide-list-active-foreground",
				)}
				onClick={() => setOpen((current) => !current)}
			>
				<SlidersHorizontal
					className={variant === "toolbar" ? "size-4 shrink-0" : "size-3.5 shrink-0"}
				/>
				<span>{label}</span>
			</button>
			{open && popoverPosition ? (
				<div
					ref={popoverRef}
					role="dialog"
					aria-label={`${label}参数`}
					className="fixed z-50 max-h-[min(32rem,calc(100vh-1rem))] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
					style={{
						left: popoverPosition.left,
						top: popoverPosition.top,
					}}
				>
					<div className="mb-3">
						<p className="text-sm font-semibold">{label}</p>
					</div>
					<ModelParamControls compact params={params} values={values} onChange={onChange} />
				</div>
			) : null}
		</div>
	);
};

export const ReferenceSelectionDialog: React.FC<{
	disabled: boolean;
	entries: GenerationEntry[];
	inputId: string;
	isUploading: boolean;
	mediaAssets: MediaAsset[];
	onOpenChange: (open: boolean) => void;
	onRefreshAssets?: () => void;
	onRemoveReference: (asset: MediaAsset) => void;
	onToggleReference: (asset: MediaAsset) => void;
	onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
	open: boolean;
	references: MediaAsset[];
	requiresReference: boolean;
	selectableKinds: Set<MediaAsset["kind"]>;
	selectedAssetIds: string[];
}> = ({
	disabled,
	entries,
	inputId,
	isUploading,
	mediaAssets,
	onOpenChange,
	onRefreshAssets,
	onRemoveReference,
	onToggleReference,
	onUpload,
	open,
	references,
	requiresReference,
	selectableKinds,
	selectedAssetIds,
}) => {
	const [kindFilter, setKindFilter] = useState<ReferenceKindFilter>("all");
	const options = useMemo(
		() => buildGeneratedReferenceOptions(entries, mediaAssets),
		[entries, mediaAssets],
	);
	const optionCounts = useMemo(
		() => ({
			all: options.length,
			image: options.filter((option) => option.kind === "image").length,
			video: options.filter((option) => option.kind === "video").length,
		}),
		[options],
	);
	const visibleOptions = useMemo(
		() => (kindFilter === "all" ? options : options.filter((option) => option.kind === kindFilter)),
		[kindFilter, options],
	);

	useEffect(() => {
		if (!open) return;

		onRefreshAssets?.();

		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			onOpenChange(false);
		};

		window.addEventListener("keydown", closeOnEscape, true);
		return () => window.removeEventListener("keydown", closeOnEscape, true);
	}, [onOpenChange, onRefreshAssets, open]);

	if (!open) return null;

	return (
		<div
			data-state="open"
			className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onOpenChange(false);
			}}
		>
			<section
				data-state="open"
				role="dialog"
				aria-modal="true"
				aria-labelledby="generation-reference-title"
				className="flex max-h-[min(46rem,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
			>
				<header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
					<div className="min-w-0">
						<h3
							id="generation-reference-title"
							className="truncate text-sm font-semibold text-foreground"
						>
							选择参考图
						</h3>
						<p className="mt-1 truncate text-xs text-muted-foreground">
							上传素材，或从当前项目素材中选择。
						</p>
					</div>
					<Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
						<X className="size-4" />
					</Button>
				</header>

				<div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
					<input
						id={inputId}
						type="file"
						accept="image/*,video/*"
						className="sr-only"
						disabled={disabled || isUploading}
						onChange={onUpload}
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={disabled || isUploading}
						onClick={() => document.getElementById(inputId)?.click()}
					>
						{isUploading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<UploadCloud className="size-4" />
						)}
						<span>上传</span>
					</Button>
					<p className="shrink-0 text-xs text-muted-foreground">已选 {references.length} 个</p>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<div className="grid gap-4">
						<ReferencePreviewStrip
							tone="card"
							disabled={disabled}
							enableImagePreview
							references={references}
							requiresReference={requiresReference}
							simple
							onRemove={onRemoveReference}
						/>
						<Tabs
							value={kindFilter}
							onValueChange={(value) => setKindFilter(value as ReferenceKindFilter)}
						>
							<TabsList className="grid h-8 w-full grid-cols-3 sm:w-72">
								{referenceKindTabs.map((tab) => (
									<TabsTrigger key={tab.value} value={tab.value} className="text-xs">
										<span>{tab.label}</span>
										<span className="text-2xs text-muted-foreground">
											{optionCounts[tab.value]}
										</span>
									</TabsTrigger>
								))}
							</TabsList>
						</Tabs>
						{options.length === 0 ? (
							<div className="flex min-h-56 items-center justify-center rounded-sm border border-dashed border-border bg-muted px-4 text-center text-xs text-muted-foreground">
								当前项目暂无可选择的图片或视频素材。
							</div>
						) : visibleOptions.length === 0 ? (
							<div className="flex min-h-56 items-center justify-center rounded-sm border border-dashed border-border bg-muted px-4 text-center text-xs text-muted-foreground">
								当前没有{referenceKindFilterLabel(kindFilter)}素材。
							</div>
						) : (
							<div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
								{visibleOptions.map((option) => {
									const supported = Boolean(
										option.mediaAsset && selectableKinds.has(option.mediaAsset.kind),
									);
									const selectable = !disabled && supported;
									const selected = Boolean(
										option.mediaAsset && selectedAssetIds.includes(option.mediaAsset.id),
									);

									return (
										<GeneratedReferenceOptionCard
											key={option.key}
											option={option}
											selectable={selectable}
											selected={selected}
											supported={supported}
											onToggle={() => {
												if (option.mediaAsset) onToggleReference(option.mediaAsset);
											}}
										/>
									);
								})}
							</div>
						)}
					</div>
				</div>
			</section>
		</div>
	);
};

type ReferenceKindFilter = "all" | "video" | "image";

const referenceKindTabs: Array<{ label: string; value: ReferenceKindFilter }> = [
	{ label: "全部", value: "all" },
	{ label: "视频", value: "video" },
	{ label: "图片", value: "image" },
];

const referenceKindFilterLabel = (value: ReferenceKindFilter) => {
	if (value === "video") return "视频";
	if (value === "image") return "图片";
	return "参考";
};

const GeneratedReferenceOptionCard: React.FC<{
	option: GeneratedReferenceOption;
	onToggle: () => void;
	selectable: boolean;
	selected: boolean;
	supported: boolean;
}> = ({ option, onToggle, selectable, selected, supported }) => (
	<button
		type="button"
		disabled={!selectable}
		className={cn(
			"min-w-0 overflow-hidden rounded-sm border bg-card text-left transition-colors",
			selected ? "border-primary" : "border-border",
			selectable ? "hover:border-input" : "opacity-60",
		)}
		onClick={onToggle}
	>
		<div className="relative aspect-square bg-muted">
			<GeneratedReferenceOptionPreview option={option} />
			{option.kind === "video" ? (
				<span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-sm bg-background/90 px-1.5 py-1 text-2xs font-medium text-foreground shadow-sm">
					<Film className="size-3" />
					视频
				</span>
			) : null}
			{selected ? (
				<span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-sm bg-primary px-1.5 py-1 text-xs font-medium text-primary-foreground shadow-sm">
					<Check className="size-3" />
					已选
				</span>
			) : null}
		</div>
		<div className="grid gap-1 p-2">
			<p className="line-clamp-2 text-xs leading-4 text-muted-foreground">
				{option.entry
					? entryPromptText(option.entry) ||
						option.mediaAsset?.filename ||
						fallbackOptionTitle(option)
					: option.mediaAsset?.filename || fallbackOptionTitle(option)}
			</p>
			<p className="truncate text-xs text-muted-foreground">
				{referenceOptionStatusText(option, supported)}
			</p>
		</div>
	</button>
);

const GeneratedReferenceOptionPreview: React.FC<{ option: GeneratedReferenceOption }> = ({
	option,
}) => {
	if (option.kind === "video") {
		return <GenerationVideoThumbnail source={option.source} />;
	}

	return <img src={option.source} alt="" className="size-full object-cover" />;
};

const referenceOptionStatusText = (option: GeneratedReferenceOption, supported: boolean) => {
	if (!option.mediaAsset) return "暂不可作为参考";
	if (!supported) return "当前模型不可用";
	if (option.entry?.status) return generationStatusLabel(option.entry.status);

	return "可作为参考";
};

const fallbackOptionTitle = (option: GeneratedReferenceOption) => {
	const kindLabel = option.kind === "video" ? "视频" : "图片";

	return option.entry ? `历史生成${kindLabel}` : `项目${kindLabel}素材`;
};
