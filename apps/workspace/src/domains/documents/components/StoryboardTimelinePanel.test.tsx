import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryboardTimelinePanel } from "./StoryboardTimelinePanel";
import { createEpisodeFromMarkdownDocument } from "@/domains/episode/lib/from-markdown";

vi.mock("@/domains/episode/lib/from-markdown", () => ({
	createEpisodeFromMarkdownDocument: vi.fn(() => ({
		duration: 5,
		sections: [{ id: "section-1", title: "分镜 01", start: 0, end: 5, summary: "画面" }],
		tracks: [
			{
				type: "video",
				clips: [{ id: "video-1", title: "画面", start: 0, end: 5, content: "推镜" }],
			},
			{ type: "voiceover", clips: [] },
			{ type: "caption", clips: [] },
		],
	})),
}));

describe("StoryboardTimelinePanel", () => {
	it("defers storyboard timeline parsing until the panel is expanded", () => {
		render(
			<StoryboardTimelinePanel
				documentId="doc-a"
				documentTitle="第一章 分镜脚本"
				documentContent={"# 第一章\n\n".repeat(500)}
			/>,
		);

		expect(createEpisodeFromMarkdownDocument).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "展开分镜同步面板" }));

		expect(createEpisodeFromMarkdownDocument).toHaveBeenCalledTimes(1);
		expect(screen.getByText("分镜 01")).toBeTruthy();
	});
});
