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
import { useEffect, useMemo, useState } from "react";
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
	const activeCategory =
		categories.find((category) => category.key === activeCategoryKey) ??
		categories.find((category) => category.key === selectedOption?.categoryKey) ??
		categories[0] ??
		null;

	useEffect(() => {
		const fallbackCategoryKey = selectedOption?.categoryKey ?? categories[0]?.key ?? "";
		setActiveCategoryKey((currentKey) => {
			if (open && currentKey && categories.some((category) => category.key === currentKey)) {
				return currentKey;
			}
			return fallbackCategoryKey;
		});
	}, [categories, open, selectedOption?.categoryKey]);

	if (options.length === 0 || !selectedOption) return null;

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
				aria-label="分类和模型"
				className="agent-config-content grid h-[22rem] max-h-[calc(100vh_-_2rem)] w-[min(42rem,calc(100vw_-_2rem))] grid-cols-[minmax(13rem,1fr)_minmax(12rem,0.85fr)] overflow-hidden rounded-[var(--radius-scale-sm)] border-border bg-popover p-0 text-popover-foreground shadow-xl"
			>
				<section className="flex min-h-0 min-w-0 flex-col p-[var(--generation-popover-padding)]">
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">分类</p>
					<div className="grid min-h-0 flex-1 auto-rows-min gap-1 overflow-y-auto pr-1">
						{categories.map((category) => {
							const active = category.key === activeCategory?.key;
							const categoryBrand = generationProviderBrand(category.label);

							return (
								<button
									key={category.key}
									type="button"
									className={cn(
										"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										active
											? "bg-ide-list-active text-ide-list-active-foreground"
											: "text-foreground hover:bg-muted",
									)}
									onMouseEnter={() => setActiveCategoryKey(category.key)}
									onFocus={() => setActiveCategoryKey(category.key)}
									onClick={() => setActiveCategoryKey(category.key)}
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
				</section>
				<section className="flex min-h-0 min-w-0 flex-col border-l border-border bg-muted/40 p-[var(--generation-popover-padding)]">
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">模型</p>
					<div className="grid min-h-0 flex-1 auto-rows-min gap-1 overflow-y-auto pr-1">
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
