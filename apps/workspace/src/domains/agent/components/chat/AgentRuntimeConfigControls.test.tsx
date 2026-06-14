import { cleanup, render, screen } from "@testing-library/react";
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
	options: { isLoading?: boolean; errorMessage?: string } = {},
) =>
	render(
		<AgentRuntimeConfigControls
			config={config}
			disabled={false}
			errorMessage={options.errorMessage ?? ""}
			isLoading={options.isLoading ?? false}
			modelValue=""
			permissionValue=""
			reasoningValue=""
			onModelChange={vi.fn()}
			onPermissionChange={vi.fn()}
			onReasoningChange={vi.fn()}
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
});
