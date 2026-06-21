import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenerationComposerPanel } from "./GenerationComposerPanel";

describe("GenerationComposerPanel", () => {
	it("renders copy prompt as an icon-only toolbar button before parameter controls", () => {
		const onCopyPrompt = vi.fn();

		render(
			<GenerationComposerPanel
				canCopyPrompt
				canSubmit
				isSubmitting={false}
				promptInput={<div data-testid="prompt-input" className="prompt-input" />}
				rightControls={<button type="button">参数</button>}
				submitLabel="生成"
				onCopyPrompt={onCopyPrompt}
			/>,
		);

		const copyButton = screen.getByRole("button", { name: "复制 Prompt" });
		const paramButton = screen.getByRole("button", { name: "参数" });

		expect(screen.queryByText("复制 Prompt")).toBeNull();
		expect(copyButton.className).not.toContain("absolute");
		expect(copyButton.className).toContain("h-[var(--generation-control-height)]");
		expect(copyButton.className).toContain("w-[var(--generation-control-height)]");
		expect(copyButton.className).toContain("bg-muted");
		expect(screen.getByTestId("prompt-input")).not.toHaveClass("pb-12");
		expect(copyButton.compareDocumentPosition(paramButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

		fireEvent.click(copyButton);

		expect(onCopyPrompt).toHaveBeenCalledTimes(1);
	});
});
