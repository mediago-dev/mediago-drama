import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { AgentWorkbenchHeaderActions } from "./AgentWorkbenchTopBar";

const LocationProbe = () => {
	const location = useLocation();
	return <div data-testid="location" data-path={`${location.pathname}${location.search}`} />;
};

const renderHeaderActions = () =>
	render(
		<MemoryRouter initialEntries={["/projects?projectId=project-1&workspace=reference"]}>
			<AgentWorkbenchHeaderActions mode="agent" showTabs />
			<LocationProbe />
		</MemoryRouter>,
	);

describe("AgentWorkbenchHeaderActions", () => {
	afterEach(() => {
		cleanup();
		useAgentLayoutStore.getState().setTab("document");
		localStorage.clear();
	});

	it("opens the assistant without changing the current workspace", () => {
		useAgentLayoutStore.getState().setTab("document");
		renderHeaderActions();
		fireEvent.click(screen.getByRole("button", { name: "打开制作助理" }));

		expect(useAgentLayoutStore.getState().tab).toBe("agent");
		expect(screen.getByTestId("location").dataset.path).toBe(
			"/projects?projectId=project-1&workspace=reference",
		);
	});

	it("closes the assistant without replacing project content", () => {
		useAgentLayoutStore.getState().setTab("agent");
		renderHeaderActions();
		fireEvent.click(screen.getByRole("button", { name: "收起制作助理" }));

		expect(useAgentLayoutStore.getState().tab).toBe("document");
	});
});
