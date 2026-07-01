import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeConfigPayload } from "@/domains/agent/api/agent";
import {
	AgentRuntimeConfigControls,
	shouldKeepAgentRuntimeCategoryActive,
} from "./AgentRuntimeConfigControls";

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
		vi.restoreAllMocks();
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

		expect(screen.getByRole("button", { name: "模型" })).toBeTruthy();
		expect(screen.getByLabelText("模式")).toBeTruthy();
		expect(screen.queryByText("模型")).toBeNull();
		expect(screen.queryByText("模式")).toBeNull();
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

		expect(screen.getByLabelText("推理强度")).toBeTruthy();
		expect(screen.queryByText("推理强度")).toBeNull();
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

	it("sizes the model menu to the returned category and model rows", () => {
		renderControls({
			model: {
				configId: "model",
				currentValue: "minimax/minimax-m2.7-highspeed",
				options: [
					{
						name: "MiniMax 国内/MiniMax-M2.7",
						value: "minimax/minimax-m2.7",
					},
					{
						name: "MiniMax 国内/MiniMax-M2.7-highspeed",
						value: "minimax/minimax-m2.7-highspeed",
					},
					{
						name: "MiniMax 国内/MiniMax-M3",
						value: "minimax/minimax-m3",
					},
				],
			},
		});

		fireEvent.click(screen.getByRole("button", { name: "模型" }));
		const menu = screen.getByLabelText("分类和模型");

		expect(menu).toHaveClass("h-[var(--agent-runtime-model-menu-height)]");
		expect(menu).not.toHaveClass("h-[22rem]");
		expect(menu.getAttribute("style")).toContain(
			"3 * var(--generation-model-popover-option-height)",
		);
	});

	it("caps the model menu height and keeps long model lists scrollable", () => {
		renderControls({
			model: {
				configId: "model",
				currentValue: "mediago/glm-4.7",
				options: [
					"glm-4.7",
					"glm-5.2",
					"gpt-4.1",
					"gpt-4.1-mini",
					"minimax-m2.7",
					"minimax-m2.7-highspeed",
					"minimax-m3",
					"qwen3.5-27b",
				].map((model) => ({
					name: `MediaGo/${model}`,
					value: `mediago/${model}`,
				})),
			},
		});

		fireEvent.click(screen.getByRole("button", { name: "模型" }));
		const menu = screen.getByLabelText("分类和模型");

		expect(menu.getAttribute("style")).toContain(
			"3 * var(--generation-model-popover-option-height)",
		);
		expect(screen.getByText("qwen3.5-27b")).toBeTruthy();
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

	it("stacks the model icon above the provider icon in the trigger", () => {
		const view = renderControls(
			{
				model: {
					configId: "model",
					currentValue: "mediago/minimax-m3",
					options: [
						{
							name: "MediaGo/MiniMax M3",
							value: "mediago/minimax-m3",
						},
					],
				},
			},
			{ modelValue: "mediago/minimax-m3" },
		);

		const icons = Array.from(
			view.container.querySelectorAll('button[aria-label="模型"] [data-generation-brand]'),
		);

		expect(icons[0]).toHaveClass("z-0");
		expect(icons[1]).toHaveClass("z-10");
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
		expect(menu).toHaveClass("h-[var(--agent-runtime-model-menu-height)]");
		expect(menu.getAttribute("style")).toContain(
			"2 * var(--generation-model-popover-option-height)",
		);

		fireEvent.pointerEnter(screen.getByRole("button", { name: "MiniMax 国内" }));
		expect(screen.getByText("MiniMax-M3")).toBeTruthy();
		expect(screen.queryByText("GLM-4 Flash")).toBeNull();

		view.rerender(runtimeControlsElement(modelConfig(), { modelValue: "mediago/glm-4-flash" }));

		expect(screen.getByText("MiniMax-M3")).toBeTruthy();
		expect(screen.queryByText("GLM-4 Flash")).toBeNull();
	});

	it("keeps the active model category while the pointer crosses the safe triangle", () => {
		renderControls({
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

		fireEvent.click(screen.getByRole("button", { name: "模型" }));
		const mediaGoCategory = screen.getByRole("button", { name: "MediaGo" });
		const miniMaxCategory = screen.getByRole("button", { name: "MiniMax 国内" });
		const modelPanel = screen.getByText("模型").closest("section");
		expect(modelPanel).toBeTruthy();
		vi.spyOn(mediaGoCategory, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 220, top: 80 }),
		);
		vi.spyOn(modelPanel as HTMLElement, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 360, left: 240, right: 520, top: 40 }),
		);

		fireEvent.pointerEnter(mediaGoCategory, { clientX: 150, clientY: 96 });
		fireEvent.pointerMove(mediaGoCategory, { clientX: 160, clientY: 112 });
		fireEvent.pointerEnter(miniMaxCategory, { clientX: 172, clientY: 136 });

		expect(screen.getByText("GLM-4 Flash")).toBeTruthy();
		expect(screen.queryByText("MiniMax-M3")).toBeNull();
		expect(miniMaxCategory).not.toHaveClass("hover:bg-muted");
	});

	it("switches model category immediately when the pointer is not moving toward the model panel", () => {
		renderControls({
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

		fireEvent.click(screen.getByRole("button", { name: "模型" }));
		const mediaGoCategory = screen.getByRole("button", { name: "MediaGo" });
		const miniMaxCategory = screen.getByRole("button", { name: "MiniMax 国内" });
		const modelPanel = screen.getByText("模型").closest("section");
		expect(modelPanel).toBeTruthy();
		vi.spyOn(mediaGoCategory, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 220, top: 80 }),
		);
		vi.spyOn(modelPanel as HTMLElement, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 360, left: 240, right: 520, top: 40 }),
		);

		fireEvent.pointerEnter(mediaGoCategory, { clientX: 188, clientY: 96 });
		fireEvent.pointerMove(mediaGoCategory, { clientX: 200, clientY: 112 });
		fireEvent.pointerEnter(miniMaxCategory, { clientX: 200, clientY: 136 });

		expect(screen.getByText("MiniMax-M3")).toBeTruthy();
		expect(screen.queryByText("GLM-4 Flash")).toBeNull();
	});

	it("keeps the active model category while the pointer keeps moving inside the safe triangle", () => {
		renderControls({
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

		fireEvent.click(screen.getByRole("button", { name: "模型" }));
		const mediaGoCategory = screen.getByRole("button", { name: "MediaGo" });
		const miniMaxCategory = screen.getByRole("button", { name: "MiniMax 国内" });
		const modelPanel = screen.getByText("模型").closest("section");
		expect(modelPanel).toBeTruthy();
		vi.spyOn(mediaGoCategory, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 220, top: 80 }),
		);
		vi.spyOn(modelPanel as HTMLElement, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 360, left: 240, right: 520, top: 40 }),
		);

		fireEvent.pointerEnter(mediaGoCategory, { clientX: 150, clientY: 96 });
		fireEvent.pointerMove(mediaGoCategory, { clientX: 160, clientY: 112 });
		fireEvent.pointerEnter(miniMaxCategory, { clientX: 172, clientY: 136 });
		fireEvent.pointerMove(miniMaxCategory, { clientX: 180, clientY: 150 });

		expect(screen.getByText("GLM-4 Flash")).toBeTruthy();
		expect(screen.queryByText("MiniMax-M3")).toBeNull();
	});

	it("keeps the category when the pointer reaches the model panel", () => {
		renderControls({
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

		fireEvent.click(screen.getByRole("button", { name: "模型" }));
		const mediaGoCategory = screen.getByRole("button", { name: "MediaGo" });
		const miniMaxCategory = screen.getByRole("button", { name: "MiniMax 国内" });
		const modelPanel = screen.getByText("模型").closest("section");
		expect(modelPanel).toBeTruthy();
		vi.spyOn(mediaGoCategory, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 220, top: 80 }),
		);
		vi.spyOn(modelPanel as HTMLElement, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 360, left: 240, right: 520, top: 40 }),
		);

		fireEvent.pointerEnter(mediaGoCategory, { clientX: 150, clientY: 96 });
		fireEvent.pointerMove(mediaGoCategory, { clientX: 160, clientY: 112 });
		fireEvent.pointerEnter(miniMaxCategory, { clientX: 172, clientY: 136 });
		fireEvent.pointerEnter(modelPanel as HTMLElement, { clientX: 246, clientY: 136 });

		expect(screen.getByText("GLM-4 Flash")).toBeTruthy();
		expect(screen.queryByText("MiniMax-M3")).toBeNull();
	});
});

describe("shouldKeepAgentRuntimeCategoryActive", () => {
	it("keeps the category active for diagonal movement through the safe triangle", () => {
		expect(
			shouldKeepAgentRuntimeCategoryActive({
				activeRect: { bottom: 124, left: 20, right: 220, top: 80 },
				origin: { x: 160, y: 112 },
				point: { x: 172, y: 136 },
				submenuRect: { bottom: 360, left: 240, right: 520, top: 40 },
			}),
		).toBe(true);
	});

	it("does not keep the category active for vertical movement inside the category column", () => {
		expect(
			shouldKeepAgentRuntimeCategoryActive({
				activeRect: { bottom: 124, left: 20, right: 220, top: 80 },
				origin: { x: 188, y: 112 },
				point: { x: 188, y: 136 },
				submenuRect: { bottom: 360, left: 240, right: 520, top: 40 },
			}),
		).toBe(false);
	});
});

const testRect = ({
	bottom,
	left,
	right,
	top,
}: {
	bottom: number;
	left: number;
	right: number;
	top: number;
}) =>
	({
		bottom,
		height: bottom - top,
		left,
		right,
		toJSON: () => ({}),
		top,
		width: right - left,
		x: left,
		y: top,
	}) as DOMRect;
