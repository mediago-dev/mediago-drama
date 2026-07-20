import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	beginCodexAccountLogin,
	getCodexAccount,
	getCodexAccountLogin,
	getCodexRelaySettings,
} from "@/domains/settings/api/settings";
import { openExternalUrl } from "@/shared/desktop/actions";
import { CodexAccessPanel } from "./CodexAccessPanel";

vi.mock("@/domains/settings/api/settings", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/settings/api/settings")>();
	return {
		...actual,
		beginCodexAccountLogin: vi.fn(),
		cancelCodexAccountLogin: vi.fn(),
		getCodexAccount: vi.fn(),
		getCodexAccountLogin: vi.fn(),
		getCodexRelaySettings: vi.fn(),
		logoutCodexAccount: vi.fn(),
		saveCodexRelaySettings: vi.fn(),
	};
});

vi.mock("@/domains/settings/components/CodexRelayPanel", () => ({
	CodexRelayPanel: ({
		officialChannel,
		title,
	}: {
		officialChannel?: {
			busy: boolean;
			detail?: string;
			email?: string;
			onLogin: () => void;
			onLogout: () => void;
			onReopen: () => void;
			status: string;
		};
		title?: unknown;
	}) => (
		<div>
			<h2>{String(title)}</h2>
			<p>{officialChannel?.email}</p>
			<p>{officialChannel?.detail}</p>
			{officialChannel?.status === "loggedIn" ? (
				<button type="button" onClick={officialChannel.onLogout}>
					退出全局账号
				</button>
			) : null}
			{officialChannel?.status === "loggedOut" ? (
				<button type="button" onClick={officialChannel.onLogin}>
					使用 ChatGPT 登录
				</button>
			) : null}
			{officialChannel?.status === "pending" ? (
				<button type="button" onClick={officialChannel.onReopen}>
					重新打开浏览器
				</button>
			) : null}
		</div>
	),
}));

vi.mock("@/shared/desktop/actions", () => ({ openExternalUrl: vi.fn() }));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

describe("CodexAccessPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getCodexRelaySettings).mockResolvedValue({
			enabled: false,
			activeProfileId: "",
			profiles: [],
		});
	});

	afterEach(cleanup);

	it("reuses and displays the shared global Codex account", async () => {
		vi.mocked(getCodexAccount).mockResolvedValue({
			status: "loggedIn",
			email: "user@example.com",
			planType: "plus",
			codexHome: "/Users/test/.codex",
			shared: true,
		});

		renderPanel();

		expect(await screen.findByText("user@example.com")).toBeInTheDocument();
		expect(screen.getByText("ChatGPT Plus · /Users/test/.codex")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "退出全局账号" })).toBeInTheDocument();
		expect(beginCodexAccountLogin).not.toHaveBeenCalled();
	});

	it("opens the browser URL returned by bundled Codex", async () => {
		vi.mocked(getCodexAccount).mockResolvedValue({
			status: "notLoggedIn",
			codexHome: "/Users/test/.codex",
			shared: true,
		});
		vi.mocked(beginCodexAccountLogin).mockResolvedValue({
			loginId: "login-123",
			authUrl: "https://chatgpt.com/auth/test",
			status: "pending",
		});
		vi.mocked(getCodexAccountLogin).mockResolvedValue({
			loginId: "login-123",
			authUrl: "https://chatgpt.com/auth/test",
			status: "pending",
		});

		renderPanel();
		fireEvent.click(await screen.findByRole("button", { name: "使用 ChatGPT 登录" }));

		await waitFor(() =>
			expect(openExternalUrl).toHaveBeenCalledWith("https://chatgpt.com/auth/test"),
		);
		expect(await screen.findByRole("button", { name: "重新打开浏览器" })).toBeInTheDocument();
	});
});

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
			<CodexAccessPanel />
		</SWRConfig>,
	);
