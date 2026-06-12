import httpClient from "@/shared/lib/http";

export interface BillingSummaryRow {
	key: string;
	label: string;
	calls: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	reasoningTokens: number;
	cachedTokens: number;
	costs: Record<string, number>;
	priced: boolean;
}

export interface BillingSummaryResponse {
	range: { start: string; end: string };
	totals: {
		calls: number;
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		reasoningTokens: number;
		cachedTokens: number;
		costs: Record<string, number>;
	};
	rows: BillingSummaryRow[];
	series: {
		bucket: string;
		calls: number;
		totalTokens: number;
		cachedTokens: number;
		costs: Record<string, number>;
	}[];
	currencies: string[];
}

export interface BillingSummaryParams {
	end?: string;
	groupBy: string;
	kind?: string;
	projectId?: string;
	start?: string;
}

export const billingSummaryKey = (params: BillingSummaryParams) =>
	[
		params.projectId?.trim()
			? `/projects/${encodeURIComponent(params.projectId.trim())}/billing/summary`
			: "/billing/summary",
		params.projectId?.trim() ?? "",
		params.start ?? "",
		params.end ?? "",
		params.groupBy,
		params.kind ?? "",
	] as const;

export const getBillingSummary = async (params: BillingSummaryParams) => {
	const projectId = params.projectId?.trim();
	const path = projectId
		? `/projects/${encodeURIComponent(projectId)}/billing/summary`
		: "/billing/summary";
	const { projectId: _, ...query } = params;
	const response = await httpClient.get<BillingSummaryResponse>(path, { params: query });
	return response.data;
};
