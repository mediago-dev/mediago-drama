import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeConfigPayload } from "@/domains/agent/api/agent";
import {
	AgentRuntimeConfigControls,
	buildRuntimeConfigSelections,
} from "./AgentRuntimeConfigControls";

const baseConfig: AgentRuntimeConfigPayload = {
	options: [
		{
			configId: "model",
			category: "model",
			currentValue: "mini",
			options: [{ name: "MiniMax", value: "mini" }],
		},
		{
			configId: "permission",
			category: "mode",
			name: "模式",
			currentValue: "build",
			options: [{ name: "build", value: "build" }],
		},
	],
};

const renderControls = (
	config?: AgentRuntimeConfigPayload,
	options: { isLoading?: boolean; errorMessage?: string } = {},
) =>
	render(
		<AgentRuntimeConfigControls
			config={config}
			selections={{}}
			disabled={false}
			errorMessage={options.errorMessage ?? ""}
			isLoading={options.isLoading ?? false}
			onSelectionChange={vi.fn()}
		/>,
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
			options: [
				...baseConfig.options,
				{
					configId: "reasoning",
					category: "thought_level",
					currentValue: "medium",
					options: [{ name: "中等", value: "medium" }],
				},
			],
		});

		expect(screen.getByText("推理强度")).toBeTruthy();
		expect(screen.getByText("中等")).toBeTruthy();
	});

	it("renders arbitrary config options that do not match known categories", () => {
		renderControls({
			options: [
				{
					configId: "custom_toggle",
					name: "自定义开关",
					currentValue: "on",
					options: [
						{ name: "开", value: "on" },
						{ name: "关", value: "off" },
					],
				},
			],
		});

		expect(screen.getByText("自定义开关")).toBeTruthy();
		expect(screen.getByText("开")).toBeTruthy();
	});
});

describe("buildRuntimeConfigSelections", () => {
	it("builds a selection per config option from the selections map", () => {
		const selections = buildRuntimeConfigSelections(
			{
				options: [
					{
						configId: "model",
						source: "configOption",
						currentValue: "mini",
						options: [{ name: "MiniMax", value: "mini" }],
					},
					{
						configId: "reasoning",
						source: "configOption",
						currentValue: "high",
						options: [{ name: "High", value: "high" }],
					},
				],
			},
			{ model: "mini" },
		);

		expect(selections).toEqual([
			{ configId: "model", source: "configOption", value: "mini" },
			{ configId: "reasoning", source: "configOption", value: "high" },
		]);
	});

	it("skips config options that expose no selectable choices", () => {
		const selections = buildRuntimeConfigSelections(
			{
				options: [
					{
						configId: "model",
						source: "configOption",
						currentValue: "mini",
						options: [{ name: "MiniMax", value: "mini" }],
					},
					{
						configId: "empty",
						source: "configOption",
						options: [],
					},
				],
			},
			{},
		);

		expect(selections).toEqual([{ configId: "model", source: "configOption", value: "mini" }]);
	});
});
