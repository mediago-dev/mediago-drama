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
import {
	productionStageStates,
	productionTemplateById,
	productionTemplateSnapshot,
} from "@/lib/production/production-templates";

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
		vi.mocked(httpClient.get).mockImplementation(async (url, config) => {
			if (url === "/projects/project-111/config") {
				return apiResponse(projectConfigForActiveProject(activeProjectName));
			}
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
			const location = new URL(
				screen.getByTestId("location").textContent ?? "",
				"http://localhost",
			);
			expect(location.pathname).toBe("/projects");
			expect(location.searchParams.get("projectId")).toBe("project-111");
			expect(location.searchParams.get("workspace")).toBe("workflow");
			expect(location.searchParams.get("stageId")).toBe("stage-1");
		});
		expect(useProjectStore.getState().activeProjectId).toBe("project-111");
	});

	it("uses the durable project config for the current stage when the list summary is stale", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<MemoryRouter>
					<Projects />
				</MemoryRouter>
			</SWRConfig>,
		);

		// The list fixture intentionally has no production summary. The config request
		// remains the source of truth for the current production stage shown here.
		const projectCard = await screen.findByRole("button", { name: /短剧项目/ });
		expect(projectCard).toHaveTextContent("01 创意与分镜定稿");
		expect(httpClient.get).toHaveBeenCalledWith("/projects/project-111/config");
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
		expect(screen.getByRole("button", { name: "创建第一个项目" })).toBeInTheDocument();
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
		expect(screen.getByRole("button", { name: "创建第一个项目" })).toBeInTheDocument();
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

const projectConfigForActiveProject = (name: string) => {
	const template = productionTemplateById("commercial-film");
	return {
		schemaVersion: 1 as const,
		projectId: activeProject.id,
		name,
		description: activeProject.description,
		overview: {
			production: {
				template: productionTemplateSnapshot(template),
				stageStates: {
					...productionStageStates(template),
					"stage-1": {
						...productionStageStates(template)["stage-1"],
						status: "REVIEW" as const,
					},
				},
				currentStageId: "stage-1",
				overallProgress: 3,
				coreAssetCount: 0,
				shotCount: 0,
				completedShotCount: 0,
				reviewShotCount: 0,
				version: "V01",
				updatedAt: "2026-06-18T16:05:00Z",
			},
		},
		createdAt: activeProject.createdAt,
	};
};

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
