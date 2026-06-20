import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenerationChatPanel } from "./GenerationChatPanel";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

vi.mock("@/components/AudioPlayer", () => ({
	AudioPlayer: ({ mimeType, src }: { mimeType?: string; src: string }) => (
		<div data-testid="audio-player" data-mime-type={mimeType} data-src={src} />
	),
}));

describe("GenerationChatPanel", () => {
	it("shows a loading label for empty streaming text results", () => {
		HTMLElement.prototype.scrollTo = vi.fn();
		const entries: GenerationEntry[] = [
			{
				id: "task-text",
				kind: "text",
				status: "streaming",
				content: "",
				prompt: "你好",
				assistantMessage: {
					id: "task-text",
					role: "assistant",
					kind: "text",
					status: "streaming",
					content: "",
				},
			},
		];

		render(
			<GenerationChatPanel entries={entries} onRefreshVideo={vi.fn()} onSelectEntry={vi.fn()} />,
		);

		expect(screen.getByText("文本生成中...")).toBeTruthy();
	});

	it("collapses long user prompts consistently across generation kinds", () => {
		HTMLElement.prototype.scrollTo = vi.fn();
		const longPrompt = [
			"时间位置：00:00 - 00:15",
			"目标时长：15 秒",
			"画幅比例：16:9",
			"要求：作为当前组的视频素材，动作连续，构图稳定，避免文字水印。",
			"项目视觉风格：写真风格，质感光照，自然光线，质感十足。",
		].join("\n");
		const entries: GenerationEntry[] = [
			{
				id: "task-image",
				kind: "image",
				status: "completed",
				content: "",
				prompt: longPrompt,
			},
			{
				id: "task-video",
				kind: "video",
				status: "completed",
				content: "",
				prompt: longPrompt,
			},
			{
				id: "task-text",
				kind: "text",
				status: "completed",
				content: "生成结果",
				prompt: longPrompt,
			},
		];

		render(
			<GenerationChatPanel entries={entries} onRefreshVideo={vi.fn()} onSelectEntry={vi.fn()} />,
		);

		const expandButtons = screen.getAllByRole("button", { name: "展开 Prompt" });
		expect(expandButtons).toHaveLength(3);
		expect(expandButtons[0]?.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(expandButtons[0]);

		expect(screen.getByRole("button", { name: "收起 Prompt" }).getAttribute("aria-expanded")).toBe(
			"true",
		);
	});

	it("copies the prompt through the provided action", () => {
		HTMLElement.prototype.scrollTo = vi.fn();
		const onCopyPrompt = vi.fn();
		const entries: GenerationEntry[] = [
			{
				id: "task-image",
				kind: "image",
				status: "completed",
				content: "",
				prompt: "生成一张城市夜景",
			},
		];

		render(
			<GenerationChatPanel
				entries={entries}
				onCopyPrompt={onCopyPrompt}
				onRefreshVideo={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "复制 Prompt" }));

		expect(onCopyPrompt).toHaveBeenCalledWith(entries[0]);
	});

	it("saves text results when project save is available", () => {
		HTMLElement.prototype.scrollTo = vi.fn();
		const onSaveText = vi.fn();
		const entries: GenerationEntry[] = [
			{
				id: "task-text",
				kind: "text",
				status: "completed",
				content: "生成结果",
				prompt: "写一段旁白",
			},
		];

		render(
			<GenerationChatPanel
				canSaveText
				entries={entries}
				onRefreshVideo={vi.fn()}
				onSaveText={onSaveText}
				onSelectEntry={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "保存素材" }));

		expect(onSaveText).toHaveBeenCalledWith(entries[0]);
	});

	it("renders generated audio assets with the shared audio player", () => {
		HTMLElement.prototype.scrollTo = vi.fn();
		const entries: GenerationEntry[] = [
			{
				id: "task-audio",
				kind: "audio",
				status: "completed",
				content: "",
				prompt: "生成一句旁白",
				assets: [
					{
						kind: "audio",
						url: "https://example.test/narration.mp3",
						mimeType: "audio/mpeg",
					},
				],
			},
		];

		render(
			<GenerationChatPanel entries={entries} onRefreshVideo={vi.fn()} onSelectEntry={vi.fn()} />,
		);

		const audioPlayer = screen.getByTestId("audio-player");
		expect(audioPlayer.getAttribute("data-src")).toBe("https://example.test/narration.mp3");
		expect(audioPlayer.getAttribute("data-mime-type")).toBe("audio/mpeg");
	});

	it("keeps pending image slots visible after a multi-image task partially returns assets", () => {
		HTMLElement.prototype.scrollTo = vi.fn();
		const entries: GenerationEntry[] = [
			{
				id: "task-image",
				kind: "image",
				status: "submitted",
				content: "",
				prompt: "生成四张图",
				requestDetails: [{ label: "数量", value: "4" }],
				assets: [
					{ kind: "image", url: "https://example.test/a.png", mimeType: "image/png" },
					{ kind: "image", url: "https://example.test/b.png", mimeType: "image/png" },
				],
			},
		];

		const { container } = render(
			<GenerationChatPanel entries={entries} onRefreshVideo={vi.fn()} onSelectEntry={vi.fn()} />,
		);

		expect(container.querySelectorAll("img")).toHaveLength(2);
		expect(screen.getAllByText("生成中")).toHaveLength(2);
	});
});
