import { Bot, LayoutGrid, Loader2, type LucideIcon, Sparkles } from "lucide-react";
import type React from "react";
import type {
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
			<AgentRuntimeConfigSelect
				label="模型"
				icon={Bot}
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

interface AgentRuntimeConfigSelectProps {
	label: string;
	icon: LucideIcon;
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
