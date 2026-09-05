import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadProjectAsset } from "@/domains/workspace/api/project-assets";
import { ReferenceTransferModule } from "./ReferenceTransferModule";

vi.mock("@/domains/workspace/api/project-assets", () => ({
	getProjectAssets: vi.fn(async () => ({ assets: [] })),
	uploadProjectAsset: vi.fn(),
}));

describe("ReferenceTransferModule", () => {
	afterEach(() => {
		cleanup();
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("adds multiple references and assigns a different visual role to each", async () => {
		vi.mocked(uploadProjectAsset).mockImplementation(async (_projectId, file) => ({
			createdAt: "2026-08-21T00:00:00.000Z",
			filename: file.name,
			folderId: null,
			id: file.name,
			kind: "image",
			mimeType: file.type,
			parentId: null,
			projectId: "project-a",
			sizeBytes: file.size,
			sortOrder: 0,
			updatedAt: "2026-08-21T00:00:00.000Z",
			url: `/assets/${file.name}`,
		}));

		render(<ReferenceTransferModule projectId="project-a" />);

		const input = screen.getByLabelText("选择多张参考图", { selector: "input" });
		fireEvent.change(input, {
			target: {
				files: [
					new File(["style"], "style.png", { type: "image/png" }),
					new File(["pose"], "pose.png", { type: "image/png" }),
				],
			},
		});

		await waitFor(() => expect(uploadProjectAsset).toHaveBeenCalledTimes(2), { timeout: 5000 });
		expect(await screen.findByText("style.png", undefined, { timeout: 5000 })).toBeInTheDocument();
		expect(await screen.findByText("pose.png", undefined, { timeout: 5000 })).toBeInTheDocument();

		const styleButtons = screen.getAllByRole("button", { name: "渲染风格" });
		const poseButtons = screen.getAllByRole("button", { name: "姿势动作" });
		fireEvent.click(styleButtons[0]);
		fireEvent.click(poseButtons[1]);

		expect(styleButtons[0]).toHaveAttribute("aria-pressed", "true");
		expect(poseButtons[1]).toHaveAttribute("aria-pressed", "true");
	});
});
