import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importPromptPackFile, listPromptPacks } from "@/domains/settings/api/packs";
import { openPromptPackEditor } from "@/shared/desktop/actions";
import { PromptPacksPanel } from "./PromptPacksPanel";

vi.mock("@/domains/settings/api/packs", () => ({
	importPromptPackFile: vi.fn(),
	listPromptPacks: vi.fn(),
	promptPacksKey: "/packs",
}));

vi.mock("@/shared/desktop/actions", () => ({
	openPromptPackEditor: vi.fn(),
}));

vi.mock("@/domains/workspace/lib/desktop-window-drag", () => ({
	useDesktopWindowDrag: () => vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

vi.mock("./SkillsEditorPanel", () => ({
	SkillsEditorPanel: ({ showActions }: { showActions?: boolean }) => (
		<div data-show-actions={String(showActions)}>Skills editor</div>
	),
}));

vi.mock("./PromptLibraryEditorPanel", () => ({
	PromptLibraryEditorPanel: ({ showActions }: { showActions?: boolean }) => (
		<div data-show-actions={String(showActions)}>Prompt library editor</div>
	),
}));

describe("PromptPacksPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listPromptPacks).mockResolvedValue([
			{
				id: "builtin",
				name: "默认包",
				version: "1.0.0",
				source: "default",
				enabled: true,
			},
		]);
	});

	afterEach(() => cleanup());

	it("keeps the Skill catalog read-only on the settings page", () => {
		renderPanel();

		expect(screen.getByRole("tab", { name: "技能" })).toHaveAttribute("data-state", "active");
		expect(screen.getByText("Skills editor")).toHaveAttribute("data-show-actions", "false");
		expect(screen.queryByRole("tab", { name: "技能包" })).not.toBeInTheDocument();
	});

	it("imports a selected mgpack file", async () => {
		vi.mocked(importPromptPackFile).mockResolvedValue({
			id: "imported.test",
			name: "导入包",
			version: "1.0.0",
			source: "imported",
			enabled: true,
		});
		renderPanel(<PendingPromptPackCache />);

		const file = new File(["MGPK"], "test.mgpack", { type: "application/octet-stream" });
		fireEvent.change(screen.getByLabelText("导入技能包文件"), {
			target: { files: [file] },
		});

		await waitFor(() => expect(importPromptPackFile).toHaveBeenCalledWith(file));
		await waitFor(() => expect(screen.getByRole("button", { name: "导入" })).toBeEnabled());
	});

	it("opens the dedicated management window without entering create mode", () => {
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "技能包管理" }));

		expect(openPromptPackEditor).toHaveBeenCalledWith();
	});
});

const PendingPromptPackCache = () => {
	useSWR("/skills", () => new Promise<never>(() => undefined));
	return null;
};

const renderPanel = (extra?: React.ReactNode) =>
	render(
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
			<PromptPacksPanel />
			{extra}
		</SWRConfig>,
	);
