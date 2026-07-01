import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Projects } from "./Projects";
import httpClient from "@/shared/lib/http";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import { useProjectStore } from "@/domains/projects/stores";
import { ConfirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { ProjectRenameDialog } from "@/domains/projects/components/ProjectRenameDialog";
import type { ApiResponse } from "@/types/api";

vi.mock("@/shared/lib/http", () => ({
	default: {
		delete: vi.fn(),
		get: vi.fn(),
		patch: vi.fn(),
		post: vi.fn(),
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

const activeProject: WorkspaceProject = {
	createdAt: "2026-06-18T16:00:00Z",
	description: "",
	documentCount: 2,
	id: "project-111",
	name: "短剧项目",
	projectDir: "/Users/example/project-111",
	relativeDir: "project-111",
	status: "active",
	updatedAt: "2026-06-18T16:05:00Z",
};

describe("Projects", () => {
	let isProjectDeleted = false;
	let activeProjectStatus: WorkspaceProject["status"] = "active";
	let activeProjectName = activeProject.name;

	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
		useProjectStore.getState().setActiveProjectId(null);
		isProjectDeleted = false;
		activeProjectStatus = "active";
		activeProjectName = activeProject.name;
		vi.mocked(httpClient.get).mockImplementation(async (_url, config) => {
			const status = config?.params?.status ?? "active";
			const projects = projectsForStatus(
				status,
				activeProjectStatus,
				isProjectDeleted,
				activeProjectName,
			);
			return apiResponse({ databasePath: "", projects, workspaceDir: "" });
		});
		vi.mocked(httpClient.post).mockImplementation(async (url) => {
			if (url === "/projects/project-111/archive") {
				activeProjectStatus = "archived";
				return apiResponse(projectWithStatus("archived", activeProjectName));
			}
			if (url === "/projects/project-111/restore") {
				activeProjectStatus = "active";
				return apiResponse(projectWithStatus("active", activeProjectName));
			}
			return apiResponse({});
		});
		vi.mocked(httpClient.patch).mockImplementation(async (url, payload) => {
			if (url === "/projects/project-111") {
				activeProjectName = (payload as { name: string }).name;
				return apiResponse(projectWithStatus(activeProjectStatus, activeProjectName));
			}
			return apiResponse({});
		});
		vi.mocked(httpClient.delete).mockImplementation(async (url) => {
			if (url === "/projects/project-111") {
				activeProjectStatus = "trashed";
				return apiResponse(projectWithStatus("trashed", activeProjectName));
			}
			if (url === "/projects/project-333/permanent") {
				isProjectDeleted = true;
				return apiResponse(trashedProject);
			}
			return apiResponse({});
		});
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
		useProjectStore.getState().setActiveProjectId(null);
	});

	it("opens an active project when clicking the row body", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter>
					<Projects />
					<LocationProbe />
				</MemoryRouter>
			</SWRConfig>,
		);

		const row = await screen.findByRole("button", { name: /短剧项目/ });
		fireEvent.click(row);

		await waitFor(() => {
			expect(screen.getByTestId("location").textContent).toBe("/projects?projectId=project-111");
		});
		expect(useProjectStore.getState().activeProjectId).toBe("project-111");
	});

	it("archives an active project from the row context menu", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter>
					<Projects />
					<ConfirmDialog />
				</MemoryRouter>
			</SWRConfig>,
		);

		expect(await screen.findByText("短剧项目")).toBeInTheDocument();

		fireEvent.contextMenu(screen.getByText("短剧项目"), { clientX: 48, clientY: 48 });
		fireEvent.click(await screen.findByRole("menuitem", { name: "归档" }));

		await waitFor(() =>
			expect(httpClient.post).toHaveBeenCalledWith("/projects/project-111/archive"),
		);
		await waitFor(() => expect(screen.queryByText("短剧项目")).not.toBeInTheDocument());
		expect(screen.getByText("还没有项目")).toBeInTheDocument();
	});

	it("renames an active project from the row context menu", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter>
					<Projects />
					<ProjectRenameDialog />
				</MemoryRouter>
			</SWRConfig>,
		);

		expect(await screen.findByText("短剧项目")).toBeInTheDocument();

		fireEvent.contextMenu(screen.getByText("短剧项目"), { clientX: 48, clientY: 48 });
		fireEvent.click(await screen.findByRole("menuitem", { name: "重命名" }));

		const dialog = await screen.findByRole("alertdialog", { name: "重命名项目" });
		fireEvent.change(within(dialog).getByRole("textbox", { name: "项目名称" }), {
			target: { value: "短剧项目改名" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "重命名" }));

		await waitFor(() =>
			expect(httpClient.patch).toHaveBeenCalledWith("/projects/project-111", {
				name: "短剧项目改名",
			}),
		);
		expect(await screen.findByText("短剧项目改名")).toBeInTheDocument();
	});

	it("moves an active project to trash from the row context menu", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter>
					<Projects />
					<ConfirmDialog />
				</MemoryRouter>
			</SWRConfig>,
		);

		expect(await screen.findByText("短剧项目")).toBeInTheDocument();

		fireEvent.contextMenu(screen.getByText("短剧项目"), { clientX: 48, clientY: 48 });
		fireEvent.click(await screen.findByRole("menuitem", { name: "移到垃圾箱" }));

		const dialog = await screen.findByRole("alertdialog", { name: "移到垃圾箱？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "移到垃圾箱" }));

		await waitFor(() => expect(httpClient.delete).toHaveBeenCalledWith("/projects/project-111"));
		await waitFor(() => expect(screen.queryByText("短剧项目")).not.toBeInTheDocument());
		expect(screen.getByText("还没有项目")).toBeInTheDocument();
	});

	it("refreshes the trash list after permanently deleting a project", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter>
					<Projects />
					<ConfirmDialog />
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

const projectsForStatus = (
	status: string,
	activeProjectStatus: WorkspaceProject["status"],
	isProjectDeleted: boolean,
	activeProjectName: string,
) => {
	const projects: WorkspaceProject[] = [];
	if (activeProjectStatus === status) {
		projects.push(projectWithStatus(activeProjectStatus, activeProjectName));
	}
	if (status === "trashed" && !isProjectDeleted) projects.push(trashedProject);
	return projects;
};

const projectWithStatus = (
	status: WorkspaceProject["status"],
	name = activeProject.name,
): WorkspaceProject => ({
	...activeProject,
	name,
	status,
	archivedAt: status === "archived" ? "2026-06-18T16:10:00Z" : undefined,
	originalProjectDir: status === "trashed" ? activeProject.projectDir : undefined,
	projectDir:
		status === "trashed"
			? "/Users/example/.mediago-drama/trash/projects/project-111"
			: activeProject.projectDir,
	trashProjectDir:
		status === "trashed" ? "/Users/example/.mediago-drama/trash/projects/project-111" : undefined,
	trashedAt: status === "trashed" ? "2026-06-18T16:10:00Z" : undefined,
	updatedAt: status === "active" ? activeProject.updatedAt : "2026-06-18T16:10:00Z",
});

const apiResponse = <T,>(data: T): ApiResponse<T> => ({
	code: 0,
	data,
	message: "ok",
	success: true,
});

const LocationProbe = () => {
	const location = useLocation();
	return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
};
