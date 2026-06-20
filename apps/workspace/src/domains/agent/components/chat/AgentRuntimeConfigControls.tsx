import { Bot, LayoutGrid, Loader2, type LucideIcon, Sparkles } from "lucide-react";
import type React from "react";
import type {
	AgentACPConfigSelection,
	AgentRuntimeConfigPayload,
	AgentRuntimeSelectConfig,
} from "@/domains/agent/api/agent";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";

interface AgentRuntimeConfigControlsProps {
	config?: AgentRuntimeConfigPayload;
	selections: Record<string, string>;
	disabled: boolean;
	errorMessage: string;
	isLoading: boolean;
	onSelectionChange: (configId: string, value: string) => void;
}

export const AgentRuntimeConfigControls: React.FC<AgentRuntimeConfigControlsProps> = ({
	config,
	selections,
	disabled,
	isLoading,
	onSelectionChange,
}) => {
	const options = config?.options ?? [];
	const hasRuntimeConfigOptions = options.some((item) => runtimeConfigOptions(item).length > 0);
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
			{options.map((option) => (
				<AgentRuntimeConfigSelect
					key={option.configId ?? "__mode__"}
					config={option}
					value={selections[option.configId ?? ""] ?? ""}
					disabled={disabled}
					onChange={(value) => onSelectionChange(option.configId ?? "", value)}
				/>
			))}
		</div>
	);
};

interface AgentRuntimeConfigSelectProps {
	config?: AgentRuntimeSelectConfig;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}

const AgentRuntimeConfigSelect: React.FC<AgentRuntimeConfigSelectProps> = ({
	config,
	value,
	disabled,
	onChange,
}) => {
	const options = runtimeConfigOptions(config);
	if (options.length === 0) return null;

	const label = configLabel(config);
	const Icon = configIcon(config);
	const resolvedValue = normalizeRuntimeConfigValue(config, value);

	return (
		<Select value={resolvedValue} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger className="agent-config-trigger" aria-label={label}>
				<span className="agent-config-icon" aria-hidden="true">
					<Icon />
				</span>
				<span className="agent-config-title">{label}</span>
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

const runtimeConfigOptions = (config?: AgentRuntimeSelectConfig) =>
	(config?.options ?? []).filter((option) => option.value.trim().length > 0);

const configLabel = (config?: AgentRuntimeSelectConfig): string => {
	const name = config?.name?.trim();
	if (name) return name;
	switch (config?.category) {
		case "model":
			return "模型";
		case "thought_level":
			return "推理强度";
		case "mode":
			return "模式";
		default:
			return "配置";
	}
};

const configIcon = (config?: AgentRuntimeSelectConfig): LucideIcon => {
	if (config?.source === "mode" || config?.category === "mode") return LayoutGrid;
	if (config?.category === "model") return Bot;
	return Sparkles;
};

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

export const buildRuntimeConfigSelections = (
	config: AgentRuntimeConfigPayload | undefined,
	selections: Record<string, string>,
): AgentACPConfigSelection[] => {
	const result: AgentACPConfigSelection[] = [];
	for (const option of config?.options ?? []) {
		const key = option.configId ?? "";
		const value = normalizeRuntimeConfigValue(option, selections[key] ?? "").trim();
		if (!value) continue;
		result.push({ configId: option.configId, source: option.source, value });
	}
	return result;
};

export const getRuntimeConfigError = (err: unknown) => {
	if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === 404) {
		return "ACP 配置接口不可用";
	}
	if (err instanceof Error) return err.message;
	return "ACP 配置不可用";
};
