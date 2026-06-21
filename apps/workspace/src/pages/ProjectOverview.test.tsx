import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingSummaryResponse } from "@/domains/billing/api/billing";
import type { ProjectConfig } from "@/domains/projects/api/projects";
import httpClient from "@/shared/lib/http";
import type { ApiResponse } from "@/types/api";
import { ProjectOverview } from "./ProjectOverview";

vi.mock("@/shared/lib/http", () => ({
	default: {
		get: vi.fn(),
		patch: vi.fn(),
	},
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

const projectConfig: ProjectConfig = {
	createdAt: "2026-06-19T02:08:41.000Z",
	description: "",
	name: "222",
	overview: { categoryDefaults: {}, style: "" },
	projectId: "project-a",
	schemaVersion: 1,
};

const billingSummary: BillingSummaryResponse = {
	currencies: ["CNY", "USD"],
	range: { end: "2026-06-19T00:00:00.000Z", start: "2026-06-18T00:00:00.000Z" },
	rows: [],
	series: [],
	totals: {
		cachedTokens: 0,
		calls: 0,
		costs: {},
		inputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
	},
};

describe("ProjectOverview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(httpClient.get).mockImplementation(async (url) => {
			switch (url) {
				case "/projects/project-a/config":
					return apiResponse(projectConfig);
				case "/prompt-presets":
					return apiResponse({ prompts: [] });
				case "/projects/project-a/billing/summary":
					return apiResponse(billingSummary);
				case "/projects/project-a/generation/selected-assets":
					return apiResponse({
						assets: [
							{
								assetIndex: 0,
								createdAt: "2026-06-19T02:10:00.000Z",
								id: "selected-character-a",
								kind: "image",
								mimeType: "image/png",
								resourceType: "character",
								taskId: "task-a",
								title: "主角 底层青年 / 低阶散修",
								url: "/api/v1/media-assets/character-a/content",
							},
						],
					});
				default:
					throw new Error(`Unexpected GET ${url}`);
			}
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("opens selected resources in a dialog from the overview cards", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<ProjectOverview />
				</MemoryRouter>
			</SWRConfig>,
		);

		await screen.findByText("已选 1 张");
		fireEvent.click(screen.getByRole("button", { name: /角色/ }));

		const dialog = await screen.findByRole("dialog");
		await waitFor(() =>
			expect(within(dialog).getByText("主角 底层青年 / 低阶散修")).toBeInTheDocument(),
		);
		expect(within(dialog).getByText("角色 · 已选资源")).toBeInTheDocument();
	});
});

const apiResponse = <T,>(data: T): ApiResponse<T> => ({
	code: 0,
	data,
	message: "ok",
	success: true,
});
