import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationParam } from "@/domains/generation/api/generation";
import { filterImageGenerationSpecParams, resolveImageGenerationSpec } from "./imageGenerationSpec";
import { ImageGenerationSpecControl } from "./ImageGenerationSpecControl";

const selectParam = (
	name: string,
	label: string,
	defaultValue: string,
	options: Array<{ label: string; value: string }>,
): GenerationParam => ({
	name,
	label,
	type: "select",
	default: defaultValue,
	options,
});

const numberParam = (name: string, label: string): GenerationParam => ({
	name,
	label,
	type: "number",
	default: 1,
	min: 1,
	max: 4,
});

const splitParams = [
	selectParam("aspectRatio", "画幅比例", "1:1", [
		{ label: "1:1", value: "1:1" },
		{ label: "16:9", value: "16:9" },
		{ label: "9:16", value: "9:16" },
	]),
	selectParam("imageSize", "图像尺寸", "2K", [
		{ label: "1K", value: "1K" },
		{ label: "2K", value: "2K" },
		{ label: "4K", value: "4K" },
	]),
	numberParam("n", "图像数量"),
];

describe("resolveImageGenerationSpec", () => {
	it("resolves split aspect ratio and image size params", () => {
		const spec = resolveImageGenerationSpec(splitParams, {
			aspectRatio: "16:9",
			imageSize: "4K",
		});

		expect(spec?.mode).toBe("split");
		expect(spec?.controlledParamNames).toEqual(["aspectRatio", "imageSize"]);
		expect(spec?.selectedRatio?.ratio).toBe("16:9");
		expect(spec?.selectedResolution?.resolution).toBe("4K");
		expect(spec?.sizePreview).toEqual({ width: 4096, height: 2304 });
	});

	it("does not show smart ratio unless the route exposes an automatic option", () => {
		const spec = resolveImageGenerationSpec(splitParams, {});

		expect(spec?.ratioOptions.some((option) => option.smart)).toBe(false);
	});

	it("shows smart ratio when the route exposes an automatic option", () => {
		const spec = resolveImageGenerationSpec(
			[
				selectParam("aspectRatio", "画幅比例", "auto", [
					{ label: "自动", value: "auto" },
					{ label: "1:1", value: "1:1" },
				]),
				splitParams[1],
			],
			{},
		);

		expect(spec?.ratioOptions.some((option) => option.smart)).toBe(true);
	});

	it("uses size compatibility mode only when ratio and resolution can be parsed", () => {
		const spec = resolveImageGenerationSpec(
			[
				selectParam("size", "尺寸", "2048x2048", [
					{ label: "2048x2048", value: "2048x2048" },
					{ label: "16:9 2K", value: "2848x1600" },
					{ label: "9:16 2K", value: "1600x2848" },
				]),
				selectParam("outputFormat", "输出格式", "png", [
					{ label: "PNG", value: "png" },
					{ label: "JPEG", value: "jpeg" },
				]),
			],
			{ size: "2848x1600" },
		);

		expect(spec?.mode).toBe("size");
		expect(spec?.controlledParamNames).toEqual(["size"]);
		expect(spec?.selectedRatio?.ratio).toBe("16:9");
		expect(spec?.selectedResolution?.resolution).toBe("2K");
		expect(spec?.sizePreview).toEqual({ width: 2848, height: 1600 });
	});

	it("uses a default ratio label for named size options without a fixed ratio", () => {
		const spec = resolveImageGenerationSpec(
			[
				selectParam("size", "尺寸", "2K", [
					{ label: "2K", value: "2K" },
					{ label: "16:9 2K", value: "2848x1600" },
					{ label: "9:16 2K", value: "1600x2848" },
				]),
			],
			{ size: "2K" },
		);

		expect(spec?.mode).toBe("size");
		expect(spec?.selectedRatio?.defaultRatio).toBe(true);
		expect(spec?.selectedResolution?.resolution).toBe("2K");
	});

	it("keeps unparsed size params in the advanced form", () => {
		const params = [
			selectParam("size", "尺寸", "small", [
				{ label: "小", value: "small" },
				{ label: "大", value: "large" },
			]),
		];
		const spec = resolveImageGenerationSpec(params, {});

		expect(spec).toBeNull();
		expect(filterImageGenerationSpecParams(params, spec).map((param) => param.name)).toEqual([
			"size",
		]);
	});

	it("filters controlled params from remaining advanced params", () => {
		const spec = resolveImageGenerationSpec(splitParams, {});

		expect(filterImageGenerationSpecParams(splitParams, spec).map((param) => param.name)).toEqual([
			"n",
		]);
	});
});

describe("ImageGenerationSpecControl", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		}) as typeof window.requestAnimationFrame;
		window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
	});

	afterEach(() => {
		cleanup();
	});

	it("updates ratio and resolution through the popover", async () => {
		const onChange = vi.fn();
		const spec = resolveImageGenerationSpec(splitParams, {
			aspectRatio: "1:1",
			imageSize: "2K",
		});
		expect(spec).not.toBeNull();

		render(<ImageGenerationSpecControl spec={spec!} onChange={onChange} />);

		fireEvent.click(screen.getByRole("button", { name: /图像规格/ }));
		await screen.findByRole("dialog", { name: "图像规格" });
		fireEvent.click(screen.getByRole("button", { name: "16:9" }));
		fireEvent.click(screen.getByRole("button", { name: "超清 4K" }));

		expect(onChange).toHaveBeenCalledWith("aspectRatio", "16:9");
		expect(onChange).toHaveBeenCalledWith("imageSize", "4K");
	});

	it("shows read-only size preview and refreshes it after selection", async () => {
		const Harness = () => {
			const [values, setValues] = useState<Record<string, unknown>>({
				aspectRatio: "1:1",
				imageSize: "2K",
			});
			const spec = useMemo(() => resolveImageGenerationSpec(splitParams, values), [values]);
			if (!spec) return null;

			return (
				<ImageGenerationSpecControl
					spec={spec}
					onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
				/>
			);
		};

		render(<Harness />);

		fireEvent.click(screen.getByRole("button", { name: /图像规格/ }));
		await screen.findByRole("dialog", { name: "图像规格" });
		expect(screen.getByLabelText("宽度预览").textContent).toContain("2048");
		expect(screen.getByLabelText("高度预览").textContent).toContain("2048");

		fireEvent.click(screen.getByRole("button", { name: "16:9" }));

		expect(screen.getByLabelText("宽度预览").textContent).toContain("2048");
		expect(screen.getByLabelText("高度预览").textContent).toContain("1152");
	});

	it("closes on Escape and outside pointer down", async () => {
		const spec = resolveImageGenerationSpec(splitParams, {});
		expect(spec).not.toBeNull();

		render(<ImageGenerationSpecControl spec={spec!} onChange={vi.fn()} />);

		fireEvent.click(screen.getByRole("button", { name: /图像规格/ }));
		await screen.findByRole("dialog", { name: "图像规格" });
		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "图像规格" })).toBeNull());

		fireEvent.click(screen.getByRole("button", { name: /图像规格/ }));
		await screen.findByRole("dialog", { name: "图像规格" });
		fireEvent.pointerDown(document.body);
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "图像规格" })).toBeNull());
	});
});
