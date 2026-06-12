import { Loader2, Wallet } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import {
	billingSummaryKey,
	getBillingSummary,
	type BillingSummaryParams,
	type BillingSummaryRow,
} from "../api/billing";

type RangeMode = "7d" | "30d" | "custom";
type GroupBy = "model" | "capability" | "kind" | "provider";

const numberFormatter = new Intl.NumberFormat("zh-CN");
const moneyFormatter = new Intl.NumberFormat("zh-CN", {
	maximumFractionDigits: 6,
	minimumFractionDigits: 0,
});

export const BillingPanel: React.FC = () => {
	const [rangeMode, setRangeMode] = useState<RangeMode>("30d");
	const [groupBy, setGroupBy] = useState<GroupBy>("model");
	const [customStart, setCustomStart] = useState(() => dateInputDaysAgo(30));
	const [customEnd, setCustomEnd] = useState(() => dateInputDaysAgo(0));
	const params = useMemo(
		() => buildParams(rangeMode, customStart, customEnd, groupBy),
		[customEnd, customStart, groupBy, rangeMode],
	);
	const { data, error, isLoading } = useSWR(billingSummaryKey(params), () =>
		getBillingSummary(params),
	);
	const rows = data?.rows ?? [];
	const currencies = data?.currencies ?? [];
	const totalCards = buildTotalCards(data?.totals, currencies);

	return (
		<SettingsPanelLayout
			title="用量与账单"
			description="按模型、能力和时间统计 Token 用量与花费。"
			icon={<Wallet className="size-4" />}
			actions={
				<div className="flex flex-wrap items-center gap-2">
					<Select value={rangeMode} onValueChange={(value) => setRangeMode(value as RangeMode)}>
						<SelectTrigger className="w-28">
							<SelectValue />
						</SelectTrigger>
						<SelectContent align="end">
							<SelectItem value="7d">近 7 天</SelectItem>
							<SelectItem value="30d">近 30 天</SelectItem>
							<SelectItem value="custom">自定义</SelectItem>
						</SelectContent>
					</Select>
					<Select value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)}>
						<SelectTrigger className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent align="end">
							<SelectItem value="model">按模型</SelectItem>
							<SelectItem value="capability">按能力</SelectItem>
							<SelectItem value="kind">按类型</SelectItem>
							<SelectItem value="provider">按供应商</SelectItem>
						</SelectContent>
					</Select>
				</div>
			}
		>
			<div className="space-y-4">
				{rangeMode === "custom" ? (
					<div className="grid gap-2 rounded-sm border border-border bg-card p-3 md:grid-cols-2">
						<Input
							type="date"
							value={customStart}
							onChange={(event) => setCustomStart(event.target.value)}
						/>
						<Input
							type="date"
							value={customEnd}
							onChange={(event) => setCustomEnd(event.target.value)}
						/>
					</div>
				) : null}

				{error ? (
					<div className="rounded-sm border border-error-border bg-error-surface px-4 py-3 text-sm text-error-foreground">
						计费汇总加载失败
					</div>
				) : null}

				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
					<MetricCard label="调用次数" value={formatNumber(data?.totals.calls ?? 0)} />
					<MetricCard label="总 Token" value={formatNumber(data?.totals.totalTokens ?? 0)} />
					<MetricCard label="输入 Token" value={formatNumber(data?.totals.inputTokens ?? 0)} />
					<MetricCard label="输出 Token" value={formatNumber(data?.totals.outputTokens ?? 0)} />
					<MetricCard label="缓存 Token" value={formatNumber(data?.totals.cachedTokens ?? 0)} />
					<MetricCard label="推理 Token" value={formatNumber(data?.totals.reasoningTokens ?? 0)} />
					{totalCards.map((card) => (
						<MetricCard key={card.label} label={card.label} value={card.value} />
					))}
				</div>

				<section className="overflow-hidden rounded-sm border border-border bg-card">
					<div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
						<h3 className="text-sm font-semibold text-foreground">明细</h3>
						{isLoading ? (
							<span className="flex items-center gap-1 text-xs text-muted-foreground">
								<Loader2 className="size-3 animate-spin" />
								加载中
							</span>
						) : null}
					</div>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[720px] border-collapse text-left text-xs">
							<thead className="bg-ide-toolbar text-muted-foreground">
								<tr>
									<th className="px-3 py-2 font-medium">分组</th>
									<th className="px-3 py-2 text-right font-medium">调用</th>
									<th className="px-3 py-2 text-right font-medium">输入</th>
									<th className="px-3 py-2 text-right font-medium">输出</th>
									<th className="px-3 py-2 text-right font-medium">缓存</th>
									<th className="px-3 py-2 text-right font-medium">推理</th>
									<th className="px-3 py-2 text-right font-medium">总量</th>
									<th className="px-3 py-2 text-right font-medium">花费</th>
								</tr>
							</thead>
							<tbody>
								{rows.length === 0 && !isLoading ? (
									<tr>
										<td className="px-3 py-6 text-center text-muted-foreground" colSpan={8}>
											暂无用量记录
										</td>
									</tr>
								) : null}
								{rows.map((row) => (
									<BillingRow key={row.key} row={row} currencies={currencies} />
								))}
							</tbody>
						</table>
					</div>
				</section>
			</div>
		</SettingsPanelLayout>
	);
};

const MetricCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
	<div className="rounded-sm border border-border bg-card px-4 py-3">
		<p className="text-xs text-muted-foreground">{label}</p>
		<p className="mt-2 truncate text-lg font-semibold text-foreground">{value}</p>
	</div>
);

const BillingRow: React.FC<{ currencies: string[]; row: BillingSummaryRow }> = ({
	currencies,
	row,
}) => (
	<tr className="border-t border-border first:border-t-0">
		<td className="max-w-64 px-3 py-2">
			<div className="flex min-w-0 items-center gap-2">
				<span className="truncate text-foreground">{row.label || row.key}</span>
				{!row.priced ? (
					<Badge
						variant="outline"
						className="shrink-0 border-warning-border text-warning-foreground"
					>
						未定价
					</Badge>
				) : null}
			</div>
			<p className="mt-0.5 truncate text-muted-foreground">{row.key}</p>
		</td>
		<td className="px-3 py-2 text-right text-foreground">{formatNumber(row.calls)}</td>
		<td className="px-3 py-2 text-right text-foreground">{formatNumber(row.inputTokens)}</td>
		<td className="px-3 py-2 text-right text-foreground">{formatNumber(row.outputTokens)}</td>
		<td className="px-3 py-2 text-right text-foreground">{formatNumber(row.cachedTokens)}</td>
		<td className="px-3 py-2 text-right text-foreground">{formatNumber(row.reasoningTokens)}</td>
		<td className="px-3 py-2 text-right text-foreground">{formatNumber(row.totalTokens)}</td>
		<td className="px-3 py-2 text-right text-foreground">{formatCosts(row.costs, currencies)}</td>
	</tr>
);

const buildTotalCards = (
	totals: { costs: Record<string, number> } | undefined,
	currencies: string[],
) =>
	currencies.map((currency) => ({
		label: `${currency} 花费`,
		value: formatMoney(totals?.costs[currency] ?? 0, currency),
	}));

const buildParams = (
	rangeMode: RangeMode,
	customStart: string,
	customEnd: string,
	groupBy: GroupBy,
): BillingSummaryParams => {
	if (rangeMode === "custom") {
		return {
			start: startOfDate(customStart),
			end: endExclusiveDate(customEnd),
			groupBy,
		};
	}
	const days = rangeMode === "7d" ? 7 : 30;
	const end = new Date();
	const start = new Date(end);
	start.setDate(start.getDate() - days);
	return { start: start.toISOString(), end: end.toISOString(), groupBy };
};

const dateInputDaysAgo = (days: number) => {
	const date = new Date();
	date.setDate(date.getDate() - days);
	return date.toISOString().slice(0, 10);
};

const startOfDate = (value: string) => `${value || dateInputDaysAgo(30)}T00:00:00Z`;

const endExclusiveDate = (value: string) => {
	const date = new Date(`${value || dateInputDaysAgo(0)}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString();
};

const formatNumber = (value: number) => numberFormatter.format(value);

const formatMoney = (value: number, currency: string) =>
	`${currency} ${moneyFormatter.format(value)}`;

const formatCosts = (costs: Record<string, number>, currencies: string[]) => {
	const visible = currencies.length > 0 ? currencies : Object.keys(costs).sort();
	if (visible.length === 0) return "-";
	return visible.map((currency) => formatMoney(costs[currency] ?? 0, currency)).join(" / ");
};
