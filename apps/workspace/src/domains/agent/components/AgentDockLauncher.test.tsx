import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { AgentDockLauncher } from "./AgentDockLauncher";

describe("AgentDockLauncher", () => {
	afterEach(() => {
		cleanup();
		useAgentLayoutStore.getState().setTab("document");
	});

	it("opens the assistant from the bottom dock", () => {
		render(<AgentDockLauncher />);

		fireEvent.click(screen.getByRole("button", { name: "打开底部制作助理" }));

		expect(useAgentLayoutStore.getState().tab).toBe("agent");
	});
});
