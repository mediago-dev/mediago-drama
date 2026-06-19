import {
	cleanup,
	fireEvent,
	render as testingRender,
	screen,
	waitFor,
} from "@testing-library/react";
import type React from "react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilitiesKey, type CapabilityRecord } from "@/domains/capabilities/api/capabilities";
import {
	createGenerationConversation,
	getGenerationConversations,
} from "@/domains/generation/api/generation";
import { GenerationConversationCreateDialog } from "@/domains/workspace/components/GenerationConversationCreateDialog";
import {
	StudioSessionsScreen,
	StudioTypesScreen,
} from "@/domains/workspace/components/ProjectNavigatorPanels";

vi.mock("@/domains/generation/api/generation", () => ({
	createGenerationConversation: vi.fn(),
	deleteGenerationConversation: vi.fn(),
	generationConversationsQueryKey: (kind?: string, scopeId = "studio") => [
		"/generation/sessions",
		scopeId,
		kind ?? "",
	],
	getGenerationConversations: vi.fn(),
}));

const render = (ui: React.ReactElement) =>
	testingRender(
		<>
			{ui}
			<GenerationConversationCreateDialog />
		</>,
	);

describe("Studio sidebar screens", () => {
	afterEach(() => {
		vi.clearAllMocks();
		cleanup();
	});

	it("does not render disabled understanding studio tools", () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), revalidateOnMount: false }}>
				<StudioTypesScreen
					activeCapabilityId={null}
					activeTab={null}
					onOpenSettings={vi.fn()}
					onSelectTab={vi.fn()}
				/>
			</SWRConfig>,
		);

		expect(screen.queryByText("理解")).toBeNull();
		expect(screen.queryByText("小说切片")).toBeNull();
		expect(screen.queryByText("视频切片")).toBeNull();
		expect(screen.queryByText("小说理解")).toBeNull();
		expect(screen.queryByText("视频理解")).toBeNull();
		expect(screen.queryByText("音频转录")).toBeNull();
		expect(screen.queryByText("Coming soon")).toBeNull();
		expect(screen.queryByLabelText("工作模式")).toBeNull();
	});

	it("keeps generation tools clickable when routes are not configured", () => {
		const onSelectTab = vi.fn();
		render(
			<SWRConfig
				value={{
					provider: () => new Map(),
					fallback: {
						[capabilitiesKey]: {
							capabilities: [
								capability("video.generate", "视频生成", "video"),
								capability("image.generate", "图片生成", "image"),
								capability("text.generate", "文本生成", "text"),
							],
						},
					},
				}}
			>
				<StudioTypesScreen
					activeCapabilityId={null}
					activeTab={null}
					onOpenSettings={vi.fn()}
					onSelectTab={onSelectTab}
				/>
			</SWRConfig>,
		);

		for (const [label, tab] of [
			["视频生成", "video"],
			["图片生成", "image"],
			["文本生成", "text"],
		] as const) {
			const button = screen.getByText(label).closest("button");
			expect(button?.disabled).toBe(false);
			fireEvent.click(button as HTMLButtonElement);
			expect(onSelectTab).toHaveBeenLastCalledWith(tab);
		}
	});
});

describe("StudioSessionsScreen", () => {
	afterEach(() => {
		vi.clearAllMocks();
		cleanup();
	});

	it("renders generation conversations under video, image, and text groups", async () => {
		vi.mocked(getGenerationConversations).mockImplementation(async (kind) => {
			const conversationKind = kind ?? "image";
			return {
				conversations: [
					generationConversation(`${conversationKind}-1`, conversationKind, `${kind} 会话`),
					...(conversationKind === "image"
						? [generationConversation("project-image", "image", "项目图片会话", "agent")]
						: []),
				],
			};
		});
		const onSelectConversation = vi.fn();

		render(
			<SWRConfig value={{ provider: () => new Map() }}>
				<StudioSessionsScreen
					activeConversationId="image-1"
					activeTab="image"
					onOpenSettings={vi.fn()}
					onSelectConversation={onSelectConversation}
				/>
			</SWRConfig>,
		);

		await waitFor(() => expect(screen.getByText("video 会话")).toBeTruthy());
		expect(getGenerationConversations).toHaveBeenCalledWith("video", "studio", {
			allScopes: true,
		});
		expect(getGenerationConversations).toHaveBeenCalledWith("image", "studio", {
			allScopes: true,
		});
		expect(getGenerationConversations).toHaveBeenCalledWith("text", "studio", {
			allScopes: true,
		});
		expect(screen.getByText("项目图片会话")).toBeTruthy();
		expect(screen.queryByLabelText("工作模式")).toBeNull();

		fireEvent.click(screen.getByText("video 会话"));

		expect(onSelectConversation).toHaveBeenCalledWith("video", "video-1");
	});

	it("creates a conversation from the sidebar new button", async () => {
		vi.mocked(getGenerationConversations).mockResolvedValue({ conversations: [] });
		vi.mocked(createGenerationConversation).mockResolvedValue(
			generationConversation("text-new", "text", "文本草稿"),
		);
		const onSelectConversation = vi.fn();

		render(
			<SWRConfig value={{ provider: () => new Map() }}>
				<StudioSessionsScreen
					activeConversationId=""
					activeTab="text"
					onOpenSettings={vi.fn()}
					onSelectConversation={onSelectConversation}
				/>
			</SWRConfig>,
		);

		fireEvent.click(screen.getByRole("button", { name: "新建" }));
		fireEvent.change(screen.getByLabelText("会话名称"), { target: { value: "文本草稿" } });
		fireEvent.click(screen.getByRole("button", { name: "创建" }));

		await waitFor(() =>
			expect(createGenerationConversation).toHaveBeenCalledWith({
				kind: "text",
				scopeId: "studio",
				title: "文本草稿",
			}),
		);
		expect(onSelectConversation).toHaveBeenCalledWith("text", "text-new");
	});
});

const capability = (
	id: string,
	name: string,
	kind: "image" | "video" | "text",
): CapabilityRecord => ({
	available: false,
	category: "generation",
	description: name,
	icon: kind === "image" ? "Image" : kind === "video" ? "Film" : "FileText",
	id,
	inputs: ["text"],
	kind,
	name,
	outputs: [kind],
	relatedRoutes: [`${kind}.route`],
	status: "available",
	surface: "generation",
});

const generationConversation = (id: string, kind: string, title: string, scopeId = "studio") => ({
	id,
	sessionId: id,
	scopeId,
	kind: kind as "image" | "video" | "text",
	title,
	taskCount: 0,
	createdAt: "2026-06-06T11:00:00Z",
	updatedAt: "2026-06-06T11:00:00Z",
});
