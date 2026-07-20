import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationSettingsFormController } from "@/domains/generation/hooks/useGenerationSettingsForm";
import { BatchGenerationSettingsDialog } from "./BatchGenerationSettingsDialog";

const mocks = vi.hoisted(() => ({
	renderSharedForm: vi.fn(),
	useGenerationSettingsForm: vi.fn(),
}));

vi.mock("@/domains/documents/components/GenerationModalShell", () => ({
	GenerationModalShell: ({
		children,
		open,
		title,
		titleAside,
	}: {
		children: React.ReactNode;
		open: boolean;
		title: React.ReactNode;
		titleAside?: React.ReactNode;
	}) =>
		open ? (
			<div role="dialog">
				<h2>{title}</h2>
				{titleAside}
				{children}
			</div>
		) : null,
}));

vi.mock("@/domains/generation/hooks/useGenerationSettingsForm", () => ({
	useGenerationSettingsForm: mocks.useGenerationSettingsForm,
}));

vi.mock("./GenerationSettingsForm", () => ({
	GenerationSettingsForm: ({ controller }: { controller: GenerationSettingsFormController }) => {
		mocks.renderSharedForm(controller);
		return (
			<div data-testid="shared-generation-settings-form">
				<span>模型</span>
				<span>参数</span>
				<span>参考图</span>
				<span>补充提示词</span>
				<span>优化提示词</span>
			</div>
		);
	},
}));

