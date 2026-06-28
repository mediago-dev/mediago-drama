import { render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationRoute } from "@/domains/generation/api/generation";
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
	versionId: imageVersion.id,
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

describe("BatchGenerationSettingsDialog rendered preferences", () => {
	beforeEach(() => {
		localStorage.removeItem(batchGenerationSettingsStorageKey);
		useBatchGenerationSettingsPreferenceStore.setState({ settingsByKind: {} });
		workspaceMocks.useGenerationWorkspace.mockReturnValue({
			catalog: generationCatalog,
			hasConfiguredRoutesForKind: true,
			hasLiveCatalog: true,
			promptInsertItems: [
				{
					categoryLabel: "风格",
					id: "prompt-pack-1",
					name: "电影感提示词",
					prompt: "强化镜头语言、光影与构图。",
					sourceLabel: "来自包",
				},
			],
			selectedFamily: imageFamily,
			selectedParams: {},
			selectedRoute: imageRoute,
			selectedVersion: imageVersion,
			updateFamily: workspaceMocks.updateFamily,
			updateModelRoute: workspaceMocks.updateModelRoute,
			updateParam: workspaceMocks.updateParam,
			visibleFamilies: [imageFamily],
			visibleFamilyRoutes: [imageRoute],
			visibleVersions: [imageVersion],
		});
		workspaceMocks.useGenerationWorkspace.mockClear();
		workspaceMocks.updateFamily.mockClear();
		workspaceMocks.updateModelRoute.mockClear();
		workspaceMocks.updateParam.mockClear();
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

		await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
		expect(screen.getByRole("button", { name: /优化并生成/ })).toBeEnabled();
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
});
