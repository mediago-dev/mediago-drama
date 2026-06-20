import { cleanup, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionMediaPreview } from "./section-media-preview";

vi.mock("@/components/AudioPlayer", () => ({
	AudioPlayer: ({
		className,
		mimeType,
		src,
		title,
	}: {
		className?: string;
		mimeType?: string;
		src: string;
		title?: string;
	}) => (
		<div
			className={className}
			data-testid="audio-player"
			data-mime-type={mimeType}
			data-src={src}
			data-title={title}
		/>
	),
}));

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: ({
		className,
		load,
		mimeType,
		showTitleInControls,
		src,
		title,
	}: {
		className?: string;
		load?: string;
		mimeType?: string;
		showTitleInControls?: boolean;
		src: string;
		title?: string;
	}) => (
		<div
			className={className}
			data-testid="video-player"
			data-load={load}
			data-mime-type={mimeType}
			data-show-title={String(showTitleInControls)}
			data-src={src}
			data-title={title}
		/>
	),
}));

describe("SectionMediaPreview", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders section audio markdown with the shared audio player and preserves markdown", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionMediaPreview, Markdown],
			content: "[章节音频：陈远](</api/v1/media-assets/audio-1/content>)",
			contentType: "markdown",
		});

		expect(editor.getJSON().content?.[0]?.type).toBe("sectionMediaPreview");
		render(<EditorContent editor={editor} />);
		const player = screen.getByTestId("audio-player");
		expect(player.getAttribute("data-src")).toBe("/api/v1/media-assets/audio-1/content");
		expect(player.getAttribute("data-mime-type")).toBe("audio/mpeg");
		expect(player.getAttribute("data-title")).toBe("陈远");
		expect(editor.getMarkdown()).toContain(
			"[章节音频：陈远](</api/v1/media-assets/audio-1/content>)",
		);

		editor.destroy();
	});

	it("renders section video markdown with the shared video player and preserves markdown", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionMediaPreview, Markdown],
			content: "[章节视频：陈远](</api/v1/media-assets/video-1/content>)",
			contentType: "markdown",
		});

		expect(editor.getJSON().content?.[0]?.type).toBe("sectionMediaPreview");
		render(<EditorContent editor={editor} />);
		const player = screen.getByTestId("video-player");
		expect(player.getAttribute("data-src")).toBe("/api/v1/media-assets/video-1/content");
		expect(player.getAttribute("data-mime-type")).toBe("video/mp4");
		expect(player.getAttribute("data-load")).toBe("visible");
		expect(player.getAttribute("data-show-title")).toBe("false");
		expect(player.getAttribute("data-title")).toBe("陈远");
		expect(editor.getMarkdown()).toContain(
			"[章节视频：陈远](</api/v1/media-assets/video-1/content>)",
		);

		editor.destroy();
	});

	it("leaves bare section audio links as regular markdown links", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionMediaPreview, Markdown],
			content: "[章节音频](</api/v1/media-assets/audio-1/content>)",
			contentType: "markdown",
		});

		expect(editor.getJSON().content?.[0]?.type).not.toBe("sectionMediaPreview");
		render(<EditorContent editor={editor} />);
		expect(screen.queryByTestId("audio-player")).toBeNull();
		expect(editor.getMarkdown()).toContain("[章节音频](/api/v1/media-assets/audio-1/content)");

		editor.destroy();
	});
});
