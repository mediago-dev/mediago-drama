import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { HistoryGenerationList } from "./MediaGenerationHistory";

const videoEntry = (): GenerationEntry => ({
	id: "entry-video",
	kind: "video",
	status: "completed",
	content: "",
	prompt: "生成一个街景镜头",
	assets: [{ kind: "video", url: "https://example.test/scene.mp4", mimeType: "video/mp4" }],
});

describe("HistoryGenerationList", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders generated video history items with a video thumbnail", () => {
		const { container } = render(
			<HistoryGenerationList
				activeEntryId="entry-video"
				deletingEntryIds={[]}
				entries={[videoEntry()]}
				kind="video"
				selectedAssetKeys={[]}
				onDeleteEntry={vi.fn()}
				onSelectEntry={vi.fn()}
			/>,
		);

		const video = container.querySelector("video");

		expect(video).not.toBeNull();
		expect(video?.getAttribute("src")).toBe("https://example.test/scene.mp4");
		expect(video?.getAttribute("preload")).toBe("auto");
		expect(video?.playsInline).toBe(true);
	});
});
