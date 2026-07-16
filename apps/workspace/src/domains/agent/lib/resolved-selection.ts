import type { AgentSelection } from "@/api/types/agent";
import type { ResolvedAgentSelection } from "@/domains/agent/stores/persistence";

// selectionDecisionSummary renders a decided selection record as the frozen
// card's one-line summary. The decide endpoint is idempotent: clicking a card
// that was already decided (or expired) returns the current record, so the
// summary reflects the real outcome instead of double-submitting.
export const selectionDecisionSummary = (record: AgentSelection) => {
	switch (record.status) {
		case "selected": {
			const option = record.options.find((item) => item.id === record.decision?.optionId);
			const label = option?.label || record.decision?.optionId || "";
			return label ? `已选择：${label}` : "选择已提交。";
		}
		case "custom":
			return "已选择自定义描述，请在对话中说明你的需求。";
		case "cancelled":
			return "已取消选择。";
		case "expired":
			return "该选择已过期，请让 Agent 重新发起。";
		default:
			return "选择已提交。";
	}
};

// resolvedSelectionFromRecord maps a server selection record onto the frozen-
// card shape; a still-pending record returns null (card stays interactive).
export const resolvedSelectionFromRecord = (
	record: AgentSelection,
): ResolvedAgentSelection | null => {
	if (record.status === "pending") return null;
	const option = record.options.find((item) => item.id === record.decision?.optionId);
	return {
		status: record.status,
		summary: selectionDecisionSummary(record),
		title: record.title || "用户选择",
		...(record.intent ? { intent: record.intent } : {}),
		...(option?.imageUrl ? { imageUrl: option.imageUrl } : {}),
	};
};

// missingSelectionResolution freezes a card whose selection record no longer
// exists server-side (e.g. an old transcript's card): it can't be decided
// anymore, so it must not render interactive controls.
export const missingSelectionResolution = (title?: string): ResolvedAgentSelection => ({
	status: "expired",
	summary: "该卡片已失效，请让 Agent 重新发起。",
	...(title ? { title } : {}),
});
