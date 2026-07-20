import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePromptOptimize } from "./usePromptOptimize";

const mocks = vi.hoisted(() => ({
	getCodexAccount: vi.fn(),
	streamGenerationText: vi.fn(),
}));

vi.mock("@/domains/settings/api/settings", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/settings/api/settings")>();
	return { ...actual, getCodexAccount: mocks.getCodexAccount };
});

vi.mock("@/domains/generation/api/generation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/generation/api/generation")>();
	return { ...actual, streamGenerationText: mocks.streamGenerationText };
});

const Harness = () => {
	const optimizer = usePromptOptimize({
		catalog: { families: [], models: [], providers: [], routes: [], versions: [] },
		onOptimized: vi.fn(),
	});
	return (
		<button
			type="button"
			disabled={!optimizer.canOptimize}
			onClick={() =>
				void optimizer.optimize({
					currentPrompt: "a hero",
					referenceName: "cinematic",
					referencePrompt: "cinematic lighting",
				})
			}
		>
			{optimizer.codexAvailable ? "Codex ready" : "Unavailable"}
		</button>
	);
};

describe("usePromptOptimize", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getCodexAccount.mockResolvedValue({
			codexHome: "/tmp/codex",
			shared: true,
			status: "loggedIn",
		});
		mocks.streamGenerationText.mockImplementation(async (_request, handlers) => {
			handlers.onDone?.({ text: "optimized", status: "completed" });
		});
	});

	it("uses Codex when no configured text route exists", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<Harness />
			</SWRConfig>,
		);

		const button = await screen.findByRole("button", { name: "Codex ready" });
		fireEvent.click(button);

		await waitFor(() => expect(mocks.streamGenerationText).toHaveBeenCalledTimes(1));
		expect(mocks.streamGenerationText.mock.calls[0]?.[0]).toMatchObject({
			kind: "text",
			model: "",
			routeId: "",
			textExecutor: "codex",
		});
	});
});
