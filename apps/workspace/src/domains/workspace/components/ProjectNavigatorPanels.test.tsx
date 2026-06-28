import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectSettingsGeneralTab } from "@/lib/stores/settings";
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
				onBack={vi.fn()}
				onSelectTab={onSelectTab}
			/>,
		);

		expect(screen.queryByRole("button", { name: "模型接入" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "API 密钥" }));
		expect(onSelectTab).toHaveBeenCalledWith("api-keys");
	});

	it("hides the Jianying draft settings entry while it is disabled", () => {
		render(
			<SettingsSidebarPanel
				activeTab="appearance"
				isProjectSettings={false}
				onBack={vi.fn()}
				onSelectTab={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("button", { name: "剪映草稿" })).toBeNull();
	});

	it("adds project settings above global settings in project mode", () => {
		const onSelectTab = vi.fn();

		render(
			<SettingsSidebarPanel
				activeTab={projectSettingsGeneralTab}
				isProjectSettings
				onBack={vi.fn()}
				onSelectTab={onSelectTab}
			/>,
		);

		expect(screen.getByText("项目设置")).toBeTruthy();
		expect(screen.getByRole("button", { name: "常规" }).className).toContain("bg-ide-list-active");
		expect(screen.getByRole("button", { name: "基础设置" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "API 密钥" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "基础设置" }));
		expect(onSelectTab).toHaveBeenCalledWith("appearance");
	});
});
