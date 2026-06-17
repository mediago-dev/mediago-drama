import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutKeysPanel } from "./ShortcutKeysPanel";

describe("ShortcutKeysPanel", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders the read-only shortcut catalog", () => {
		render(<ShortcutKeysPanel />);

		expect(screen.getByRole("heading", { name: "快捷键" })).toBeTruthy();
		expect(screen.getByText("新建项目")).toBeTruthy();
		expect(screen.getByText("打开搜索")).toBeTruthy();
		expect(screen.getAllByText("提示词斜杠菜单").length).toBeGreaterThan(0);
		expect(screen.getAllByText("⌘").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Ctrl").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Enter").length).toBeGreaterThan(0);
	});
});
