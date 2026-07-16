import type React from "react";
import { useCallback, useState } from "react";
import type {
	AgentFormField,
	AgentFormPayload,
	AgentGenerationPlanIntent,
	AgentSelection,
} from "@/api/types/agent";
import { decideAgentSelection } from "@/domains/agent/api/agent";
import { useResolvedAgentSelection } from "@/domains/agent/lib/useResolvedAgentSelection";
import type { AgentMessage } from "@/domains/agent/stores";
import { useAgentStore } from "@/domains/agent/stores";
import {
	useAgentPersistenceStore,
	type ResolvedAgentSelection,
} from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";
import { cn } from "@/shared/lib/utils";
import { AgentFormGenerationParams } from "./AgentFormGenerationParams";
import { AgentGenerationIntentSummary } from "./AgentGenerationIntentSummary";
import { AgentFormImagesField, normalizeImageIds } from "./AgentFormImagesField";
import {
	AgentFormPromptOptimization,
	formatPromptOptimizationValue,
	normalizePromptOptimizationValue,
} from "./AgentFormPromptOptimization";
import { formatGenerationParamsValue } from "./agentFormGenerationParams.helpers";
import { AgentFormGenerationSettings } from "./AgentFormGenerationSettings";
import {
	formatGenerationSettingsValue,
	type GenerationSettingsValue,
} from "@/domains/generation/components/generationSettingsValue";

export const AgentFormCard: React.FC<{ message: AgentMessage }> = ({ message }) => {
	const payload = message.metadata?.form;
	// A transcript hydrate re-materializes the original interactive form even
	// after the user decided it, because the chat store is rebuilt from the
	// server. Render the frozen summary so the form can't be confirmed twice;
	// the local persisted decision wins, otherwise the server's selection
	// record is the authority (covers decisions made before local persistence
	// existed, in another window, or forms whose record no longer exists).
	const mapRecord = useCallback(
		(record: AgentSelection) => (payload ? resolvedFormFromRecord(payload, record) : null),
		[payload],
	);
	const resolved = useResolvedAgentSelection(payload?.selectionId, payload?.projectId, mapRecord);
	if (!payload) return null;
	if (resolved) {
		return (
			<AgentFormCardResolved
				payload={payload}
				summary={resolved.summary}
				intent={resolved.intent ?? payload.intent}
			/>
		);
	}
	return <AgentFormCardInner payload={payload} />;
};

// resolvedFormFromRecord maps a server-decided form record onto the frozen
// summary, mirroring the texts finish() writes on a live submission.
const resolvedFormFromRecord = (
	payload: AgentFormPayload,
	record: AgentSelection,
): ResolvedAgentSelection | null => {
	if (record.status === "pending") return null;
	const summary =
		record.status === "submitted"
			? formSubmissionSummary(
					payload.fields,
					record.decision?.values ?? {},
					payload.intent ?? record.intent,
				)
			: record.status === "cancelled"
				? "已取消，请在对话中说明你的调整需求。"
				: record.status === "expired"
					? "该表单已过期，请让智能体重新发起。"
					: `表单已处理（${record.status}）。`;
	return {
		status: record.status,
		summary,
		title: payload.title,
		intent: payload.intent ?? record.intent,
	};
};

const AgentFormCardResolved: React.FC<{
	payload: AgentFormPayload;
	summary: string;
	intent?: AgentGenerationPlanIntent;
}> = ({ payload, summary, intent }) => (
	<article className="agent-form-card max-w-[var(--message-bubble-max-width)] rounded-sm border border-border bg-card px-3 py-3 text-xs shadow-sm">
		<h5 className="m-0 text-sm font-semibold text-foreground">{payload.title}</h5>
		<p className="mt-1 whitespace-pre-wrap break-words leading-5 text-muted-foreground">
			{summary || "该参数表单已处理。"}
		</p>
		<AgentGenerationIntentSummary intent={intent} className="mt-2" />
	</article>
);

