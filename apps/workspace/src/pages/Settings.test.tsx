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
import { openExternalUrl } from "@/shared/desktop/actions";
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
		vi.mocked(getAPIKeys).mockResolvedValue(apiKeysResponse({}));
		vi.mocked(getModelPlatforms).mockResolvedValue(modelPlatformsResponse());
		vi.mocked(saveAPIKey).mockResolvedValue(apiKeysResponse({ mediagoConfigured: true }));
	});

	afterEach(() => {
		cleanup();
	});

	it("shows MediaGo hero and CLI section, keeps other providers collapsed", async () => {
		renderSettings();

		expect(await screen.findByRole("heading", { name: "统一接口" })).toBeInTheDocument();
		expect(screen.getByText("一个 API Key，通用全部生成模型")).toBeInTheDocument();
		expect(screen.getAllByText("推荐")).toHaveLength(1);

		expect(screen.getByRole("heading", { name: "会员 CLI 接入" })).toBeInTheDocument();
		expect(
			screen.getByText("已开通即梦高级会员？可直接登录即梦账号接入，无需 API Key。"),
		).toBeInTheDocument();
		expect(screen.getByText("即梦")).toBeInTheDocument();

		expect(screen.getByRole("button", { name: /其他接入方式/ })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "自定义接口" })).not.toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "官方供应商" })).not.toBeInTheDocument();
	});

	it("renders MediaGo model chips from platform data", async () => {
		renderSettings();

		expect(await screen.findByText("支持模型")).toBeInTheDocument();
		expect(screen.getByText("MiniMax M3")).toBeInTheDocument();
		expect(screen.getByText("GLM 4.7")).toBeInTheDocument();
	});

	it("expands other providers on demand", async () => {
		renderSettings();

		fireEvent.click(await screen.findByRole("button", { name: /其他接入方式/ }));

		expect(screen.getByRole("heading", { name: "自定义接口" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "官方供应商" })).toBeInTheDocument();
		expect(screen.getByText("OpenRouter")).toBeInTheDocument();
		expect(screen.queryByText("openrouter")).not.toBeInTheDocument();
	});

	it("keeps other providers collapsed by default even when one is configured", async () => {
		vi.mocked(getAPIKeys).mockResolvedValue(apiKeysResponse({ openrouterConfigured: true }));
		renderSettings();

		expect(await screen.findByRole("button", { name: /其他接入方式/ })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "自定义接口" })).not.toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "官方供应商" })).not.toBeInTheDocument();
	});

	it("opens the MediaGo API key page from the config dialog", async () => {
		renderSettings();

		fireEvent.click(await screen.findByRole("button", { name: /配置 API Key/ }));
		fireEvent.click(await screen.findByRole("button", { name: /免费注册获取/ }));

		expect(openExternalUrl).toHaveBeenCalledWith(expect.stringContaining("apiKeys"));
	});

	it("saves the MediaGo key from the config dialog", async () => {
		renderSettings();

		fireEvent.click(await screen.findByRole("button", { name: /配置 API Key/ }));
		const dialog = await screen.findByRole("dialog", { name: "配置 MediaGo API Key" });
		const input = within(dialog).getByLabelText("MediaGo API Key") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "sk-mediago-123456" } });

		expect(screen.getByText("API Key 已输入，可以点击一键配置完成保存。")).toBeInTheDocument();
		fireEvent.click(within(dialog).getByRole("button", { name: "一键配置" }));

		await waitFor(() => expect(saveAPIKey).toHaveBeenCalledWith("mediago", "sk-mediago-123456"));
	});

	it("does not render non-editable routing metadata as form inputs", async () => {
		renderSettings();

		fireEvent.click(await screen.findByRole("button", { name: /其他接入方式/ }));
		const customSection = screen.getByRole("heading", { name: "自定义接口" }).closest("section");
		expect(customSection).toBeTruthy();
		fireEvent.click(within(customSection as HTMLElement).getByRole("button", { name: /编辑/ }));

		const dialog = await screen.findByRole("dialog", { name: "配置 OpenRouter" });
		expect(dialog).toBeInTheDocument();
		expect(screen.getByLabelText("OpenRouter API Key")).toBeInTheDocument();
		expect(screen.queryByLabelText("供应商 ID")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("端点策略")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("模型路由")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("能力范围")).not.toBeInTheDocument();
	});

	it("shows the jimeng CLI login flow instead of an API key input", async () => {
		renderSettings();

		const cliSection = (await screen.findByRole("heading", { name: "会员 CLI 接入" })).closest(
			"section",
		);
		expect(cliSection).toBeTruthy();
		expect(within(cliSection as HTMLElement).getByText("未登录")).toBeInTheDocument();
		expect(
			within(cliSection as HTMLElement).getByRole("button", { name: "登录" }),
		).toBeInTheDocument();
		expect(screen.queryByText("jimeng")).not.toBeInTheDocument();
	});

	it("renders LibTV and Xiaoyunque CLI providers from platform data", async () => {
		vi.mocked(getAPIKeys).mockResolvedValue(apiKeysResponse({ includeExtraCLI: true }));
		vi.mocked(getModelPlatforms).mockResolvedValue(
			modelPlatformsResponse({ cliProviderIDs: ["libtv", "xiaoyunque"] }),
		);

		renderSettings();

		const cliSection = (await screen.findByRole("heading", { name: "会员 CLI 接入" })).closest(
			"section",
		);
		expect(cliSection).toBeTruthy();
		expect(within(cliSection as HTMLElement).getByText("LibTV")).toBeInTheDocument();
		expect(within(cliSection as HTMLElement).getByText("小云雀")).toBeInTheDocument();
		expect(
			within(cliSection as HTMLElement).getByRole("button", { name: "登录" }),
		).toBeInTheDocument();
		expect(
			screen.queryByText("已有小云雀 Access Key？可通过本地 Pippit CLI 接入。"),
		).not.toBeInTheDocument();
		expect(
			within(cliSection as HTMLElement).queryByLabelText("小云雀 API Key"),
		).not.toBeInTheDocument();
		fireEvent.click(within(cliSection as HTMLElement).getByRole("button", { name: "编辑 小云雀" }));
		const dialog = await screen.findByRole("dialog", { name: "配置 小云雀" });
		expect(within(dialog).getByLabelText("小云雀 API Key")).toBeInTheDocument();
		expect(within(cliSection as HTMLElement).queryByText("即梦")).not.toBeInTheDocument();
	});

	it("saves the Xiaoyunque key from a CLI config dialog", async () => {
		vi.mocked(getAPIKeys).mockResolvedValue(apiKeysResponse({ includeExtraCLI: true }));
		vi.mocked(getModelPlatforms).mockResolvedValue(
			modelPlatformsResponse({ cliProviderIDs: ["xiaoyunque"] }),
		);

		renderSettings();

		const cliSection = (await screen.findByRole("heading", { name: "会员 CLI 接入" })).closest(
			"section",
		);
		expect(cliSection).toBeTruthy();
		fireEvent.click(within(cliSection as HTMLElement).getByRole("button", { name: "编辑 小云雀" }));
		const dialog = await screen.findByRole("dialog", { name: "配置 小云雀" });
		fireEvent.change(within(dialog).getByLabelText("小云雀 API Key"), {
			target: { value: "xyq-access-key-123456" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

		await waitFor(() =>
			expect(saveAPIKey).toHaveBeenCalledWith("xiaoyunque", "xyq-access-key-123456"),
		);
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

const apiKeysResponse = ({
	includeExtraCLI = false,
	mediagoConfigured = false,
	openrouterConfigured = false,
}: {
	includeExtraCLI?: boolean;
	mediagoConfigured?: boolean;
	openrouterConfigured?: boolean;
}): APIKeyListResponse => ({
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
			configured: openrouterConfigured,
			source: openrouterConfigured ? "settings" : "none",
			masked: openrouterConfigured ? "sk••••7890" : undefined,
			credentialKind: "apiKey",
			capabilities: ["text"],
		},
		{
			id: "jimeng",
			label: "即梦",
			description: "即梦 CLI 接入",
			configured: false,
			source: "none",
			credentialKind: "oauth",
			capabilities: ["image"],
		},
		...(includeExtraCLI
			? [
					{
						id: "libtv",
						label: "LibTV",
						description: "LibTV CLI 接入",
						configured: false,
						source: "none" as const,
						credentialKind: "oauth",
						capabilities: ["image"],
					},
					{
						id: "xiaoyunque",
						label: "小云雀",
						description: "小云雀 CLI 接入",
						configured: false,
						source: "none" as const,
						credentialKind: "apiKey",
						credentialLabel: "小云雀 Access Key",
						help: "已有小云雀 Access Key？可通过本地 Pippit CLI 接入。",
						placeholder: "输入 XYQ_ACCESS_KEY",
						capabilities: ["image", "video"],
					},
				]
			: []),
		{
			id: "volcengine",
			label: "火山引擎",
			description: "官方供应商",
			configured: false,
			source: "none",
			credentialKind: "apiKey",
			capabilities: ["image"],
		},
	],
});

const modelPlatformsResponse = ({
	cliProviderIDs = ["jimeng"],
}: {
	cliProviderIDs?: string[];
} = {}): ModelPlatformsResponse => ({
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
		...cliProviderIDs.map((providerID) => ({
			id: providerID,
			label: cliPlatformLabel(providerID),
			kind: "cli",
			description: `${cliPlatformLabel(providerID)} CLI 接入`,
			apiKeyProviderId: providerID,
		})),
	],
});

const cliPlatformLabel = (providerID: string) => {
	switch (providerID) {
		case "libtv":
			return "LibTV";
		case "xiaoyunque":
			return "小云雀";
		default:
			return "即梦";
	}
};
