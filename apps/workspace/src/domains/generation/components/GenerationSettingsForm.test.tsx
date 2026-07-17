import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	GenerationModelsResponse,
	GenerationRoute,
} from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	batchGenerationSettingsStorageKey,
	useBatchGenerationSettingsPreferenceStore,
} from "@/domains/generation/stores/batch-generation-settings";
import { useGenerationSettingsForm } from "@/domains/generation/hooks/useGenerationSettingsForm";
import { GenerationSettingsForm } from "./GenerationSettingsForm";

const workspaceMock = vi.hoisted(() => ({
	current: {} as Record<string, unknown>,
	useGenerationWorkspace: vi.fn(),
}));

vi.mock("@/domains/generation/hooks/useGenerationWorkspace", () => ({
	useGenerationWorkspace: workspaceMock.useGenerationWorkspace,
}));

vi.mock("./GenerationBrandMark", () => ({
	GenerationBrandMark: () => <span data-testid="brand-mark" />,
	generationFamilyBrand: () => null,
}));

vi.mock("./GenerationModelRoutePicker", () => ({
	GenerationModelRoutePicker: () => <button type="button">模型路由</button>,
}));

const onValueChange = vi.fn();

const Harness: React.FC<{ defaultValue?: unknown; disabled?: boolean }> = ({
	defaultValue,
	disabled,
}) => {
	const controller = useGenerationSettingsForm({
		defaultValue,
		kind: "image",
		onValueChange,
		persist: false,
		projectId: "project-a",
	});
	return <GenerationSettingsForm controller={controller} disabled={disabled} />;
};

describe("GenerationSettingsForm", () => {
	beforeEach(() => {
		localStorage.removeItem(batchGenerationSettingsStorageKey);
		useBatchGenerationSettingsPreferenceStore.setState({ settingsByKind: {} });
		workspaceMock.current = workspaceValue();
		workspaceMock.useGenerationWorkspace.mockImplementation(() => workspaceMock.current);
		onValueChange.mockClear();
	});

	afterEach(cleanup);

	it("renders_sections_in_batch_form_order without a modal shell or footer", async () => {
		render(<Harness />);
		await screen.findByRole("combobox", { name: "模型名称" });

		const sections = [
			screen.getByLabelText("模型设置"),
			screen.getByLabelText("参数设置"),
			screen.getByLabelText("参考图设置"),
			screen.getByLabelText("补充提示词设置"),
			screen.getByLabelText("优化提示词设置"),
		];
		for (let index = 0; index < sections.length - 1; index += 1) {
			expect(
				Boolean(
					sections[index]?.compareDocumentPosition(sections[index + 1] as Node) &
					Node.DOCUMENT_POSITION_FOLLOWING,
				),
			).toBe(true);
		}
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByText(/已选 \d+ 项/)).toBeNull();
		expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
		expect(screen.queryByRole("button", { name: "生成" })).toBeNull();
	});

	it("renders_route_schema_controls_without_filtering_style_named_params", async () => {
		render(<Harness />);
		const style = await screen.findByRole("combobox", { name: "模型风格参数" });

		fireEvent.change(style, { target: { value: "anime" } });

		await waitFor(() =>
			expect(onValueChange).toHaveBeenLastCalledWith(
				expect.objectContaining({ params: expect.objectContaining({ style: "anime" }) }),
			),
		);
	});

	it("renders_user_managed_style_prompt_packs_as_dynamic_packs and selects multiple supplements", async () => {
		render(<Harness />);
		await screen.findByRole("combobox", { name: "模型名称" });
		fireEvent.click(screen.getByRole("checkbox", { name: "生成时追加" }));

		const trigger = screen.getByRole("button", { name: "补充技能包" });
		fireEvent.click(trigger);
		expect(screen.getByRole("button", { name: "风格 1 项" })).toBeTruthy();
		fireEvent.click(screen.getByRole("option", { name: "用户自定义风格" }));
		fireEvent.pointerEnter(screen.getByRole("button", { name: "镜头 1 项" }));
		fireEvent.click(screen.getByRole("option", { name: "推进镜头" }));

		expect(trigger).toHaveTextContent("已选 2 个");
		await waitFor(() =>
			expect(onValueChange).toHaveBeenLastCalledWith(
				expect.objectContaining({
					promptSupplements: [
						expect.objectContaining({ referenceId: "pack-user-style" }),
						expect.objectContaining({ referenceId: "pack-camera" }),
					],
				}),
			),
		);
	});

	it("requires_prompt_pack_and_text_route_for_optimization", async () => {
		workspaceMock.current = {
			...workspaceValue(),
			catalog: { ...catalog, routes: catalog.routes.filter((route) => route.kind !== "text") },
			promptInsertItems: [],
		};
		render(<Harness />);
		await screen.findByRole("combobox", { name: "模型名称" });

		fireEvent.click(screen.getByRole("checkbox", { name: "优化并生成时使用" }));

		expect(screen.getByText("需要可用的技能包和文本模型后才能优化并生成。")).toBeTruthy();
		expect(screen.getByRole("button", { name: "优化技能包" })).toBeDisabled();
		expect(screen.getByRole("combobox", { name: "优化模型" })).toBeDisabled();
	});

	it("shows_references_only_for_capable_image_routes", async () => {
		const { rerender } = render(<Harness />);
		await screen.findByRole("button", { name: "选择参考图" });

		rerender(<Harness defaultValue={{ routeId: "route-no-reference" }} />);

		await waitFor(() => expect(screen.queryByLabelText("参考图设置")).toBeNull());
	});

	it("emits_one_complete_settings_value for each edit", async () => {
		render(<Harness />);
		const style = await screen.findByRole("combobox", { name: "模型风格参数" });
		onValueChange.mockClear();

		fireEvent.change(style, { target: { value: "anime" } });

		await waitFor(() => expect(onValueChange).toHaveBeenCalledTimes(1));
		expect(onValueChange.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				kind: "image",
				label: "参考图路由",
				params: expect.objectContaining({
					n: 1,
					ratio: "16:9",
					resolution: "2k",
					style: "anime",
				}),
				promptOptimization: { enabled: false },
				promptSupplements: [],
				referenceAssetIds: [],
				routeId: "route-reference",
			}),
		);
	});
});

