import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeConfigPayload } from "@/domains/agent/api/agent";
import {
	AgentRuntimeConfigControls,
	getRuntimeConfigError,
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
		onOpenSettings?: () => void;
		onRetry?: () => void;
	} = {},
) => render(runtimeControlsElement(config, options));

const runtimeControlsElement = (
	config?: AgentRuntimeConfigPayload,
	options: {
		errorMessage?: string;
		isLoading?: boolean;
		modelValue?: string;
		onModelChange?: (value: string) => void;
		onOpenSettings?: () => void;
		onRetry?: () => void;
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
		onOpenSettings={options.onOpenSettings ?? vi.fn()}
		onPermissionChange={vi.fn()}
		onReasoningChange={vi.fn()}
		onRetry={options.onRetry ?? vi.fn()}
	/>
);

describe("AgentRuntimeConfigControls", () => {
	beforeEach(() => {
		ensurePointerCaptureMocks();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("shows a loading hint before runtime config options are loaded", () => {
		renderControls(undefined, { isLoading: true });

		expect(screen.getByRole("status")).toHaveTextContent("配置读取中");
		expect(screen.queryByText("模型")).toBeNull();
		expect(screen.queryByText("推理强度")).toBeNull();
		expect(screen.queryByText("模式")).toBeNull();
	});

	it("shows a compact recovery state and runs its recovery callbacks", () => {
		const onOpenSettings = vi.fn();
		const onRetry = vi.fn();
		renderControls(undefined, {
			errorMessage: "Agent 尚未认证，请先配置凭据",
			onOpenSettings,
			onRetry,
		});

		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("Agent 尚未认证，请先配置凭据");
		expect(screen.queryByLabelText("模型")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		fireEvent.click(screen.getByRole("button", { name: "前往设置" }));

		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onOpenSettings).toHaveBeenCalledTimes(1);
	});

	it("keeps stale runtime options visible when a refresh fails", () => {
		renderControls(baseConfig, { errorMessage: "运行时暂时不可用" });

		expect(screen.getByLabelText("模型")).toBeTruthy();
		expect(screen.getByLabelText("模式")).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
	});

	it("shows only returned runtime config controls", () => {
		renderControls(baseConfig);

		expect(screen.getByLabelText("模型")).toBeTruthy();
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

		expect(screen.getByText("提供商")).toBeTruthy();
		expect(screen.getByText("GLM-4 Flash")).toBeTruthy();
		expect(screen.getByRole("button", { name: "MediaGo" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "MiniMax 国内" }));
		fireEvent.click(screen.getByRole("button", { name: "MiniMax-M3" }));

		expect(onModelChange).toHaveBeenCalledWith("minimax/minimax-m3");
	});

	it("uses the standard select for providerless model options", async () => {
		renderControls(
			{
				model: {
					configId: "model",
					currentValue: "gpt-5.5",
					options: [
						{ name: "GPT-5.5", value: "gpt-5.5" },
						{ name: "GPT-5.4", value: "gpt-5.4" },
					],
				},
			},
			{ modelValue: "gpt-5.5" },
		);

		expect(agentModelTriggerBrands(document.body)).toEqual(["gpt"]);
		const modelTriggerBrand = screen
			.getByRole("combobox", { name: "模型" })
			.querySelector(".agent-config-brand");
		expect(modelTriggerBrand?.className).toContain("!flex-none");
		expect(modelTriggerBrand?.className).toContain("!overflow-visible");

		openSelect("模型");

		expect(await screen.findByRole("option", { name: "GPT-5.5" })).toBeTruthy();
		expect(screen.getByRole("option", { name: "GPT-5.4" })).toBeTruthy();
		expect(screen.queryByLabelText("提供商和模型")).toBeNull();
		expect(screen.queryByText("提供商")).toBeNull();
		expect(screen.queryByRole("button", { name: "默认提供方" })).toBeNull();
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
		const menu = screen.getByLabelText("提供商和模型");

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
		const menu = screen.getByLabelText("提供商和模型");

		expect(menu.getAttribute("style")).toContain(
			"5 * var(--generation-model-popover-option-height)",
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
		const menu = screen.getByLabelText("提供商和模型");
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

	it("reopens the model menu on the selected model category", () => {
		renderControls(
			{
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
			},
			{ modelValue: "mediago/glm-4-flash" },
		);

		const trigger = screen.getByRole("button", { name: "模型" });
		fireEvent.click(trigger);
		fireEvent.pointerEnter(screen.getByRole("button", { name: "MiniMax 国内" }));

		expect(screen.getByText("MiniMax-M3")).toBeTruthy();
		expect(screen.queryByText("GLM-4 Flash")).toBeNull();

		fireEvent.click(trigger);
		expect(screen.queryByLabelText("提供商和模型")).toBeNull();

		fireEvent.click(trigger);
		expect(screen.getByText("GLM-4 Flash")).toBeTruthy();
		expect(screen.queryByText("MiniMax-M3")).toBeNull();
	});

	it("positions the selected model row when opening a long model list", async () => {
		const originalElementScrollIntoView = Element.prototype.scrollIntoView;
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
		const scrollIntoView = vi.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		HTMLElement.prototype.scrollIntoView = scrollIntoView;

		try {
			renderControls(
				{
					model: {
						configId: "model",
						currentValue: "mediago/minimax-m3",
						options: [
							"glm-4.7",
							"glm-5.2",
							"gpt-4.1",
							"gpt-4.1-mini",
							"minimax-m2.7",
							"minimax-m2.7-highspeed",
							"minimax-m3",
						].map((model) => ({
							name: `MediaGo/${model}`,
							value: `mediago/${model}`,
						})),
					},
				},
				{ modelValue: "mediago/minimax-m3" },
			);

			fireEvent.click(screen.getByRole("button", { name: "模型" }));

			const selectedCategory = screen.getByRole("button", { name: "MediaGo" });
			const selectedModel = screen.getByRole("button", { name: "minimax-m3" });
			await waitFor(() => {
				expect(scrollIntoView.mock.contexts).toEqual(
					expect.arrayContaining([selectedCategory, selectedModel]),
				);
			});
		} finally {
			if (originalElementScrollIntoView) {
				Element.prototype.scrollIntoView = originalElementScrollIntoView;
			} else {
				delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
			}
			if (originalScrollIntoView) {
				HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
			} else {
				delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
			}
		}
	});

	it("does not snap the model list back to the selected row while scrolling", async () => {
		const originalElementScrollIntoView = Element.prototype.scrollIntoView;
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
		const scrollIntoView = vi.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		HTMLElement.prototype.scrollIntoView = scrollIntoView;

		try {
			renderControls(
				{
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
				},
				{ modelValue: "mediago/glm-4.7" },
			);

			fireEvent.click(screen.getByRole("button", { name: "模型" }));
			await waitFor(() => {
				expect(scrollIntoView).toHaveBeenCalled();
			});
			scrollIntoView.mockClear();

			const modelList = screen.getByRole("button", { name: "qwen3.5-27b" })
				.parentElement as HTMLElement;
			let scrollTop = 0;
			Object.defineProperties(modelList, {
				clientHeight: { configurable: true, value: 200 },
				scrollHeight: { configurable: true, value: 800 },
				scrollTop: {
					configurable: true,
					get: () => scrollTop,
					set: (value) => {
						scrollTop = Number(value);
					},
				},
			});

			scrollTop = 200;
			fireEvent.scroll(modelList);
			scrollTop = 600;
			fireEvent.scroll(modelList);

			await new Promise((resolve) => window.setTimeout(resolve, 0));
			expect(scrollIntoView).not.toHaveBeenCalled();
		} finally {
			if (originalElementScrollIntoView) {
				Element.prototype.scrollIntoView = originalElementScrollIntoView;
			} else {
				delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
			}
			if (originalScrollIntoView) {
				HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
			} else {
				delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
			}
		}
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

	it("switches model category when the pointer dwells on a crossed category", () => {
		vi.useFakeTimers();
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

		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(screen.getByText("MiniMax-M3")).toBeTruthy();
		expect(screen.queryByText("GLM-4 Flash")).toBeNull();
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

describe("getRuntimeConfigError", () => {
	it("preserves the message from a plain ApiError object", () => {
		expect(
			getRuntimeConfigError({
				code: 503,
				message: "Agent 尚未认证，请先配置凭据",
			}),
		).toBe("Agent 尚未认证，请先配置凭据");
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

const openSelect = (label: string) => {
	fireEvent.pointerDown(screen.getByRole("combobox", { name: label }), {
		button: 0,
		ctrlKey: false,
		pageX: 0,
		pageY: 0,
		pointerId: 1,
		pointerType: "mouse",
	});
};

const ensurePointerCaptureMocks = () => {
	const pointerCaptureMethods = {
		hasPointerCapture: () => false,
		releasePointerCapture: () => undefined,
		scrollIntoView: () => undefined,
		setPointerCapture: () => undefined,
	};

	for (const [methodName, implementation] of Object.entries(pointerCaptureMethods)) {
		if (methodName in HTMLElement.prototype) continue;
		Object.defineProperty(HTMLElement.prototype, methodName, {
			configurable: true,
			value: implementation,
			writable: true,
		});
	}
};
