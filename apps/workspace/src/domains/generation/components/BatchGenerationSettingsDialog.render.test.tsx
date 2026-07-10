import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationRoute } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { BatchGenerationSettingsDialog } from "./BatchGenerationSettingsDialog";
import {
	batchGenerationSettingsStorageKey,
	useBatchGenerationSettingsPreferenceStore,
} from "../stores/batch-generation-settings";

const workspaceMocks = vi.hoisted(() => ({
	useGenerationWorkspace: vi.fn(),
	updateFamily: vi.fn(),
	updateModelRoute: vi.fn(),
	updateParam: vi.fn(),
}));

vi.mock("@/domains/documents/components/GenerationModalShell", () => ({
	GenerationModalShell: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
		open ? <div role="dialog">{children}</div> : null,
}));

vi.mock("@/domains/generation/hooks/useGenerationWorkspace", () => ({
	useGenerationWorkspace: workspaceMocks.useGenerationWorkspace,
}));

vi.mock("./GenerationBrandMark", () => ({
	GenerationBrandStack: () => <span />,
	GenerationBrandMark: () => <span />,
	generationFamilyBrand: () => null,
	generationModelBrand: () => null,
	generationProviderBrand: () => null,
}));

vi.mock("./GenerationModelRoutePicker", () => ({
	GenerationModelRoutePicker: () => <button type="button">模型路由</button>,
}));

const imageFamily = { id: "gpt-image", label: "GPT Image" };
const imageVersion = { id: "gpt-image-2", label: "GPT Image 2" };
const imageRoute = {
	configured: true,
	familyId: imageFamily.id,
	id: "image-route-1",
	kind: "image",
	model: "image-model",
	paramCombos: [],
	params: [],
	provider: "dmx",
	status: "available",
	supportsReferenceUrls: true,
	versionId: imageVersion.id,
} as unknown as GenerationRoute;
const unsupportedImageRoute = {
	...imageRoute,
	id: "image-route-no-reference",
	supportsReferenceUrls: false,
} as unknown as GenerationRoute;
const textRoute = {
	configured: true,
	familyId: "gpt-text",
	id: "text-route-1",
	kind: "text",
	label: "DMX",
	model: "text-model",
	paramCombos: [],
	params: [],
	provider: "dmx",
	status: "available",
	versionId: "gpt-text-mini",
} as unknown as GenerationRoute;
const generationCatalog = {
	families: [imageFamily, { id: "gpt-text", label: "GPT Text" }],
	models: [],
	providers: [],
	routes: [imageRoute, textRoute],
	versions: [imageVersion, { id: "gpt-text-mini", label: "GPT Text Mini" }],
};
const selectedReferenceAsset: MediaAsset = {
	createdAt: "2026-06-12T00:00:00.000Z",
	filename: "reference.png",
	id: "selected-ref",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1024,
	updatedAt: "2026-06-12T00:00:00.000Z",
	url: "/api/v1/media-assets/selected-ref/content",
};

