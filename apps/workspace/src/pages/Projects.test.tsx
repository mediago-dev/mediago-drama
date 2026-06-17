import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Projects } from "./Projects";
import httpClient from "@/shared/lib/http";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import type { ApiResponse } from "@/types/api";

vi.mock("@/shared/lib/http", () => ({
	default: {
		delete: vi.fn(),
		get: vi.fn(),
	},
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
	}),
}));

const trashedProject: WorkspaceProject = {
	createdAt: "2026-06-17T16:00:00Z",
	description: "",
	documentCount: 0,
	id: "project-333",
	name: "333",
	originalProjectDir: "/Users/example/project-333",
	projectDir: "/Users/example/project-333",
	relativeDir: "project-333",
	status: "trashed",
	trashedAt: "2026-06-17T16:05:00Z",
	updatedAt: "2026-06-17T16:05:00Z",
};

describe("Projects", () => {
	let isProjectDeleted = false;

	beforeEach(() => {
		vi.clearAllMocks();
		isProjectDeleted = false;
		vi.mocked(httpClient.get).mockImplementation(async (_url, config) => {
			const status = config?.params?.status;
			const projects = status === "trashed" && !isProjectDeleted ? [trashedProject] : [];
			return apiResponse({ databasePath: "", projects, workspaceDir: "" });
		});
		vi.mocked(httpClient.delete).mockImplementation(async () => {
			isProjectDeleted = true;
			return apiResponse(trashedProject);
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("refreshes the trash list after permanently deleting a project", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter>
					<Projects />
				</MemoryRouter>
			</SWRConfig>,
		);

		fireEvent.click(screen.getByRole("button", { name: "垃圾箱" }));

		expect(await screen.findByText("333")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "永久删除" }));

		await waitFor(() =>
			expect(httpClient.delete).toHaveBeenCalledWith("/projects/project-333/permanent"),
		);
		await waitFor(() => expect(screen.queryByText("333")).not.toBeInTheDocument());
		expect(screen.getByText("垃圾箱为空")).toBeInTheDocument();
	});
});

const apiResponse = <T,>(data: T): ApiResponse<T> => ({
	code: 0,
	data,
	message: "ok",
	success: true,
});
