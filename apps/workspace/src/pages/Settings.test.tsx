import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAPIKeys,
	getModelPlatforms,
	saveAPIKey,
	type APIKeyListResponse,
	type ModelPlatformsResponse,
} from "@/domains/settings/api/settings";
import { useSettingsNavigationStore } from "@/lib/stores/settings";
import { Settings } from "./Settings";

vi.mock("@/domains/settings/api/settings", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/settings/api/settings")>();
	return {
		...actual,
		beginProviderLogin: vi.fn(),
		clearAPIKey: vi.fn(),
		completeProviderLogin: vi.fn(),
		getAPIKeys: vi.fn(),
		getJianyingDraftSettings: vi.fn(),
		getModelPlatforms: vi.fn(),
		saveAPIKey: vi.fn(),
		saveJianyingDraftSettings: vi.fn(),
	};
});

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	}),
}));

vi.mock("@/shared/desktop/actions", () => ({
	openExternalUrl: vi.fn(),
	pickDesktopDirectory: vi.fn(),
}));

describe("Settings API key page", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSettingsNavigationStore.setState({ activeTab: "api-keys" });
		vi.mocked(getAPIKeys).mockResolvedValue(apiKeysResponse(false));
		vi.mocked(getModelPlatforms).mockResolvedValue(modelPlatformsResponse());
		vi.mocked(saveAPIKey).mockResolvedValue(apiKeysResponse(true));
	});

	afterEach(() => {
		cleanup();
	});

	it("shows all three credential categories with MediaGo first", async () => {
		renderSettings();

		expect(
			await screen.findByRole("heading", { name: "配置 MediaGo API Key" }),
		).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "统一接口" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "自定义接口" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "官方供应商" })).toBeInTheDocument();
		expect(screen.getAllByText("推荐")).toHaveLength(1);
		expect(screen.queryByText(/只需要一个 API/)).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "显示高级选项" })).not.toBeInTheDocument();
		expect(screen.queryByText("内置模型入口")).not.toBeInTheDocument();
		expect(screen.queryByText("文本模型")).not.toBeInTheDocument();
		expect(screen.queryByText("MiniMax M3")).not.toBeInTheDocument();
		expect(
			screen.queryByText(/保存后，生成工作区和 Agent 默认模型会读取这个/),
		).not.toBeInTheDocument();
		expect(screen.queryByText("配置摘要")).not.toBeInTheDocument();
		expect(screen.queryByText("一个 Key")).not.toBeInTheDocument();
		expect(screen.queryByText("优先入口")).not.toBeInTheDocument();
		expect(screen.queryByText("可随时替换")).not.toBeInTheDocument();
	});

	it("saves the MediaGo key from the one-click setup area", async () => {
		renderSettings();

		const input = (await screen.findByLabelText("MediaGo API Key")) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "sk-mediago-123456" } });

		expect(screen.queryByText("格式已通过")).not.toBeInTheDocument();
		expect(screen.getByText("API Key 已输入，可以点击一键配置完成保存。")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "一键配置" }));

		await waitFor(() => expect(saveAPIKey).toHaveBeenCalledWith("mediago", "sk-mediago-123456"));
	});

	it("does not render non-editable routing metadata as form inputs", async () => {
		renderSettings();

		const customSection = (await screen.findByRole("heading", { name: "自定义接口" })).closest(
			"section",
		);
		expect(customSection).toBeTruthy();
		fireEvent.click(within(customSection as HTMLElement).getByRole("button", { name: "编辑" }));

		const dialog = await screen.findByRole("dialog", { name: "配置 OpenRouter" });
		expect(dialog).toBeInTheDocument();
		expect(screen.getByLabelText("OpenRouter API Key")).toBeInTheDocument();
		expect(screen.queryByLabelText("供应商 ID")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("端点策略")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("模型路由")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("能力范围")).not.toBeInTheDocument();
		expect(
			within(dialog).queryByText("除 API Key 外，其余路由信息由系统读取，不在此弹窗中编辑。"),
		).not.toBeInTheDocument();
		expect(within(dialog).queryByText(/能力：/)).not.toBeInTheDocument();
	});

	it("does not show provider ids beside provider labels in the list", async () => {
		renderSettings();

		expect(await screen.findByText("OpenRouter")).toBeInTheDocument();
		expect(screen.getByText("即梦")).toBeInTheDocument();
		expect(screen.queryByText("openrouter")).not.toBeInTheDocument();
		expect(screen.queryByText("jimeng")).not.toBeInTheDocument();
	});
});

const renderSettings = () =>
	render(
		<MemoryRouter>
			<SWRConfig value={{ provider: () => new Map() }}>
				<Settings />
			</SWRConfig>
		</MemoryRouter>,
	);

const apiKeysResponse = (mediagoConfigured: boolean): APIKeyListResponse => ({
	providers: [
		{
			id: "mediago",
			label: "MediaGo聚合平台",
			description: "统一聚合平台",
			configured: mediagoConfigured,
			source: mediagoConfigured ? "settings" : "none",
			masked: mediagoConfigured ? "sk••••3456" : undefined,
			credentialKind: "apiKey",
			capabilities: ["text", "image", "video"],
		},
		{
			id: "openrouter",
			label: "OpenRouter",
			description: "自定义兼容接口",
			configured: false,
			source: "none",
			credentialKind: "apiKey",
			capabilities: ["text"],
		},
		{
			id: "jimeng",
			label: "即梦",
			description: "官方供应商",
			configured: false,
			source: "none",
			credentialKind: "apiKey",
			capabilities: ["image"],
		},
	],
});

const modelPlatformsResponse = (): ModelPlatformsResponse => ({
	platforms: [
		{
			id: "mediago",
			label: "MediaGo聚合平台",
			kind: "unified",
			description: "统一聚合平台",
			apiKeyProviderId: "mediago",
			modelGroups: [
				{
					label: "文本模型",
					models: ["MiniMax M3", "GLM 4.7", "Qwen3.5"],
				},
			],
		},
		{
			id: "openrouter",
			label: "OpenRouter",
			kind: "custom",
			description: "自定义兼容接口",
			apiKeyProviderId: "openrouter",
		},
	],
});
