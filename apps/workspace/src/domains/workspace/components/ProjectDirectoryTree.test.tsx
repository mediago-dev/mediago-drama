import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import type { DocumentFolder, MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import {
	createWorkspaceFolder,
	updateWorkspaceDocumentRecord,
} from "@/domains/workspace/api/workspace";
import { useDirectoryTreeStore } from "@/lib/stores/directory-tree";
import { ProjectDirectoryTree } from "./ProjectDirectoryTree";

vi.mock("@/domains/workspace/api/workspace", () => ({
	createWorkspaceFolder: vi.fn(),
	deleteWorkspaceFolder: vi.fn(),
	getWorkspaceDocuments: vi.fn(),
	updateWorkspaceDocumentRecord: vi.fn(),
	updateWorkspaceFolder: vi.fn(),
	workspaceDocumentsKey: (projectId?: string | null) =>
		projectId
			? `/workspace/documents?projectId=${encodeURIComponent(projectId)}`
			: "/workspace/documents",
}));

const project: WorkspaceProject = {
	id: "project-a",
	name: "测试项目",
	description: "",
	relativeDir: "project-a",
	documentCount: 0,
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
};

const renderDirectoryTree = () =>
	render(
		<ProjectDirectoryTree
			project={project}
			locationPathname="/projects"
			onOpenAsset={vi.fn()}
			onOpenDocument={vi.fn()}
			onDeleteAsset={vi.fn()}
			onDeleteDocument={vi.fn()}
		/>,
	);

const makeFolder = (id: string, name: string): DocumentFolder => ({
	id,
	name,
	parentId: null,
	sortOrder: 0,
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
});

const makeTextAsset = (id: string, folderId: string | null): ProjectAsset => ({
	id,
	projectId: project.id,
	kind: "text",
	filename: "notes.txt",
	mimeType: "text/plain",
	sizeBytes: 16,
	url: `/api/v1/projects/${project.id}/assets/${id}/content`,
	folderId,
	sortOrder: 0,
	createdAt: "2026-06-04T00:00:00.000Z",
	updatedAt: "2026-06-04T00:00:00.000Z",
});

const makeDocument = (id: string, title: string): MarkdownDocument => ({
	id,
	title,
	content: "",
	category: "screenplay",
	parentId: null,
	folderId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-06-04T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});

describe("ProjectDirectoryTree folder creation", () => {
	beforeEach(() => {
		localStorage.clear();
		useDirectoryTreeStore.setState({ collapsedByProject: {} });
		vi.mocked(createWorkspaceFolder).mockReset();
		vi.mocked(updateWorkspaceDocumentRecord).mockReset();
		vi.mocked(createWorkspaceFolder).mockImplementation(async (payload, projectId) => {
			const folder = {
				id: payload.id ?? "folder-a",
				name: payload.name,
				parentId: payload.parentId ?? null,
				sortOrder: payload.sortOrder ?? 0,
				createdAt: "2026-06-04T00:00:00.000Z",
				updatedAt: "2026-06-04T00:00:00.000Z",
			};
			return {
				folder,
				state: {
					workspaceDir: "/workspace/project-a",
					projectId: projectId ?? undefined,
					documents: [],
					folders: [folder],
				},
			};
		});
		vi.mocked(updateWorkspaceDocumentRecord).mockImplementation(
			async (documentId, payload, projectId) => {
				const current = useDocumentsStore
					.getState()
					.documents.find((document) => document.id === documentId);
				const document = {
					...(current ?? makeDocument(documentId, "未命名文档")),
					category: payload.category,
				};
				return {
					document,
					state: {
						workspaceDir: "/workspace/project-a",
						projectId: projectId ?? undefined,
						documents: [document],
						folders: [],
						assets: [],
					},
				};
			},
		);
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: project.id,
			documents: [],
			folders: [],
			assets: [],
		});
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
		useDirectoryTreeStore.setState({ collapsedByProject: {} });
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
	});

	it("cancels a new folder draft when the empty input blurs", () => {
		renderDirectoryTree();

		fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
		const input = screen.getByLabelText("文件夹名称");
		fireEvent.blur(input);

		expect(createWorkspaceFolder).not.toHaveBeenCalled();
		expect(screen.queryByLabelText("文件夹名称")).toBeNull();
	});

	it("creates a folder when the named draft input blurs", async () => {
		renderDirectoryTree();

		fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
		const input = screen.getByLabelText("文件夹名称");
		expect(input.previousElementSibling?.tagName.toLowerCase()).toBe("svg");

		fireEvent.change(input, { target: { value: "第一集" } });
		fireEvent.blur(input);

		await waitFor(() => expect(createWorkspaceFolder).toHaveBeenCalledTimes(1));
		expect(createWorkspaceFolder).toHaveBeenCalledWith(
			expect.objectContaining({ name: "第一集", parentId: null }),
			project.id,
		);
	});

	it("renders text assets inside folders as file-system children", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: project.id,
			documents: [],
			folders: [makeFolder("folder-a", "素材")],
			assets: [makeTextAsset("asset-a", "folder-a")],
		});

		renderDirectoryTree();

		expect(screen.getByText("素材")).toBeTruthy();
		const assetText = screen.getByText("notes.txt");
		const assetRow = assetText.closest("button")?.parentElement;

		expect(assetText).toBeTruthy();
		expect(assetRow).toBeTruthy();
		expect((assetRow as HTMLElement).style.paddingLeft).toBe("26px");
	});

	it("renders a root drop tail for moving items back to the project root", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: project.id,
			documents: [],
			folders: [makeFolder("folder-a", "素材")],
			assets: [makeTextAsset("asset-a", "folder-a")],
		});

		renderDirectoryTree();

		expect(screen.getByTestId("directory-root-drop-tail")).toBeTruthy();
	});

	it("opens the row context menu at the pointer position", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: project.id,
			documents: [],
			folders: [makeFolder("folder-a", "素材")],
			assets: [],
		});

		renderDirectoryTree();

		const folderRow = screen.getByRole("button", { name: "折叠文件夹" }).parentElement;
		expect(folderRow).toBeTruthy();

		fireEvent.contextMenu(folderRow as HTMLElement, { clientX: 64, clientY: 88 });

		const menu = screen.getByRole("menu", { name: "素材 操作" });
		expect(menu.style.left).toBe("64px");
		expect(menu.style.top).toBe("88px");
		expect(screen.getByRole("menuitem", { name: "在文件管理器中展示" })).toBeTruthy();
	});

	it("changes a document category from the row context submenu", async () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: project.id,
			documents: [makeDocument("doc-a", "第一集")],
			folders: [],
			assets: [],
		});

		renderDirectoryTree();

		const documentButton = screen.getByRole("button", { name: "第一集" });
		const documentRow = documentButton.parentElement;
		expect(documentRow).toBeTruthy();
		expect(documentButton.querySelector("svg")?.getAttribute("class")).toContain(
			"lucide-scroll-text",
		);

		fireEvent.contextMenu(documentRow as HTMLElement, { clientX: 64, clientY: 88 });
		expect(screen.getByRole("menuitem", { name: "在文件管理器中展示" })).toBeTruthy();

		fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "变更类型" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "场景" }));

		await waitFor(() => {
			expect(updateWorkspaceDocumentRecord).toHaveBeenCalledWith(
				"doc-a",
				{ category: "scene" },
				project.id,
			);
		});
		expect(useDocumentsStore.getState().documents[0]?.category).toBe("scene");
	});

	it("reads collapsed folders from the persisted directory tree store", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: project.id,
			documents: [],
			folders: [makeFolder("folder-a", "素材")],
			assets: [makeTextAsset("asset-a", "folder-a")],
		});
		useDirectoryTreeStore.getState().setFolderCollapsed(project.id, "folder-a", true);

		renderDirectoryTree();

		expect(screen.getByText("素材")).toBeTruthy();
		expect(screen.queryByText("notes.txt")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "展开文件夹" }));

		expect(screen.getByText("notes.txt")).toBeTruthy();
	});
});
