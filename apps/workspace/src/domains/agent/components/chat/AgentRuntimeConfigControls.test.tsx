import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeConfigPayload } from "@/domains/agent/api/agent";
import { AgentRuntimeConfigControls } from "./AgentRuntimeConfigControls";

const baseConfig: AgentRuntimeConfigPayload = {
	model: {
		configId: "model",
		currentValue: "mini",
		options: [{ name: "MiniMax", value: "mini" }],
	},
	permission: {
		configId: "permission",
		currentValue: "build",
		options: [{ name: "build", value: "build" }],
	},
};

const renderControls = (
	config?: AgentRuntimeConfigPayload,
	options: {
		errorMessage?: string;
		isLoading?: boolean;
		modelValue?: string;
		onModelChange?: (value: string) => void;
	} = {},
) => render(runtimeControlsElement(config, options));

const runtimeControlsElement = (
	config?: AgentRuntimeConfigPayload,
	options: {
		errorMessage?: string;
		isLoading?: boolean;
		modelValue?: string;
		onModelChange?: (value: string) => void;
	} = {},
) => (
	<AgentRuntimeConfigControls
		config={config}
		disabled={false}
		errorMessage={options.errorMessage ?? ""}
		isLoading={options.isLoading ?? false}
		modelValue={options.modelValue ?? ""}
		permissionValue=""
		reasoningValue=""
		onModelChange={options.onModelChange ?? vi.fn()}
		onPermissionChange={vi.fn()}
		onReasoningChange={vi.fn()}
	/>
);

describe("AgentRuntimeConfigControls", () => {
	afterEach(() => {
		cleanup();
	});

	it("shows a loading hint before runtime config options are loaded", () => {
		renderControls(undefined, { isLoading: true });

		expect(screen.getByRole("status")).toHaveTextContent("配置读取中");
		expect(screen.queryByText("模型")).toBeNull();
		expect(screen.queryByText("推理强度")).toBeNull();
		expect(screen.queryByText("模式")).toBeNull();
	});

	it("shows only returned runtime config controls", () => {
		renderControls(baseConfig);

		expect(screen.getByText("模型")).toBeTruthy();
		expect(screen.getByText("模式")).toBeTruthy();
		expect(screen.queryByText("推理强度")).toBeNull();
		expect(screen.queryByText("未返回选项")).toBeNull();
		expect(screen.queryByText("读取中")).toBeNull();
	});

	it("shows reasoning control after reasoning options are available", () => {
		renderControls({
			...baseConfig,
			reasoning: {
				configId: "reasoning",
				currentValue: "medium",
				options: [{ name: "中等", value: "medium" }],
			},
		});

		expect(screen.getByText("推理强度")).toBeTruthy();
		expect(screen.getByText("中等")).toBeTruthy();
	});

	it("shows category and model columns for model options", () => {
		const onModelChange = vi.fn();
		renderControls(
			{
				model: {
					configId: "model",
					currentValue: "mediago/minimax-m3",
					options: [
						{
							name: "MediaGo/MiniMax M3",
							value: "mediago/minimax-m3",
						},
						{
							name: "MiniMax 国内/MiniMax-M3",
							value: "minimax/minimax-m3",
						},
						{
							name: "MediaGo/GLM-4 Flash",
							value: "mediago/glm-4-flash",
						},
					],
				},
			},
			{ onModelChange },
		);

		fireEvent.click(screen.getByRole("button", { name: "模型" }));

		expect(screen.getByText("分类")).toBeTruthy();
		expect(screen.getByText("GLM-4 Flash")).toBeTruthy();
		expect(screen.getByRole("button", { name: "MediaGo" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "MiniMax 国内" }));
		fireEvent.click(screen.getByRole("button", { name: "MiniMax-M3" }));

		expect(onModelChange).toHaveBeenCalledWith("minimax/minimax-m3");
	});

	it("renders agent model trigger icons as provider then model and deduplicates matching icons", () => {
		const view = renderControls(
			{
				model: {
					configId: "model",
					currentValue: "mediago/glm-4-flash",
					options: [
						{
							name: "MediaGo/GLM-4 Flash",
							value: "mediago/glm-4-flash",
						},
					],
				},
			},
			{ modelValue: "mediago/glm-4-flash" },
		);
		expect(agentModelTriggerBrands(view.container)).toEqual(["mediago", "glm"]);

		view.rerender(
			runtimeControlsElement(
				{
					model: {
						configId: "model",
						currentValue: "minimax/minimax-m3",
						options: [
							{
								name: "MiniMax 国内/MiniMax-M3",
								value: "minimax/minimax-m3",
							},
						],
					},
				},
				{ modelValue: "minimax/minimax-m3" },
			),
		);

		expect(agentModelTriggerBrands(view.container)).toEqual(["minimax"]);
	});

	const agentModelTriggerBrands = (container: HTMLElement) =>
		Array.from(container.querySelectorAll('button[aria-label="模型"] [data-generation-brand]')).map(
			(node) => node.getAttribute("data-generation-brand"),
		);

	it("keeps the open model menu stable when config refreshes", () => {
		const modelConfig = (): AgentRuntimeConfigPayload => ({
			model: {
				configId: "model",
				currentValue: "mediago/glm-4-flash",
				options: [
					{
						name: "MediaGo/GLM-4 Flash",
						value: "mediago/glm-4-flash",
					},
					{
						name: "MiniMax 国内/MiniMax-M3",
						value: "minimax/minimax-m3",
					},
				],
			},
		});
		const view = renderControls(modelConfig(), { modelValue: "mediago/glm-4-flash" });

		fireEvent.click(screen.getByRole("button", { name: "模型" }));
		const menu = screen.getByLabelText("分类和模型");
		expect(menu).toHaveClass("h-[22rem]");

		fireEvent.mouseEnter(screen.getByRole("button", { name: "MiniMax 国内" }));
		expect(screen.getByText("MiniMax-M3")).toBeTruthy();
		expect(screen.queryByText("GLM-4 Flash")).toBeNull();

		view.rerender(runtimeControlsElement(modelConfig(), { modelValue: "mediago/glm-4-flash" }));

		expect(screen.getByText("MiniMax-M3")).toBeTruthy();
		expect(screen.queryByText("GLM-4 Flash")).toBeNull();
	});
});
