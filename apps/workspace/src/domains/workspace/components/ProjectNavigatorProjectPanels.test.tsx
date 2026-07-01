import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { useDocumentViewStore } from "@/lib/stores/document-view";
import { ProjectSidebarPanel, ProjectsSidebarPanel } from "./ProjectNavigatorProjectPanels";

const project: WorkspaceProject = {
	id: "project-a",
	name: "测试项目",
	description: "",
	relativeDir: "project-a",
	documentCount: 1,
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
};

const document: MarkdownDocument = {
	id: "doc-a",
	title: "第一集",
	content: "",
	category: "screenplay",
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-06-04T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
};

const secondDocument: MarkdownDocument = {
	...document,
	id: "doc-b",
	title: "第二集",
};

const makeProjectAsset = (filename: string, mimeType: string): ProjectAsset => ({
	id: `asset-${filename}`,
	projectId: project.id,
	kind: "text",
	filename,
	mimeType,
	sizeBytes: 16,
	url: `/api/v1/projects/${project.id}/assets/${filename}/content`,
	folderId: null,
	sortOrder: 0,
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
});

describe("ProjectSidebarPanel", () => {
	beforeEach(() => {
		useDocumentViewStore.setState({ mode: "category" });
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: project.id,
			documents: [document],
			folders: [],
			assets: [],
		});
		useDocumentsStore.getState().selectDocument(document.id);
	});

	afterEach(() => {
		cleanup();
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
		useDocumentViewStore.setState({ mode: "directory" });
		localStorage.clear();
	});

	it("hides overview and document active highlights when active selection is disabled", () => {
		renderProjectSidebar(false);

		expect(screen.getByRole("button", { name: "项目概览" }).className).not.toContain(
			"bg-ide-list-active",
		);
		expect(documentItemClassName()).not.toContain("bg-ide-list-active");
	});

	it("highlights overview instead of the store document when no document is in the URL", () => {
		renderProjectSidebar(true);

		expect(screen.getByRole("button", { name: "项目概览" }).className).toContain(
			"bg-ide-list-active",
		);
		expect(documentItemClassName("第一集")).not.toContain("bg-ide-list-active");
	});

	it("uses the URL document as the first sidebar highlight source", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: project.id,
			documents: [document, secondDocument],
			folders: [],
			assets: [],
		});
		useDocumentsStore.getState().selectDocument(document.id);

		renderProjectSidebar(true, {
			isOverviewActive: false,
			locationSearch: "?projectId=project-a&documentId=doc-b",
		});

		expect(screen.getByRole("button", { name: "项目概览" }).className).not.toContain(
			"bg-ide-list-active",
		);
		expect(documentItemClassName("第一集")).not.toContain("bg-ide-list-active");
		expect(documentItemClassName("第二集")).toContain("bg-ide-list-active");
	});

	it("renders category headers without counts and moves document actions to right click", () => {
		renderProjectSidebar(true);

		expect(screen.getByRole("button", { name: "剧本" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "剧本 1" })).toBeNull();
		expect(screen.queryByLabelText(/更多操作/)).toBeNull();

		const categoryIcons = screen.getByRole("button", { name: "剧本" }).querySelectorAll("svg");
		const documentIcon = screen.getByRole("button", { name: "第一集" }).querySelector("svg");
		expect(categoryIcons[1]?.getAttribute("class")).toContain("lucide-scroll-text");
		expect(documentIcon?.getAttribute("class")).toContain("lucide-scroll-text");

		const documentRow = screen.getByRole("button", { name: "第一集" }).parentElement;
		expect(documentRow).toBeTruthy();
		expect((documentRow as HTMLElement).style.paddingLeft).toBe("40px");

		fireEvent.contextMenu(documentRow as HTMLElement, { clientX: 72, clientY: 96 });

		expect(screen.getByRole("menu", { name: "第一集 操作" })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: "在文件管理器中展示" })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: "变更类型" })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: "删除" })).toBeTruthy();
	});

	it("hides markdown project assets while keeping the parsed reference document", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: project.id,
			documents: [
				{
					...document,
					id: "doc-reference",
					title: "解析后的资料",
					category: "reference",
				},
			],
			folders: [],
			assets: [makeProjectAsset("原始资料.md", "text/markdown")],
		});

		renderProjectSidebar(true, { isOverviewActive: false });

		expect(screen.getByRole("button", { name: "解析后的资料" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "原始资料.md" })).toBeNull();
	});

	it("creates a document from the category header context menu", () => {
		const onCreateDocumentInCategory = vi.fn();
		renderProjectSidebar(true, { onCreateDocumentInCategory });

		fireEvent.contextMenu(screen.getByRole("button", { name: "角色" }), {
			clientX: 72,
			clientY: 96,
		});
		fireEvent.click(screen.getByRole("menuitem", { name: "新建角色" }));

		expect(onCreateDocumentInCategory).toHaveBeenCalledWith("character");
	});

	it("opens the upload-ready new document dialog from the reference header menu", () => {
		const onOpenNewDocument = vi.fn();
		renderProjectSidebar(true, { onOpenNewDocument });

		fireEvent.contextMenu(screen.getByRole("button", { name: "资料" }), {
			clientX: 72,
			clientY: 96,
		});
		fireEvent.click(screen.getByRole("menuitem", { name: "新建资料" }));

		expect(onOpenNewDocument).toHaveBeenCalledWith("reference");
	});

	it("right-aligns footer actions on home and project sidebars", () => {
		const projectSidebar = renderProjectSidebar(true);
		expect(footerActionRowClassName()).toContain("justify-end");
		projectSidebar.unmount();

		renderProjectsSidebar();
		expect(footerActionRowClassName()).toContain("justify-end");
	});

	it("shows a return action when the selected project does not exist", () => {
		const onBack = vi.fn();
		renderProjectSidebar(true, {
			displayProject: null,
			documentsProjectId: null,
			onBack,
		});

		expect(screen.getByText("项目不存在")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "返回项目列表" }));

		expect(onBack).toHaveBeenCalledTimes(1);
	});

	it("opens project list actions from the project context menu", () => {
		const onArchiveProject = vi.fn();
		const onOpenProject = vi.fn();
		const onRenameProject = vi.fn();
		const onRequestDeleteProject = vi.fn();
		renderProjectsSidebar({
			onArchiveProject,
			onOpenProject,
			onRenameProject,
			onRequestDeleteProject,
		});

		fireEvent.contextMenu(screen.getByRole("button", { name: "测试项目" }), {
			clientX: 72,
			clientY: 96,
		});

		expect(screen.getByRole("menuitem", { name: "打开" })).toBeTruthy();
		fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
		expect(onRenameProject).toHaveBeenCalledWith(project);

		fireEvent.contextMenu(screen.getByRole("button", { name: "测试项目" }), {
			clientX: 72,
			clientY: 96,
		});
		fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));
		expect(onArchiveProject).toHaveBeenCalledWith(project);

		fireEvent.contextMenu(screen.getByRole("button", { name: "测试项目" }), {
			clientX: 72,
			clientY: 96,
		});
		fireEvent.click(screen.getByRole("menuitem", { name: "移到垃圾箱" }));
		expect(onRequestDeleteProject).toHaveBeenCalledWith(project);
		expect(onOpenProject).not.toHaveBeenCalled();
	});
});

