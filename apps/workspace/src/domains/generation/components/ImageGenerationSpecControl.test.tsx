import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationParam, GenerationParamCombo } from "@/domains/generation/api/generation";
import { filterImageGenerationSpecParams, resolveImageGenerationSpec } from "./imageGenerationSpec";
import {
	ImageGenerationSpecControl,
	imageGenerationSpecPopoverBoundary,
} from "./ImageGenerationSpecControl";

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

const sparseCombos = [
	{
		params: ["aspectRatio", "imageSize"],
		allowed: [
			["adaptive", "1K"],
			["1:1", "1K"],
			["1:1", "2K"],
			["16:9", "2K"],
			["16:9", "4K"],
			["9:16", "4K"],
		],
	},
];

const gptImageSplitParams = [
	selectParam("aspectRatio", "画幅比例", "1:1", [
		{ label: "1:1", value: "1:1" },
		{ label: "3:2", value: "3:2" },
		{ label: "2:3", value: "2:3" },
		{ label: "16:9", value: "16:9" },
		{ label: "9:16", value: "9:16" },
	]),
	selectParam("resolution", "分辨率", "1K", [
		{ label: "1K", value: "1K" },
		{ label: "2K", value: "2K" },
		{ label: "4K", value: "4K" },
	]),
];

const gptImageCombos: GenerationParamCombo[] = [
	{
		params: ["aspectRatio", "resolution"],
		allowed: [
			["1:1", "1K"],
			["1:1", "2K"],
			["3:2", "1K"],
			["2:3", "1K"],
			["16:9", "2K"],
			["16:9", "4K"],
			["9:16", "4K"],
		],
		outputs: {
			"1:1|1K": "1024x1024",
			"1:1|2K": "2048x2048",
			"3:2|1K": "1536x1024",
			"2:3|1K": "1024x1536",
			"16:9|2K": "2048x1152",
			"16:9|4K": "3840x2160",
			"9:16|4K": "2160x3840",
		},
	},
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

	it("resolves canonical resolution params", () => {
		const params = [
			splitParams[0],
			selectParam("resolution", "分辨率", "2K", [
				{ label: "1K", value: "1K" },
				{ label: "2K", value: "2K" },
				{ label: "4K", value: "4K" },
			]),
			numberParam("n", "图像数量"),
		];
		const spec = resolveImageGenerationSpec(params, {
			aspectRatio: "9:16",
			resolution: "4K",
		});

		expect(spec?.mode).toBe("split");
		expect(spec?.controlledParamNames).toEqual(["aspectRatio", "resolution"]);
		expect(spec?.selectedRatio?.ratio).toBe("9:16");
		expect(spec?.selectedResolution?.resolution).toBe("4K");
		expect(spec?.sizePreview).toEqual({ width: 2304, height: 4096 });
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

	it("filters controlled params from remaining advanced params", () => {
		const spec = resolveImageGenerationSpec(splitParams, {});

		expect(filterImageGenerationSpecParams(splitParams, spec).map((param) => param.name)).toEqual([
			"n",
		]);
	});

	it("marks split options unavailable from route combos", () => {
		const spec = resolveImageGenerationSpec(
			splitParams,
			{
				aspectRatio: "16:9",
				imageSize: "2K",
			},
			sparseCombos,
		);

		expect(spec?.mode).toBe("split");
		expect(spec?.resolutionOptions.find((option) => option.value === "1K")?.disabled).toBe(true);
		expect(spec?.resolutionOptions.find((option) => option.value === "4K")?.disabled).toBe(false);
		expect(spec?.ratioOptions.find((option) => option.value === "9:16")?.disabled).toBe(false);
	});

	it("uses exact combo outputs for GPT Image 2 size preview", () => {
		const portrait = resolveImageGenerationSpec(
			gptImageSplitParams,
			{
				aspectRatio: "2:3",
				resolution: "1K",
			},
			gptImageCombos,
		);
		const wide4k = resolveImageGenerationSpec(
			gptImageSplitParams,
			{
				aspectRatio: "16:9",
				resolution: "4K",
			},
			gptImageCombos,
		);

		expect(portrait?.sizePreview).toEqual({ width: 1024, height: 1536 });
		expect(wide4k?.sizePreview).toEqual({ width: 3840, height: 2160 });
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

	it("renders the trigger icon with the selected aspect ratio", () => {
		const spec = resolveImageGenerationSpec(splitParams, {
			aspectRatio: "16:9",
			imageSize: "2K",
		});
		expect(spec).not.toBeNull();

		const { container } = render(<ImageGenerationSpecControl spec={spec!} onChange={vi.fn()} />);
		const glyph = container.querySelector<HTMLElement>('[data-ratio-glyph="trigger"]');

		expect(glyph?.dataset.ratioValue).toBe("16:9");
		expect(glyph?.style.aspectRatio).toBe("16 / 9");
		expect(glyph?.style.width).toBe("var(--generation-size-ratio-glyph-max)");
	});

	it("resolves the modal collision boundary from the trigger", () => {
		const boundary = document.createElement("div");
		const trigger = document.createElement("button");
		boundary.setAttribute("data-agent-mention-popup-root", "");
		boundary.append(trigger);
		document.body.append(boundary);

		expect(imageGenerationSpecPopoverBoundary(trigger)).toBe(boundary);
		expect(imageGenerationSpecPopoverBoundary(null)).toBeUndefined();

		boundary.remove();
	});

	it("disables unavailable combos and jumps resolution when ratio changes", async () => {
		const onChange = vi.fn();
		const spec = resolveImageGenerationSpec(
			splitParams,
			{
				aspectRatio: "1:1",
				imageSize: "1K",
			},
			sparseCombos,
		);
		expect(spec).not.toBeNull();

		render(<ImageGenerationSpecControl spec={spec!} onChange={onChange} />);

		fireEvent.click(screen.getByRole("button", { name: /图像规格/ }));
		await screen.findByRole("dialog", { name: "图像规格" });

		expect(screen.getByRole("button", { name: "超清 4K" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "16:9" }));

		expect(onChange).toHaveBeenCalledWith("aspectRatio", "16:9");
		expect(onChange).toHaveBeenCalledWith("imageSize", "2K");
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
