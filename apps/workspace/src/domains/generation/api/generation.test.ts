import { beforeEach, describe, expect, it, vi } from "vitest";
import httpClient from "@/shared/lib/http";
import {
	agentGenerationConversationScopeId,
	getGenerationModels,
	getGenerationTasks,
	projectGenerationConversation,
	projectGenerationConversationId,
	retryGenerationTask,
	sendGenerationBatch,
	updateGenerationTaskAsset,
} from "@/domains/generation/api/generation";

vi.mock("@/shared/lib/http", () => ({
	default: {
		get: vi.fn(),
		patch: vi.fn(),
		post: vi.fn(),
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("sendGenerationBatch", () => {
	it("posts one ordered batch request without rewriting child requests", async () => {
		vi.mocked(httpClient.post).mockResolvedValue({
			code: 0,
			data: {
				id: "generation-batch-1",
				status: "submitted",
				total: 2,
				accepted: 2,
				failed: 0,
				items: [],
			},
			message: "ok",
			success: true,
		});
		const request = {
			projectId: "project-a",
			scopeId: "project-a",
			items: [
				{
					id: "scene-1",
					request: {
						kind: "image" as const,
						routeId: "route-image",
						modelId: "model-image",
						model: "image-model",
						prompt: "first",
						referenceUrls: [],
						referenceAssetIds: [],
						params: { ratio: "16:9" },
					},
				},
				{
					id: "scene-2",
					request: {
						kind: "image" as const,
						routeId: "route-image",
						modelId: "model-image",
						model: "image-model",
						prompt: "second",
						referenceUrls: [],
						referenceAssetIds: [],
						params: { ratio: "16:9" },
					},
				},
			],
		};

		await sendGenerationBatch(request);

		expect(httpClient.post).toHaveBeenCalledWith("/generation/batches", request, {
			timeout: 1_000_000,
		});
	});
});

describe("generation workbench HTTP boundaries", () => {
	it("keeps the HTTP model catalog used by generation settings", async () => {
		vi.mocked(httpClient.get).mockResolvedValue({
			code: 0,
			data: { routes: [] },
			message: "ok",
			success: true,
		});

		await getGenerationModels();

		expect(httpClient.get).toHaveBeenCalledWith("/generation/models");
	});

	it("keeps project task queries outside the Agent MCP", async () => {
		vi.mocked(httpClient.get).mockResolvedValue({
			code: 0,
			data: { tasks: [] },
			message: "ok",
			success: true,
		});

		await getGenerationTasks(undefined, "image", "studio", " project-a ");

		expect(httpClient.get).toHaveBeenCalledWith("/generation/tasks", {
			params: { kind: "image", projectId: "project-a" },
		});
	});

	it("keeps the HTTP retry wrapper even though no Agent MCP retry tool exists", async () => {
		vi.mocked(httpClient.post).mockResolvedValue({
			code: 0,
			data: { id: "task/1", status: "submitted" },
			message: "ok",
			success: true,
		});

		await retryGenerationTask("task/1");

		expect(httpClient.post).toHaveBeenCalledWith("/generation/tasks/task%2F1/retry", undefined, {
			timeout: 1_000_000,
		});
	});

	it("keeps task asset updates for workbench selection", async () => {
		vi.mocked(httpClient.patch).mockResolvedValue({
			code: 0,
			data: { id: "task-1", conversationId: "session-1", assets: [] },
			message: "ok",
			success: true,
		});

		await updateGenerationTaskAsset("task-1", 2, { selected: true });

		expect(httpClient.patch).toHaveBeenCalledWith("/generation/tasks/task-1/assets/2", {
			selected: true,
		});
	});
});

describe("projectGenerationConversationId", () => {
	it("joins trimmed project id and kind", () => {
		expect(projectGenerationConversationId(" proj-1 ", "image")).toBe("proj-1-image");
		expect(projectGenerationConversationId("proj-1", "video")).toBe("proj-1-video");
	});
});

describe("projectGenerationConversation", () => {
	it("returns undefined without a project id", () => {
		expect(projectGenerationConversation(undefined, "image")).toBeUndefined();
		expect(projectGenerationConversation(null, "image")).toBeUndefined();
		expect(projectGenerationConversation("   ", "image")).toBeUndefined();
	});

	it("builds the project-level named conversation for image", () => {
		expect(projectGenerationConversation("proj-1", "image", "我的项目")).toEqual({
			conversationId: "proj-1-image",
			conversationScopeId: agentGenerationConversationScopeId,
			conversationTitle: "我的项目 · 图片",
			historyScopeId: "proj-1-image",
		});
	});

	it("uses a kind-specific title and keeps image/video on separate conversation ids", () => {
		const image = projectGenerationConversation("proj-1", "image", "剧集 A");
		const video = projectGenerationConversation("proj-1", "video", "剧集 A");

		expect(image?.conversationTitle).toBe("剧集 A · 图片");
		expect(video?.conversationTitle).toBe("剧集 A · 视频");
		// 不同 kind 必须是不同的会话 id，避免后端 kind 校验冲突。
		expect(image?.conversationId).not.toBe(video?.conversationId);
	});

	it("falls back to a generic title and trims the project id", () => {
		expect(projectGenerationConversation(" proj-2 ", "video")).toEqual({
			conversationId: "proj-2-video",
			conversationScopeId: agentGenerationConversationScopeId,
			conversationTitle: "项目 · 视频",
			historyScopeId: "proj-2-video",
		});
	});

	it("allows a project conversation title label override", () => {
		expect(
			projectGenerationConversation("proj-3", "text", "剧集 B", {
				kindLabel: "提示词生成",
			}),
		).toEqual({
			conversationId: "proj-3-text",
			conversationScopeId: agentGenerationConversationScopeId,
			conversationTitle: "剧集 B · 提示词生成",
			historyScopeId: "proj-3-text",
		});
	});
});
