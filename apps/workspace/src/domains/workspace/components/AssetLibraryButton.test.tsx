import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getSelectedGenerationAssets,
	type SelectedGenerationAsset,
	updateGenerationTaskAsset,
} from "@/domains/generation/api/generation";
import { getProjects } from "@/domains/projects/api/projects";
import { getMediaAssets, type MediaAsset } from "@/domains/workspace/api/media";
import { getWorkspaceDocuments } from "@/domains/workspace/api/workspace";
import { AssetLibraryButton } from "./AssetLibraryButton";

class TestPointerEvent extends MouseEvent {
	pointerId: number;
	pointerType: string;

	constructor(type: string, params: PointerEventInit = {}) {
		super(type, params);
		this.pointerId = params.pointerId ?? 1;
		this.pointerType = params.pointerType ?? "mouse";
	}
}

if (typeof window !== "undefined" && typeof window.PointerEvent !== "function") {
	Object.defineProperty(window, "PointerEvent", {
		value: TestPointerEvent,
		configurable: true,
	});
	Object.defineProperty(globalThis, "PointerEvent", {
		value: TestPointerEvent,
		configurable: true,
	});
}

if (typeof HTMLElement !== "undefined") {
	if (typeof HTMLElement.prototype.hasPointerCapture !== "function") {
		Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
			value: () => false,
			configurable: true,
		});
	}
	if (typeof HTMLElement.prototype.setPointerCapture !== "function") {
		Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
			value: () => {},
			configurable: true,
		});
	}
	if (typeof HTMLElement.prototype.releasePointerCapture !== "function") {
		Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
			value: () => {},
			configurable: true,
		});
	}
	if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			value: () => {},
			configurable: true,
		});
	}
}

vi.mock("@/domains/workspace/api/media", () => ({
	deleteMediaAsset: vi.fn(),
	getMediaAssets: vi.fn(),
	mediaAssetsKey: "/media-assets",
	updateMediaAsset: vi.fn(),
	uploadMediaAsset: vi.fn(),
}));

vi.mock("@/domains/workspace/api/project-assets", () => ({
	deleteProjectAsset: vi.fn(),
	updateProjectAsset: vi.fn(),
	uploadProjectAsset: vi.fn(),
}));

vi.mock("@/domains/workspace/api/workspace", () => ({
	getWorkspaceDocuments: vi.fn(),
	workspaceDocumentsKey: (projectId?: string | null) =>
		`/projects/${projectId ?? ""}/workspace/documents`,
}));

vi.mock("@/domains/generation/api/generation", () => ({
	getSelectedGenerationAssets: vi.fn(),
	selectedGenerationAssetsQueryKey: (projectId?: string | null) => [
		"/generation/selected-assets",
		projectId ?? "",
	],
	updateGenerationTaskAsset: vi.fn(),
}));

vi.mock("@/domains/projects/api/projects", () => ({
	getProjects: vi.fn(),
	projectsKey: "/projects",
}));

