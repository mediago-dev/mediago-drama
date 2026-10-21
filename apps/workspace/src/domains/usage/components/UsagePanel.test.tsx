import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { getUsageSummary } from "../api/usage";
import { UsagePanel } from "./UsagePanel";

vi.mock("../api/usage", async (importOriginal) => ({
	...(await importOriginal<typeof import("../api/usage")>()),
	getUsageSummary: vi.fn(),
}));

afterEach(cleanup);

it("shows historical calls and tokens without a bill or price status", async () => {
	vi.mocked(getUsageSummary).mockResolvedValue({
		range: { start: "", end: "" },
		totals: {
			calls: 3,
			inputTokens: 30,
			outputTokens: 12,
			totalTokens: 42,
			reasoningTokens: 2,
			cachedTokens: 10,
		},
		rows: [
			{
				key: "mediago.retired",
				label: "历史模型",
				calls: 3,
				inputTokens: 30,
				outputTokens: 12,
				totalTokens: 42,
				reasoningTokens: 2,
				cachedTokens: 10,
			},
		],
		series: [],
	});

	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<UsagePanel />
		</SWRConfig>,
	);
	expect(await screen.findByText("历史模型")).toBeInTheDocument();
	expect(screen.getByRole("heading", { name: "用量统计" })).toBeInTheDocument();
	expect(screen.getByRole("columnheader", { name: "总量" })).toBeInTheDocument();
	expect(screen.queryByText(/账单|花费|未定价|USD|CNY/)).not.toBeInTheDocument();
});
