import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentTurnLifecycle, AgentTurnOutcome } from "@/domains/agent/stores";
import { ProcessDisclosure } from "./ProcessDisclosure";

describe("ProcessDisclosure", () => {
	afterEach(() => {
		cleanup();
	});

	it.each<AgentTurnLifecycle>(["pending", "in_progress", "waiting"])(
		"keeps %s turns open in auto mode",
		(lifecycle) => {
			renderDisclosure({ lifecycle });

			const trigger = screen.getByRole("button", { name: /(处理|确认)/ });
			expect(trigger).toHaveAttribute("aria-expanded", "true");
			expect(disclosureRegion(trigger)).toHaveTextContent("过程内容");
			expect(disclosureRegion(trigger)).toHaveAttribute("aria-hidden", "false");
		},
	);

	it.each<{
		outcome: AgentTurnOutcome;
		expanded: boolean;
		label: string;
	}>([
		{ outcome: "succeeded", expanded: false, label: "已处理" },
		{ outcome: "cancelled", expanded: false, label: "已取消" },
		{ outcome: "refused", expanded: false, label: "已拒绝" },
		{ outcome: "failed", expanded: true, label: "处理失败" },
		{ outcome: "interrupted", expanded: true, label: "已中断" },
	])("uses the automatic policy for a completed $outcome turn", ({ outcome, expanded, label }) => {
		renderDisclosure({ lifecycle: "completed", outcome });

		const trigger = screen.getByRole("button", { name: new RegExp(label) });
		expect(trigger).toHaveAttribute("aria-expanded", String(expanded));
		expect(disclosureRegion(trigger)).toHaveAttribute("aria-hidden", String(!expanded));
		if (expanded) {
			expect(disclosureRegion(trigger)).not.toHaveAttribute("inert");
		} else {
			expect(disclosureRegion(trigger)).toHaveAttribute("inert");
		}
	});

	it("shows a compact Codex-style status summary", () => {
		renderDisclosure({
			lifecycle: "completed",
			outcome: "succeeded",
			durationMs: 174_000,
			itemCount: 4,
		});

		const trigger = screen.getByRole("button", { name: /已处理/ });
		expect(trigger).toHaveTextContent("2m 54s");
		expect(trigger).toHaveTextContent("4 项");
	});

	it("keeps the running summary static so the process body owns the loading indicator", () => {
		renderDisclosure({ lifecycle: "in_progress" });

		const trigger = screen.getByRole("button", { name: /正在处理/ });
		expect(trigger.querySelector(".lucide-loader-circle")).toBeNull();
		expect(trigger).toHaveTextContent("正在处理");
	});

	it("hides an unknown zero duration and labels real subsecond work", () => {
		const { rerender } = renderDisclosure({
			lifecycle: "completed",
			outcome: "succeeded",
			durationMs: 0,
		});
		let trigger = screen.getByRole("button", { name: /已处理/ });
		expect(trigger).not.toHaveTextContent("0s");

		rerender(
			<DisclosureFixture
				turnId="turn-1"
				lifecycle="completed"
				outcome="succeeded"
				durationMs={420}
			/>,
		);
		trigger = screen.getByRole("button", { name: /已处理/ });
		expect(trigger).toHaveTextContent("<1s");
	});

	it("drops manual overrides made before completion when the turn becomes terminal", () => {
		const { rerender } = renderDisclosure({ lifecycle: "in_progress" });
		let trigger = screen.getByRole("button", { name: /正在处理/ });

		fireEvent.click(trigger);
		expect(trigger).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(trigger);
		expect(trigger).toHaveAttribute("aria-expanded", "true");

		rerender(<DisclosureFixture turnId="turn-1" lifecycle="completed" outcome="succeeded" />);
		trigger = screen.getByRole("button", { name: /已处理/ });
		expect(trigger).toHaveAttribute("aria-expanded", "false");

		rerender(<DisclosureFixture turnId="turn-1" lifecycle="in_progress" />);
		trigger = screen.getByRole("button", { name: /正在处理/ });
		fireEvent.click(trigger);

		rerender(<DisclosureFixture turnId="turn-1" lifecycle="completed" outcome="failed" />);
		trigger = screen.getByRole("button", { name: /处理失败/ });
		expect(trigger).toHaveAttribute("aria-expanded", "true");

		rerender(<DisclosureFixture turnId="turn-2" lifecycle="completed" outcome="failed" />);
		trigger = screen.getByRole("button", { name: /处理失败/ });
		expect(trigger).toHaveAttribute("aria-expanded", "true");

		fireEvent.click(trigger);
		rerender(<DisclosureFixture turnId="turn-2" lifecycle="completed" outcome="succeeded" />);
		expect(screen.getByRole("button", { name: /已处理/ })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});

	it("keeps a manually opened completed turn open across terminal outcome updates", () => {
		const { rerender } = renderDisclosure({
			lifecycle: "completed",
			outcome: "succeeded",
		});
		let trigger = screen.getByRole("button", { name: /已处理/ });

		fireEvent.click(trigger);
		expect(trigger).toHaveAttribute("aria-expanded", "true");

		rerender(<DisclosureFixture turnId="turn-1" lifecycle="completed" outcome="cancelled" />);
		trigger = screen.getByRole("button", { name: /已取消/ });
		expect(trigger).toHaveAttribute("aria-expanded", "true");

		rerender(<DisclosureFixture turnId="turn-2" lifecycle="completed" outcome="cancelled" />);
		expect(screen.getByRole("button", { name: /已取消/ })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});

	it("moves focus to the summary trigger when automatic completion collapses process content", () => {
		const { rerender } = renderDisclosure({ lifecycle: "in_progress" });
		const innerAction = screen.getByRole("button", { name: "过程操作" });
		innerAction.focus();
		expect(innerAction).toHaveFocus();

		rerender(<DisclosureFixture turnId="turn-1" lifecycle="completed" outcome="succeeded" />);
		const trigger = screen.getByRole("button", { name: /已处理/ });
		expect(trigger).toHaveAttribute("aria-expanded", "false");
		expect(trigger).toHaveFocus();
		expect(disclosureRegion(trigger)).toHaveAttribute("aria-hidden", "true");
	});

	it.each(["Enter", " "])("toggles from the keyboard with %j", (key) => {
		renderDisclosure({ lifecycle: "completed", outcome: "succeeded" });
		const trigger = screen.getByRole("button", { name: /已处理/ });
		trigger.focus();

		fireEvent.keyDown(trigger, { key });
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByText("过程内容")).toBeInTheDocument();
	});
});

const disclosureRegion = (trigger: HTMLElement) => {
	const contentId = trigger.getAttribute("aria-controls");
	expect(contentId).toBeTruthy();
	const region = document.getElementById(contentId ?? "");
	expect(region).not.toBeNull();
	return region as HTMLElement;
};

interface DisclosureFixtureProps {
	turnId?: string;
	lifecycle?: AgentTurnLifecycle;
	outcome?: AgentTurnOutcome | null;
	durationMs?: number;
	itemCount?: number;
}

const DisclosureFixture = ({
	turnId = "turn-1",
	lifecycle = "in_progress",
	outcome = null,
	durationMs = 1_800,
	itemCount = 2,
}: DisclosureFixtureProps) => (
	<ProcessDisclosure
		turnId={turnId}
		lifecycle={lifecycle}
		outcome={outcome}
		durationMs={durationMs}
		itemCount={itemCount}
	>
		<p>过程内容</p>
		<button type="button">过程操作</button>
	</ProcessDisclosure>
);

const renderDisclosure = (props: DisclosureFixtureProps = {}) =>
	render(<DisclosureFixture {...props} />);
