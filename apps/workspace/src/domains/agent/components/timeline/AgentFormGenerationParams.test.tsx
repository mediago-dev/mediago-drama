import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationModelsResponse } from "@/domains/generation/api/generation";
import { AgentFormGenerationParams } from "./AgentFormGenerationParams";

const mocks = vi.hoisted(() => ({ useSWR: vi.fn() }));

vi.mock("swr", () => ({ default: mocks.useSWR }));

describe("AgentFormGenerationParams", () => {
	afterEach(() => {
		cleanup();
		mocks.useSWR.mockReset();
	});

	it("renders every route-schema parameter with normalized defaults", async () => {
		mocks.useSWR.mockReturnValue({ data: catalog() });
		const onChange = vi.fn();

		render(
			<AgentFormGenerationParams
				value={{ routeId: "test.image", params: {} }}
				disabled={false}
				onChange={onChange}
			/>,
		);

		expect(screen.getByLabelText("生成数量：2")).toBeTruthy();
		expect(screen.getByLabelText(/^图片大小：/)).toBeTruthy();
		expect(screen.getByLabelText("风格：写实")).toBeTruthy();
		expect(screen.getByText("其他设置")).toBeTruthy();
		expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
		expect(screen.getByDisplayValue("24")).toBeTruthy();
		expect(screen.getByDisplayValue("none")).toBeTruthy();

		await waitFor(() =>
			expect(onChange).toHaveBeenCalledWith({
				routeId: "test.image",
				label: "test · Image Model",
				params: {
					aspectRatio: "1:1",
					resolution: "2K",
					n: 2,
					style: "realistic",
					enhance: true,
					steps: 24,
					negativePrompt: "none",
				},
			}),
		);
	});
});

const catalog = (): GenerationModelsResponse =>
	({
		families: [{ id: "image-family", label: "Image", kinds: ["image"] }],
		versions: [
			{ id: "image-version", familyId: "image-family", label: "Image Model", kind: "image" },
		],
		routes: [
			{
				id: "test.image",
				familyId: "image-family",
				versionId: "image-version",
				kind: "image",
				label: "Test",
				provider: "test",
				model: "image-model",
				status: "available",
				configured: true,
				params: [
					{
						name: "aspectRatio",
						label: "比例",
						type: "select",
						default: "1:1",
						options: [
							{ label: "1:1", value: "1:1" },
							{ label: "16:9", value: "16:9" },
						],
					},
					{
						name: "resolution",
						label: "分辨率",
						type: "select",
						default: "2K",
						options: [
							{ label: "1K", value: "1K" },
							{ label: "2K", value: "2K" },
						],
					},
					{ name: "n", label: "数量", type: "number", default: 2, min: 1, max: 4 },
					{
						name: "style",
						label: "风格",
						type: "select",
						default: "realistic",
						options: [
							{ label: "写实", value: "realistic" },
							{ label: "动漫", value: "anime" },
						],
					},
					{ name: "enhance", label: "增强", type: "boolean", default: true },
					{ name: "steps", label: "步数", type: "number", default: 24, min: 1, max: 50 },
					{
						name: "negativePrompt",
						label: "负面提示词",
						type: "text",
						default: "none",
					},
				],
				paramGroups: [
					{ id: "size", label: "大小", params: ["aspectRatio", "resolution"] },
					{ id: "count", label: "数量", params: ["n"] },
					{ id: "style", label: "风格", params: ["style"] },
				],
			},
		],
		models: [],
		providers: [],
	}) as unknown as GenerationModelsResponse;
