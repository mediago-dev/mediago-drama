import httpClient from "@/shared/lib/http";

export interface UsageSummaryRow {
	key: string;
	label: string;
	calls: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	reasoningTokens: number;
	cachedTokens: number;
}

export interface UsageSummaryResponse {
	range: { start: string; end: string };
	totals: {
		calls: number;
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		reasoningTokens: number;
		cachedTokens: number;
	};
	rows: UsageSummaryRow[];
	series: {
		bucket: string;
		calls: number;
		totalTokens: number;
		cachedTokens: number;
	}[];
}

export interface UsageSummaryParams {
	end?: string;
	groupBy: string;
	kind?: string;
	projectId?: string;
	start?: string;
}

export const usageSummaryKey = (params: UsageSummaryParams) =>
	[
		params.projectId?.trim()
			? `/projects/${encodeURIComponent(params.projectId.trim())}/usage/summary`
			: "/usage/summary",
		params.projectId?.trim() ?? "",
		params.start ?? "",
		params.end ?? "",
		params.groupBy,
		params.kind ?? "",
	] as const;

export const getUsageSummary = async (params: UsageSummaryParams) => {
	const projectId = params.projectId?.trim();
	const path = projectId
		? `/projects/${encodeURIComponent(projectId)}/usage/summary`
		: "/usage/summary";
	const { projectId: _, ...query } = params;
	const response = await httpClient.get<UsageSummaryResponse>(path, { params: query });
	return response.data;
};
