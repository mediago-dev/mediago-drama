import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingSummaryResponse } from "@/domains/billing/api/billing";
import { useDocumentsStore } from "@/domains/documents/stores";
import type { ProjectConfig } from "@/domains/projects/api/projects";
import httpClient from "@/shared/lib/http";
import type { ApiResponse } from "@/types/api";
import { ProjectOverview } from "./ProjectOverview";

const dialogMocks = vi.hoisted(() => ({
	DocumentSectionBatchGenerationRunner: vi.fn((_props: Record<string, unknown>) => null),
	ImageGenerationDialog: vi.fn((_props: Record<string, unknown>) => null),
	VideoGenerationDialog: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock("@/domains/documents/components/DocumentSectionBatchGenerationRunner", () => ({
	DocumentSectionBatchGenerationRunner: dialogMocks.DocumentSectionBatchGenerationRunner,
}));

vi.mock("@/shared/components/generation-dialogs/VideoGenerationDialog", () => ({
	VideoGenerationDialog: dialogMocks.VideoGenerationDialog,
}));

vi.mock("@/shared/components/generation-dialogs/ImageGenerationDialog", () => ({
	ImageGenerationDialog: dialogMocks.ImageGenerationDialog,
}));

vi.mock("@/shared/lib/http", () => ({
	default: {
		get: vi.fn(),
		patch: vi.fn(),
	},
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		info: vi.fn(),
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
		vi.mocked(httpClient.get).mockImplementation(async (url, config) => {
			const requestUrl = String(url);
			if (requestUrl === "/generation/tasks") {
				const params =
					(config as { params?: { kind?: string; projectId?: string } } | undefined)?.params ?? {};
				return apiResponse({
					tasks:
						params.projectId === "project-a" && params.kind === "image"
							? [
									generationTask({
										documentId: "characters",
										id: "task-image-lintong",
										kind: "image",
										message: "图片生成已完成。",
										sectionId: "section_lintong",
										status: "completed",
									}),
									generationTask({
										documentId: "characters",
										id: "task-image-xulele",
										kind: "image",
										message: "正在生成图片。",
										sectionId: "section_xulele",
										status: "running",
									}),
								]
							: params.projectId === "project-a" && params.kind === "video"
								? [
										generationTask({
											documentId: "storyboard-a",
											id: "task-video-reel-01",
											kind: "video",
											message: "视频生成已完成。",
											sectionId: "section_reel_01",
											status: "completed",
										}),
										generationTask({
											documentId: "storyboard-a",
											id: "task-video-reel-02",
											kind: "video",
											message: "视频生成任务已提交。",
											sectionId: "section_reel_02",
											status: "submitted",
										}),
									]
								: [],
				});
			}

			switch (requestUrl) {
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
							{
								category: "storyboard",
								comments: [],
								content: [
									"# 第一章分镜脚本",
									"",
									"<!-- section-id: section_reel_01 -->",
									"## 第 01 组 总时长：00:08",
									"",
									"### 分镜 01",
									"",
									"沈阁从黑暗水面坠入湖中。",
									"",
									"[章节视频：落水镜头](</api/v1/media-assets/video-1/content>)",
									"",
									"<!-- section-id: section_reel_02 -->",
									"## 第 02 组 总时长：00:06",
									"",
									"### 分镜 02",
									"",
									"他猛然睁眼。",
									"",
									"[章节视频：苏醒镜头](</api/v1/media-assets/video-2/content>)",
								].join("\n"),
								id: "storyboard-a",
								isDirty: false,
								parentId: null,
								sortOrder: 1,
								title: "第一章分镜脚本",
								updatedAt: "2026-06-19T02:08:41.000Z",
								version: 1,
								workbenchDraft: null,
							},
							{
								category: "storyboard",
								comments: [],
								content: [
									"# 第二章分镜脚本",
									"",
									"<!-- section-id: section_reel_b_01 -->",
									"## 第 01 组 总时长：00:05",
									"",
									"### 分镜 01",
									"",
									"门外传来脚步声。",
								].join("\n"),
								id: "storyboard-b",
								isDirty: false,
								parentId: null,
								sortOrder: 2,
								title: "第二章分镜脚本",
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
							{
								blockId: "section_xulele",
								canGenerate: true,
								documentId: "characters",
								documentTitle: "角色设定",
								headingLevel: 2,
								headingOccurrence: 2,
								id: "character:characters:section_xulele",
								markdown: "## 徐乐乐\n\n温和的同学。",
								plainText: "徐乐乐\n\n温和的同学。",
								prompt: "## 徐乐乐\n\n温和的同学。",
								sectionId: "section_xulele",
								selectedImages: [],
								sourceCategory: "character",
								summary: "温和的同学。",
								title: "徐乐乐",
								type: "character",
							},
							{
								blockId: "shot_01",
								canGenerate: true,
								documentId: "storyboard-a",
								documentTitle: "第一章分镜脚本",
								headingLevel: 3,
								headingOccurrence: 1,
								id: "storyboard:storyboard-a:shot_01",
								markdown: [
									"### 分镜 01",
									"",
									"沈阁从黑暗水面坠入湖中。",
									"",
									"[章节视频：落水镜头](</api/v1/media-assets/video-1/content>)",
								].join("\n"),
								plainText: "分镜 01\n\n沈阁从黑暗水面坠入湖中。",
								prompt: "## 分镜 01\n\n沈阁从黑暗水面坠入湖中。",
								sectionId: "shot_01",
								selectedImages: [],
								sourceCategory: "storyboard",
								summary: "沈阁从黑暗水面坠入湖中。",
								title: "分镜 01",
								type: "storyboard",
							},
							{
								blockId: "shot_02",
								canGenerate: true,
								documentId: "storyboard-a",
								documentTitle: "第一章分镜脚本",
								headingLevel: 3,
								headingOccurrence: 2,
								id: "storyboard:storyboard-a:shot_02",
								markdown: [
									"### 分镜 02",
									"",
									"他猛然睁眼。",
									"",
									"[章节视频：苏醒镜头](</api/v1/media-assets/video-2/content>)",
								].join("\n"),
								plainText: "分镜 02\n\n他猛然睁眼。",
								prompt: "## 分镜 02\n\n他猛然睁眼。",
								sectionId: "shot_02",
								selectedImages: [],
								sourceCategory: "storyboard",
								summary: "他猛然睁眼。",
								title: "分镜 02",
								type: "storyboard",
							},
							{
								blockId: "shot_01",
								canGenerate: true,
								documentId: "storyboard-b",
								documentTitle: "第二章分镜脚本",
								headingLevel: 3,
								headingOccurrence: 1,
								id: "storyboard:storyboard-b:shot_01",
								markdown: "### 分镜 01\n\n门外传来脚步声。",
								plainText: "分镜 01\n\n门外传来脚步声。",
								prompt: "### 分镜 01\n\n门外传来脚步声。",
								sectionId: "shot_01",
								selectedImages: [],
								sourceCategory: "storyboard",
								summary: "门外传来脚步声。",
								title: "分镜 01",
								type: "storyboard",
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
				case "/projects/project-a/workspace/storyboard-video-resources":
					return apiResponse({
						groups: [
							{
								documentId: "storyboard-a",
								documentTitle: "第一章分镜脚本",
								reels: [
									{
										blockId: "section_reel_01",
										canGenerate: true,
										headingLevel: 2,
										headingOccurrence: 1,
										id: "storyboard-a:section_reel_01",
										markdown: [
											"## 第 01 组 总时长：00:08",
											"",
											"### 分镜 01",
											"",
											"沈阁从黑暗水面坠入湖中。",
											"",
											"[章节视频：落水镜头](</api/v1/media-assets/video-1/content>)",
										].join("\n"),
										plainText: "第 01 组 总时长：00:08\n\n分镜 01\n\n沈阁从黑暗水面坠入湖中。",
										prompt: "## 第 01 组 总时长：00:08\n\n### 分镜 01\n\n沈阁从黑暗水面坠入湖中。",
										sectionId: "section_reel_01",
										title: "第 01 组 总时长：00:08",
										videos: [
											{
												id: "markdown:section_reel_01:/api/v1/media-assets/video-1/content",
												mimeType: "video/mp4",
												posterUrl: "/api/v1/media-assets/video-1/poster",
												sectionTitle: "第 01 组 总时长：00:08",
												sourceLabel: "文档成片",
												src: "/api/v1/media-assets/video-1/content",
												title: "落水镜头",
											},
										],
									},
									{
										blockId: "section_reel_02",
										canGenerate: true,
										headingLevel: 2,
										headingOccurrence: 1,
										id: "storyboard-a:section_reel_02",
										markdown: [
											"## 第 02 组 总时长：00:06",
											"",
											"### 分镜 02",
											"",
											"他猛然睁眼。",
											"",
											"[章节视频：苏醒镜头](</api/v1/media-assets/video-2/content>)",
										].join("\n"),
										plainText: "第 02 组 总时长：00:06\n\n分镜 02\n\n他猛然睁眼。",
										prompt: "## 第 02 组 总时长：00:06\n\n### 分镜 02\n\n他猛然睁眼。",
										sectionId: "section_reel_02",
										title: "第 02 组 总时长：00:06",
										videos: [
											{
												id: "markdown:section_reel_02:/api/v1/media-assets/video-2/content",
												mimeType: "video/mp4",
												posterUrl: "/api/v1/media-assets/video-2/poster",
												sectionTitle: "第 02 组 总时长：00:06",
												sourceLabel: "文档成片",
												src: "/api/v1/media-assets/video-2/content",
												title: "苏醒镜头",
											},
										],
									},
								],
							},
							{
								documentId: "storyboard-b",
								documentTitle: "第二章分镜脚本",
								reels: [
									{
										blockId: "section_reel_b_01",
										canGenerate: true,
										headingLevel: 2,
										headingOccurrence: 1,
										id: "storyboard-b:section_reel_b_01",
										markdown: [
											"## 第 01 组 总时长：00:05",
											"",
											"### 分镜 01",
											"",
											"门外传来脚步声。",
										].join("\n"),
										plainText: "第 01 组 总时长：00:05\n\n分镜 01\n\n门外传来脚步声。",
										prompt: "## 第 01 组 总时长：00:05\n\n### 分镜 01\n\n门外传来脚步声。",
										sectionId: "section_reel_b_01",
										title: "第 01 组 总时长：00:05",
										videos: [
											{
												id: "task:task-video-b:0",
												mimeType: "video/mp4",
												posterUrl: "/api/v1/media-assets/video-3/poster",
												sectionTitle: "第 01 组 总时长：00:05",
												sourceLabel: "生成历史",
												src: "/api/v1/media-assets/video-3/content",
												title: "门外脚步成片",
											},
										],
									},
								],
							},
						],
						projectId: "project-a",
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

		await screen.findByText("文档 2 项 · 图片 1 张");
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

		await screen.findByText("文档 2 项 · 图片 1 张");
		fireEvent.click(screen.getByRole("button", { name: "角色 文档资源" }));

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("角色 · 文档资源")).toBeInTheDocument();
		expect(within(dialog).getByText("林书彤")).toBeInTheDocument();
		expect(within(dialog).getByText("徐乐乐")).toBeInTheDocument();
		expect(within(dialog).queryByText("section_lintong")).not.toBeInTheDocument();
		expect(within(dialog).queryByText("section_xulele")).not.toBeInTheDocument();
		expect(within(dialog).getByRole("img", { name: "主角 底层青年 / 低阶散修" })).toHaveAttribute(
			"src",
			"/api/v1/media-assets/character-a/content",
		);
		expect(within(dialog).getAllByText("已选择 1 张")).toHaveLength(2);
		expect(within(dialog).getByText("已选择 0 张")).toBeInTheDocument();
		expect(within(dialog).getByText("暂无已选图片")).toBeInTheDocument();
		expect(within(dialog).queryByText("来源：角色设定")).not.toBeInTheDocument();
		expect(within(dialog).queryByText("冷静的调查记者。")).not.toBeInTheDocument();
		expect(within(dialog).queryByText("H2")).not.toBeInTheDocument();
		for (const button of within(dialog).getAllByRole("button", { name: "生成图片" })) {
			expect(button).toBeEnabled();
		}
	});

	it("shows in-progress generation status in resource dialogs", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<ProjectOverview />
				</MemoryRouter>
			</SWRConfig>,
		);

		await screen.findByText("文档 2 项 · 图片 1 张");
		fireEvent.click(screen.getByRole("button", { name: "角色 文档资源" }));

		const documentDialog = await screen.findByRole("dialog");
		expect(within(documentDialog).getByText("徐乐乐")).toBeInTheDocument();
		const documentStatus = within(documentDialog).getByText("生成中");
		expect(documentStatus).toBeInTheDocument();
		expect(documentStatus.parentElement?.className).toContain("absolute");
		expect(documentStatus.parentElement?.className).toContain("right-2");
		expect(documentStatus.parentElement?.className).toContain("top-2");
		expect(within(documentDialog).queryByText("已完成")).not.toBeInTheDocument();

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

		fireEvent.click(screen.getByRole("button", { name: "第一章分镜脚本 成片资源" }));
		const videoDialog = await screen.findByRole("dialog");
		expect(within(videoDialog).getByText("第 02 组 总时长：00:06")).toBeInTheDocument();
		const videoStatus = within(videoDialog).getByText("生成中");
		expect(videoStatus).toBeInTheDocument();
		expect(videoStatus.parentElement?.className).toContain("absolute");
		expect(videoStatus.parentElement?.className).toContain("right-2");
		expect(videoStatus.parentElement?.className).toContain("top-2");
		expect(within(videoDialog).queryByText("已完成")).not.toBeInTheDocument();
	});

	it("submits document-derived resources for background batch image generation", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<ProjectOverview />
				</MemoryRouter>
			</SWRConfig>,
		);

		await screen.findByText("文档 2 项 · 图片 1 张");
		fireEvent.click(screen.getByRole("button", { name: "角色 文档资源" }));

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByRole("button", { name: "批量生成图片（0）" })).toBeDisabled();
		expect(
			within(dialog).getByRole("checkbox", { name: "选择 林书彤" }).getAttribute("aria-checked"),
		).toBe("false");

		fireEvent.click(within(dialog).getByRole("button", { name: "全选" }));

		expect(
			within(dialog)
				.getByRole("checkbox", { name: "取消选择 林书彤" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			within(dialog)
				.getByRole("checkbox", { name: "取消选择 徐乐乐" })
				.getAttribute("aria-checked"),
		).toBe("true");

		fireEvent.click(within(dialog).getByRole("button", { name: "批量生成图片（2）" }));

		expect(within(dialog).queryByText("已完成")).not.toBeInTheDocument();
		expect(within(dialog).getAllByText("生成中")).toHaveLength(2);

		await waitFor(() => {
			const props = dialogMocks.DocumentSectionBatchGenerationRunner.mock.calls.at(-1)?.[0] as
				| { jobs?: unknown[] }
				| undefined;
			expect(props?.jobs).toHaveLength(2);
		});

		const props = dialogMocks.DocumentSectionBatchGenerationRunner.mock.calls.at(-1)?.[0] as {
			jobs: Array<Record<string, unknown>>;
		};
		expect(props.jobs).toEqual([
			expect.objectContaining({
				kind: "image",
				projectId: "project-a",
				section: expect.objectContaining({
					blockId: "section_lintong",
					documentId: "characters",
					headingText: "林书彤",
				}),
			}),
			expect.objectContaining({
				kind: "image",
				projectId: "project-a",
				section: expect.objectContaining({
					blockId: "section_xulele",
					documentId: "characters",
					headingText: "徐乐乐",
				}),
			}),
		]);
		expect(
			dialogMocks.ImageGenerationDialog.mock.calls.some(([props]) => props.open === true),
		).toBe(false);

		await waitFor(() => {
			expect(within(dialog).getByRole("button", { name: "批量生成图片（0）" })).toBeDisabled();
		});
	});

	it("opens storyboard video resources for the selected storyboard document", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<ProjectOverview />
				</MemoryRouter>
			</SWRConfig>,
		);

		await screen.findByRole("button", { name: "第一章分镜脚本 成片资源" });
		expect(screen.getByText("分镜组 2 项 · 成片 2 个")).toBeInTheDocument();
		expect(await screen.findByText("分镜组 1 项 · 成片 1 个")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "第一章分镜脚本 成片资源" }));

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("成片资源 · 第一章分镜脚本")).toBeInTheDocument();
		expect(within(dialog).getByText("第 01 组 总时长：00:08")).toBeInTheDocument();
		expect(within(dialog).getByText("第 02 组 总时长：00:06")).toBeInTheDocument();
		expect(within(dialog).queryByText("分镜 01")).not.toBeInTheDocument();
		expect(within(dialog).getByText("落水镜头")).toBeInTheDocument();
		expect(within(dialog).getByText("苏醒镜头")).toBeInTheDocument();
		expect(within(dialog).queryByText("门外脚步成片")).not.toBeInTheDocument();
		expect(within(dialog).getAllByRole("button", { name: "生成视频" })).toHaveLength(2);

		expect(within(dialog).getByRole("img", { name: "落水镜头" })).toHaveAttribute(
			"src",
			"/api/v1/media-assets/video-1/poster",
		);
		expect(within(dialog).getByRole("img", { name: "苏醒镜头" })).toHaveAttribute(
			"src",
			"/api/v1/media-assets/video-2/poster",
		);
		expect(within(dialog).queryByText("已有成片")).not.toBeInTheDocument();
		expect(within(dialog).queryByTestId("overview-video-player")).not.toBeInTheDocument();

		fireEvent.click(within(dialog).getAllByRole("button", { name: "生成视频" })[0]);
		await waitFor(() => {
			const props = dialogMocks.VideoGenerationDialog.mock.calls.at(-1)?.[0];
			expect(props).toMatchObject({
				open: true,
				projectId: "project-a",
				section: expect.objectContaining({
					blockId: "section_reel_01",
					documentId: "storyboard-a",
					headingLevel: 2,
					headingOccurrence: 1,
					headingText: "第 01 组 总时长：00:08",
					markdown: expect.stringContaining("### 分镜 01"),
				}),
				selectedAssetKeys: ["video:/api/v1/media-assets/video-1/content"],
			});
		});

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: "第二章分镜脚本 成片资源" }));

		const secondDialog = await screen.findByRole("dialog");
		expect(within(secondDialog).getByText("成片资源 · 第二章分镜脚本")).toBeInTheDocument();
		expect(within(secondDialog).getByText("第 01 组 总时长：00:05")).toBeInTheDocument();
		expect(within(secondDialog).getByText("门外脚步成片")).toBeInTheDocument();

		expect(within(secondDialog).getByRole("img", { name: "门外脚步成片" })).toHaveAttribute(
			"src",
			"/api/v1/media-assets/video-3/poster",
		);
		expect(within(secondDialog).queryByText("已有成片")).not.toBeInTheDocument();
		expect(within(secondDialog).queryByTestId("overview-video-player")).not.toBeInTheDocument();
	});

	it("submits storyboard video reels for background batch video generation", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<ProjectOverview />
				</MemoryRouter>
			</SWRConfig>,
		);

		await screen.findByRole("button", { name: "第一章分镜脚本 成片资源" });
		fireEvent.click(screen.getByRole("button", { name: "第一章分镜脚本 成片资源" }));

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByRole("button", { name: "批量生成视频（0）" })).toBeDisabled();

		fireEvent.click(within(dialog).getByRole("button", { name: "全选" }));
		expect(
			within(dialog)
				.getByRole("checkbox", { name: "取消选择 第 01 组 总时长：00:08" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			within(dialog)
				.getByRole("checkbox", { name: "取消选择 第 02 组 总时长：00:06" })
				.getAttribute("aria-checked"),
		).toBe("true");

		fireEvent.click(within(dialog).getByRole("button", { name: "批量生成视频（2）" }));

		expect(within(dialog).queryByText("已完成")).not.toBeInTheDocument();
		expect(within(dialog).getAllByText("生成中")).toHaveLength(2);

		await waitFor(() => {
			const props = dialogMocks.DocumentSectionBatchGenerationRunner.mock.calls.at(-1)?.[0] as
				| { jobs?: unknown[] }
				| undefined;
			expect(props?.jobs).toHaveLength(2);
		});

		const props = dialogMocks.DocumentSectionBatchGenerationRunner.mock.calls.at(-1)?.[0] as {
			jobs: Array<Record<string, unknown>>;
		};
		expect(props.jobs).toEqual([
			expect.objectContaining({
				kind: "video",
				projectId: "project-a",
				resolveLatestSection: false,
				section: expect.objectContaining({
					blockId: "section_reel_01",
					documentId: "storyboard-a",
					headingText: "第 01 组 总时长：00:08",
				}),
			}),
			expect.objectContaining({
				kind: "video",
				projectId: "project-a",
				resolveLatestSection: false,
				section: expect.objectContaining({
					blockId: "section_reel_02",
					documentId: "storyboard-a",
					headingText: "第 02 组 总时长：00:06",
				}),
			}),
		]);
		expect(
			dialogMocks.VideoGenerationDialog.mock.calls.some(([props]) => props.open === true),
		).toBe(false);

		await waitFor(() => {
			expect(within(dialog).getByRole("button", { name: "批量生成视频（0）" })).toBeDisabled();
		});
	});
});

const apiResponse = <T,>(data: T): ApiResponse<T> => ({
	code: 0,
	data,
	message: "ok",
	success: true,
});

const generationTask = (overrides: {
	documentId: string;
	id: string;
	kind: "image" | "video";
	message: string;
	sectionId: string;
	status: string;
}) => ({
	assets: [],
	createdAt: "2026-06-19T02:12:00.000Z",
	documentId: overrides.documentId,
	durationMs: 0,
	familyId: "family",
	id: overrides.id,
	kind: overrides.kind,
	message: overrides.message,
	model: "model",
	modelId: "model",
	params: {},
	projectId: "project-a",
	provider: "provider",
	referenceAssetIds: [],
	referenceUrls: [],
	retryCount: 0,
	routeId: "route",
	sectionId: overrides.sectionId,
	status: overrides.status,
	updatedAt: "2026-06-19T02:13:00.000Z",
	usage: {
		cachedTokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
	},
	versionId: "version",
});
