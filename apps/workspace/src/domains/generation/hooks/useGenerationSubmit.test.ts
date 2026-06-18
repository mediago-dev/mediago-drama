import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { useState } from "react";
import type { KeyedMutator } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetsResponse } from "@/domains/workspace/api/media";
import type {
	GenerationFamily,
	GenerationMessageResponse,
	GenerationRoute,
	GenerationTasksResponse,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import {
	createGenerationConversation,
	sendGenerationMessage,
	streamGenerationText,
} from "@/domains/generation/api/generation";
import type { ChatMessage, GenerationExtraValue } from "./useGenerationWorkspace.helpers";
import {
	type GenerationSubmitFailureEvent,
	type GenerationSubmitResponseEvent,
	type GenerationSubmitStartEvent,
	generationRequestPrompt,
	useGenerationSubmit,
} from "./useGenerationSubmit";

vi.mock("@/domains/generation/api/generation", () => ({
	createGenerationConversation: vi.fn(),
	generationConversationsQueryKey: (
		kind?: string,
		scopeId = "studio",
		options: { allScopes?: boolean } = {},
	): readonly [string, string, string] => [
		"/generation/conversations",
		options.allScopes ? "*" : scopeId,
		kind ?? "",
	],
	sendGenerationMessage: vi.fn(),
	streamGenerationText: vi.fn(),
}));

const imageFamily: GenerationFamily = {
	id: "family-image",
	label: "Image Family",
	kind: "image",
};

const imageVersion: GenerationVersion = {
	id: "version-image",
	familyId: imageFamily.id,
	label: "Image v1",
	kind: "image",
	canonicalModel: "image-model",
	capabilities: {
		async: false,
		supportsReferenceUrls: true,
	},
};

const imageRoute: GenerationRoute = {
	id: "route-image",
	familyId: imageFamily.id,
	versionId: imageVersion.id,
	label: "Image Route",
	kind: "image",
	provider: "openai",
	model: "image-model",
	adapter: "test.image",
	docUrl: "",
	async: false,
	supportsReferenceUrls: true,
	status: "available",
	configured: true,
	params: [],
};

const videoFamily: GenerationFamily = {
	id: "family-video",
	label: "Video Family",
	kind: "video",
};

const videoVersion: GenerationVersion = {
	id: "version-video",
	familyId: videoFamily.id,
	label: "Video v1",
	kind: "video",
	canonicalModel: "video-model",
	capabilities: {
		async: true,
		supportsReferenceUrls: true,
	},
};

const videoRoute: GenerationRoute = {
	id: "route-video",
	familyId: videoFamily.id,
	versionId: videoVersion.id,
	label: "Video Route",
	kind: "video",
	provider: "dmx",
	model: "video-model",
	adapter: "test.video",
	docUrl: "",
	async: true,
	supportsReferenceUrls: true,
	status: "available",
	configured: true,
	params: [],
};

const textFamily: GenerationFamily = {
	id: "family-text",
	label: "Text Family",
	kind: "text",
};

const textVersion: GenerationVersion = {
	id: "version-text",
	familyId: textFamily.id,
	label: "Text v1",
	kind: "text",
	canonicalModel: "text-model",
	capabilities: {
		async: false,
		supportsReferenceUrls: false,
	},
};

const textRoute: GenerationRoute = {
	id: "route-text",
	familyId: textFamily.id,
	versionId: textVersion.id,
	label: "Text Route",
	kind: "text",
	provider: "dmx",
	model: "text-model",
	adapter: "test.text",
	docUrl: "",
	async: false,
	supportsReferenceUrls: false,
	status: "available",
	configured: true,
	params: [],
};

const generationResponse = (overrides: Partial<GenerationMessageResponse> = {}) => ({
	id: "task-1",
	role: "assistant",
	status: "completed",
	message: "done",
	assets: [],
	usage: {
		inputTokens: 1,
		outputTokens: 1,
		totalTokens: 2,
		reasoningTokens: 0,
		cachedTokens: 0,
	},
	...overrides,
});

const renderSubmitHook = (
	options: {
		onSubmitError?: (message: string) => void;
		onSubmitFailure?: (event: GenerationSubmitFailureEvent) => void;
		onSubmitResponse?: (event: GenerationSubmitResponseEvent) => void;
		onSubmitStart?: (event: GenerationSubmitStartEvent) => void;
		onSubmitSuccess?: (kind: GenerationSubmitStartEvent["kind"]) => void;
		rememberSelectedModel?: () => void;
		conversationTitle?: string | null;
		extraPrompt?: GenerationExtraValue<string>;
		prompt?: string;
		promptRef?: React.MutableRefObject<string>;
		projectStylePrompt?: string;
		selectedFamily?: GenerationFamily;
		selectedRoute?: GenerationRoute;
		selectedVersion?: GenerationVersion;
		useRawPrompt?: boolean;
	} = {},
) => {
	const mutateMediaAssets = vi.fn(async () => ({
		assets: [],
	})) as unknown as KeyedMutator<MediaAssetsResponse>;
	const mutateProjectGenerationTasks = vi.fn();
	const mutateTasks = vi.fn(async () => ({
		tasks: [],
	})) as unknown as KeyedMutator<GenerationTasksResponse>;

	const result = renderHook(() => {
		const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
		const [error, setError] = useState<string | null>(null);
		const [messages, setMessages] = useState<ChatMessage[]>([]);
		const [prompt, setPrompt] = useState(options.prompt ?? "draw a cat");

		return {
			activeEntryId,
			error,
			messages,
			prompt,
			...useGenerationSubmit({
				conversationId: "session-1",
				conversationTitle: options.conversationTitle,
				effectiveReferenceAssetIds: ["asset-1"],
				effectiveReferenceUrls: ["https://example.test/reference.png"],
				extraPrompt: options.extraPrompt ?? "",
				isLoadingProjectBrief: false,
				mediaAssetProjectId: "project-1",
				mediaAssets: [
					{
						id: "asset-1",
						kind: "image",
						filename: "reference.png",
						mimeType: "image/png",
						sizeBytes: 100,
						url: "/media/reference.png",
						projectId: "project-1",
						createdAt: "2026-06-04T00:00:00.000Z",
						updatedAt: "2026-06-04T00:00:00.000Z",
					},
				],
				mutateMediaAssets,
				mutateProjectGenerationTasks,
				mutateTasks,
				onSubmitError: options.onSubmitError,
				onSubmitFailure: options.onSubmitFailure,
				onSubmitResponse: options.onSubmitResponse,
				onSubmitStart: options.onSubmitStart,
				onSubmitSuccess: options.onSubmitSuccess,
				rememberSelectedModel: options.rememberSelectedModel,
				projectId: "project-1",
				projectStylePrompt: options.projectStylePrompt,
				prompt,
				promptRef: options.promptRef,
				resolvedConversationScopeId: "scope-1",
				selectedFamily: options.selectedFamily ?? imageFamily,
				selectedParams: {
					size: "1024x1024",
				},
				selectedRoute: options.selectedRoute ?? imageRoute,
				selectedVersion: options.selectedVersion ?? imageVersion,
				setActiveEntryId,
				setError,
				setMessages,
				setPrompt,
				useRawPrompt: options.useRawPrompt,
			}),
		};
	});

	return {
		...result,
		mutateMediaAssets,
		mutateProjectGenerationTasks,
		mutateTasks,
	};
};

describe("useGenerationSubmit", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("builds the full visual prompt with extra context and style layers", () => {
		const prompt = generationRequestPrompt({
			extraPrompt: "引用资料：角色设定",
			kind: "image",
			projectStylePrompt: "电影感光影\n冷色调",
			prompt: "生成角色设定图",
		});

		expect(prompt).toContain("生成角色设定图");
		expect(prompt).toContain("引用资料：角色设定");
		expect(prompt).toContain("项目视觉风格：");
		expect(prompt).toContain("电影感光影\n冷色调");
		expect(prompt).toContain("本次图片/视频生成必须遵循这个风格。");
	});

	it("can bypass prompt enrichment and keep the prompt unchanged", () => {
		const prompt = generationRequestPrompt({
			extraPrompt: "引用资料：角色设定",
			kind: "image",
			projectStylePrompt: "电影感光影",
			prompt: "  生成角色设定图\n",
			useRawPrompt: true,
		});

		expect(prompt).toBe("  生成角色设定图\n");
	});

	it("submits image generations and replaces optimistic messages with the response", async () => {
		const response = generationResponse({
			assets: [
				{
					kind: "image",
					url: "http://127.0.0.1:48273/api/v1/media-assets/generated/content",
				},
			],
		});
		vi.mocked(sendGenerationMessage).mockResolvedValue(response);
		const onSubmitStart = vi.fn();
		const onSubmitResponse = vi.fn();
		const onSubmitSuccess = vi.fn();
		const rememberSelectedModel = vi.fn();
		const { mutateMediaAssets, mutateProjectGenerationTasks, mutateTasks, result } =
			renderSubmitHook({
				onSubmitResponse,
				onSubmitStart,
				onSubmitSuccess,
				rememberSelectedModel,
			});

		await act(async () => {
			await result.current.submitGeneration();
		});

		expect(sendGenerationMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "session-1",
				familyId: imageFamily.id,
				kind: "image",
				model: "image-model",
				params: { size: "1024x1024" },
				projectId: "project-1",
				prompt: "draw a cat",
				referenceAssetIds: ["asset-1"],
				referenceUrls: ["https://example.test/reference.png"],
				routeId: imageRoute.id,
				scopeId: "scope-1",
				versionId: imageVersion.id,
			}),
		);
		expect(result.current.prompt).toBe("");
		expect(result.current.error).toBeNull();
		expect(result.current.activeEntryId).toBe(response.id);
		expect(result.current.messages).toEqual([
			expect.objectContaining({
				id: "task-1:prompt",
				role: "user",
				content: "draw a cat",
				assets: [
					{ kind: "image", url: "https://example.test/reference.png" },
					{ kind: "image", url: "/media/reference.png", mimeType: "image/png" },
				],
			}),
			expect.objectContaining({
				id: "task-1",
				role: "assistant",
				status: "completed",
				content: "done",
				assets: response.assets,
				details: expect.arrayContaining([
					expect.objectContaining({ label: "生成耗时" }),
					expect.objectContaining({ label: "生成时间" }),
				]),
			}),
		]);
		expect(onSubmitStart).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "image", prompt: "draw a cat" }),
		);
		expect(onSubmitResponse).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "image", response }),
		);
		expect(onSubmitSuccess).toHaveBeenCalledWith("image");
		expect(rememberSelectedModel).toHaveBeenCalledTimes(1);
		expect(mutateTasks).toHaveBeenCalledTimes(1);
		expect(mutateProjectGenerationTasks).toHaveBeenCalledWith("image");
		expect(mutateMediaAssets).toHaveBeenCalledTimes(1);
	});

	it("submits the raw prompt without resolving extra prompt or style layers", async () => {
		vi.mocked(sendGenerationMessage).mockResolvedValue(generationResponse());
		const extraPrompt = vi.fn(() => "引用资料：不应附加");
		const { result } = renderSubmitHook({
			extraPrompt,
			projectStylePrompt: "项目视觉风格不应附加",
			prompt: "  draw a cat\nwith props  ",
			useRawPrompt: true,
		});

		await act(async () => {
			await result.current.submitGeneration();
		});

		expect(extraPrompt).not.toHaveBeenCalled();
		expect(sendGenerationMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "  draw a cat\nwith props  ",
			}),
		);
		expect(result.current.messages).toEqual([
			expect.objectContaining({
				id: "task-1:prompt",
				content: "  draw a cat\nwith props  ",
			}),
			expect.objectContaining({
				id: "task-1",
			}),
		]);
	});

	it("uses the latest prompt ref when the rendered prompt state is stale", async () => {
		vi.mocked(sendGenerationMessage).mockResolvedValue(generationResponse());
		const promptRef = { current: "fresh prompt from editor blur" };
		const { result } = renderSubmitHook({
			prompt: "stale rendered prompt",
			promptRef,
		});

		await act(async () => {
			await result.current.submitGeneration();
		});

		expect(sendGenerationMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "fresh prompt from editor blur",
			}),
		);
		expect(result.current.messages).toEqual([
			expect.objectContaining({
				id: "task-1:prompt",
				content: "fresh prompt from editor blur",
			}),
			expect.objectContaining({
				id: "task-1",
			}),
		]);
	});

	it("ensures a named conversation before submitting", async () => {
		vi.mocked(sendGenerationMessage).mockResolvedValue(generationResponse());
		const { result } = renderSubmitHook({
			conversationTitle: "Project Alpha",
		});

		await act(async () => {
			await result.current.submitGeneration();
		});

		expect(createGenerationConversation).toHaveBeenCalledWith({
			id: "session-1",
			kind: "image",
			scopeId: "scope-1",
			title: "Project Alpha",
		});
	});

	it("remembers video model selections when submitting video generations", async () => {
		vi.mocked(sendGenerationMessage).mockResolvedValue(generationResponse());
		const rememberSelectedModel = vi.fn();
		const { result } = renderSubmitHook({
			prompt: "make a clip",
			rememberSelectedModel,
			selectedFamily: videoFamily,
			selectedRoute: videoRoute,
			selectedVersion: videoVersion,
		});

		await act(async () => {
			await result.current.submitGeneration();
		});

		expect(sendGenerationMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "video",
				model: "video-model",
				routeId: videoRoute.id,
				versionId: videoVersion.id,
			}),
		);
		expect(rememberSelectedModel).toHaveBeenCalledTimes(1);
	});

	it("turns failed requests into error messages and failure callbacks", async () => {
		vi.mocked(sendGenerationMessage).mockRejectedValue(new Error("network down"));
		const onSubmitError = vi.fn();
		const onSubmitFailure = vi.fn();
		const onSubmitSuccess = vi.fn();
		const { mutateMediaAssets, mutateProjectGenerationTasks, mutateTasks, result } =
			renderSubmitHook({
				onSubmitError,
				onSubmitFailure,
				onSubmitSuccess,
				prompt: "draw failure",
			});

		await act(async () => {
			await result.current.submitGeneration();
		});

		expect(result.current.prompt).toBe("");
		expect(result.current.error).toBe("network down");
		expect(result.current.messages).toEqual([
			expect.objectContaining({
				role: "user",
				content: "draw failure",
			}),
			expect.objectContaining({
				role: "assistant",
				status: "error",
				content: "network down",
				details: expect.arrayContaining([
					expect.objectContaining({ label: "生成耗时" }),
					expect.objectContaining({ label: "生成时间" }),
				]),
			}),
		]);
		expect(result.current.activeEntryId).toContain(":error");
		expect(onSubmitError).toHaveBeenCalledWith("network down");
		expect(onSubmitFailure).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "image", message: "network down" }),
		);
		expect(onSubmitSuccess).not.toHaveBeenCalled();
		expect(mutateTasks).toHaveBeenCalledTimes(1);
		expect(mutateProjectGenerationTasks).toHaveBeenCalledWith("image");
		expect(mutateMediaAssets).not.toHaveBeenCalled();
	});

	it("keeps the task id when a streamed text request fails after start", async () => {
		vi.mocked(streamGenerationText).mockImplementation(async (_request, handlers) => {
			handlers?.onStart?.({
				type: "start",
				taskId: "task-text",
				conversationId: "session-1",
				status: "running",
				message: generationResponse({
					id: "task-text",
					status: "running",
					message: "文本生成中...",
				}),
			});
			handlers?.onError?.("provider failed", {
				type: "error",
				taskId: "task-text",
				status: "failed",
				error: "provider failed",
			});
			throw new Error("provider failed");
		});
		const rememberSelectedModel = vi.fn();
		const { mutateProjectGenerationTasks, mutateTasks, result } = renderSubmitHook({
			rememberSelectedModel,
			prompt: "write text",
			selectedFamily: textFamily,
			selectedRoute: textRoute,
			selectedVersion: textVersion,
		});

		await act(async () => {
			await result.current.submitGeneration();
		});

		expect(streamGenerationText).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "text",
				prompt: "write text",
				routeId: textRoute.id,
			}),
			expect.any(Object),
		);
		expect(result.current.error).toBe("provider failed");
		expect(result.current.activeEntryId).toBe("task-text");
		expect(result.current.messages).toEqual([
			expect.objectContaining({
				id: "task-text:prompt",
				role: "user",
				content: "write text",
			}),
			expect.objectContaining({
				id: "task-text",
				role: "assistant",
				status: "error",
				content: "provider failed",
			}),
		]);
		expect(mutateTasks).toHaveBeenCalledTimes(1);
		expect(mutateProjectGenerationTasks).toHaveBeenCalledWith("text");
		expect(rememberSelectedModel).not.toHaveBeenCalled();
	});
});