const imageAsset: MediaAsset = {
	createdAt: "2026-07-15T00:00:00.000Z",
	filename: "reference.png",
	id: "asset-image",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1024,
	updatedAt: "2026-07-15T00:00:00.000Z",
	url: "/api/v1/media-assets/asset-image/content",
};

const promptInsertItems = [
	{
		categoryLabel: "风格",
		id: "pack-user-style",
		name: "用户自定义风格",
		prompt: "用户维护的风格提示词",
	},
	{
		categoryLabel: "镜头",
		id: "pack-camera",
		name: "推进镜头",
		prompt: "缓慢推进镜头",
	},
];

const workspaceValue = () => ({
	catalog,
	generationPreferences: null,
	hasConfiguredRoutesForKind: true,
	hasLiveCatalog: true,
	hasLoadedPromptInsertItems: true,
	hasSettledGenerationPreferences: true,
	hasSettledPromptInsertItems: true,
	isUploadingAsset: false,
	mediaAssets: [imageAsset],
	mutateMediaAssets: vi.fn(),
	promptInsertItems,
	selectedFamily: catalog.families[0],
	selectedParams: {},
	selectedRoute: catalog.routes[0],
	selectedVersion: catalog.versions[0],
});

const catalog: GenerationModelsResponse = {
	families: [
		{ id: "family-image", kind: "image", label: "图片模型" },
		{ id: "family-text", kind: "text", label: "文本模型" },
	],
	versions: [
		{
			canonicalModel: "image-model",
			capabilities: { async: false, supportsReferenceUrls: true },
			familyId: "family-image",
			id: "version-image",
			kind: "image",
			label: "图片 V1",
		},
		{
			canonicalModel: "text-model",
			capabilities: { async: false, supportsReferenceUrls: false },
			familyId: "family-text",
			id: "version-text",
			kind: "text",
			label: "文本 V1",
		},
	],
	routes: [
		imageRoute("route-reference", true),
		imageRoute("route-no-reference", false),
		{
			adapter: "test.text",
			async: false,
			configured: true,
			docUrl: "",
			familyId: "family-text",
			id: "route-text",
			kind: "text",
			label: "文本优化路由",
			model: "text-model",
			params: [],
			provider: "openai",
			status: "available",
			supportsReferenceUrls: false,
			versionId: "version-text",
		},
	],
	models: [],
	providers: [{ id: "openai", label: "OpenAI", providerType: "official" }],
};

function imageRoute(id: string, supportsReferenceUrls: boolean): GenerationRoute {
	return {
		adapter: "test.image",
		async: false,
		configured: true,
		docUrl: "",
		familyId: "family-image",
		id,
		kind: "image",
		label: id === "route-reference" ? "参考图路由" : "无参考图路由",
		maxReferenceUrls: 2,
		model: "image-model",
		paramCombos: [
			{
				allowed: [["16:9", "2k"]],
				params: ["ratio", "resolution"],
			},
		],
		paramGroups: [
			{ id: "size", label: "画面", params: ["ratio", "resolution"] },
			{ id: "count", label: "张数", params: ["n"] },
			{ id: "other", label: "其他", params: ["style"] },
		],
		params: [
			{
				default: "16:9",
				label: "比例",
				name: "ratio",
				options: [{ label: "16:9", value: "16:9" }],
				type: "select",
			},
			{
				default: "2k",
				label: "清晰度",
				name: "resolution",
				options: [{ label: "高清 2K", value: "2k" }],
				type: "select",
			},
			{ default: 1, label: "张数", max: 4, min: 1, name: "n", type: "number" },
			{
				default: "realistic",
				label: "模型风格参数",
				name: "style",
				options: [
					{ label: "写实", value: "realistic" },
					{ label: "动漫", value: "anime" },
				],
				type: "select",
			},
		],
		provider: "openai",
		status: "available",
		supportsReferenceUrls,
		versionId: "version-image",
	};
}
