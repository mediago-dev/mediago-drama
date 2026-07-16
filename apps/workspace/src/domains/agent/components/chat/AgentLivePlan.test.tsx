import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import { AgentLivePlan, activePlanFromMessages } from "./AgentLivePlan";

afterEach(cleanup);

const planMessage = (
	entries: NonNullable<AgentMessage["metadata"]>["planEntries"],
	id = "plan-1",
): AgentMessage => ({
	id,
	role: "assistant",
	kind: "plan",
	content: entries?.map((entry) => entry.content).join("\n") ?? "",
	metadata: { planEntries: entries },
});

describe("AgentLivePlan", () => {
	it("selects the latest structured plan and derives its current step", () => {
		const first = planMessage([{ content: "旧计划", status: "in_progress" }], "old-plan");
		const latest = planMessage(
			[
				{ content: "读取素材", status: "completed" },
				{ content: "生成分镜", status: "in_progress" },
				{ content: "检查结果", status: "pending" },
			],
			"latest-plan",
		);

		expect(activePlanFromMessages([first, latest])).toMatchObject({
			currentStep: 2,
			entries: latest.metadata?.planEntries,
		});
	});

	it("uses the first pending step when the runtime has not marked one in progress", () => {
		const plan = activePlanFromMessages([
			planMessage([
				{ content: "读取素材", status: "completed" },
				{ content: "生成分镜", status: "pending" },
				{ content: "检查结果", status: "pending" },
			]),
		]);

		expect(plan?.currentStep).toBe(2);
	});

	it("renders an expanded card and toggles it from the progress pill", () => {
		render(
			<AgentLivePlan
				isRunning
				messages={[
					planMessage([
						{ content: "读取素材", status: "completed" },
						{ content: "生成分镜", status: "in_progress" },
						{ content: "检查结果", status: "pending" },
					])!,
				]}
			/>,
		);

		const toggle = screen.getByRole("button", { name: "收起执行计划，第 2 / 3 步" });
		const region = screen.getByRole("region", { name: "执行计划" });
		expect(toggle).toHaveAttribute("aria-expanded", "true");
		expect(region).toHaveTextContent("读取素材");
		expect(region).toHaveTextContent("生成分镜");

		fireEvent.click(toggle);

		expect(screen.getByRole("button", { name: "展开执行计划，第 2 / 3 步" })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		expect(screen.queryByRole("region", { name: "执行计划" })).not.toBeInTheDocument();
	});

	it("does not render without an active structured plan", () => {
		const { rerender } = render(
			<AgentLivePlan
				isRunning={false}
				messages={[planMessage([{ content: "完成", status: "completed" }])!]}
			/>,
		);
		expect(screen.queryByTestId("agent-live-plan")).not.toBeInTheDocument();

		rerender(
			<AgentLivePlan
				isRunning
				messages={[{ id: "note", role: "assistant", kind: "message", content: "处理中" }]}
			/>,
		);
		expect(screen.queryByTestId("agent-live-plan")).not.toBeInTheDocument();
	});

	it("shows a failed step with the error status treatment", () => {
		const { container } = render(
			<AgentLivePlan
				isRunning
				messages={[
					planMessage([
						{ content: "读取素材", status: "completed" },
						{ content: "生成分镜", status: "failed" },
						{ content: "检查结果", status: "pending" },
					]),
				]}
			/>,
		);

		expect(screen.getByRole("button", { name: "收起执行计划，第 2 / 3 步" })).toBeTruthy();
		expect(container.querySelector(".agent-plan-status-icon.text-error-foreground")).not.toBeNull();
	});
});
