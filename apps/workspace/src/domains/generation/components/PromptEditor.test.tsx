import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptEditor, PromptMarkdownPreview } from "./PromptEditor";

describe("PromptEditor", () => {
	it("renders editable prompt markdown as rich content", () => {
		render(
			<PromptEditor
				value={"# 角色设定\n\n- 沈闯保持湿透水状态"}
				placeholder="描述要生成的图片素材"
				onChange={vi.fn()}
			/>,
		);

		expect(screen.getByRole("heading", { name: "角色设定" })).toBeTruthy();
		expect(screen.getByText("沈闯保持湿透水状态")).toBeTruthy();
		expect(screen.queryByText("# 角色设定")).toBeNull();
	});

	it("renders readonly prompt markdown as rich content", () => {
		const { container } = render(<PromptMarkdownPreview value={"**重点**\n\n1. 镜头运动自然"} />);

		expect(container.querySelector("strong")?.textContent).toBe("重点");
		expect(screen.getByText("镜头运动自然")).toBeTruthy();
	});
});
