import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createGenerationConversation,
	getGenerationConversations,
} from "@/domains/generation/api/generation";
import { GenerationConversationCreateDialog } from "./GenerationConversationCreateDialog";
import { GlobalToolboxButton } from "./GlobalToolboxDrawer";

vi.mock("@/domains/generation/api/generation", () => ({
	createGenerationConversation: vi.fn(),
	generationConversationsQueryKey: (
		kind?: string,
		scopeId = "studio",
		options: { allScopes?: boolean } = {},
	) => ["/generation/sessions", options.allScopes ? "*" : scopeId, kind ?? ""],
	getGenerationConversations: vi.fn(),
	projectGenerationConversation: (projectId: string | undefined, kind: string) =>
		projectId?.trim()
			? {
					conversationId: `${projectId.trim()}-${kind}`,
					conversationScopeId: "agent",
					conversationTitle: `项目 · ${kind === "image" ? "图片" : "视频"}`,
					historyScopeId: `${projectId.trim()}-${kind}`,
				}
			: undefined,
}));

vi.mock("@/domains/generation/components/GenerationWorkspace", () => ({
	GenerationWorkspace: (props: {
		conversationId?: string | null;
		conversationScopeId?: string | null;
		conversationTitle?: string | null;
		initialKind?: string;
		onOpenSettings?: () => void;
	}) => (
		<div
			data-testid="global-generation-workspace"
			data-conversation-id={props.conversationId ?? ""}
			data-kind={props.initialKind ?? ""}
			data-scope-id={props.conversationScopeId ?? ""}
		>
			{props.conversationTitle}
			<button type="button" onClick={props.onOpenSettings}>
				打开供应商设置
			</button>
		</div>
	),
}));

