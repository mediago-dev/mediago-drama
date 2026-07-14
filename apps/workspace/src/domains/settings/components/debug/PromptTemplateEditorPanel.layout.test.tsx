import { cleanup, render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPromptTemplates } from "@/domains/settings/api/prompt-templates";
import { PromptTemplateEditorPanel } from "./PromptTemplateEditorPanel";

vi.mock("@/domains/settings/api/prompt-templates", () => ({
	listPromptTemplates: vi.fn(),
	promptTemplatesKey: "/prompt-templates",
	resetPromptTemplate: vi.fn(),
	updatePromptTemplate: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

vi.mock("./SettingsMarkdownEditor", () => ({
	SettingsMarkdownEditor: () => null,
	SettingsMarkdownPreview: ({ className, value }: { className?: string; value: string }) => (
		<div aria-label="指令 Markdown 预览" className={className}>
			{value}
		</div>
	),
}));

describe("PromptTemplateEditorPanel layout", () => {
	beforeEach(() => {
		vi.mocked(listPromptTemplates).mockResolvedValue([
			{
				content: "# Agent 操作指令\n\n默认身份\n\n这是系统指令正文。",
				description: "Agent 操作指令",
				id: "agents-md",
				name: "AGENTS.md",
				source: "official",
			},
		]);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps instruction controls fixed while the Markdown preview scrolls", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map() }}>
				<PromptTemplateEditorPanel />
			</SWRConfig>,
		);

		const preview = await screen.findByLabelText("指令 Markdown 预览");
		expect(preview).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");

		const bodySection = preview.parentElement;
		expect(bodySection).toHaveClass("flex", "min-h-0", "flex-1", "flex-col");
		expect(bodySection?.parentElement).toHaveClass("h-full", "min-h-0", "flex-col");
		expect(bodySection?.parentElement?.parentElement).not.toHaveClass("overflow-y-auto");
	});
});
