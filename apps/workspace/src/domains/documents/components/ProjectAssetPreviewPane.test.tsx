import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectAssetPreviewPane } from "@/domains/documents/components/ProjectAssetPreviewPane";
import { AssetPreviewBody } from "@/domains/documents/components/project-asset-preview.components";
import { useDocumentsStore } from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { updateProjectAsset } from "@/domains/workspace/api/project-assets";
import { getWorkspaceDocuments } from "@/domains/workspace/api/workspace";

const { toastMock } = vi.hoisted(() => ({
	toastMock: {
		success: vi.fn(),
		info: vi.fn(),
		warning: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => toastMock,
}));

vi.mock("@/components/VideoPlayer", () => ({
	VideoPlayer: () => null,
}));

vi.mock("@/domains/workspace/lib/downloads", () => ({
	downloadLocalFileWithDirectoryPicker: vi.fn(),
}));

vi.mock("@/domains/workspace/api/project-assets", () => ({
	updateProjectAsset: vi.fn(),
}));

vi.mock("@/domains/workspace/api/workspace", () => ({
	createWorkspaceEventSource: vi.fn(),
	createWorkspaceFolder: vi.fn(),
	createWorkspaceDocument: vi.fn(),
	deleteWorkspaceFolder: vi.fn(),
	deleteWorkspaceDocumentRecord: vi.fn(),
	getWorkspaceDocuments: vi.fn(),
	getWorkspaceFolders: vi.fn(),
	getWorkspaceState: vi.fn(),
	updateWorkspaceFolder: vi.fn(),
	updateWorkspaceDocumentSectionMention: vi.fn(),
	updateWorkspaceDocumentRecord: vi.fn(),
	updateWorkspaceState: vi.fn(),
	workspaceDocumentsChangedEventType: "workspace.documents.changed",
	workspaceStateKey: (projectId?: string | null) =>
		projectId ? `/workspace/state?projectId=${encodeURIComponent(projectId)}` : "/workspace/state",
}));

const makeAsset = (id: string, folderId?: string): ProjectAsset => ({
	id,
	projectId: "project-a",
	kind: "text",
	filename: `${id}.txt`,
	mimeType: "text/plain",
	sizeBytes: 1,
	url: `/assets/${id}`,
	folderId,
	sortOrder: 0,
	createdAt: "2026-05-31T00:00:00.000Z",
	updatedAt: "2026-05-31T00:00:00.000Z",
});

const hydrateAssets = (assets: ProjectAsset[]) => {
	useDocumentsStore.getState().hydrateWorkspaceDocuments({
		workspaceDir: "/workspace/project-a",
		projectId: "project-a",
		documents: [],
		assets,
	});
	return useDocumentsStore.getState();
};

const renderPane = (asset: ProjectAsset) =>
	render(
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
			<ProjectAssetPreviewPane asset={asset} projectId="project-a" />
		</SWRConfig>,
	);

describe("ProjectAssetPreviewPane", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async (_input: RequestInfo | URL, _init?: RequestInit) =>
					new Response("剧本正文第一行", { headers: { "Content-Type": "text/plain" } }),
			),
		);
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.mocked(updateProjectAsset).mockReset();
		vi.mocked(getWorkspaceDocuments).mockReset();
		toastMock.success.mockReset();
		toastMock.error.mockReset();
	});

	it("keeps the preview body memoized so filename typing skips heavy re-renders", () => {
		expect((AssetPreviewBody as unknown as { $$typeof: symbol }).$$typeof).toBe(
			Symbol.for("react.memo"),
		);
	});

	it("renders the fetched text preview with wrapping and a ranged request", async () => {
		const state = hydrateAssets([makeAsset("asset-a")]);
		const { container } = renderPane(state.assets[0]);

		await screen.findByText("剧本正文第一行");

		const pre = container.querySelector("pre");
		expect(pre?.className).toContain("whitespace-pre-wrap");
		expect(fetch).toHaveBeenCalledWith("/assets/asset-a", {
			headers: { Range: "bytes=0-524287" },
		});
	});

	it("applies the rename through the returned asset without refetching the workspace", async () => {
		const before = hydrateAssets([makeAsset("asset-a"), makeAsset("asset-b")]);
		const storedAsset = before.assets[0];
		vi.mocked(updateProjectAsset).mockResolvedValue({
			...storedAsset,
			filename: "renamed.txt",
		});

		renderPane(storedAsset);
		fireEvent.change(screen.getByLabelText("素材文件名"), { target: { value: "renamed" } });
		fireEvent.click(screen.getByRole("button", { name: "保存文件名" }));

		await waitFor(() =>
			expect(vi.mocked(updateProjectAsset)).toHaveBeenCalledWith("project-a", "asset-a", {
				filename: "renamed",
			}),
		);
		await waitFor(() =>
			expect(useDocumentsStore.getState().assets[0].filename).toBe("renamed.txt"),
		);

		const state = useDocumentsStore.getState();
		expect(state.assets[1]).toBe(before.assets[1]);
		expect(state.documents).toBe(before.documents);
		expect(getWorkspaceDocuments).not.toHaveBeenCalled();
		expect(toastMock.success).toHaveBeenCalledWith("素材已重命名", {
			description: "renamed.txt",
		});
	});

	it("keeps the store untouched and surfaces an error toast when the rename fails", async () => {
		const before = hydrateAssets([makeAsset("asset-a")]);
		vi.mocked(updateProjectAsset).mockRejectedValue(new Error("磁盘只读"));

		renderPane(before.assets[0]);
		fireEvent.change(screen.getByLabelText("素材文件名"), { target: { value: "renamed" } });
		fireEvent.click(screen.getByRole("button", { name: "保存文件名" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith("重命名失败", { description: "磁盘只读" }),
		);
		expect(useDocumentsStore.getState().assets).toBe(before.assets);
	});
});
