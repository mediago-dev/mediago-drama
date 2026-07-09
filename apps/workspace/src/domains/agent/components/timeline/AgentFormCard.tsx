import type React from "react";
import { useCallback, useState } from "react";
import type { AgentFormField, AgentFormPayload, AgentSelection } from "@/api/types/agent";
import { decideAgentSelection } from "@/domains/agent/api/agent";
import { useResolvedAgentSelection } from "@/domains/agent/lib/useResolvedAgentSelection";
import { useSupersededSelectionCard } from "@/domains/agent/lib/useSupersededSelectionCard";
import type { AgentMessage } from "@/domains/agent/stores";
import { useAgentStore } from "@/domains/agent/stores";
import {
	useAgentPersistenceStore,
	type ResolvedAgentSelection,
} from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";
import { cn } from "@/shared/lib/utils";
import { AgentFormGenerationParams } from "./AgentFormGenerationParams";
import { formatGenerationParamsValue } from "./agentFormGenerationParams.helpers";

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
	// Freeze a card the flow has already moved past even if it was never decided:
	// on an ask timeout the agent proceeds (e.g. with a suggested fallback) but
	// the selection record stays pending, so without this it keeps live buttons
	// that would submit into an already-continued flow.
	const superseded = useSupersededSelectionCard(message.id);
	if (!payload) return null;
	if (resolved) {
		return <AgentFormCardResolved title={payload.title} summary={resolved.summary} />;
	}
	if (superseded) {
		return <AgentFormCardResolved title={payload.title} summary="流程已继续，无需操作。" />;
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
			? `已提交：${formSummary(payload.fields, record.decision?.values ?? {})}`
			: record.status === "cancelled"
				? "已取消，请在对话中说明你的调整需求。"
				: record.status === "expired"
					? "该表单已过期，请让智能体重新发起。"
					: `表单已处理（${record.status}）。`;
	return { status: record.status, summary, title: payload.title };
};

const AgentFormCardResolved: React.FC<{ title: string; summary: string }> = ({
	title,
	summary,
}) => (
	<article className="agent-form-card max-w-[var(--message-bubble-max-width)] rounded-sm border border-border bg-card px-3 py-3 text-xs shadow-sm">
		<h5 className="m-0 text-sm font-semibold text-foreground">{title}</h5>
		<p className="mt-1 whitespace-pre-wrap break-words leading-5 text-muted-foreground">
			{summary || "该参数表单已处理。"}
		</p>
	</article>
);

const AgentFormCardInner: React.FC<{ payload: AgentFormPayload }> = ({ payload }) => {
	const [values, setValues] = useState<Record<string, unknown>>(() =>
		initialFormValues(payload.fields),
	);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");

	const setValue = (fieldId: string, value: unknown) =>
		setValues((current) => ({ ...current, [fieldId]: value }));

	const finish = (summary: string, status: string) => {
		// Record the decision in the persisted store rather than mutating the
		// message: the in-memory chat store is rebuilt from the server on every
		// transcript hydrate, so a local edit would be discarded and the form
		// would come back interactive. AgentFormCard reads this to render frozen.
		useAgentPersistenceStore.getState().markSelectionResolved(payload.selectionId, {
			status,
			summary,
		});
	};

	const decide = async (request: { values?: Record<string, unknown>; cancelled?: boolean }) => {
		const projectId = payload.projectId || useProjectStore.getState().activeProjectId;
		if (!projectId) {
			setError("缺少项目信息，无法提交。");
			return;
		}
		setSubmitting(true);
		setError("");
		try {
			const record = await decideAgentSelection(payload.selectionId, request, projectId);
			if (record.status === "submitted") {
				finish(
					`已提交：${formSummary(payload.fields, record.decision?.values ?? {})}`,
					record.status,
				);
			} else if (record.status === "cancelled") {
				finish("已取消，请在对话中说明你的调整需求。", record.status);
			} else if (record.status === "expired") {
				finish("该表单已过期，请让智能体重新发起。", record.status);
			} else {
				finish(`表单已处理（${record.status}）。`, record.status);
			}
			useAgentStore.getState().recordActivity("runtime", "参数已提交", payload.title || "参数表单");
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
			<div className="mt-2 space-y-3">
				{payload.fields.map((field) => (
					<FormFieldControl
						key={field.id}
						field={field}
						value={values[field.id]}
						disabled={submitting}
						onChange={(value) => setValue(field.id, value)}
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
					disabled={submitting}
					onClick={() => void decide({ values })}
				>
					{payload.submitLabel || "确认"}
				</button>
			</div>
		</article>
	);
};

const FormFieldControl: React.FC<{
	field: AgentFormField;
	value: unknown;
	disabled: boolean;
	onChange: (value: unknown) => void;
}> = ({ field, value, disabled, onChange }) => (
	<div>
		<div className="flex items-baseline gap-2">
			<span className="font-medium text-foreground">{field.label}</span>
			{field.description ? (
				<span className="text-caption text-muted-foreground">{field.description}</span>
			) : null}
		</div>
		<div className="mt-1.5">
			{field.type === "generation_params" ? (
				<AgentFormGenerationParams value={value} disabled={disabled} onChange={onChange} />
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
								onClick={() => onChange(option.value)}
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
					onClick={() => onChange(value !== true)}
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
							onChange(Number.isNaN(parsed) ? undefined : parsed);
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
					onChange={(event) => onChange(event.target.value)}
				/>
			) : null}
		</div>
	</div>
);

const initialFormValues = (fields: AgentFormField[]) => {
	const values: Record<string, unknown> = {};
	for (const field of fields) {
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
			return `${field.label} ${formatFormValue(field, value)}`;
		})
		.filter(Boolean)
		.join(" · ");

const formatFormValue = (field: AgentFormField, value: unknown) => {
	if (field.type === "generation_params") return formatGenerationParamsValue(value);
	if (field.type === "toggle") return value === true ? "开" : "关";
	if (field.type === "select") {
		const option = (field.options ?? []).find((item) => item.value === value);
		return option?.label ?? String(value);
	}
	if (field.type === "number" && field.unit) return `${String(value)}${field.unit}`;
	return String(value);
};