describe("BatchGenerationSettingsDialog rendered preferences", () => {
	beforeEach(() => {
		localStorage.removeItem(batchGenerationSettingsStorageKey);
		useBatchGenerationSettingsPreferenceStore.setState({ settingsByKind: {} });
		workspaceMocks.useGenerationWorkspace.mockReturnValue({
			catalog: generationCatalog,
			hasConfiguredRoutesForKind: true,
			hasLiveCatalog: true,
			isUploadingAsset: false,
			mediaAssets: [selectedReferenceAsset],
			mutateMediaAssets: vi.fn(),
			promptInsertItems: [
				{
					categoryLabel: "风格",
					id: "prompt-pack-1",
					name: "电影感提示词",
					prompt: "强化镜头语言、光影与构图。",
					sourceLabel: "来自包",
				},
				{
					categoryLabel: "镜头",
					id: "prompt-pack-camera",
					name: "镜头推进",
					prompt: "拉近镜头，突出主体动作。",
					sourceLabel: "来自包",
				},
			],
			selectedFamily: imageFamily,
			selectedParams: {},
			selectedReferenceAssetIds: [],
			selectedReferenceAssets: [],
			selectedRoute: imageRoute,
			selectedVersion: imageVersion,
			removeReferenceAsset: vi.fn(),
			toggleReferenceAsset: vi.fn(),
			updateFamily: workspaceMocks.updateFamily,
			updateModelRoute: workspaceMocks.updateModelRoute,
			updateParam: workspaceMocks.updateParam,
			uploadReferenceAsset: vi.fn(),
			visibleFamilies: [imageFamily],
			visibleFamilyRoutes: [imageRoute],
			visibleVersions: [imageVersion],
		});
		workspaceMocks.useGenerationWorkspace.mockClear();
		workspaceMocks.updateFamily.mockClear();
		workspaceMocks.updateModelRoute.mockClear();
		workspaceMocks.updateParam.mockClear();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows the last saved prompt optimization choice when opened", async () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			promptOptimizeItemId: "prompt-pack-1",
			promptOptimizeRouteId: "text-route-1",
			routeId: "image-route-1",
			usePromptOptimization: true,
			versionId: "gpt-image-2",
		});

		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				selectedCount={1}
				onConfirm={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		await waitFor(() =>
			expect(screen.getByRole("checkbox", { name: "优化并生成时使用" })).toBeChecked(),
		);
		expect(screen.getByRole("button", { name: /优化并生成/ })).toBeEnabled();
	});

	it("shows the last saved prompt supplement choice when opened", async () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			promptSupplementItemId: "prompt-pack-1",
			routeId: "image-route-1",
			usePromptSupplement: true,
			versionId: "gpt-image-2",
		});

		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				selectedCount={1}
				onConfirm={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		await waitFor(() => expect(screen.getByRole("checkbox", { name: "生成时追加" })).toBeChecked());
		const trigger = screen.getByRole("button", { name: "补充提示词包" });
		expect(trigger).toBeEnabled();
		expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
	});

	it("keeps dialog-closing pointer events inside the batch settings layer", () => {
		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				selectedCount={2}
				onConfirm={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		const documentPointerDown = vi.fn();
		document.addEventListener("pointerdown", documentPointerDown);

		fireEvent.pointerDown(screen.getByRole("button", { name: "取消" }), { button: 0 });
		fireEvent.pointerDown(screen.getByRole("button", { name: "生成" }), { button: 0 });

		document.removeEventListener("pointerdown", documentPointerDown);
		expect(documentPointerDown).not.toHaveBeenCalled();
	});

	it("selects a prompt supplement from the two-column prompt pack picker", async () => {
		const onConfirm = vi.fn();

		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				selectedCount={1}
				onConfirm={onConfirm}
				onOpenChange={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "生成时追加" }));

		const trigger = screen.getByRole("button", { name: "补充提示词包" });
		await waitFor(() => expect(trigger).toBeEnabled());
		fireEvent.click(trigger);

		expect(screen.getByText("分类")).toBeTruthy();
		expect(screen.getByRole("button", { name: "风格 1 项" })).toBeTruthy();
		fireEvent.pointerEnter(screen.getByRole("button", { name: "镜头 1 项" }));
		fireEvent.click(screen.getByRole("option", { name: "镜头推进" }));

		expect(screen.getByText("镜头推进")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "生成" }));

		expect(onConfirm).toHaveBeenCalledWith(
			expect.objectContaining({
				promptSupplement: {
					referenceName: "镜头推进",
					referencePrompt: "拉近镜头，突出主体动作。",
				},
			}),
		);
	});

	it("passes the last saved model selection into workspace initialization", () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			familyId: "jimeng-local",
			params: { size: "1024x1024" },
			routeId: "jimeng-local-route",
			versionId: "jimeng-local-v1",
		});

		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				selectedCount={1}
				onConfirm={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		expect(workspaceMocks.useGenerationWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({
				initialModelSelection: {
					familyIds: { image: "jimeng-local" },
					routeIds: { "jimeng-local-v1": "jimeng-local-route" },
					routeParams: { "jimeng-local-route": { size: "1024x1024" } },
					versionIds: { "jimeng-local": "jimeng-local-v1" },
				},
				initialModelSelectionKey: expect.stringContaining("jimeng-local-route"),
				persistModelSelection: false,
			}),
		);
	});

	it("confirms image reference asset ids without persisting them as dialog preferences", () => {
		const onConfirm = vi.fn();
		workspaceMocks.useGenerationWorkspace.mockReturnValue({
			catalog: generationCatalog,
			hasConfiguredRoutesForKind: true,
			hasLiveCatalog: true,
			isUploadingAsset: false,
			mediaAssets: [selectedReferenceAsset],
			mutateMediaAssets: vi.fn(),
			promptInsertItems: [],
			selectedFamily: imageFamily,
			selectedParams: {},
			selectedReferenceAssetIds: ["selected-ref"],
			selectedReferenceAssets: [selectedReferenceAsset],
			selectedRoute: imageRoute,
			selectedVersion: imageVersion,
			removeReferenceAsset: vi.fn(),
			toggleReferenceAsset: vi.fn(),
			updateFamily: workspaceMocks.updateFamily,
			updateModelRoute: workspaceMocks.updateModelRoute,
			updateParam: workspaceMocks.updateParam,
			uploadReferenceAsset: vi.fn(),
			visibleFamilies: [imageFamily],
			visibleFamilyRoutes: [imageRoute],
			visibleVersions: [imageVersion],
		});

		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				selectedCount={1}
				onConfirm={onConfirm}
				onOpenChange={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: /已选 1 张/ })).toBeEnabled();

		fireEvent.click(screen.getByRole("button", { name: "生成" }));

		expect(onConfirm).toHaveBeenCalledWith(
			expect.objectContaining({
				referenceAssetIds: ["selected-ref"],
			}),
		);
		expect(localStorage.getItem(batchGenerationSettingsStorageKey) ?? "").not.toContain(
			"selected-ref",
		);
	});

	it("hides the reference image control when the selected model route does not support references", () => {
		workspaceMocks.useGenerationWorkspace.mockReturnValue({
			catalog: generationCatalog,
			hasConfiguredRoutesForKind: true,
			hasLiveCatalog: true,
			isUploadingAsset: false,
			mediaAssets: [selectedReferenceAsset],
			mutateMediaAssets: vi.fn(),
			promptInsertItems: [],
			selectedFamily: imageFamily,
			selectedParams: {},
			selectedReferenceAssetIds: [],
			selectedReferenceAssets: [],
			selectedRoute: unsupportedImageRoute,
			selectedVersion: imageVersion,
			removeReferenceAsset: vi.fn(),
			toggleReferenceAsset: vi.fn(),
			updateFamily: workspaceMocks.updateFamily,
			updateModelRoute: workspaceMocks.updateModelRoute,
			updateParam: workspaceMocks.updateParam,
			uploadReferenceAsset: vi.fn(),
			visibleFamilies: [imageFamily],
			visibleFamilyRoutes: [unsupportedImageRoute],
			visibleVersions: [imageVersion],
		});

		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				selectedCount={1}
				onConfirm={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		expect(screen.queryByText("参考图")).toBeNull();
	});

	it("hides stale selected references and confirms without reference ids when the route cannot use them", () => {
		const onConfirm = vi.fn();
		workspaceMocks.useGenerationWorkspace.mockReturnValue({
			catalog: generationCatalog,
			hasConfiguredRoutesForKind: true,
			hasLiveCatalog: true,
			isUploadingAsset: false,
			mediaAssets: [selectedReferenceAsset],
			mutateMediaAssets: vi.fn(),
			promptInsertItems: [],
			selectedFamily: imageFamily,
			selectedParams: {},
			selectedReferenceAssetIds: ["selected-ref"],
			selectedReferenceAssets: [selectedReferenceAsset],
			selectedRoute: unsupportedImageRoute,
			selectedVersion: imageVersion,
			removeReferenceAsset: vi.fn(),
			toggleReferenceAsset: vi.fn(),
			updateFamily: workspaceMocks.updateFamily,
			updateModelRoute: workspaceMocks.updateModelRoute,
			updateParam: workspaceMocks.updateParam,
			uploadReferenceAsset: vi.fn(),
			visibleFamilies: [imageFamily],
			visibleFamilyRoutes: [unsupportedImageRoute],
			visibleVersions: [imageVersion],
		});

		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				selectedCount={1}
				onConfirm={onConfirm}
				onOpenChange={vi.fn()}
			/>,
		);

		expect(screen.queryByText("参考图")).toBeNull();
		expect(screen.getByRole("button", { name: "生成" })).toBeEnabled();

		fireEvent.click(screen.getByRole("button", { name: "生成" }));

		expect(onConfirm).toHaveBeenCalledWith(
			expect.not.objectContaining({
				referenceAssetIds: expect.any(Array),
			}),
		);
	});
});
