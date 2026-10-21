import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownHybridEditor } from "./MarkdownHybridEditor";

describe("MarkdownHybridEditor", () => {
	afterEach(() => {
		cleanup();
		delete window.mediagoDesktop;
		vi.unstubAllEnvs();
	});

	it("renders markdown image URLs against the packaged desktop server", async () => {
		vi.stubEnv("DEV", false);
		window.mediagoDesktop = {
			isElectron: true,
			serverOrigin: "http://127.0.0.1:49157",
		} as typeof window.mediagoDesktop;

		render(
			<MarkdownHybridEditor
				documentId="doc-character"
				value="![角色图](</api/v1/media-assets/character/content>)"
				onChange={vi.fn()}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("img", { name: "角色图" })).toHaveAttribute(
				"src",
				"http://127.0.0.1:49157/api/v1/media-assets/character/content",
			);
		});
	});
});