vi.mock("@/shared/components/ui/dialog-dismiss", () => ({
	DialogDismissButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

describe("BatchGenerationSettingsDialog shared form adapter", () => {
	beforeEach(() => {
		mocks.renderSharedForm.mockClear();
		mocks.useGenerationSettingsForm.mockReset();
		mocks.useGenerationSettingsForm.mockReturnValue(controllerFixture());
	});

	afterEach(cleanup);

	it("keeps the batch shell and renders the shared five-section form", () => {
		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				projectId="project-a"
				selectedCount={2}
				onConfirm={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		expect(screen.getByRole("heading", { name: "批量生成图片设置" })).toBeTruthy();
		expect(screen.getByText("已选 2 项")).toBeTruthy();
		expect(screen.getByTestId("shared-generation-settings-form")).toBeTruthy();
		expect(mocks.useGenerationSettingsForm).toHaveBeenCalledWith({
			kind: "image",
			persist: true,
			projectId: "project-a",
			uploadIdPrefix: "batch-generation-settings-image",
		});
		expect(mocks.renderSharedForm).toHaveBeenCalledWith(
			mocks.useGenerationSettingsForm.mock.results[0]?.value,
		);
		expect(screen.getByText("将按顺序对 2 项各提交一次生成任务。")).toBeTruthy();
	});

	it("maps the complete shared value to the existing batch confirm payload", () => {
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

		fireEvent.click(screen.getByRole("button", { name: "优化并生成" }));

		expect(onConfirm).toHaveBeenCalledWith({
			family: expect.objectContaining({ id: "family-image" }),
			params: { n: 2, ratio: "1:1" },
			promptOptimization: {
				model: "text-model",
				referenceId: "pack-optimize",
				referenceName: "场景氛围图",
				referencePrompt: "突出空间层次和光线。",
				routeId: "route-text",
			},
			promptSupplements: [
				{
					referenceId: "pack-style",
					referenceName: "2D动漫",
					referencePrompt: "纯正二维动画风格。",
				},
			],
			referenceAssetIds: ["asset-reference"],
			route: expect.objectContaining({ id: "route-image" }),
			version: expect.objectContaining({ id: "version-image" }),
		});
	});

	it("disables only confirm while shared settings are not ready and keeps cancel actionable", () => {
		mocks.useGenerationSettingsForm.mockReturnValue(
			controllerFixture({ isBusy: true, isValid: false }),
		);
		const onOpenChange = vi.fn();
		render(
			<BatchGenerationSettingsDialog
				kind="image"
				open
				selectedCount={1}
				onConfirm={vi.fn()}
				onOpenChange={onOpenChange}
			/>,
		);

		expect(screen.getByRole("button", { name: "优化并生成" })).toBeDisabled();
		const cancel = screen.getByRole("button", { name: "取消" });
		expect(cancel).toBeEnabled();
		fireEvent.click(cancel);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("unmounts the form while closed so reopening drops transient references", () => {
		const props = {
			kind: "image" as const,
			onConfirm: vi.fn(),
			onOpenChange: vi.fn(),
			selectedCount: 1,
		};
		const { rerender } = render(<BatchGenerationSettingsDialog {...props} open />);
		expect(mocks.useGenerationSettingsForm).toHaveBeenCalledTimes(1);

		rerender(<BatchGenerationSettingsDialog {...props} open={false} />);
		expect(screen.queryByTestId("shared-generation-settings-form")).toBeNull();
		expect(mocks.useGenerationSettingsForm).toHaveBeenCalledTimes(1);

		rerender(<BatchGenerationSettingsDialog {...props} open />);
		expect(mocks.useGenerationSettingsForm).toHaveBeenCalledTimes(2);
	});
});

const controllerFixture = (
	overrides: Partial<GenerationSettingsFormController> = {},
): GenerationSettingsFormController => {
	const imageFamily = { id: "family-image", kind: "image", label: "图片模型" };
	const imageVersion = {
		canonicalModel: "image-model",
		capabilities: { async: false, supportsReferenceUrls: true },
		familyId: imageFamily.id,
		id: "version-image",
		kind: "image",
		label: "图片 V1",
	};
	const imageRoute = {
		adapter: "test.image",
		async: false,
		configured: true,
		docUrl: "",
		familyId: imageFamily.id,
		id: "route-image",
		kind: "image",
		label: "图片路由",
		model: "image-model",
		params: [
			{ default: 1, label: "张数", name: "n", type: "number" },
			{
				default: "1:1",
				label: "比例",
				name: "ratio",
				options: [{ label: "1:1", value: "1:1" }],
				type: "select",
			},
		],
		provider: "test",
		status: "available",
		supportsReferenceUrls: true,
		versionId: imageVersion.id,
	};
	const textFamily = { id: "family-text", kind: "text", label: "文本模型" };
	const textVersion = {
		canonicalModel: "text-model",
		capabilities: { async: false, supportsReferenceUrls: false },
		familyId: textFamily.id,
		id: "version-text",
		kind: "text",
		label: "文本 V1",
	};
	const textRoute = {
		adapter: "test.text",
		async: false,
		configured: true,
		docUrl: "",
		familyId: textFamily.id,
		id: "route-text",
		kind: "text",
		label: "文本路由",
		model: "text-model",
		params: [],
		provider: "test",
		status: "available",
		supportsReferenceUrls: false,
		versionId: textVersion.id,
	};
	const catalog = {
		families: [imageFamily, textFamily],
		models: [],
		providers: [],
		routes: [imageRoute, textRoute],
		versions: [imageVersion, textVersion],
	};

	return {
		catalog,
		isBusy: false,
		isValid: true,
		promptInsertItems: [
			{
				categoryLabel: "风格",
				id: "pack-style",
				name: "2D动漫",
				prompt: "纯正二维动画风格。",
			},
			{
				categoryLabel: "构图",
				id: "pack-optimize",
				name: "场景氛围图",
				prompt: "突出空间层次和光线。",
			},
		],
		value: {
			kind: "image",
			label: "图片路由",
			params: { n: 2, ratio: "1:1" },
			promptOptimization: {
				enabled: true,
				referenceId: "pack-optimize",
				referenceName: "场景氛围图",
				referencePrompt: "突出空间层次和光线。",
				routeId: "route-text",
			},
			promptSupplements: [
				{
					referenceId: "pack-style",
					referenceName: "2D动漫",
					referencePrompt: "纯正二维动画风格。",
				},
			],
			referenceAssetIds: ["asset-reference"],
			routeId: "route-image",
		},
		...overrides,
	} as GenerationSettingsFormController;
};
