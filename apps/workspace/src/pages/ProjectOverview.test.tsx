import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingSummaryResponse } from "@/domains/billing/api/billing";
import { type MarkdownDocument, useDocumentsStore } from "@/domains/documents/stores";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";
import type { ProjectConfig } from "@/domains/projects/api/projects";
import httpClient from "@/shared/lib/http";
import type { ApiResponse } from "@/types/api";
import { ProjectOverview } from "./ProjectOverview";

const dialogMocks = vi.hoisted(() => ({
	BatchGenerationSettingsDialog: vi.fn((_props: Record<string, unknown>): React.ReactNode => null),
	DocumentSectionBatchGenerationRunner: vi.fn((_props: Record<string, unknown>) => null),
	EpisodeTimelineView: vi.fn((_props: Record<string, unknown>): React.ReactNode => null),
}));

vi.mock("@/domains/generation/components/BatchGenerationSettingsDialog", () => ({
	BatchGenerationSettingsDialog: dialogMocks.BatchGenerationSettingsDialog,
}));

vi.mock("@/domains/documents/components/DocumentSectionBatchGenerationRunner", () => ({
	DocumentSectionBatchGenerationRunner: dialogMocks.DocumentSectionBatchGenerationRunner,
}));

vi.mock("@/domains/episode/components/EpisodeTimelineView", () => ({
	EpisodeTimelineView: dialogMocks.EpisodeTimelineView,
}));

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({ mimeType, src }: { mimeType?: string; src: string }) => (
		<video data-testid="video-preview" data-mime-type={mimeType} src={src} />
	),
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

const LocationProbe = () => {
	const location = useLocation();
	const state = location.state as { projectView?: string } | null;
	return (
		<div data-project-view={state?.projectView ?? ""} data-testid="location">
			{`${location.pathname}${location.search}`}
		</div>
	);
};

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
	rows: [
		{
			cachedTokens: 0,
			calls: 3,
			costs: { CNY: 0.42 },
			inputTokens: 120,
			key: "usage-row-only",
			label: "仅用于测试的能力明细",
			outputTokens: 80,
			priced: true,
			reasoningTokens: 0,
			totalTokens: 200,
		},
	],
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

let imageGenerationTasksFixture: unknown[] = [];
let selectedGenerationAssetsFixture: unknown[] = [];
let selectedGenerationAssetsRefreshFixture: unknown[] | null = null;
let selectedGenerationAssetsRequestCount = 0;
let videoGenerationTasksFixture: unknown[] = [];

