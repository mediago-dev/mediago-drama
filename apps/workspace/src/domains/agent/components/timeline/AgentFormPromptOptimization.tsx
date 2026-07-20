import type React from "react";
import { useEffect, useMemo } from "react";
import useSWR from "swr";
import { generationModelsKey, getGenerationModels } from "@/domains/generation/api/generation";
import {
	listPromptCategories,
	promptCategoriesKey,
} from "@/domains/generation/api/prompt-categories";
import { listPromptPresets, promptPresetsKey } from "@/domains/generation/api/prompt-presets";
import {
	GenerationBrandMark,
	generationFamilyBrand,
} from "@/domains/generation/components/GenerationBrandMark";
import { displayGenerationLabelWithoutAlias } from "@/domains/generation/components/generationDisplayLabels";
import { PromptOptimizePicker } from "@/domains/generation/components/PromptOptimizePicker";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import { promptOptimizeModelOptions } from "@/domains/generation/hooks/usePromptOptimize";
import { useCodexTextAvailability } from "@/domains/generation/hooks/useCodexTextAvailability";
import { promptInsertItemsFromPresets } from "@/domains/generation/lib/prompt-insertions";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

export interface PromptOptimizationFieldValue {
	enabled: boolean;
	executor?: "route" | "codex";
	routeId?: string;
	label?: string;
	referenceId?: string;
	referenceName?: string;
	referencePrompt?: string;
}

