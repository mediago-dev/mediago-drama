import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptOptimizeControl } from "./PromptOptimizeControl";

describe("PromptOptimizeControl", () => {
	it("shows the signed-in Codex fallback when no text route is configured", async () => {
		render(
			<PromptOptimizeControl
				canOptimize
				codexAvailable
				isOptimizing={false}
				items={[]}
				modelOptions={[]}
				onOptimize={vi.fn()}
				onOptimizeAndSubmit={vi.fn()}
				onSelectModel={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));

		expect(screen.getByText("Codex · 当前登录账户")).toBeInTheDocument();
		expect(screen.queryByText("无可用文本模型")).not.toBeInTheDocument();
	});
});
