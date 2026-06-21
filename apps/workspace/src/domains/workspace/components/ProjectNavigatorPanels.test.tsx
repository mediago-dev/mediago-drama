import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebarPanel } from "./ProjectNavigatorPanels";

describe("SettingsSidebarPanel", () => {
	afterEach(() => {
		cleanup();
	});

	it("selects the shortcuts settings tab", () => {
		const onSelectTab = vi.fn();

		render(
			<SettingsSidebarPanel
				activeTab="appearance"
				isProjectSettings={false}
				projectName=""
				onBack={vi.fn()}
				onSelectTab={onSelectTab}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "快捷键" }));

		expect(onSelectTab).toHaveBeenCalledWith("shortcuts");
	});

	it("shows API keys without the retired agent model profile entry", () => {
		const onSelectTab = vi.fn();

		render(
			<SettingsSidebarPanel
				activeTab="appearance"
				isProjectSettings={false}
				projectName=""
				onBack={vi.fn()}
				onSelectTab={onSelectTab}
			/>,
		);

		expect(screen.queryByRole("button", { name: "模型接入" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "API 密钥" }));
		expect(onSelectTab).toHaveBeenCalledWith("api-keys");
	});
});