const AgentFormCardInner: React.FC<{ payload: AgentFormPayload }> = ({ payload }) => {
	const [values, setValues] = useState<Record<string, unknown>>(() =>
		initialFormValues(payload.fields),
	);
	const [submitting, setSubmitting] = useState(false);
	const [fieldRuntime, setFieldRuntime] = useState<Record<string, FormFieldRuntime>>({});
	const [error, setError] = useState("");
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const effectiveProjectId = payload.projectId || activeProjectId || undefined;
	const fieldsBusy = Object.values(fieldRuntime).some((runtime) => runtime.busy);
	const fieldsValid = payload.fields.every(
		(field) =>
			field.type !== "generation_settings" ||
			(fieldRuntime[field.id]?.valid === true && values[field.id] !== undefined),
	);

	const setValue = useCallback(
		(fieldId: string, value: unknown) => setValues((current) => ({ ...current, [fieldId]: value })),
		[],
	);
	const updateFieldRuntime = useCallback((fieldId: string, patch: Partial<FormFieldRuntime>) => {
		setFieldRuntime((current) => {
			const previous = current[fieldId] ?? emptyFormFieldRuntime;
			const next = { ...previous, ...patch };
			if (next.busy === previous.busy && next.valid === previous.valid) return current;
			return { ...current, [fieldId]: next };
		});
	}, []);
	const setFieldBusy = useCallback(
		(fieldId: string, busy: boolean) => updateFieldRuntime(fieldId, { busy }),
		[updateFieldRuntime],
	);
	const setFieldValidity = useCallback(
		(fieldId: string, valid: boolean) => updateFieldRuntime(fieldId, { valid }),
		[updateFieldRuntime],
	);

	const finish = (summary: string, status: string, intent?: AgentGenerationPlanIntent) => {
		// Record the decision in the persisted store rather than mutating the
		// message: the in-memory chat store is rebuilt from the server on every
		// transcript hydrate, so a local edit would be discarded and the form
		// would come back interactive. AgentFormCard reads this to render frozen.
		useAgentPersistenceStore.getState().markSelectionResolved(payload.selectionId, {
			status,
			summary,
			intent,
		});
	};

	const decide = async (request: { values?: Record<string, unknown>; cancelled?: boolean }) => {
		if (request.values && (fieldsBusy || !fieldsValid)) return;
		if (!effectiveProjectId) {
			setError("缺少项目信息，无法提交。");
			return;
		}
		setSubmitting(true);
		setError("");
		try {
			const record = await decideAgentSelection(
				payload.selectionId,
				request.values
					? { ...request, values: normalizeFormValues(payload.fields, request.values) }
					: request,
				effectiveProjectId,
			);
			let summary: string;
			if (record.status === "submitted") {
				summary = formSubmissionSummary(
					payload.fields,
					record.decision?.values ?? {},
					payload.intent ?? record.intent,
				);
			} else if (record.status === "cancelled") {
				summary = "已取消，请在对话中说明你的调整需求。";
			} else if (record.status === "expired") {
				summary = "该表单已过期，请让智能体重新发起。";
			} else {
				summary = `表单已处理（${record.status}）。`;
			}
			finish(summary, record.status, payload.intent ?? record.intent);
			const activityLabel =
				record.status === "submitted"
					? "参数已提交"
					: record.status === "cancelled"
						? "参数已取消"
						: record.status === "expired"
							? "参数已过期"
							: "参数已处理";
			useAgentStore.getState().recordActivity("runtime", activityLabel, summary);
		} catch (err) {
			setError(err instanceof Error ? err.message : "提交失败，请重试。");
			setSubmitting(false);
		}
	};

	return (
		<article className="agent-form-card max-w-[var(--message-bubble-max-width)] rounded-sm border border-border bg-card px-3 py-3 text-xs shadow-sm">
			<h5 className="m-0 text-sm font-semibold text-foreground">{payload.title}</h5>
			{payload.prompt ? (
				<p className="mt-1 whitespace-pre-wrap break-words leading-5 text-muted-foreground">
					{payload.prompt}
				</p>
			) : null}
			<AgentGenerationIntentSummary intent={payload.intent} className="mt-2" />
			<div className="mt-2 space-y-3">
				{payload.fields.map((field) => (
					<FormFieldControl
						key={field.id}
						field={field}
						value={values[field.id]}
						disabled={submitting}
						projectId={effectiveProjectId}
						selectionId={payload.selectionId}
						onChange={setValue}
						onBusyChange={setFieldBusy}
						onValidityChange={setFieldValidity}
					/>
				))}
			</div>
			{error ? <p className="mt-2 text-error-foreground">{error}</p> : null}
			<div className="mt-3 flex items-center justify-end gap-2">
				<button
					type="button"
					className="inline-flex min-h-7 cursor-pointer items-center rounded-sm border border-border bg-background px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-ide-list-hover disabled:cursor-not-allowed disabled:opacity-50"
					disabled={submitting}
					onClick={() => void decide({ cancelled: true })}
				>
					取消
				</button>
				<button
					type="button"
					className="inline-flex min-h-7 cursor-pointer items-center rounded-sm border border-primary bg-primary px-2.5 py-1 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={submitting || fieldsBusy || !fieldsValid}
					onClick={() => void decide({ values })}
				>
					{payload.submitLabel || "确认"}
				</button>
			</div>
		</article>
	);
};

