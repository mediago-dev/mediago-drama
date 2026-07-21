import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptOptimizeModelOption } from "@/domains/generation/hooks/usePromptOptimize";
import { PromptOptimizeControl } from "./PromptOptimizeControl";

const textModelOption = {
	family: { id: "gpt", kind: "text", label: "GPT" },
	id: "openrouter.gpt-5.5",
	label: "GPT-5.5 Text · OpenRouter",
	route: {
		adapter: "openai.responses",
		async: false,
		configured: true,
		docUrl: "",
		familyId: "gpt",
		id: "openrouter.gpt-5.5",
		kind: "text",
		label: "GPT-5.5 Text · OpenRouter",
		model: "gpt-5.5",
		params: [],
		provider: "openrouter",
		status: "available",
		supportsReferenceUrls: false,
		versionId: "gpt-5.5",
	},
	version: {
		canonicalModel: "gpt-5.5",
		capabilities: { async: false, supportsReferenceUrls: false },
		familyId: "gpt",
		id: "gpt-5.5",
		kind: "text",
		label: "GPT-5.5 Text",
	},
} as PromptOptimizeModelOption;

describe("PromptOptimizeControl", () => {
	afterEach(cleanup);

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

		expect(screen.getByRole("combobox", { name: "优化模型名称" })).toHaveTextContent("Codex");
		expect(screen.getByText("当前登录账户")).toBeInTheDocument();
		expect(screen.queryByText("无可用文本模型")).not.toBeInTheDocument();
	});

	it("keeps Codex as the default while configured text models remain selectable", () => {
		const onSelectModel = vi.fn();
		render(
			<PromptOptimizeControl
				canOptimize
				codexAvailable
				isOptimizing={false}
				items={[]}
				modelOptions={[textModelOption]}
				onOptimize={vi.fn()}
				onOptimizeAndSubmit={vi.fn()}
				onSelectModel={onSelectModel}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		const modelFamily = screen.getByRole("combobox", { name: "优化模型名称" });
		expect(modelFamily).toHaveTextContent("Codex");

		fireEvent.click(modelFamily);
		expect(screen.getByRole("option", { name: "Codex" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("option", { name: "GPT" }));
		expect(onSelectModel).toHaveBeenCalledWith("openrouter.gpt-5.5");
	});

	it("lets a user switch a configured text model back to Codex", () => {
		const onSelectModel = vi.fn();
		render(
			<PromptOptimizeControl
				canOptimize
				codexAvailable
				isOptimizing={false}
				items={[]}
				modelOptions={[textModelOption]}
				onOptimize={vi.fn()}
				onOptimizeAndSubmit={vi.fn()}
				onSelectModel={onSelectModel}
				selectedModelRouteId={textModelOption.id}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
		fireEvent.click(screen.getByRole("combobox", { name: "优化模型名称" }));
		fireEvent.click(screen.getByRole("option", { name: "Codex" }));

		expect(onSelectModel).toHaveBeenCalledWith("");
	});
});