describe("GlobalToolboxButton", () => {
	afterEach(() => {
		vi.clearAllMocks();
		cleanup();
	});

	it("opens a global drawer and can select project-scoped generation conversations", async () => {
		vi.mocked(getGenerationConversations).mockImplementation(async (kind) => ({
			conversations:
				kind === "image"
					? [
							generationConversation(
								"project-image",
								"image",
								"项目图片会话",
								"agent",
								"2026-06-06T13:00:00Z",
							),
						]
					: kind === "video"
						? [
								generationConversation(
									"video-one",
									"video",
									"视频会话",
									"studio",
									"2026-06-06T12:00:00Z",
								),
							]
						: [],
		}));

		renderGlobalToolboxButton();

		fireEvent.click(screen.getByRole("button", { name: "打开生成历史" }));

		await waitFor(() =>
			expect(getGenerationConversations).toHaveBeenCalledWith("image", "studio", {
				allScopes: true,
			}),
		);
		expect(screen.getByRole("dialog", { name: "生成历史" })).toBeTruthy();
		expect(screen.getAllByText("项目图片会话").length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole("button", { name: "历史会话" }));
		expect(screen.getByText("选择任一会话恢复当前生成上下文。")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "项目图片会话" }));

		const workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "project-image");
		expect(workspace).toHaveAttribute("data-kind", "image");
		expect(workspace).toHaveAttribute("data-scope-id", "agent");
	});

	it("opens the same drawer from an inline generation history button", async () => {
		vi.mocked(getGenerationConversations).mockResolvedValue({ conversations: [] });

		renderGlobalToolboxButton("inline");

		fireEvent.click(screen.getByRole("button", { name: "生成历史" }));

		expect(await screen.findByRole("dialog", { name: "生成历史" })).toBeTruthy();
	});

	it("filters inline generation history to the requested kind", async () => {
		vi.mocked(getGenerationConversations).mockImplementation(async (kind) => ({
			conversations:
				kind === "video"
					? [
							generationConversation(
								"video-one",
								"video",
								"视频会话",
								"studio",
								"2026-06-06T12:00:00Z",
							),
						]
					: [],
		}));

		renderGlobalToolboxButton("inline", "video");

		fireEvent.click(screen.getByRole("button", { name: "生成历史" }));

		await waitFor(() =>
			expect(getGenerationConversations).toHaveBeenCalledWith("video", "studio", {
				allScopes: true,
			}),
		);
		expect(getGenerationConversations).not.toHaveBeenCalledWith("image", "studio", {
			allScopes: true,
		});
		expect(getGenerationConversations).not.toHaveBeenCalledWith("text", "studio", {
			allScopes: true,
		});
		expect(getGenerationConversations).not.toHaveBeenCalledWith("audio", "studio", {
			allScopes: true,
		});
		const workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "video-one");
		expect(workspace).toHaveAttribute("data-kind", "video");

		fireEvent.click(screen.getByRole("button", { name: "历史会话" }));
		expect(screen.getByText("视频生成")).toBeTruthy();
		expect(screen.queryByText("图片生成")).not.toBeInTheDocument();
		expect(screen.queryByText("文本生成")).not.toBeInTheDocument();
		expect(screen.queryByText("音频生成")).not.toBeInTheDocument();
	});

	it("opens the current project's matching history instead of a newer project conversation", async () => {
		vi.mocked(getGenerationConversations).mockImplementation(async (kind) => ({
			conversations:
				kind === "image"
					? [
							generationConversation(
								"other-project-image",
								"image",
								"其他项目 · 图片",
								"agent",
								"2026-06-06T14:00:00Z",
							),
							generationConversation(
								"current-project-image",
								"image",
								"当前项目 · 图片",
								"agent",
								"2026-06-06T12:00:00Z",
							),
						]
					: [],
		}));

		renderGlobalToolboxButton("inline", "image", "current-project");
		fireEvent.click(screen.getByRole("button", { name: "生成历史" }));

		const workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "current-project-image");
		expect(workspace).toHaveAttribute("data-kind", "image");
		expect(workspace).toHaveTextContent("当前项目 · 图片");
	});

	it("opens the current project's video history from a video generation dialog", async () => {
		vi.mocked(getGenerationConversations).mockImplementation(async (kind) => ({
			conversations:
				kind === "video"
					? [
							generationConversation(
								"other-project-video",
								"video",
								"其他项目 · 视频",
								"agent",
								"2026-06-06T14:00:00Z",
							),
							generationConversation(
								"current-project-video",
								"video",
								"当前项目 · 视频",
								"agent",
								"2026-06-06T12:00:00Z",
							),
						]
					: [],
		}));

		renderGlobalToolboxButton("inline", "video", "current-project");
		fireEvent.click(screen.getByRole("button", { name: "生成历史" }));

		const workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "current-project-video");
		expect(workspace).toHaveAttribute("data-kind", "video");
		expect(workspace).toHaveTextContent("当前项目 · 视频");
	});

	it("waits for every toolbox kind before auto-selecting the latest conversation", async () => {
		const imageConversations = deferred<{
			conversations: Array<ReturnType<typeof generationConversation>>;
		}>();
		vi.mocked(getGenerationConversations).mockImplementation((kind) => {
			if (kind === "video") {
				return Promise.resolve({
					conversations: [
						generationConversation(
							"video-old",
							"video",
							"未命名会话",
							"studio",
							"2026-06-06T12:00:00Z",
						),
					],
				});
			}
			if (kind === "image") return imageConversations.promise;
			return Promise.resolve({ conversations: [] });
		});

		renderGlobalToolboxButton();

		fireEvent.click(screen.getByRole("button", { name: "打开生成历史" }));

		await waitFor(() =>
			expect(getGenerationConversations).toHaveBeenCalledWith("video", "studio", {
				allScopes: true,
			}),
		);
		expect(screen.queryByTestId("global-generation-workspace")).not.toBeInTheDocument();
		expect(screen.getByText("从历史会话选择或新建会话。")).toBeTruthy();

		imageConversations.resolve({
			conversations: [
				generationConversation(
					"project-image",
					"image",
					"测试 · 图片",
					"agent",
					"2026-06-06T13:00:00Z",
				),
			],
		});

		const workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "project-image");
		expect(workspace).toHaveAttribute("data-kind", "image");
		expect(workspace).toHaveTextContent("测试 · 图片");
	});

	it("auto-selects the latest conversation again after reopening", async () => {
		vi.mocked(getGenerationConversations).mockImplementation(async (kind) => ({
			conversations:
				kind === "image"
					? [
							generationConversation(
								"project-image",
								"image",
								"测试 · 图片",
								"agent",
								"2026-06-06T13:00:00Z",
							),
						]
					: kind === "video"
						? [
								generationConversation(
									"video-old",
									"video",
									"未命名会话",
									"studio",
									"2026-06-06T12:00:00Z",
								),
							]
						: [],
		}));

		renderGlobalToolboxButton();

		fireEvent.click(screen.getByRole("button", { name: "打开生成历史" }));
		let workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "project-image");

		fireEvent.click(screen.getByRole("button", { name: "历史会话" }));
		fireEvent.click(await screen.findByRole("button", { name: "未命名会话" }));
		workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "video-old");

		fireEvent.click(screen.getByRole("button", { name: "关闭生成历史" }));
		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: "生成历史" })).not.toBeInTheDocument(),
		);

		fireEvent.click(screen.getByRole("button", { name: "打开生成历史" }));
		workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "project-image");
		expect(workspace).toHaveTextContent("测试 · 图片");
	});

	it("creates a studio conversation from the drawer", async () => {
		vi.mocked(getGenerationConversations).mockImplementation(async (kind) => ({
			conversations:
				kind === "video"
					? [
							generationConversation(
								"video-old",
								"video",
								"旧视频会话",
								"studio",
								"2026-06-06T10:00:00Z",
							),
						]
					: [],
		}));
		vi.mocked(createGenerationConversation).mockResolvedValue(
			generationConversation("video-new", "video", "视频草稿", "studio", "2026-06-06T13:00:00Z"),
		);

		renderGlobalToolboxButton();

		fireEvent.click(screen.getByRole("button", { name: "打开生成历史" }));
		fireEvent.click(await screen.findByRole("button", { name: "新建会话" }));
		fireEvent.change(screen.getByLabelText("会话名称"), { target: { value: "视频草稿" } });
		fireEvent.click(screen.getByRole("button", { name: "创建" }));

		await waitFor(() =>
			expect(createGenerationConversation).toHaveBeenCalledWith({
				kind: "video",
				scopeId: "studio",
				title: "视频草稿",
			}),
		);
		const workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "video-new");
		expect(workspace).toHaveAttribute("data-kind", "video");
		expect(workspace).toHaveAttribute("data-scope-id", "studio");

		fireEvent.click(screen.getByRole("button", { name: "历史会话" }));
		expect(await screen.findByRole("button", { name: "视频草稿" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "旧视频会话" })).toBeTruthy();
	});

	it("closes the drawer when the embedded workspace opens provider settings", async () => {
		vi.mocked(getGenerationConversations).mockImplementation(async (kind) => ({
			conversations:
				kind === "audio"
					? [
							generationConversation(
								"audio-one",
								"audio",
								"音频会话",
								"studio",
								"2026-06-06T14:00:00Z",
							),
						]
					: [],
		}));

		renderGlobalToolboxButton();

		fireEvent.click(screen.getByRole("button", { name: "打开生成历史" }));
		expect(await screen.findByRole("dialog", { name: "生成历史" })).toBeTruthy();
		fireEvent.click(await screen.findByRole("button", { name: "打开供应商设置" }));

		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: "生成历史" })).not.toBeInTheDocument(),
		);
	});
});

const renderGlobalToolboxButton = (
	variant: "icon" | "inline" = "icon",
	kind?: "image" | "video" | "text" | "audio",
	projectId?: string,
) =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<GlobalToolboxButton kind={kind} projectId={projectId} variant={variant} />
			<GenerationConversationCreateDialog />
		</SWRConfig>,
	);

const generationConversation = (
	id: string,
	kind: "image" | "video" | "text" | "audio",
	title: string,
	scopeId = "studio",
	updatedAt = "2026-06-06T11:00:00Z",
) => ({
	createdAt: "2026-06-06T11:00:00Z",
	id,
	kind,
	scopeId,
	sessionId: id,
	taskCount: 0,
	title,
	updatedAt,
});

const deferred = <T,>() => {
	let resolve: (value: T) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, reject, resolve };
};
