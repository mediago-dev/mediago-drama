import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptOptimizePicker } from "./PromptOptimizePicker";

const promptItems = Array.from({ length: 8 }, (_, index) => ({
	id: `prompt-${index}`,
	categoryLabel: index < 4 ? "风格" : "镜头",
	name: `提示词 ${index + 1}`,
	prompt: `prompt body ${index + 1}`,
	sourceLabel: "来自包",
}));

describe("PromptOptimizePicker", () => {
	it("keeps the prompt pack list scrollable inside the popover", () => {
		const parentWheel = vi.fn();

		render(
			<div onWheel={parentWheel}>
				<PromptOptimizePicker items={promptItems} onSelect={vi.fn()} />
			</div>,
		);

		const list = screen.getByRole("region", { name: "技能包列表" });

		expect(list.parentElement?.getAttribute("style")).toContain("27.5rem");
		expect(list.className).toContain("overflow-y-auto");
		expect(list.className).toContain("overscroll-contain");

		fireEvent.wheel(list);

		expect(parentWheel).not.toHaveBeenCalled();
	});
});
