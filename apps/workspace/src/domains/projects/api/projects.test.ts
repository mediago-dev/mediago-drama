import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	archiveProject,
	getProjects,
	permanentlyDeleteProject,
	projectsKey,
	projectsKeyForStatus,
	restoreProject,
} from "@/domains/projects/api/projects";
import httpClient from "@/shared/lib/http";
import type { ApiResponse } from "@/types/api";

vi.mock("@/shared/lib/http", () => ({
	default: {
		delete: vi.fn(),
		get: vi.fn(),
		post: vi.fn(),
	},
}));

describe("project api", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds stable SWR keys for project status filters", () => {
		expect(projectsKeyForStatus()).toBe(projectsKey);
		expect(projectsKeyForStatus("active")).toBe(projectsKey);
		expect(projectsKeyForStatus("archived")).toBe("/projects?status=archived");
		expect(projectsKeyForStatus("trashed")).toBe("/projects?status=trashed");
	});

	it("fetches active projects without status params", async () => {
		vi.mocked(httpClient.get).mockResolvedValueOnce(
			apiResponse({ databasePath: "", projects: [], workspaceDir: "" }),
		);

		await getProjects();

		expect(httpClient.get).toHaveBeenCalledWith(projectsKey);
	});

	it("fetches archived and trashed projects with status params", async () => {
		vi.mocked(httpClient.get).mockResolvedValue(
			apiResponse({ databasePath: "", projects: [], workspaceDir: "" }),
		);

		await getProjects("archived");
		await getProjects("trashed");

		expect(httpClient.get).toHaveBeenNthCalledWith(1, projectsKey, {
			params: { status: "archived" },
		});
		expect(httpClient.get).toHaveBeenNthCalledWith(2, projectsKey, {
			params: { status: "trashed" },
		});
	});

	it("calls project lifecycle endpoints", async () => {
		const project = {
			createdAt: "",
			description: "",
			documentCount: 0,
			id: "project one",
			name: "Project One",
			relativeDir: "",
			updatedAt: "",
		};
		vi.mocked(httpClient.post).mockResolvedValue(apiResponse(project));
		vi.mocked(httpClient.delete).mockResolvedValue(apiResponse(project));

		await archiveProject("project one");
		await restoreProject("project one");
		await permanentlyDeleteProject("project one");

		expect(httpClient.post).toHaveBeenNthCalledWith(1, "/projects/project%20one/archive");
		expect(httpClient.post).toHaveBeenNthCalledWith(2, "/projects/project%20one/restore");
		expect(httpClient.delete).toHaveBeenCalledWith("/projects/project%20one/permanent");
	});
});

const apiResponse = <T>(data: T): ApiResponse<T> => ({
	code: 0,
	data,
	message: "ok",
	success: true,
});
