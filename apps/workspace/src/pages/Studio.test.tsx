import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGenerationConversations } from "@/domains/generation/api/generation";
import { StudioImage, StudioVideoUnderstand } from "./Studio";

vi.mock("@/domains/capabilities/components/CapabilityGrid", () => ({
	CapabilityGrid: () => <div data-testid="capability-grid" />,
}));

vi.mock("@/domains/generation/components/GenerationWorkspace", () => ({
	GenerationWorkspace: ({
		conversationId,
		conversationScopeId,
	}: {
		conversationId?: string | null;
		conversationScopeId?: string | null;
	}) => (
		<div
			data-testid="generation-workspace"
			data-conversation-id={conversationId ?? ""}
			data-conversation-scope-id={conversationScopeId ?? ""}
		/>
	),
}));

vi.mock("@/domains/generation/api/generation", () => ({
	defaultGenerationConversationScopeId: "studio",
	generationConversationsQueryKey: (kind?: string, scopeId = "studio") => [
		"/generation/conversations",
		scopeId,
		kind ?? "",
	],
	getGenerationConversations: vi.fn(),
}));

const LocationProbe = () => {
	const location = useLocation();
	return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

const renderStudioImage = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<MemoryRouter initialEntries={["/toolbox/image"]}>
				<Routes>
					<Route
						path="/toolbox/image"
						element={
							<>
								<StudioImage />
								<LocationProbe />
							</>
						}
					/>
				</Routes>
			</MemoryRouter>
		</SWRConfig>,
	);

const renderStudioVideoUnderstand = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<MemoryRouter initialEntries={["/toolbox/video-understand?run=run-1"]}>
				<Routes>
					<Route path="/toolbox/video-understand" element={<StudioVideoUnderstand />} />
				</Routes>
			</MemoryRouter>
		</SWRConfig>,
	);

const generationConversation = (id: string, updatedAt: string) => ({
	id,
	scopeId: "studio",
	kind: "image" as const,
	title: id,
	taskCount: 0,
	createdAt: updatedAt,
	updatedAt,
});

describe("StudioGenerationPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("keeps the generation workspace empty when no session exists", async () => {
		vi.mocked(getGenerationConversations).mockResolvedValue({ conversations: [] });

		renderStudioImage();

		await waitFor(() =>
			expect(getGenerationConversations).toHaveBeenCalledWith("image", "studio", {
				allScopes: true,
			}),
		);
		expect(screen.queryByTestId("generation-workspace")).toBeNull();
		expect(screen.getByTestId("location").textContent).toBe("/toolbox/image");
	});

	it("opens the latest session when no session is selected", async () => {
		vi.mocked(getGenerationConversations).mockResolvedValue({
			conversations: [
				generationConversation("session-new", "2026-06-06T12:00:00Z"),
				generationConversation("session-old", "2026-06-06T11:00:00Z"),
			],
		});

		renderStudioImage();

		await waitFor(() =>
			expect(screen.getByTestId("location").textContent).toBe(
				"/toolbox/image?conversation=session-new",
			),
		);
		expect(screen.getByTestId("generation-workspace").getAttribute("data-conversation-id")).toBe(
			"session-new",
		);
		expect(
			screen.getByTestId("generation-workspace").getAttribute("data-conversation-scope-id"),
		).toBe("studio");
	});
});

describe("StudioComingSoonPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("renders coming soon without loading capability run chrome", () => {
		renderStudioVideoUnderstand();

		expect(screen.getByText("视频理解")).toBeTruthy();
		expect(screen.getByText("Coming soon")).toBeTruthy();
		expect(screen.queryByTestId("capability-grid")).toBeNull();
	});
});
