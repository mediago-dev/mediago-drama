import {
	Check,
	ChevronDown,
	ChevronRight,
	LayoutGrid,
	Loader2,
	type LucideIcon,
	Sparkles,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	AgentRuntimeConfigPayload,
	AgentRuntimeSelectConfig,
	AgentRuntimeSelectOption,
} from "@/domains/agent/api/agent";
import {
	type GenerationBrandKey,
	GenerationBrandMark,
	generationModelBrand,
	generationProviderBrand,
} from "@/domains/generation/components/GenerationBrandMark";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

interface AgentRuntimeConfigControlsProps {
	config?: AgentRuntimeConfigPayload;
	modelValue: string;
	reasoningValue: string;
	permissionValue: string;
	disabled: boolean;
	errorMessage: string;
	isLoading: boolean;
	onModelChange: (value: string) => void;
	onReasoningChange: (value: string) => void;
	onPermissionChange: (value: string) => void;
}

export const AgentRuntimeConfigControls: React.FC<AgentRuntimeConfigControlsProps> = ({
	config,
	modelValue,
	reasoningValue,
	permissionValue,
	disabled,
	isLoading,
	onModelChange,
	onReasoningChange,
	onPermissionChange,
}) => {
	const hasRuntimeConfigOptions = [config?.model, config?.reasoning, config?.permission].some(
		(item) => runtimeConfigOptions(item).length > 0,
	);
	if (!hasRuntimeConfigOptions && isLoading) {
		return (
			<div className="agent-runtime-config-loading" role="status">
				<Loader2 className="animate-spin" aria-hidden="true" />
				<span>配置读取中</span>
			</div>
		);
	}
	if (!hasRuntimeConfigOptions) return null;

	return (
		<div className="agent-runtime-config">
			<AgentRuntimeModelSelect
				label="模型"
				config={config?.model}
				value={modelValue}
				disabled={disabled}
				onChange={onModelChange}
			/>
			<AgentRuntimeConfigSelect
				label="推理强度"
				icon={Sparkles}
				config={config?.reasoning}
				value={reasoningValue}
				disabled={disabled}
				onChange={onReasoningChange}
			/>
			<AgentRuntimeConfigSelect
				label="模式"
				icon={LayoutGrid}
				config={config?.permission}
				value={permissionValue}
				disabled={disabled}
				onChange={onPermissionChange}
			/>
		</div>
	);
};

interface AgentRuntimeModelOption {
	categoryKey: string;
	categoryLabel: string;
	modelKey: string;
	modelLabel: string;
	option: AgentRuntimeSelectOption;
	providerLabel: string;
}

interface AgentRuntimeModelCategory {
	key: string;
	label: string;
	options: AgentRuntimeModelOption[];
}

interface AgentRuntimePoint {
	x: number;
	y: number;
}

interface AgentRuntimeRect {
	bottom: number;
	left: number;
	right: number;
	top: number;
}

interface AgentRuntimeSafeTriangleInput {
	activeRect?: AgentRuntimeRect | null;
	origin?: AgentRuntimePoint | null;
	point: AgentRuntimePoint;
	submenuRect?: AgentRuntimeRect | null;
}

interface AgentRuntimeConfigSelectProps {
	label: string;
	icon?: LucideIcon;
	config?: AgentRuntimeSelectConfig;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}

