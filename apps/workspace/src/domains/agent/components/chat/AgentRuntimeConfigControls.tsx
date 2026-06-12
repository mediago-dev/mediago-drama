import { ChevronDown } from "lucide-react";
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
		<div className="mb-1.5 grid grid-cols-3 gap-1.5">
			<AgentRuntimeConfigSelect
				label="模型"
				config={config?.model}
				value={modelValue}
				disabled={disabled}
				errorMessage={errorMessage}
				isLoading={isLoading}
				onChange={onModelChange}
			/>
			<AgentRuntimeConfigSelect
				label="推理强度"
				config={config?.reasoning}
				value={reasoningValue}
				disabled={disabled}
				errorMessage={errorMessage}
				isLoading={isLoading}
				onChange={onReasoningChange}
			/>
			<AgentRuntimeConfigSelect
				label="权限"
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
	config?: AgentRuntimeSelectConfig;
	value: string;
	disabled: boolean;
	errorMessage: string;
	isLoading: boolean;
	onChange: (value: string) => void;
}

const AgentRuntimeConfigSelect: React.FC<AgentRuntimeConfigSelectProps> = ({
	label,
	config,
	value,
	disabled,
	errorMessage,
	isLoading,
	onChange,
}) => {
	const options = runtimeConfigOptions(config);
	if (options.length === 0) {
		const placeholder = isLoading ? "读取 ACP 配置中" : errorMessage || `ACP 未返回${label}选项`;
		return (
			<label className="min-w-0 space-y-1">
				<span className="text-caption font-medium text-muted-foreground">{label}</span>
				<div className="flex h-7 w-full items-center justify-between gap-2 rounded-sm border border-input bg-ide-editor px-2 py-1.5 text-xs text-muted-foreground opacity-60">
					<span className="truncate">{placeholder}</span>
					<ChevronDown className="size-4 shrink-0 opacity-50" />
				</div>
			</label>
		);
	}
	const resolvedValue = normalizeRuntimeConfigValue(config, value);

	return (
		<label className="min-w-0 space-y-1">
			<span className="text-caption font-medium text-muted-foreground">
				{config?.name || label}
			</span>
			<Select value={resolvedValue} onValueChange={onChange} disabled={disabled}>
				<SelectTrigger className="h-7">
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