describe("ProjectOverview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectedGenerationAssetsRequestCount = 0;
		selectedGenerationAssetsRefreshFixture = null;
		selectedGenerationAssetsFixture = [
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
		];
		imageGenerationTasksFixture = [
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
		];
		videoGenerationTasksFixture = [
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
		];
		dialogMocks.BatchGenerationSettingsDialog.mockImplementation(
			({ kind, onConfirm, open }: Record<string, unknown>) =>
				open ? (
					<button
						type="button"
						onClick={() =>
							(onConfirm as (settings: Record<string, unknown>) => void)({
								family: { id: `${kind}-family`, kind, label: `${kind} family` },
								params: { n: 2, ratio: "16:9" },
								route: {
									configured: true,
									familyId: `${kind}-family`,
									id: `${kind}-route`,
									kind,
									model: `${kind}-model`,
									provider: "provider",
									status: "available",
									supportsReferenceUrls: true,
									versionId: `${kind}-version`,
								},
								version: {
									familyId: `${kind}-family`,
									id: `${kind}-version`,
									label: `${kind} version`,
								},
							})
						}
					>
						确认批量设置
					</button>
				) : null,
		);
		dialogMocks.EpisodeTimelineView.mockImplementation(
			({ documentId, workbench }: Record<string, unknown>) => (
				<div
					data-document-id={String(documentId ?? "")}
					data-testid="episode-timeline-view"
					data-workbench={String(workbench ?? "")}
				>
					{workbench === "canvas" ? "嵌入画布" : "嵌入预览"}
				</div>
			),
		);
		vi.mocked(httpClient.patch).mockImplementation(async (url, payload) => {
			const documentId = String(url).split("/").pop() ?? "";
			const current = useDocumentsStore.getState();
			const document = current.documents.find((item) => item.id === documentId);
			if (!document) throw new Error(`missing document ${documentId}`);

			const patchPayload = payload as Partial<Pick<MarkdownDocument, "workbenchDraft">>;
			const nextDocument: MarkdownDocument = {
				...document,
				...(patchPayload.workbenchDraft !== undefined
					? { workbenchDraft: patchPayload.workbenchDraft }
					: {}),
				isDirty: false,
			};
			const nextDocuments = current.documents.map((item) =>
				item.id === documentId ? nextDocument : item,
			);

			return apiResponse({
				document: nextDocument,
				state: {
					assets: current.assets,
					documents: nextDocuments,
					folders: current.folders,
					projectId: current.projectId ?? undefined,
					workspaceDir: current.workspaceDir,
				},
			});
		});
		vi.mocked(httpClient.get).mockImplementation(async (url, config) => {
			const requestUrl = String(url);
			if (requestUrl === "/generation/tasks") {
				const params =
					(config as { params?: { kind?: string; projectId?: string } } | undefined)?.params ?? {};
				return apiResponse({
					tasks:
						params.projectId === "project-a" && params.kind === "image"
							? imageGenerationTasksFixture
							: params.projectId === "project-a" && params.kind === "video"
								? videoGenerationTasksFixture
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
									"沈阁从黑暗水面坠入湖中。",
									"",
									"[章节视频：落水镜头](</api/v1/media-assets/video-1/content>)",
									"",
									"<!-- section-id: section_reel_02 -->",
									"## 第 02 组 总时长：00:06",
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
								generatedImageCount: 2,
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
								generatedImageCount: 0,
								headingLevel: 2,
								headingOccurrence: 2,
								id: "character:characters:section_xulele",
								markdown: "## 徐乐乐\n\n温和的同学。",
								plainText: "徐乐乐\n\n温和的同学。",
								prompt: "## 徐乐乐\n\n温和的同学。",
								sectionId: "section_xulele",
								sourceCategory: "character",
								summary: "温和的同学。",
								title: "徐乐乐",
								type: "character",
							},
							{
								blockId: "section_reel_01",
								canGenerate: true,
								documentId: "storyboard-a",
								documentTitle: "第一章分镜脚本",
								headingLevel: 2,
								headingOccurrence: 1,
								id: "storyboard:storyboard-a:section_reel_01",
								markdown: [
									"## 第 01 组 总时长：00:08",
									"",
									"沈阁从黑暗水面坠入湖中。",
									"",
									"[章节视频：落水镜头](</api/v1/media-assets/video-1/content>)",
								].join("\n"),
								plainText: "第 01 组 总时长：00:08\n\n沈阁从黑暗水面坠入湖中。",
								prompt: "## 第 01 组 总时长：00:08\n\n沈阁从黑暗水面坠入湖中。",
								sectionId: "section_reel_01",
								sourceCategory: "storyboard",
								summary: "沈阁从黑暗水面坠入湖中。",
								title: "第 01 组 总时长：00:08",
								type: "storyboard",
							},
							{
								blockId: "section_reel_02",
								canGenerate: true,
								documentId: "storyboard-a",
								documentTitle: "第一章分镜脚本",
								headingLevel: 2,
								headingOccurrence: 1,
								id: "storyboard:storyboard-a:section_reel_02",
								markdown: [
									"## 第 02 组 总时长：00:06",
									"",
									"他猛然睁眼。",
									"",
									"[章节视频：苏醒镜头](</api/v1/media-assets/video-2/content>)",
								].join("\n"),
								plainText: "第 02 组 总时长：00:06\n\n他猛然睁眼。",
								prompt: "## 第 02 组 总时长：00:06\n\n他猛然睁眼。",
								sectionId: "section_reel_02",
								sourceCategory: "storyboard",
								summary: "他猛然睁眼。",
								title: "第 02 组 总时长：00:06",
								type: "storyboard",
							},
							{
								blockId: "section_reel_b_01",
								canGenerate: true,
								documentId: "storyboard-b",
								documentTitle: "第二章分镜脚本",
								headingLevel: 2,
								headingOccurrence: 1,
								id: "storyboard:storyboard-b:section_reel_b_01",
								markdown: "## 第 01 组 总时长：00:05\n\n门外传来脚步声。",
								plainText: "第 01 组 总时长：00:05\n\n门外传来脚步声。",
								prompt: "## 第 01 组 总时长：00:05\n\n门外传来脚步声。",
								sectionId: "section_reel_b_01",
								sourceCategory: "storyboard",
								summary: "门外传来脚步声。",
								title: "第 01 组 总时长：00:05",
								type: "storyboard",
							},
						],
					});
				case "/projects/project-a/generation/selected-assets":
					selectedGenerationAssetsRequestCount += 1;
					return apiResponse({
						assets:
							selectedGenerationAssetsRequestCount > 1 && selectedGenerationAssetsRefreshFixture
								? selectedGenerationAssetsRefreshFixture
								: selectedGenerationAssetsFixture,
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
										generatedVideoCount: 2,
										headingLevel: 2,
										headingOccurrence: 1,
										id: "storyboard-a:section_reel_01",
										markdown: [
											"## 第 01 组 总时长：00:08",
											"",
											"沈阁从黑暗水面坠入湖中。",
											"",
											"[章节视频：落水镜头](</api/v1/media-assets/video-1/content>)",
										].join("\n"),
										plainText: "第 01 组 总时长：00:08\n\n沈阁从黑暗水面坠入湖中。",
										prompt: "## 第 01 组 总时长：00:08\n\n沈阁从黑暗水面坠入湖中。",
										sectionId: "section_reel_01",
										title: "第 01 组 总时长：00:08",
										videos: [
											{
												id: "selected:selected-storyboard-video-1",
												mimeType: "video/mp4",
												posterUrl: "/api/v1/media-assets/selected-video-1/poster",
												sectionTitle: "第 01 组 总时长：00:08",
												sourceLabel: "已选成片",
												src: "/api/v1/media-assets/selected-video-1/content",
												title: "已选落水镜头",
											},
										],
									},
									{
										blockId: "section_reel_02",
										canGenerate: true,
										generatedVideoCount: 0,
										headingLevel: 2,
										headingOccurrence: 1,
										id: "storyboard-a:section_reel_02",
										markdown: [
											"## 第 02 组 总时长：00:06",
											"",
											"他猛然睁眼。",
											"",
											"[章节视频：苏醒镜头](</api/v1/media-assets/video-2/content>)",
										].join("\n"),
										plainText: "第 02 组 总时长：00:06\n\n他猛然睁眼。",
										prompt: "## 第 02 组 总时长：00:06\n\n他猛然睁眼。",
										sectionId: "section_reel_02",
										title: "第 02 组 总时长：00:06",
										videos: [],
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
										generatedVideoCount: 0,
										headingLevel: 2,
										headingOccurrence: 1,
										id: "storyboard-b:section_reel_b_01",
										markdown: ["## 第 01 组 总时长：00:05", "", "门外传来脚步声。"].join("\n"),
										plainText: "第 01 组 总时长：00:05\n\n门外传来脚步声。",
										prompt: "## 第 01 组 总时长：00:05\n\n门外传来脚步声。",
										sectionId: "section_reel_b_01",
										title: "第 01 组 总时长：00:05",
										videos: [],
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
		useMediaGenerationStore.setState({ activeRequest: null, optimisticStatuses: {} });
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

	it("refreshes selected resource covers after an image generation task completes", async () => {
		selectedGenerationAssetsFixture = [];
		selectedGenerationAssetsRefreshFixture = [
			{
				assetIndex: 0,
				createdAt: "2026-06-19T02:14:00.000Z",
				id: "selected-generated-lintong",
				kind: "image",
				mimeType: "image/png",
				resourceId: "section_lintong",
				resourceType: "character",
				sourceDocumentId: "characters",
				taskId: "task-image-lintong-new",
				title: "林书彤生成图 1",
				url: "/api/v1/media-assets/generated-lintong-1/content",
			},
		];
		imageGenerationTasksFixture = [
			generationTask({
				assets: [
					{
						kind: "image",
						mimeType: "image/png",
						slotIndex: 0,
						taskId: "task-image-lintong-new",
						title: "林书彤生成图 1",
						url: "/api/v1/media-assets/generated-lintong-1/content",
					},
				],
				documentId: "characters",
				id: "task-image-lintong-new",
				kind: "image",
				message: "图片生成已完成。",
				sectionId: "section_lintong",
				status: "completed",
			}),
		];

		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<ProjectOverview />
				</MemoryRouter>
			</SWRConfig>,
		);

		await waitFor(() => expect(selectedGenerationAssetsRequestCount).toBeGreaterThanOrEqual(2));
		await screen.findByText("文档 2 项 · 图片 1 张");

		fireEvent.click(screen.getByRole("button", { name: "角色 文档资源" }));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByRole("img", { name: "林书彤生成图 1" })).toHaveAttribute(
			"src",
			"/api/v1/media-assets/generated-lintong-1/content",
		);
	});

	it("does not render capability usage detail rows in the overview", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<ProjectOverview />
				</MemoryRouter>
			</SWRConfig>,
		);

		await screen.findByText("项目消耗");
		expect(screen.getByText("累计花费")).toBeInTheDocument();
		expect(screen.queryByText("仅用于测试的能力明细")).not.toBeInTheDocument();
		expect(screen.queryByText("usage-row-only")).not.toBeInTheDocument();
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
		// 卡片标题旁的 Badge 展示历史成功生成数（替换了原「已选择 N 张」，封面浮层已移除）。
		expect(within(dialog).getByText("已生成 2 张")).toBeInTheDocument();
		expect(within(dialog).getByText("已生成 0 张")).toBeInTheDocument();
		expect(within(dialog).queryByText("已选择 1 张")).not.toBeInTheDocument();
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
		fireEvent.click(screen.getByText("确认批量设置"));

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
				batchId: expect.stringMatching(/^batch:/),
				kind: "image",
				projectId: "project-a",
				section: expect.objectContaining({
					blockId: "section_lintong",
					documentId: "characters",
					headingText: "林书彤",
				}),
				generationSettings: expect.objectContaining({
					params: { n: 2, ratio: "16:9" },
					route: expect.objectContaining({ id: "image-route" }),
				}),
			}),
			expect.objectContaining({
				batchId: expect.stringMatching(/^batch:/),
				kind: "image",
				projectId: "project-a",
				section: expect.objectContaining({
					blockId: "section_xulele",
					documentId: "characters",
					headingText: "徐乐乐",
				}),
				generationSettings: expect.objectContaining({
					params: { n: 2, ratio: "16:9" },
					route: expect.objectContaining({ id: "image-route" }),
				}),
			}),
		]);
		expect(useMediaGenerationStore.getState().activeRequest).toBeNull();

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
		expect(screen.getByText("分镜组 2 项 · 成片 1 个")).toBeInTheDocument();
		expect(await screen.findByText("分镜组 1 项 · 成片 0 个")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "第一章分镜脚本 成片资源" }));

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("成片资源 · 第一章分镜脚本")).toBeInTheDocument();
		expect(within(dialog).getByText("第 01 组 总时长：00:08")).toBeInTheDocument();
		expect(within(dialog).getByText("第 02 组 总时长：00:06")).toBeInTheDocument();
		expect(within(dialog).queryByText("分镜 01")).not.toBeInTheDocument();
		// 卡片标题旁的 Badge 展示历史成功生成数（替换了原「成片 N 个」）。
		expect(within(dialog).getByText("已生成 2 个")).toBeInTheDocument();
		expect(within(dialog).getByText("已生成 0 个")).toBeInTheDocument();
		expect(within(dialog).queryByText("苏醒镜头")).not.toBeInTheDocument();
		expect(within(dialog).queryByText("门外脚步成片")).not.toBeInTheDocument();
		expect(within(dialog).getAllByRole("button", { name: "生成视频" })).toHaveLength(2);

		// 点击成片封面用共享 VideoPlayer 打开视频预览，关闭后不影响后续断言。
		fireEvent.click(
			within(dialog).getByRole("button", { name: "预览 第 01 组 总时长：00:08 视频" }),
		);
		const videoPreview = await screen.findByTestId("video-preview");
		expect(videoPreview.getAttribute("src")).toContain(
			"/api/v1/media-assets/selected-video-1/content",
		);
		fireEvent.click(screen.getByLabelText("关闭预览"));
		await waitFor(() => expect(screen.queryByTestId("video-preview")).not.toBeInTheDocument());

		expect(within(dialog).getByRole("img", { name: "已选落水镜头" })).toHaveAttribute(
			"src",
			"/api/v1/media-assets/selected-video-1/poster",
		);
		expect(within(dialog).queryByText("已有成片")).not.toBeInTheDocument();
		expect(within(dialog).queryByTestId("overview-video-player")).not.toBeInTheDocument();

		fireEvent.click(within(dialog).getAllByRole("button", { name: "生成视频" })[0]);
		await waitFor(() => {
			expect(useMediaGenerationStore.getState().activeRequest).toMatchObject({
				kind: "video",
				projectId: "project-a",
				resolveLatestSection: false,
				statusResourceKey: "storyboard-a:section_reel_01",
				section: expect.objectContaining({
					blockId: "section_reel_01",
					documentId: "storyboard-a",
					headingLevel: 2,
					headingOccurrence: 1,
					headingText: "第 01 组 总时长：00:08",
					markdown: expect.stringContaining("沈阁从黑暗水面坠入湖中。"),
				}),
			});
		});

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: "第二章分镜脚本 成片资源" }));

		const secondDialog = await screen.findByRole("dialog");
		expect(within(secondDialog).getByText("成片资源 · 第二章分镜脚本")).toBeInTheDocument();
		expect(within(secondDialog).getByText("第 01 组 总时长：00:05")).toBeInTheDocument();
		expect(within(secondDialog).queryByText("门外脚步成片")).not.toBeInTheDocument();
		expect(
			within(secondDialog).queryByRole("img", { name: "门外脚步成片" }),
		).not.toBeInTheDocument();
		expect(within(secondDialog).getByText("暂无成片")).toBeInTheDocument();
		expect(within(secondDialog).queryByText("已有成片")).not.toBeInTheDocument();
		expect(within(secondDialog).queryByTestId("overview-video-player")).not.toBeInTheDocument();
	});

	it("shows storyboard clipping workbench tabs inside video resources", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter initialEntries={["/projects?projectId=project-a"]}>
					<Routes>
						<Route
							path="/projects"
							element={
								<>
									<ProjectOverview />
									<LocationProbe />
								</>
							}
						/>
					</Routes>
				</MemoryRouter>
			</SWRConfig>,
		);

		await screen.findByRole("button", { name: "第一章分镜脚本 成片资源" });
		fireEvent.click(screen.getByRole("button", { name: "第一章分镜脚本 成片资源" }));

		const dialog = await screen.findByRole("dialog");
		await waitFor(() => {
			expect(
				useDocumentsStore.getState().documents.some((document) => document.id === "storyboard-a"),
			).toBe(true);
		});
		// tab 常驻挂载(forceMount)后,画布/预览两个面板都在 DOM 里,只有激活的 data-state="active"。
		const activePanelView = () => {
			const panel = dialog.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
			if (!panel) throw new Error("no active tabpanel");
			return within(panel).getByTestId("episode-timeline-view");
		};

		const canvasTab = within(dialog).getByRole("tab", { name: "画布" });
		fireEvent.mouseDown(canvasTab, { button: 0 });
		fireEvent.click(canvasTab);

		await waitFor(() => {
			expect(activePanelView()).toHaveAttribute("data-workbench", "canvas");
		});
		expect(activePanelView()).toHaveAttribute("data-document-id", "storyboard-a");
		expect(screen.getByTestId("location")).toHaveTextContent("/projects?projectId=project-a");
		expect(screen.getByTestId("location")).toHaveAttribute("data-project-view", "");

		const previewTab = within(dialog).getByRole("tab", { name: "预览" });
		fireEvent.mouseDown(previewTab, { button: 0 });
		fireEvent.click(previewTab);

		await waitFor(() => {
			expect(activePanelView()).toHaveAttribute("data-workbench", "timeline");
		});
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
		fireEvent.click(screen.getByText("确认批量设置"));

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
				batchId: expect.stringMatching(/^batch:/),
				kind: "video",
				projectId: "project-a",
				resolveLatestSection: false,
				section: expect.objectContaining({
					blockId: "section_reel_01",
					documentId: "storyboard-a",
					headingText: "第 01 组 总时长：00:08",
				}),
				generationSettings: expect.objectContaining({
					params: { n: 2, ratio: "16:9" },
					route: expect.objectContaining({ id: "video-route" }),
				}),
			}),
			expect.objectContaining({
				batchId: expect.stringMatching(/^batch:/),
				kind: "video",
				projectId: "project-a",
				resolveLatestSection: false,
				section: expect.objectContaining({
					blockId: "section_reel_02",
					documentId: "storyboard-a",
					headingText: "第 02 组 总时长：00:06",
				}),
				generationSettings: expect.objectContaining({
					params: { n: 2, ratio: "16:9" },
					route: expect.objectContaining({ id: "video-route" }),
				}),
			}),
		]);
		expect(useMediaGenerationStore.getState().activeRequest).toBeNull();

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
	assets?: Array<Record<string, unknown>>;
	documentId: string;
	id: string;
	kind: "image" | "video";
	message: string;
	sectionId: string;
	status: string;
}) => ({
	assets: overrides.assets ?? [],
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
