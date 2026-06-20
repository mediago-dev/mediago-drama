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

		fireEvent.click(screen.getByRole("button", { name: "打开工具箱" }));

		await waitFor(() =>
			expect(getGenerationConversations).toHaveBeenCalledWith("image", "studio", {
				allScopes: true,
			}),
		);
		expect(screen.getByRole("dialog", { name: "工具箱" })).toBeTruthy();
		expect(screen.getAllByText("项目图片会话").length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole("button", { name: "历史会话" }));
		expect(screen.getByText("选择任一会话恢复当前生成上下文。")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "项目图片会话" }));

		const workspace = await screen.findByTestId("global-generation-workspace");
		expect(workspace).toHaveAttribute("data-conversation-id", "project-image");
		expect(workspace).toHaveAttribute("data-kind", "image");
		expect(workspace).toHaveAttribute("data-scope-id", "agent");
	});

	it("creates a studio conversation from the drawer", async () => {
		vi.mocked(getGenerationConversations).mockResolvedValue({ conversations: [] });
		vi.mocked(createGenerationConversation).mockResolvedValue(
			generationConversation("video-new", "video", "视频草稿"),
		);

		renderGlobalToolboxButton();

		fireEvent.click(screen.getByRole("button", { name: "打开工具箱" }));
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

		fireEvent.click(screen.getByRole("button", { name: "打开工具箱" }));
		expect(await screen.findByRole("dialog", { name: "工具箱" })).toBeTruthy();
		fireEvent.click(await screen.findByRole("button", { name: "打开供应商设置" }));

		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: "工具箱" })).not.toBeInTheDocument(),
		);
	});
});

const renderGlobalToolboxButton = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<GlobalToolboxButton />
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