describe("AssetLibraryButton", () => {
	beforeEach(() => {
		vi.mocked(getProjects).mockResolvedValue({
			databasePath: "/tmp/db.sqlite",
			projects: [
				workspaceProject({ id: "project-a", name: "项目甲" }),
				workspaceProject({ id: "project-b", name: "项目乙" }),
			],
			workspaceDir: "/tmp",
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
		cleanup();
	});

	it("opens the global asset library outside a project", async () => {
		vi.mocked(getMediaAssets).mockResolvedValue({
			assets: [mediaAsset({ filename: "global-still.png", id: "global-media" })],
		});

		renderAssetLibraryButton("/");

		fireEvent.click(screen.getByRole("button", { name: "打开素材库" }));

		expect(await screen.findByRole("dialog", { name: "全局素材库" })).toBeTruthy();
		expect((await screen.findAllByText("global-still.png")).length).toBeGreaterThan(0);
		expect(getMediaAssets).toHaveBeenCalledWith({ projectId: undefined });
		expect(getWorkspaceDocuments).not.toHaveBeenCalled();
		expect(getSelectedGenerationAssets).not.toHaveBeenCalled();
	});

	it("opens the project asset library without project document uploads", async () => {
		vi.mocked(getMediaAssets).mockResolvedValue({
			assets: [
				mediaAsset({
					filename: "hero-media.png",
					id: "hero-media",
					url: "/api/v1/media-assets/hero-media/content",
				}),
			],
		});
		vi.mocked(getSelectedGenerationAssets).mockResolvedValue({
			assets: [
				selectedAsset({
					resourceType: "character",
					taskId: "task-1",
					url: "/api/v1/media-assets/hero-media/content",
				}),
			],
		});

		renderAssetLibraryButton("/agent?projectId=project-a");

		fireEvent.click(screen.getByRole("button", { name: "打开素材库" }));

		expect(await screen.findByRole("dialog", { name: "项目素材库" })).toBeTruthy();
		expect((await screen.findAllByText("hero-media.png")).length).toBeGreaterThan(0);
		expect(screen.getAllByText("角色").length).toBeGreaterThan(0);
		expect(screen.queryByText("selected image")).not.toBeInTheDocument();
		expect(screen.queryByText("source-notes.txt")).not.toBeInTheDocument();
		expect(getMediaAssets).toHaveBeenCalledWith({ projectId: "project-a" });
		expect(getWorkspaceDocuments).not.toHaveBeenCalled();
		expect(getSelectedGenerationAssets).toHaveBeenCalledWith("project-a");
		expect(updateGenerationTaskAsset).not.toHaveBeenCalled();
	});

	it("switches the library to another project from the project filter", async () => {
		vi.mocked(getMediaAssets).mockImplementation(async (filters) => {
			const projectId = filters?.projectId;
			return {
				assets: [
					mediaAsset({
						filename: projectId ? `${projectId}-media.png` : "global-media.png",
						id: projectId ? `${projectId}-media` : "global-media",
						projectId,
						url: projectId
							? `/api/v1/media-assets/${projectId}-media/content`
							: "/api/v1/media-assets/global-media/content",
					}),
				],
			};
		});
		vi.mocked(getSelectedGenerationAssets).mockResolvedValue({ assets: [] });

		renderAssetLibraryButton("/");

		fireEvent.click(screen.getByRole("button", { name: "打开素材库" }));

		expect(await screen.findByRole("dialog", { name: "全局素材库" })).toBeTruthy();
		expect((await screen.findAllByText("global-media.png")).length).toBeGreaterThan(0);

		await waitFor(() => expect(getProjects).toHaveBeenCalled());
		fireEvent.pointerDown(screen.getByRole("combobox", { name: "项目" }), {
			button: 0,
			ctrlKey: false,
			pageX: 0,
			pageY: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.click(await screen.findByRole("option", { name: "项目乙" }));

		expect(await screen.findByRole("dialog", { name: "项目素材库" })).toBeTruthy();
		expect((await screen.findAllByText("project-b-media.png")).length).toBeGreaterThan(0);
		expect(screen.queryByText("project-b-file.txt")).not.toBeInTheDocument();
		expect(getMediaAssets).toHaveBeenCalledWith({ projectId: "project-b" });
		expect(getWorkspaceDocuments).not.toHaveBeenCalled();
		expect(getSelectedGenerationAssets).toHaveBeenCalledWith("project-b");
	});
});

const renderAssetLibraryButton = (initialEntry: string) => {
	window.history.pushState(null, "", initialEntry);
	return render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<AssetLibraryButton />
		</SWRConfig>,
	);
};

const mediaAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	createdAt: "2026-06-01T08:00:00Z",
	filename: "media.png",
	id: "media-a",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1024,
	updatedAt: "2026-06-01T09:00:00Z",
	url: "/api/v1/media-assets/media-a/content",
	...overrides,
});

const selectedAsset = (
	overrides: Partial<SelectedGenerationAsset> = {},
): SelectedGenerationAsset => ({
	assetIndex: 0,
	createdAt: "2026-06-01T10:00:00Z",
	id: "selected-a",
	kind: "image",
	mimeType: "image/png",
	resourceType: "character",
	taskId: "task-a",
	title: "selected image",
	updatedAt: "2026-06-01T10:30:00Z",
	url: "/api/v1/media-assets/media-a/content",
	...overrides,
});

const workspaceProject = (overrides: { id: string; name: string }) => ({
	archivedAt: "",
	createdAt: "2026-06-01T06:00:00Z",
	description: "",
	documentCount: 0,
	id: overrides.id,
	name: overrides.name,
	originalProjectDir: "",
	projectDir: `/tmp/${overrides.id}`,
	relativeDir: overrides.id,
	status: "active" as const,
	trashedAt: "",
	updatedAt: "2026-06-01T06:30:00Z",
});
