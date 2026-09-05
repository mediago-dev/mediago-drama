import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAPIKeys,
	getCustomImageAPISettings,
	saveAPIKey,
	saveCustomImageAPISettings,
	type APIKeyListResponse,
} from "@/domains/settings/api/settings";
import { useSettingsNavigationStore } from "@/lib/stores/settings";
import { Settings } from "./Settings";

const swrMocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("swr", async (importOriginal) => {
	const actual = await importOriginal<typeof import("swr")>();
	return { ...actual, useSWRConfig: () => ({ mutate: swrMocks.mutate }) };
});

vi.mock("@/domains/settings/api/settings", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/settings/api/settings")>();
	return {
		...actual,
		getAPIKeys: vi.fn(),
		getCustomImageAPISettings: vi.fn(),
		saveAPIKey: vi.fn(),
		saveCustomImageAPISettings: vi.fn(),
	};
});

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

const apiKeysResponse = (imageConfigured = false): APIKeyListResponse => ({
	providers: [
		{
			id: "mediago-image",
			label: "统一网关图片",
			description: "图片生成专用密钥",
			configured: imageConfigured,
			source: imageConfigured ? "settings" : "none",
			masked: imageConfigured ? "sk-t••••••••test" : undefined,
			credentialLabel: "图片生成 API Key",
			placeholder: "输入图片 API Key",
		},
		{
			id: "openai",
			label: "OpenAI",
			description: "旧供应商入口",
			configured: false,
			source: "none",
		},
	],
});

const renderSettings = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<MemoryRouter>
				<Settings />
			</MemoryRouter>
		</SWRConfig>,
	);

describe("图片生成 API 设置", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSettingsNavigationStore.setState({ activeTab: "api-keys" });
		vi.mocked(getAPIKeys).mockResolvedValue(apiKeysResponse());
		vi.mocked(getCustomImageAPISettings).mockResolvedValue({
			baseURL: "https://cn.whereslow.online",
			model: "nano-banana-2",
			protocol: "gemini_generate_content",
			apiKey: { configured: false, source: "none" },
		});
		vi.mocked(saveAPIKey).mockResolvedValue(apiKeysResponse(true));
		vi.mocked(saveCustomImageAPISettings).mockResolvedValue({
			baseURL: "https://cn.whereslow.online",
			model: "nano-banana-2",
			protocol: "gemini_generate_content",
			apiKey: { configured: true, source: "settings", masked: "sk-t••••test" },
		});
	});

	afterEach(cleanup);

	it("only exposes the Codex and image-generation separation", async () => {
		renderSettings();

		expect(await screen.findByRole("heading", { name: "图片生成 API" })).toBeInTheDocument();
		expect(screen.getByText("制作助理与推理")).toBeInTheDocument();
		expect(screen.getByText("Codex 额度")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Nano Banana 2 图片接口" })).toBeInTheDocument();
		expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
		expect(screen.queryByText("聚合接口（可选）")).not.toBeInTheDocument();
	});

	it("saves the independent custom Gemini image configuration", async () => {
		renderSettings();

		fireEvent.change(await screen.findByLabelText("自定义图片 API Key"), {
			target: { value: "sk-image-test-123456" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存自定义图片 API" }));

		await waitFor(() =>
			expect(saveCustomImageAPISettings).toHaveBeenCalledWith({
				baseURL: "https://cn.whereslow.online",
				apiKey: "sk-image-test-123456",
				model: "nano-banana-2",
				protocol: "gemini_generate_content",
			}),
		);
		expect(saveAPIKey).not.toHaveBeenCalled();
	});

	it("opens the separate Codex page without copying the image key there", async () => {
		renderSettings();

		fireEvent.click(await screen.findByRole("button", { name: "查看 Codex 推理" }));
		expect(useSettingsNavigationStore.getState().activeTab).toBe("codex-access");
	});
});
