import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppLayout } from "./AppLayout";

describe("AppLayout", () => {
	it("renders draggable regions across the content header and macOS sidebar chrome", () => {
		const { container } = render(
			<AppLayout
				headerActions={<button type="button">操作</button>}
				headerTitle="智能体工作台"
				sidebar={<nav>项目导航</nav>}
			>
				<div>工作台内容</div>
			</AppLayout>,
		);

		const header = screen.getByRole("banner");
		expect(header).toHaveAttribute("data-desktop-drag-region");
		expect(container.querySelector(".desktop-window-drag-region")).toHaveAttribute(
			"data-desktop-drag-region",
		);
		expect(screen.getByRole("button", { name: "操作" }).parentElement).toHaveAttribute(
			"data-desktop-no-drag",
		);
	});
});