const AgentRuntimeConfigSelect: React.FC<AgentRuntimeConfigSelectProps> = ({
	label,
	icon: Icon,
	config,
	value,
	disabled,
	onChange,
}) => {
	const options = runtimeConfigOptions(config);
	if (options.length === 0) return null;

	const resolvedValue = normalizeRuntimeConfigValue(config, value);

	return (
		<Select value={resolvedValue} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger className="agent-config-trigger" aria-label={label}>
				{Icon ? (
					<span className="agent-config-icon" aria-hidden="true">
						<Icon />
					</span>
				) : null}
				<span className="agent-config-value">
					<SelectValue placeholder={config?.name || label} />
				</span>
			</SelectTrigger>
			<SelectContent align="start" className="agent-config-content">
				{options.map((option) => (
					<SelectItem
						key={option.value}
						value={option.value}
						title={option.description}
						className="agent-config-item"
					>
						{option.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
};

const AgentRuntimeModelSelect: React.FC<AgentRuntimeConfigSelectProps> = ({
	label,
	icon: Icon,
	config,
	value,
	disabled,
	onChange,
}) => {
	const options = useMemo(() => runtimeConfigOptions(config), [config]);
	const resolvedValue = normalizeRuntimeConfigValue(config, value);
	const parsedOptions = useMemo(() => options.map(parseAgentRuntimeModelOption), [options]);
	const categories = useMemo(() => agentRuntimeModelCategories(parsedOptions), [parsedOptions]);
	const selectedOption =
		parsedOptions.find((option) => option.option.value === resolvedValue) ??
		parsedOptions[0] ??
		null;
	const [open, setOpen] = useState(false);
	const [activeCategoryKey, setActiveCategoryKey] = useState(
		selectedOption?.categoryKey ?? categories[0]?.key ?? "",
	);
	const [suppressedCategoryHoverKey, setSuppressedCategoryHoverKey] = useState<string | null>(null);
	const categoryButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	const categoryListRef = useRef<HTMLDivElement | null>(null);
	const modelPanelRef = useRef<HTMLElement | null>(null);
	const modelListRef = useRef<HTMLDivElement | null>(null);
	const safeTriangleOriginRef = useRef<{
		categoryKey: string;
		point: AgentRuntimePoint;
	} | null>(null);
	const categoryActivationIntentTimerRef = useRef<number | null>(null);
	const [categoryListCanScrollDown, setCategoryListCanScrollDown] = useState(false);
	const [modelListCanScrollDown, setModelListCanScrollDown] = useState(false);
	const activeCategory =
		categories.find((category) => category.key === activeCategoryKey) ??
		categories.find((category) => category.key === selectedOption?.categoryKey) ??
		categories[0] ??
		null;
	const modelMenuStyle = {
		"--agent-runtime-model-menu-height": agentRuntimeModelMenuHeight(categories),
	} as React.CSSProperties;

	useEffect(() => {
		const fallbackCategoryKey = selectedOption?.categoryKey ?? categories[0]?.key ?? "";
		setActiveCategoryKey((currentKey) => {
			if (open && currentKey && categories.some((category) => category.key === currentKey)) {
				return currentKey;
			}
			return fallbackCategoryKey;
		});
	}, [categories, open, selectedOption?.categoryKey]);

	const updateCategoryListScrollHint = useCallback(() => {
		const node = categoryListRef.current;
		if (!node) {
			setCategoryListCanScrollDown(false);
			return;
		}
		const remainingScroll = node.scrollHeight - node.clientHeight - node.scrollTop;
		setCategoryListCanScrollDown(remainingScroll > 1);
	}, []);

	const updateModelListScrollHint = useCallback(() => {
		const node = modelListRef.current;
		if (!node) {
			setModelListCanScrollDown(false);
			return;
		}
		const remainingScroll = node.scrollHeight - node.clientHeight - node.scrollTop;
		setModelListCanScrollDown(remainingScroll > 1);
	}, []);

	useEffect(() => {
		if (!open) {
			setCategoryListCanScrollDown(false);
			setModelListCanScrollDown(false);
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			if (categoryListRef.current) {
				categoryListRef.current.scrollTop = 0;
			}
			if (modelListRef.current) {
				modelListRef.current.scrollTop = 0;
			}
			updateCategoryListScrollHint();
			updateModelListScrollHint();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [
		activeCategory?.key,
		activeCategory?.options.length,
		categories.length,
		open,
		updateCategoryListScrollHint,
		updateModelListScrollHint,
	]);

	useEffect(() => {
		return () => {
			const timer = categoryActivationIntentTimerRef.current;
			if (timer !== null) {
				window.clearTimeout(timer);
				categoryActivationIntentTimerRef.current = null;
			}
		};
	}, []);

	if (options.length === 0 || !selectedOption) return null;

	const clearCategoryActivationIntent = () => {
		const timer = categoryActivationIntentTimerRef.current;
		if (timer !== null) {
			window.clearTimeout(timer);
			categoryActivationIntentTimerRef.current = null;
		}
	};

	const clearSafeTriangle = () => {
		clearCategoryActivationIntent();
		safeTriangleOriginRef.current = null;
		setSuppressedCategoryHoverKey(null);
	};

	const rememberActiveCategoryPointer = (categoryKey: string, point: AgentRuntimePoint) => {
		clearCategoryActivationIntent();
		safeTriangleOriginRef.current = { categoryKey, point };
		setSuppressedCategoryHoverKey(null);
	};

	const suppressCategoryHover = (categoryKey: string) => {
		setSuppressedCategoryHoverKey((currentKey) =>
			currentKey === categoryKey ? currentKey : categoryKey,
		);
	};

	const activateCategory = (categoryKey: string) => {
		setActiveCategoryKey(categoryKey);
		clearSafeTriangle();
	};

	const activateCategoryFromPointer = (categoryKey: string, point: AgentRuntimePoint) => {
		setActiveCategoryKey(categoryKey);
		rememberActiveCategoryPointer(categoryKey, point);
	};

	const scheduleCategoryActivationIntent = (categoryKey: string, point: AgentRuntimePoint) => {
		suppressCategoryHover(categoryKey);
		clearCategoryActivationIntent();
		categoryActivationIntentTimerRef.current = window.setTimeout(() => {
			categoryActivationIntentTimerRef.current = null;
			activateCategoryFromPointer(categoryKey, point);
		}, AGENT_RUNTIME_SAFE_TRIANGLE_HOVER_INTENT_MS);
	};

	const shouldPreserveActiveCategory = (point: AgentRuntimePoint) => {
		const currentActiveCategoryKey = activeCategory?.key ?? "";
		const activeButton = currentActiveCategoryKey
			? categoryButtonRefs.current.get(currentActiveCategoryKey)
			: null;
		const origin =
			safeTriangleOriginRef.current?.categoryKey === currentActiveCategoryKey
				? safeTriangleOriginRef.current.point
				: null;

		return shouldKeepAgentRuntimeCategoryActive({
			activeRect: activeButton?.getBoundingClientRect(),
			origin,
			point,
			submenuRect: modelPanelRef.current?.getBoundingClientRect(),
		});
	};

	const handleCategoryPointerEnter = (
		categoryKey: string,
		event: React.PointerEvent<HTMLButtonElement>,
	) => {
		const point = pointerEventPoint(event);
		const currentActiveCategoryKey = activeCategory?.key ?? "";
		if (categoryKey === currentActiveCategoryKey) {
			rememberActiveCategoryPointer(categoryKey, point);
			return;
		}

		if (shouldPreserveActiveCategory(point)) {
			scheduleCategoryActivationIntent(categoryKey, point);
			return;
		}

		activateCategoryFromPointer(categoryKey, point);
	};

	const handleCategoryPointerMove = (
		categoryKey: string,
		event: React.PointerEvent<HTMLButtonElement>,
	) => {
		const point = pointerEventPoint(event);
		if (categoryKey === activeCategory?.key) {
			rememberActiveCategoryPointer(categoryKey, point);
			return;
		}

		if (shouldPreserveActiveCategory(point)) {
			scheduleCategoryActivationIntent(categoryKey, point);
			return;
		}

		activateCategoryFromPointer(categoryKey, point);
	};

	const selectedModelBrand = generationModelBrand({
		version: {
			id: selectedOption.modelKey,
			label: selectedOption.modelLabel,
		},
	});
	const selectedProviderBrand = generationProviderBrand(selectedOption.providerLabel);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					aria-label={label}
					disabled={disabled}
					className="agent-config-trigger"
				>
					{Icon ? (
						<span className="agent-config-icon" aria-hidden="true">
							<Icon />
						</span>
					) : null}
					<AgentRuntimeModelBrandStack
						modelBrand={selectedModelBrand}
						providerBrand={selectedProviderBrand}
						className="shrink-0"
					/>
					<span className="agent-config-value">{selectedOption.option.name}</span>
					<ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="start"
				aria-label="提供商和模型"
				className="agent-config-content grid h-[var(--agent-runtime-model-menu-height)] max-h-[calc(100vh_-_2rem)] w-[min(42rem,calc(100vw_-_2rem))] grid-cols-[minmax(13rem,1fr)_minmax(12rem,0.85fr)] overflow-hidden rounded-[var(--radius-scale-sm)] border-border bg-popover p-0 text-popover-foreground shadow-xl"
				style={modelMenuStyle}
				onPointerLeave={() => {
					clearSafeTriangle();
				}}
			>
				<section className="flex min-h-0 min-w-0 flex-col p-[var(--generation-popover-padding)]">
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">提供商</p>
					<div className="relative min-h-0 flex-1">
						<div
							ref={categoryListRef}
							className="grid h-full min-h-0 auto-rows-min gap-1 overflow-y-auto pr-1"
							onScroll={updateCategoryListScrollHint}
						>
							{categories.map((category) => {
								const active = category.key === activeCategory?.key;
								const categoryBrand = generationProviderBrand(category.label);
								const suppressHover = category.key === suppressedCategoryHoverKey;

								return (
									<button
										key={category.key}
										type="button"
										ref={(node) => {
											if (node) {
												categoryButtonRefs.current.set(category.key, node);
											} else {
												categoryButtonRefs.current.delete(category.key);
											}
										}}
										className={cn(
											"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
											active
												? "bg-ide-list-active text-ide-list-active-foreground"
												: suppressHover
													? "text-foreground"
													: "text-foreground hover:bg-muted",
										)}
										onPointerEnter={(event) => handleCategoryPointerEnter(category.key, event)}
										onPointerMove={(event) => handleCategoryPointerMove(category.key, event)}
										onFocus={() => activateCategory(category.key)}
										onClick={() => activateCategory(category.key)}
									>
										<GenerationBrandMark
											brand={categoryBrand}
											className="size-3.5 border-0 bg-transparent p-0 text-[0.45rem] shadow-none"
										/>
										<span className="min-w-0 flex-1 truncate">{category.label}</span>
										<ChevronRight
											className={cn(
												"size-4 shrink-0",
												active ? "text-primary" : "text-muted-foreground",
											)}
										/>
									</button>
								);
							})}
						</div>
						{categoryListCanScrollDown ? (
							<div
								aria-hidden="true"
								className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-popover/95 via-popover/60 to-popover/0"
								data-agent-category-scroll-hint
							/>
						) : null}
					</div>
				</section>
				<section
					ref={modelPanelRef}
					className="flex min-h-0 min-w-0 flex-col border-l border-border bg-muted/40 p-[var(--generation-popover-padding)]"
					onPointerEnter={clearSafeTriangle}
				>
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">模型</p>
					<div className="relative min-h-0 flex-1">
						<div
							ref={modelListRef}
							className="grid h-full min-h-0 auto-rows-min gap-1 overflow-y-auto pr-1"
							onScroll={updateModelListScrollHint}
						>
							{(activeCategory?.options ?? []).map((option) => {
								const selected = option.option.value === resolvedValue;
								const modelBrand = generationModelBrand({
									version: {
										id: option.modelKey,
										label: option.modelLabel,
									},
								});

								return (
									<button
										key={option.option.value}
										type="button"
										disabled={disabled}
										title={option.option.description}
										className={cn(
											"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45",
											selected
												? "bg-ide-list-active text-ide-list-active-foreground"
												: "text-foreground hover:bg-card",
										)}
										onClick={() => {
											onChange(option.option.value);
											setOpen(false);
										}}
									>
										<GenerationBrandMark
											brand={modelBrand}
											className="size-3.5 border-0 bg-transparent p-0 text-[0.45rem] shadow-none"
										/>
										<span className="min-w-0 flex-1 truncate">{option.modelLabel}</span>
										{selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
									</button>
								);
							})}
						</div>
						{modelListCanScrollDown ? (
							<div
								aria-hidden="true"
								className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted/95 via-muted/60 to-muted/0"
								data-agent-model-scroll-hint
							/>
						) : null}
					</div>
				</section>
			</PopoverContent>
		</Popover>
	);
};

const AgentRuntimeModelBrandStack: React.FC<{
	className?: string;
	modelBrand: GenerationBrandKey;
	providerBrand: GenerationBrandKey;
}> = ({ className, modelBrand, providerBrand }) => {
	const brands = providerBrand !== modelBrand ? [providerBrand, modelBrand] : [providerBrand];

	return (
		<span
			className={cn("flex shrink-0 items-center", brands.length > 1 ? "-space-x-1" : "", className)}
		>
			{brands.map((brand, index) => (
				<GenerationBrandMark
					key={`${brand}:${index}`}
					brand={brand}
					className={
						brands.length > 1
							? cn("relative ring-1 ring-background", index === 0 ? "z-0" : "z-10")
							: undefined
					}
				/>
			))}
		</span>
	);
};

const runtimeConfigOptions = (config?: AgentRuntimeSelectConfig) =>
	(config?.options ?? []).filter((option) => option.value.trim().length > 0);

const parseAgentRuntimeModelOption = (
	option: AgentRuntimeSelectOption,
): AgentRuntimeModelOption => {
	const name = option.name.trim();
	const value = option.value.trim();
	const nameParts = splitAgentProviderModel(name);
	const valueParts = splitAgentProviderModel(value);
	const providerSource = nameParts?.provider ?? valueParts?.provider ?? "";
	const fallbackName = name && name !== value ? name : "";
	const modelLabel = nameParts?.model || fallbackName || valueParts?.model || value || "模型";
	const providerLabel = agentProviderLabel(providerSource);
	const modelKey = normalizeAgentOptionKey(modelLabel);
	const categoryKey = normalizeAgentOptionKey(providerLabel);

	return {
		categoryKey: categoryKey || "default",
		categoryLabel: providerLabel,
		modelKey: modelKey || normalizeAgentOptionKey(value) || value,
		modelLabel,
		option,
		providerLabel,
	};
};

const agentRuntimeModelCategories = (
	options: AgentRuntimeModelOption[],
): AgentRuntimeModelCategory[] => {
	const categories: AgentRuntimeModelCategory[] = [];
	const categoryByKey = new Map<string, AgentRuntimeModelCategory>();
	for (const option of options) {
		const existing = categoryByKey.get(option.categoryKey);
		if (existing) {
			existing.options.push(option);
			continue;
		}
		const category = {
			key: option.categoryKey,
			label: option.categoryLabel,
			options: [option],
		};
		categoryByKey.set(option.categoryKey, category);
		categories.push(category);
	}
	return categories;
};

const agentRuntimeModelMenuHeight = (categories: AgentRuntimeModelCategory[]) => {
	const maxModelOptionCount = categories.reduce(
		(max, category) => Math.max(max, category.options.length),
		0,
	);
	const rowCount = Math.max(categories.length, maxModelOptionCount, 1);
	const visibleRowCount = Math.min(rowCount, agentRuntimeModelMenuMaxVisibleRows);
	const gapCount = Math.max(visibleRowCount - 1, 0);
	return `calc(var(--generation-popover-padding) * 2 + 1.25rem + ${visibleRowCount} * var(--generation-model-popover-option-height) + ${gapCount} * 0.25rem)`;
};

const agentRuntimeModelMenuMaxVisibleRows = 5;

const splitAgentProviderModel = (value: string) => {
	const trimmed = value.trim();
	const separator = trimmed.indexOf("/");
	if (separator <= 0 || separator >= trimmed.length - 1) return null;
	return {
		model: trimmed.slice(separator + 1).trim(),
		provider: trimmed.slice(0, separator).trim(),
	};
};

const agentProviderLabel = (provider: string) => {
	const trimmed = provider.trim();
	const normalized = normalizeAgentOptionKey(trimmed);
	switch (normalized) {
		case "mediago":
			return "MediaGo";
		case "openrouter":
			return "OpenRouter";
		case "dmx":
		case "dmxapi":
			return "DMXAPI";
		case "openai":
			return "OpenAI";
		case "minimax":
			return "MiniMax 国内";
		case "opencode":
		case "opencodezen":
			return "OpenCode Zen";
		case "githubcopilot":
		case "copilot":
			return "GitHub Copilot";
		default:
			return trimmed || "默认提供方";
	}
};

const normalizeAgentOptionKey = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");

const AGENT_RUNTIME_SAFE_TRIANGLE_EDGE_PADDING = 8;
const AGENT_RUNTIME_SAFE_TRIANGLE_HOVER_INTENT_MS = 180;

const pointerEventPoint = (event: React.PointerEvent): AgentRuntimePoint => ({
	x: event.clientX,
	y: event.clientY,
});

export const shouldKeepAgentRuntimeCategoryActive = ({
	activeRect,
	origin,
	point,
	submenuRect,
}: AgentRuntimeSafeTriangleInput) => {
	if (!activeRect || !origin || !submenuRect) return false;
	if (origin.y < activeRect.top - AGENT_RUNTIME_SAFE_TRIANGLE_EDGE_PADDING) return false;
	if (origin.y > activeRect.bottom + AGENT_RUNTIME_SAFE_TRIANGLE_EDGE_PADDING) return false;
	if (point.x <= origin.x) return false;
	if (point.x >= submenuRect.left) return false;

	return pointInTriangle(
		point,
		origin,
		{
			x: submenuRect.left,
			y: submenuRect.top - AGENT_RUNTIME_SAFE_TRIANGLE_EDGE_PADDING,
		},
		{
			x: submenuRect.left,
			y: submenuRect.bottom + AGENT_RUNTIME_SAFE_TRIANGLE_EDGE_PADDING,
		},
	);
};

const pointInTriangle = (
	point: AgentRuntimePoint,
	first: AgentRuntimePoint,
	second: AgentRuntimePoint,
	third: AgentRuntimePoint,
) => {
	const firstSign = triangleSign(point, first, second);
	const secondSign = triangleSign(point, second, third);
	const thirdSign = triangleSign(point, third, first);
	const hasNegative = firstSign < 0 || secondSign < 0 || thirdSign < 0;
	const hasPositive = firstSign > 0 || secondSign > 0 || thirdSign > 0;
	return !(hasNegative && hasPositive);
};

const triangleSign = (
	first: AgentRuntimePoint,
	second: AgentRuntimePoint,
	third: AgentRuntimePoint,
) => (first.x - third.x) * (second.y - third.y) - (second.x - third.x) * (first.y - third.y);

export const normalizeRuntimeConfigValue = (
	config: AgentRuntimeSelectConfig | undefined,
	current: string,
) => {
	const options = runtimeConfigOptions(config);
	if (options.length === 0) return "";
	const values = new Set(options.map((option) => option.value));
	if (current && values.has(current)) return current;
	const currentValue = config?.currentValue?.trim() ?? "";
	if (currentValue && values.has(currentValue)) return currentValue;
	return options[0]?.value ?? "";
};

export const buildRuntimeConfigSelection = (
	config: AgentRuntimeSelectConfig | undefined,
	value: string,
) => {
	const trimmed = normalizeRuntimeConfigValue(config, value).trim();
	if (!config || !trimmed) return undefined;
	return {
		configId: config.configId,
		source: config.source,
		value: trimmed,
	};
};

export const getRuntimeConfigError = (err: unknown) => {
	if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === 404) {
		return "ACP 配置接口不可用";
	}
	if (err instanceof Error) return err.message;
	return "ACP 配置不可用";
};