// AgentFormPromptOptimization renders the composite `prompt_optimization`
// form field: an on/off switch plus, when on, the configured text-model
// catalog and the prompt-library package list — the same choices the manual
// generation workbench offers, instead of a bare toggle.
export const AgentFormPromptOptimization: React.FC<{
	value: unknown;
	disabled: boolean;
	onChange: (value: PromptOptimizationFieldValue) => void;
}> = ({ value, disabled, onChange }) => {
	const { data: catalog } = useSWR(generationModelsKey, getGenerationModels);
	const { data: presets } = useSWR(promptPresetsKey, () => listPromptPresets());
	const { data: categories } = useSWR(promptCategoriesKey, listPromptCategories);
	const codexAvailable = useCodexTextAvailability();

	const resolved = normalizePromptOptimizationValue(value);
	const modelOptions = useMemo(() => promptOptimizeModelOptions(catalog), [catalog]);
	const items = useMemo(
		() => promptInsertItemsFromPresets(presets ?? [], categories ?? []),
		[presets, categories],
	);
	const selectedOption =
		modelOptions.find((option) => option.route.id === resolved.routeId) ?? modelOptions[0] ?? null;

	// An enabled value without a resolvable route adopts the first configured
	// text model once the catalog arrives. Repeat this check whenever the
	// catalog changes: a previously valid route may disappear while the form is
	// still open, and the displayed fallback must also become the submitted
	// value.
	useEffect(() => {
		if (!resolved.enabled) return;
		if (selectedOption) {
			if (resolved.routeId === selectedOption.route.id) return;
			const { executor: _executor, ...routeValue } = resolved;
			onChange({
				...routeValue,
				routeId: selectedOption.route.id,
				label: selectedOption.label,
			});
			return;
		}
		if (!codexAvailable || resolved.executor === "codex") return;
		onChange({ ...resolved, executor: "codex", routeId: undefined, label: "Codex" });
	}, [codexAvailable, resolved, selectedOption, onChange]);

	const setEnabled = (enabled: boolean) => {
		const { executor: _executor, ...routeValue } = resolved;
		onChange(
			enabled
				? {
						...routeValue,
						enabled: true,
						...(!selectedOption && codexAvailable ? { executor: "codex" as const } : {}),
						routeId: selectedOption?.route.id ?? (codexAvailable ? undefined : resolved.routeId),
						label: selectedOption?.label ?? (codexAvailable ? "Codex" : resolved.label),
					}
				: { enabled: false },
		);
	};

	const selectPackage = (item: PromptInsertItem) =>
		onChange({
			...resolved,
			enabled: true,
			referenceId: item.id,
			referenceName: item.name,
			referencePrompt: item.prompt,
		});

	return (
		<div className="space-y-2">
			<button
				type="button"
				role="switch"
				aria-checked={resolved.enabled}
				disabled={disabled}
				className={cn(
					"inline-flex min-h-7 cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
					resolved.enabled
						? "border-primary bg-primary/10 text-primary"
						: "border-border bg-background text-muted-foreground hover:bg-ide-list-hover",
				)}
				onClick={() => setEnabled(!resolved.enabled)}
			>
				<span
					className={cn(
						"inline-block size-2 rounded-full",
						resolved.enabled ? "bg-primary" : "bg-muted-foreground/40",
					)}
				/>
				{resolved.enabled ? "开启" : "关闭"}
			</button>
			{resolved.enabled ? (
				<div className="space-y-2 rounded-sm border border-border bg-background p-2">
					<div className="flex min-w-0 items-center gap-2">
						<span className="shrink-0 text-caption font-medium text-muted-foreground">
							优化模型
						</span>
						{selectedOption ? (
							<Select
								value={selectedOption.route.id}
								disabled={disabled || modelOptions.length === 0}
								onValueChange={(routeId) => {
									const option = modelOptions.find((item) => item.route.id === routeId);
									if (!option) return;
									onChange({ ...resolved, routeId: option.route.id, label: option.label });
								}}
							>
								<SelectTrigger
									aria-label="优化模型"
									className="h-7 min-w-0 max-w-64 flex-1 rounded-sm text-xs"
								>
									<GenerationBrandMark
										brand={generationFamilyBrand(selectedOption.family)}
										className="size-4 text-[0.5rem]"
									/>
									<span className="min-w-0 truncate">
										{displayGenerationLabelWithoutAlias(selectedOption.label)}
									</span>
								</SelectTrigger>
								<SelectContent align="start">
									{modelOptions.map((option) => (
										<SelectItem
											key={option.route.id}
											value={option.route.id}
											textValue={displayGenerationLabelWithoutAlias(option.label)}
										>
											<span className="flex min-w-0 items-center gap-2">
												<GenerationBrandMark
													brand={generationFamilyBrand(option.family)}
													className="size-4 text-[0.5rem]"
												/>
												<span className="min-w-0 truncate">
													{displayGenerationLabelWithoutAlias(option.label)}
												</span>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : codexAvailable ? (
							<span className="inline-flex items-center gap-2 text-caption text-muted-foreground">
								<GenerationBrandMark brand="openai" className="size-4 text-[0.5rem]" />
								Codex · 当前登录账户
							</span>
						) : (
							<span className="text-caption text-muted-foreground">无可用文本模型</span>
						)}
					</div>
					<PromptOptimizePicker
						items={items}
						selectedItemId={resolved.referenceId ?? null}
						onSelect={selectPackage}
					/>
				</div>
			) : null}
		</div>
	);
};

export const normalizePromptOptimizationValue = (value: unknown): PromptOptimizationFieldValue => {
	if (typeof value === "boolean") return { enabled: value };
	if (!value || typeof value !== "object" || Array.isArray(value)) return { enabled: false };
	const object = value as Record<string, unknown>;
	const text = (key: string) => {
		const raw = object[key];
		return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
	};
	const executor =
		object.executor === "codex" || object.executor === "route" ? object.executor : undefined;
	return {
		enabled: object.enabled === true,
		...(executor ? { executor } : {}),
		routeId: text("routeId"),
		label: text("label"),
		referenceId: text("referenceId"),
		referenceName: text("referenceName"),
		referencePrompt: text("referencePrompt"),
	};
};

export const formatPromptOptimizationValue = (value: unknown) => {
	const resolved = normalizePromptOptimizationValue(value);
	if (!resolved.enabled) return "关";
	const parts = [resolved.label, resolved.referenceName].filter(Boolean);
	return parts.length > 0 ? `开（${parts.join(" · ")}）` : "开";
};
