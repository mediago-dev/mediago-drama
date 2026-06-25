import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingSummaryResponse } from "@/domains/billing/api/billing";
import { useDocumentsStore } from "@/domains/documents/stores";
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
	overview: { categoryDefaults: {} },
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
				case "/projects/project-a/workspace/documents":
					return apiResponse({
						assets: [],
						documents: [
							{
								category: "character",
								comments: [],
								content: [
									"# 角色设定",
									"",
									"<!-- section-id: section_lintong -->",
									"## 林书彤",
									"",
									"冷静的调查记者。",
								].join("\n"),
								id: "characters",
								isDirty: false,
								parentId: null,
								sortOrder: 0,
								title: "角色设定",
								updatedAt: "2026-06-19T02:08:41.000Z",
								version: 1,
								workbenchDraft: null,
							},
						],
						folders: [],
						projectId: "project-a",
						workspaceDir: "/workspace/project-a",
					});
				case "/projects/project-a/workspace/resources":
					return apiResponse({
						projectId: "project-a",
						resources: [
							{
								blockId: "section_lintong",
								canGenerate: true,
								documentId: "characters",
								documentTitle: "角色设定",
								headingLevel: 2,
								headingOccurrence: 1,
								id: "character:characters:section_lintong",
								markdown: [
									"## 林书彤",
									"",
									"冷静的调查记者。",
									"",
									"![主角 底层青年 / 低阶散修](</api/v1/media-assets/character-a/content>)",
								].join("\n"),
								plainText: "林书彤\n\n冷静的调查记者。",
								prompt: "## 林书彤\n\n冷静的调查记者。",
								sectionId: "section_lintong",
								selectedImages: [
									{
										src: "/api/v1/media-assets/character-a/content",
										title: "主角 底层青年 / 低阶散修",
									},
								],
								sourceCategory: "character",
								summary: "冷静的调查记者。",
								title: "林书彤",
								type: "character",
							},
						],
					});
				case "/projects/project-a/generation/selected-assets":
					return apiResponse({
						assets: [
							{
								assetIndex: 0,
								createdAt: "2026-06-19T02:10:00.000Z",
								id: "selected-character-a",
								kind: "image",
								mimeType: "image/png",
								resourceId: "section_lintong",
								resourceType: "character",
								sourceDocumentId: "characters",
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
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
	});

	it("does not render the selected generation resources overview section", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<ProjectOverview />
				</MemoryRouter>
			</SWRConfig>,
		);

		await screen.findByText("文档 1 项 · 图片 1 张");
		expect(screen.queryByText("已选生成资源")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "角色 已选生成资源" })).not.toBeInTheDocument();
	});

	it("opens document-derived resources with section ids from the overview cards", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<ProjectOverview />
				</MemoryRouter>
			</SWRConfig>,
		);

		await screen.findByText("文档 1 项 · 图片 1 张");
		fireEvent.click(screen.getByRole("button", { name: "角色 文档资源" }));

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("角色 · 文档资源")).toBeInTheDocument();
		expect(within(dialog).getByText("林书彤")).toBeInTheDocument();
		expect(within(dialog).getByText("section_lintong")).toBeInTheDocument();
		expect(within(dialog).getByRole("img", { name: "主角 底层青年 / 低阶散修" })).toHaveAttribute(
			"src",
			"/api/v1/media-assets/character-a/content",
		);
		expect(within(dialog).getAllByText("已选择 1 张")).toHaveLength(2);
		expect(within(dialog).getByRole("button", { name: /生成图片/ })).toBeEnabled();
	});
});

const apiResponse = <T,>(data: T): ApiResponse<T> => ({
	code: 0,
	data,
	message: "ok",
	success: true,
});
