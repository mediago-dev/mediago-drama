import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { AgentWorkbenchHeaderActions } from "./AgentWorkbenchTopBar";

const LocationProbe = () => {
	const location = useLocation();
	const state = location.state as { projectView?: string } | null;
	return (
		<div
			data-testid="location"
			data-path={`${location.pathname}${location.search}`}
			data-project-view={state?.projectView ?? ""}
		/>
	);
};

const renderHeaderActions = (initialEntry: string) =>
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route
					path="/agent"
					element={
						<>
							<AgentWorkbenchHeaderActions mode="agent" showTabs />
							<LocationProbe />
						</>
					}
				/>
			</Routes>
		</MemoryRouter>,
	);

describe("AgentWorkbenchHeaderActions", () => {
	afterEach(() => {
		cleanup();
		useAgentLayoutStore.getState().setTab("agent");
		localStorage.clear();
	});

	it("clears document targets when switching from an asset preview to agent", async () => {
		useAgentLayoutStore.getState().setTab("document");

		renderHeaderActions("/agent?projectId=project-1&assetId=asset-1");
		fireEvent.click(screen.getByRole("button", { name: "agent" }));

		await waitFor(() =>
			expect(screen.getByTestId("location").dataset.path).toBe("/agent?projectId=project-1"),
		);
		expect(screen.getByTestId("location").dataset.projectView).toBe("agent");
	});

	it("marks the clean project route as overview when switching to document", async () => {
		useAgentLayoutStore.getState().setTab("agent");

		renderHeaderActions("/agent?projectId=project-1");
		fireEvent.click(screen.getByRole("button", { name: "文档" }));

		await waitFor(() =>
			expect(screen.getByTestId("location").dataset.projectView).toBe("overview"),
		);
		expect(screen.getByTestId("location").dataset.path).toBe("/agent?projectId=project-1");
	});
});
