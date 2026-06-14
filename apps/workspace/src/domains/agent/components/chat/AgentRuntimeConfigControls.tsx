import { Bot, ChevronDown, LayoutGrid, type LucideIcon, Sparkles } from "lucide-react";
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
	errorMessage,
	isLoading,
	onModelChange,
	onReasoningChange,
	onPermissionChange,
}) => {
	return (
		<div className="agent-runtime-config">
			<AgentRuntimeConfigSelect
				label="模型"
				icon={Bot}
				config={config?.model}
				value={modelValue}
				disabled={disabled}
				errorMessage={errorMessage}
				isLoading={isLoading}
				onChange={onModelChange}
			/>
			<AgentRuntimeConfigSelect
				label="推理强度"
				icon={Sparkles}
				config={config?.reasoning}
				value={reasoningValue}
				disabled={disabled}
				errorMessage={errorMessage}
				isLoading={isLoading}
				onChange={onReasoningChange}
			/>
			<AgentRuntimeConfigSelect
				label="模式"
				icon={LayoutGrid}
				config={config?.permission}
				value={permissionValue}
				disabled={disabled}
				errorMessage={errorMessage}
				isLoading={isLoading}
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
	errorMessage: string;
	isLoading: boolean;
	onChange: (value: string) => void;
}

const AgentRuntimeConfigSelect: React.FC<AgentRuntimeConfigSelectProps> = ({
	label,
	icon: Icon,
	config,
	value,
	disabled,
	errorMessage,
	isLoading,
	onChange,
}) => {
	const options = runtimeConfigOptions(config);
	if (options.length === 0) {
		const placeholder = isLoading ? "读取中" : errorMessage ? "配置不可用" : "未返回选项";
		return (
			<label className="agent-config-field">
				<span className="agent-config-icon" aria-hidden="true">
					<Icon />
				</span>
				<span className="agent-config-title">{label}</span>
				<div
					className="agent-config-placeholder flex h-7 w-full items-center justify-between gap-2 rounded-sm border border-input bg-ide-editor px-2 py-1.5 text-xs text-muted-foreground opacity-60"
					title={errorMessage || placeholder}
				>
					<span className="truncate">{placeholder}</span>
					<ChevronDown className="size-4 shrink-0 opacity-50" />
				</div>
			</label>
		);
	}
	const resolvedValue = normalizeRuntimeConfigValue(config, value);

	return (
		<label className="agent-config-field">
			<span className="agent-config-icon" aria-hidden="true">
				<Icon />
			</span>
			<span className="agent-config-title">{label}</span>
			<Select value={resolvedValue} onValueChange={onChange} disabled={disabled}>
				<SelectTrigger className="agent-config-trigger h-7">
					<SelectValue placeholder={config?.name || label} />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value} title={option.description}>
							{option.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</label>
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
