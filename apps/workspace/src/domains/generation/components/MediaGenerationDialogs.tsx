import {
	Check,
	ChevronDown,
	Film,
	Images,
	Loader2,
	SlidersHorizontal,
	UploadCloud,
	X,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { GenerationParam } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	buildGeneratedReferenceOptions,
	entryPromptText,
	type GeneratedReferenceOption,
} from "@/domains/generation/components/mediaGenerationHelpers";
import { GenerationVideoThumbnail } from "@/domains/generation/components/GenerationVideoThumbnail";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
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
	const options = useMemo(
		() => Array.from({ length: max - min + 1 }, (_, index) => min + index),
		[max, min],
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`生成数量：${value}`}
					className={cn(
						"flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						"h-[var(--generation-control-height)] rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground hover:bg-ide-list-hover",
						open && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<Images className="size-4 shrink-0 text-muted-foreground" />
					<span>数量 {value}</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label="生成数量"
				className="w-[min(var(--generation-count-popover-width),var(--generation-popover-max-inline))] rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding)] text-popover-foreground shadow-2xl"
			>
				<div className="mb-2 px-2">
					<p className="text-xs font-semibold text-muted-foreground">数量</p>
				</div>
				<div className="grid gap-2">
					{options.map((option) => {
						const selected = option === value;

						return (
							<button
								key={option}
								type="button"
								className={cn(
									"transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									"flex h-[var(--generation-count-option-height)] items-center justify-between rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-xs font-semibold",
									selected
										? "bg-ide-list-active text-ide-list-active-foreground"
										: "text-foreground hover:bg-muted",
								)}
								onClick={() => {
									onChange(option);
									setOpen(false);
								}}
							>
								<span>{option}</span>
								{selected ? <Check className="size-5 text-primary" /> : null}
							</button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
};

export const PrimaryParamControl: React.FC<{
	label?: string;
	onChange: (value: string) => void;
	param: GenerationParam;
	value: unknown;
}> = ({ label: triggerLabel, onChange, param, value }) => {
	const [open, setOpen] = useState(false);
	const options = param.options ?? [];
	const selectedValue = String(value ?? param.default ?? options[0]?.value ?? "");
	const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0];
	const label = paramLabel(param.label);
	const controlLabel = triggerLabel ?? label;
	const selectedLabel = selectedOption ? paramOptionLabel(selectedOption.label) : "未选择";

	if (options.length === 0) return null;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${controlLabel}：${selectedLabel}`}
					className={cn(
						"flex min-w-0 items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						"h-[var(--generation-control-height)] max-w-48 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover",
						open && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<span className="truncate">
						{controlLabel}: {selectedLabel}
					</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label={label}
				className="w-[min(var(--generation-primary-popover-width),var(--generation-popover-max-inline))] rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding-lg)] text-popover-foreground shadow-xl"
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
									"flex h-[var(--generation-primary-option-height)] min-w-0 items-center justify-center rounded-[var(--generation-control-radius)] border px-[var(--generation-control-padding-x)] text-xs font-medium transition-colors",
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
			</PopoverContent>
		</Popover>
	);
};

export const SecondaryParamsDropdown: React.FC<{
	label?: string;
	onChange: (name: string, value: unknown) => void;
	params: GenerationParam[];
	values: Record<string, unknown>;
}> = ({ label = "其他", onChange, params, values }) => {
	const [open, setOpen] = useState(false);
	const triggerLabel = label === "Other" ? "其他" : paramLabel(label);

	if (params.length === 0) return null;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={triggerLabel}
					className={cn(
						"inline-flex min-w-0 items-center gap-1.5 border font-medium transition-colors",
						"h-[var(--generation-control-height)] max-w-48 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover",
						open && "border-primary bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<SlidersHorizontal className="size-4 shrink-0" />
					<span>{triggerLabel}</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label={`${triggerLabel}参数`}
				className="max-h-[var(--generation-popover-max-block)] w-[min(var(--generation-other-popover-width),var(--generation-popover-max-inline))] overflow-y-auto rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding)] text-popover-foreground shadow-2xl"
			>
				<SecondaryParamSettings params={params} values={values} onChange={onChange} />
			</PopoverContent>
		</Popover>
	);
};

const SecondaryParamSettings: React.FC<{
	onChange: (name: string, value: unknown) => void;
	params: GenerationParam[];
	values: Record<string, unknown>;
}> = ({ onChange, params, values }) => (
	<div className="grid gap-[var(--generation-composer-toolbar-gap)]">
		<header>
			<h3 className="px-1 text-sm font-semibold text-foreground">其他设置</h3>
		</header>
		<div className="grid gap-0.5">
			{params.map((param) => (
				<SecondaryParamRow
					key={param.name}
					param={param}
					value={values[param.name]}
					onChange={(value) => onChange(param.name, value)}
				/>
			))}
		</div>
	</div>
);

const SecondaryParamRow: React.FC<{
	onChange: (value: unknown) => void;
	param: GenerationParam;
	value: unknown;
}> = ({ onChange, param, value }) => {
	const label = paramLabel(param.label);
	const help = param.help ? paramHelp(param.help) : undefined;

	return (
		<div className="flex min-w-0 items-center justify-between gap-2 rounded-[var(--generation-control-radius)] px-1 py-1 hover:bg-muted/60">
			<div className="min-w-0">
				<p className="truncate text-xs font-semibold text-foreground" title={help}>
					{label}
				</p>
			</div>
			<SecondaryParamInput param={param} value={value} onChange={onChange} />
		</div>
	);
};

const SecondaryParamInput: React.FC<{
	onChange: (value: unknown) => void;
	param: GenerationParam;
	value: unknown;
}> = ({ onChange, param, value }) => {
	if (param.type === "select") {
		const options = param.options ?? [];
		const selectedValue = String(value ?? param.default ?? options[0]?.value ?? "");

		return (
			<label className="relative shrink-0">
				<span className="sr-only">{paramLabel(param.label)}</span>
				<select
					value={selectedValue}
					className="h-[var(--generation-other-control-height)] min-w-[var(--generation-other-control-min-width)] appearance-none rounded-[var(--generation-control-radius)] border border-input bg-card py-0 pl-2 pr-6 text-xs font-semibold text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
					onChange={(event) => onChange(event.target.value)}
				>
					{options.map((option) => (
						<option key={option.value} value={option.value}>
							{paramOptionLabel(option.label)}
						</option>
					))}
				</select>
				<ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
			</label>
		);
	}

	if (param.type === "boolean") {
		const enabled = Boolean(value ?? param.default);

		return (
			<button
				type="button"
				role="switch"
				aria-checked={enabled}
				className={cn(
					"relative h-[var(--generation-other-switch-height)] w-[var(--generation-other-switch-width)] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					enabled ? "bg-primary" : "bg-muted",
				)}
				onClick={() => onChange(!enabled)}
			>
				<span
					className={cn(
						"absolute top-[var(--generation-other-switch-thumb-offset)] size-[var(--generation-other-switch-thumb-size)] rounded-full bg-card shadow-md transition-transform",
						enabled
							? "translate-x-[var(--generation-other-switch-thumb-checked-x)]"
							: "translate-x-[var(--generation-other-switch-thumb-offset)]",
					)}
				/>
			</button>
		);
	}

	if (param.type === "number") {
		return (
			<input
				type="number"
				value={String(value ?? param.default ?? "")}
				min={param.min}
				max={param.max}
				className="h-[var(--generation-other-control-height)] w-[var(--generation-other-number-width)] shrink-0 rounded-[var(--generation-control-radius)] border border-input bg-card px-2 text-xs font-semibold text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
				onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
			/>
		);
	}

	return (
		<input
			value={String(value ?? param.default ?? "")}
			className="h-[var(--generation-other-control-height)] w-[var(--generation-other-text-width)] shrink-0 rounded-[var(--generation-control-radius)] border border-input bg-card px-2 text-xs font-semibold text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
			onChange={(event) => onChange(event.target.value)}
		/>
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
	title?: string;
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
	title = "选择参考图",
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
							{title}
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
