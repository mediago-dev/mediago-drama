import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SectionGenerateButton,
	type SectionGenerateKind,
} from "@/domains/documents/components/tiptap/editor-overlays";
import type { HoveredBlockRect } from "@/domains/documents/components/tiptap/types";

const hoveredHeadingRect: HoveredBlockRect = {
	height: 32,
	isHeading: true,
	range: {
		from: 1,
		headingLevel: 2,
		index: 0,
		nodeType: "heading",
		text: "标题",
		to: 4,
	},
	top: 40,
};

describe("SectionGenerateButton", () => {
	afterEach(() => cleanup());

	it("renders image, audio, and video generation actions", () => {
		const generatedKinds: SectionGenerateKind[] = [];

		render(
			<SectionGenerateButton
				rect={hoveredHeadingRect}
				onGenerate={(kind) => generatedKinds.push(kind)}
				onMouseLeave={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "根据当前标题区域生成图片" }));
		fireEvent.click(screen.getByRole("button", { name: "根据当前标题区域生成语音" }));
		fireEvent.click(screen.getByRole("button", { name: "根据当前标题区域生成视频" }));

		expect(screen.getByText("生成图片")).toBeTruthy();
		expect(screen.getByText("生成语音")).toBeTruthy();
		expect(screen.getByText("生成视频")).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "根据当前标题区域生成图片" })
				.closest(".tiptap-section-generate-action-group"),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "根据当前标题区域生成图片" }).parentElement?.style.top,
		).toBe("12px");
		expect(generatedKinds).toEqual(["image", "audio", "video"]);
	});
});