interface FormFieldRuntime {
	busy: boolean;
	valid: boolean;
}

const emptyFormFieldRuntime: FormFieldRuntime = { busy: false, valid: false };

const FormFieldControl: React.FC<{
	field: AgentFormField;
	value: unknown;
	disabled: boolean;
	projectId?: string;
	selectionId: string;
	onChange: (fieldId: string, value: unknown) => void;
	onBusyChange: (fieldId: string, busy: boolean) => void;
	onValidityChange: (fieldId: string, valid: boolean) => void;
}> = ({
	field,
	value,
	disabled,
	projectId,
	selectionId,
	onChange,
	onBusyChange,
	onValidityChange,
}) => {
	const change = useCallback(
		(nextValue: unknown) => onChange(field.id, nextValue),
		[field.id, onChange],
	);
	const changeBusy = useCallback(
		(busy: boolean) => onBusyChange(field.id, busy),
		[field.id, onBusyChange],
	);
	const changeValidity = useCallback(
		(valid: boolean) => onValidityChange(field.id, valid),
		[field.id, onValidityChange],
	);

	if (field.type === "generation_settings") {
		return (
			<AgentFormGenerationSettings
				defaultValue={field.default}
				disabled={disabled}
				fieldId={field.id}
				kind={field.kind === "video" ? "video" : "image"}
				onBusyChange={changeBusy}
				onChange={change}
				onValidityChange={changeValidity}
				projectId={projectId}
				selectionId={selectionId}
			/>
		);
	}

	return (
		<div>
			<div className="flex items-baseline gap-2">
				<span className="font-medium text-foreground">{field.label}</span>
				{field.description ? (
					<span className="text-caption text-muted-foreground">{field.description}</span>
				) : null}
			</div>
			<div className="mt-1.5">
				{field.type === "generation_params" ? (
					<AgentFormGenerationParams
						value={value}
						kind={field.kind}
						disabled={disabled}
						onChange={change}
					/>
				) : null}
				{field.type === "prompt_optimization" ? (
					<AgentFormPromptOptimization value={value} disabled={disabled} onChange={change} />
				) : null}
				{field.type === "images" ? (
					<AgentFormImagesField
						value={value}
						max={field.max}
						disabled={disabled}
						projectId={projectId}
						onChange={change}
						onBusyChange={changeBusy}
					/>
				) : null}
				{field.type === "select" ? (
					<div className="flex flex-wrap gap-1.5">
						{(field.options ?? []).map((option) => {
							const selected = value === option.value;
							return (
								<button
									key={option.value}
									type="button"
									title={option.description}
									disabled={disabled}
									className={cn(
										"inline-flex min-h-7 cursor-pointer items-center rounded-sm border px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
										selected
											? "border-primary bg-primary/10 text-primary"
											: "border-border bg-background text-foreground hover:bg-ide-list-hover",
									)}
									onClick={() => change(option.value)}
								>
									{option.label}
								</button>
							);
						})}
					</div>
				) : null}
				{field.type === "toggle" ? (
					<button
						type="button"
						role="switch"
						aria-checked={value === true}
						disabled={disabled}
						className={cn(
							"inline-flex min-h-7 cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
							value === true
								? "border-primary bg-primary/10 text-primary"
								: "border-border bg-background text-muted-foreground hover:bg-ide-list-hover",
						)}
						onClick={() => change(value !== true)}
					>
						<span
							className={cn(
								"inline-block size-2 rounded-full",
								value === true ? "bg-primary" : "bg-muted-foreground/40",
							)}
						/>
						{value === true ? "开启" : "关闭"}
					</button>
				) : null}
				{field.type === "number" ? (
					<span className="inline-flex items-center gap-1.5">
						<input
							type="number"
							className="h-7 w-24 rounded-sm border border-input bg-background px-2 text-xs text-foreground"
							value={typeof value === "number" ? value : ""}
							min={field.min}
							max={field.max}
							disabled={disabled}
							onChange={(event) => {
								const parsed = Number.parseFloat(event.target.value);
								change(Number.isNaN(parsed) ? undefined : parsed);
							}}
						/>
						{field.unit ? <span className="text-muted-foreground">{field.unit}</span> : null}
					</span>
				) : null}
				{field.type === "text" ? (
					<input
						type="text"
						className="h-7 w-full max-w-72 rounded-sm border border-input bg-background px-2 text-xs text-foreground"
						value={typeof value === "string" ? value : ""}
						disabled={disabled}
						onChange={(event) => change(event.target.value)}
					/>
				) : null}
			</div>
		</div>
	);
};