const renderProjectSidebar = (
	showActiveSelection: boolean,
	overrides: Partial<React.ComponentProps<typeof ProjectSidebarPanel>> = {},
) =>
	render(
		<ProjectSidebarPanel
			displayProject={project}
			documentsProjectId={project.id}
			isOverviewActive
			isLoading={false}
			locationPathname="/projects"
			locationSearch="?projectId=project-a"
			showActiveSelection={showActiveSelection}
			onBack={vi.fn()}
			onCreateDocumentInCategory={vi.fn()}
			onDeleteAsset={vi.fn()}
			onDeleteDocument={vi.fn()}
			onOpenAsset={vi.fn()}
			onOpenDocument={vi.fn()}
			onOpenNewDocument={vi.fn()}
			onOpenOverview={vi.fn()}
			onOpenSearch={vi.fn()}
			onOpenSettings={vi.fn()}
			{...overrides}
		/>,
	);

const renderProjectsSidebar = (
	overrides: Partial<React.ComponentProps<typeof ProjectsSidebarPanel>> = {},
) =>
	render(
		<ProjectsSidebarPanel
			isCreating={false}
			isLoading={false}
			locationPathname="/"
			projects={[project]}
			onArchiveProject={vi.fn()}
			onCreateProject={vi.fn()}
			onRequestDeleteProject={vi.fn()}
			onRenameProject={vi.fn()}
			onOpenProject={vi.fn()}
			onOpenSearch={vi.fn()}
			onOpenSettings={vi.fn()}
			{...overrides}
		/>,
	);

const documentItemClassName = (name = "第一集") =>
	(screen.getByRole("button", { name }).parentElement as HTMLElement).className;

const footerActionRowClassName = () =>
	(screen.getByRole("button", { name: "设置" }).parentElement as HTMLElement).className;