// normalizeFormValues fixes up agent-prefilled defaults the user never
// touched before they go to the server — e.g. a bare-boolean
// prompt_optimization default becomes the object shape validation expects.
const normalizeFormValues = (fields: AgentFormField[], values: Record<string, unknown>) => {
	const normalized: Record<string, unknown> = { ...values };
	for (const field of fields) {
		if (field.type === "prompt_optimization" && field.id in normalized) {
			normalized[field.id] = normalizePromptOptimizationValue(normalized[field.id]);
		}
	}
	return normalized;
};

const initialFormValues = (fields: AgentFormField[]) => {
	const values: Record<string, unknown> = {};
	for (const field of fields) {
		if (field.type === "generation_settings") continue;
		if (field.default !== undefined && field.default !== null) {
			values[field.id] = field.default;
		} else if (field.type === "toggle") {
			values[field.id] = false;
		}
	}
	return values;
};

const formSummary = (fields: AgentFormField[], values: Record<string, unknown>) =>
	fields
		.map((field) => {
			const value = values[field.id];
			if (value === undefined || value === null || value === "") return "";
			const formatted = formatFormValue(field, value);
			return field.type === "generation_settings" ? formatted : `${field.label} ${formatted}`;
		})
		.filter(Boolean)
		.join(" · ");

const formSubmissionSummary = (
	fields: AgentFormField[],
	values: Record<string, unknown>,
	intent?: AgentGenerationPlanIntent,
) => {
	const settingsSummary = formSummary(fields, values);
	if (!intent) return `已提交：${settingsSummary}`;

	const confirmedSummary = `已确认 ${intent.items.length} 项`;
	return settingsSummary ? `${confirmedSummary} · ${settingsSummary}` : confirmedSummary;
};

const formatFormValue = (field: AgentFormField, value: unknown) => {
	if (field.type === "generation_settings") {
		return formatGenerationSettingsValue(value as GenerationSettingsValue);
	}
	if (field.type === "generation_params") return formatGenerationParamsValue(value);
	if (field.type === "images") return `${normalizeImageIds(value).length} 张`;
	if (field.type === "prompt_optimization") return formatPromptOptimizationValue(value);
	if (field.type === "toggle") return value === true ? "开" : "关";
	if (field.type === "select") {
		const option = (field.options ?? []).find((item) => item.value === value);
		return option?.label ?? String(value);
	}
	if (field.type === "number" && field.unit) return `${String(value)}${field.unit}`;
	return String(value);
};
