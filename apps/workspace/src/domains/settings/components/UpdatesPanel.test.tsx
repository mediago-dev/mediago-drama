import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatesPanel } from "@/domains/settings/components/UpdatesPanel";
import type { DesktopUpdateStatus, RendererUpdateStatus } from "@/shared/desktop/types";
import {
	checkDesktopUpdate,
	checkRendererUpdate,
	downloadDesktopUpdate,
	getDesktopAppVersion,
	getDesktopUpdateCapability,
	getRendererUpdateCapability,
	installDesktopUpdate,
	openExternalUrl,
	subscribeDesktopUpdateStatus,
	subscribeRendererUpdateStatus,
} from "@/shared/desktop/actions";

vi.mock("@/shared/desktop/actions", () => ({
	checkDesktopUpdate: vi.fn(),
	checkRendererUpdate: vi.fn(),
	downloadDesktopUpdate: vi.fn(),
	getDesktopAppVersion: vi.fn(),
	getDesktopUpdateCapability: vi.fn(),
	getRendererUpdateCapability: vi.fn(),
	installDesktopUpdate: vi.fn(),
	openExternalUrl: vi.fn(),
	subscribeDesktopUpdateStatus: vi.fn(() => vi.fn()),
	subscribeRendererUpdateStatus: vi.fn(() => vi.fn()),
}));

vi.mock("@/shared/desktop/runtime", () => ({
	isDesktopRuntime: vi.fn(() => true),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	}),
}));

const supportedCapability = {
	supportsAutoUpdate: true,
	releasePageUrl: "https://example.com/releases",
};

const unsupportedCapability = {
	supportsAutoUpdate: false,
	releasePageUrl: "https://example.com/releases",
	reason: "macOS 未启用签名",
};

const pushStatus = async (status: DesktopUpdateStatus) => {
	const calls = vi.mocked(subscribeDesktopUpdateStatus).mock.calls;
	const listener = calls.at(-1)?.[0];
	if (!listener) throw new Error("no subscriber attached");
	await act(async () => {
		listener(status);
	});
};

describe("UpdatesPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDesktopAppVersion).mockResolvedValue("1.0.0");
		vi.mocked(getDesktopUpdateCapability).mockResolvedValue(supportedCapability);
		vi.mocked(subscribeDesktopUpdateStatus).mockImplementation(() => vi.fn());
		vi.mocked(getRendererUpdateCapability).mockResolvedValue({
			enabled: false,
			currentRev: 0,
			source: "builtin",
		});
		vi.mocked(subscribeRendererUpdateStatus).mockImplementation(() => vi.fn());
	});

	afterEach(() => {
		cleanup();
	});

	it("enables download after push stream reports an available update", async () => {
		vi.mocked(checkDesktopUpdate).mockResolvedValue({ ok: true });
		render(<UpdatesPanel />);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /检查更新/ })).not.toBeDisabled(),
		);

		fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
		await waitFor(() => expect(checkDesktopUpdate).toHaveBeenCalled());

		await pushStatus({
			currentVersion: "1.0.0",
			phase: "available",
			info: { version: "1.1.0" },
		});

		expect(screen.getByText("可用版本")).toBeInTheDocument();
		expect(screen.getByText("1.1.0")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "下载更新" })).not.toBeDisabled();
		expect(screen.getByRole("button", { name: "安装更新并重启" })).toBeDisabled();
	});

	it("shows up-to-date title and keeps action buttons disabled", async () => {
		vi.mocked(checkDesktopUpdate).mockResolvedValue({ ok: true });
		render(<UpdatesPanel />);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /检查更新/ })).not.toBeDisabled(),
		);

		fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
		await pushStatus({ currentVersion: "1.0.0", phase: "up-to-date" });

		expect(screen.getByText("已是最新版本")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "下载更新" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "安装更新并重启" })).toBeDisabled();
	});

	it("renders download progress from the push stream", async () => {
		vi.mocked(checkDesktopUpdate).mockResolvedValue({ ok: true });
		vi.mocked(downloadDesktopUpdate).mockResolvedValue({ ok: true });
		render(<UpdatesPanel />);

		fireEvent.click(await screen.findByRole("button", { name: "检查更新" }));
		await pushStatus({
			currentVersion: "1.0.0",
			phase: "available",
			info: { version: "1.1.0" },
		});
		fireEvent.click(screen.getByRole("button", { name: "下载更新" }));
		await pushStatus({
			currentVersion: "1.0.0",
			phase: "downloading",
			progress: { percent: 42.5, transferred: 42, total: 100, bytesPerSecond: 1024 },
		});

		expect(screen.getByText(/42\.5%/)).toBeInTheDocument();
		await waitFor(() => expect(downloadDesktopUpdate).toHaveBeenCalled());
	});

	it("enables install once downloaded", async () => {
		vi.mocked(checkDesktopUpdate).mockResolvedValue({ ok: true });
		vi.mocked(installDesktopUpdate).mockResolvedValue({ ok: true });
		render(<UpdatesPanel />);

		fireEvent.click(await screen.findByRole("button", { name: "检查更新" }));
		await pushStatus({
			currentVersion: "1.0.0",
			phase: "downloaded",
			info: { version: "1.1.0" },
		});

		const installButton = screen.getByRole("button", { name: "安装更新并重启" });
		expect(installButton).not.toBeDisabled();
		fireEvent.click(installButton);
		await waitFor(() => expect(installDesktopUpdate).toHaveBeenCalled());
	});

	it("surfaces error phase from the push stream", async () => {
		vi.mocked(checkDesktopUpdate).mockResolvedValue({ ok: true });
		render(<UpdatesPanel />);

		fireEvent.click(await screen.findByRole("button", { name: "检查更新" }));
		await pushStatus({
			currentVersion: "1.0.0",
			phase: "error",
			error: "network unreachable",
		});

		expect(screen.getByText("更新服务异常")).toBeInTheDocument();
		expect(screen.getByText("network unreachable")).toBeInTheDocument();
	});

	it("falls back to a release-page link when auto-update is not supported", async () => {
		vi.mocked(getDesktopUpdateCapability).mockResolvedValue(unsupportedCapability);
		render(<UpdatesPanel />);

		const link = await screen.findByRole("button", { name: /前往下载页/ });
		expect(link).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /检查更新/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "下载更新" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "安装更新并重启" })).not.toBeInTheDocument();
		expect(screen.getByText(/macOS 未启用签名/)).toBeInTheDocument();

		fireEvent.click(link);
		await waitFor(() =>
			expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/releases"),
		);
	});

	it("hides the renderer update section while the feature is disabled", async () => {
		render(<UpdatesPanel />);
		await waitFor(() => expect(getRendererUpdateCapability).toHaveBeenCalled());
		expect(screen.queryByText("界面更新")).not.toBeInTheDocument();
	});

	it("shows renderer revision and runs a check when enabled", async () => {
		vi.mocked(getRendererUpdateCapability).mockResolvedValue({
			enabled: true,
			currentRev: 3,
			source: "builtin",
		});
		vi.mocked(checkRendererUpdate).mockResolvedValue({ ok: true });

		render(<UpdatesPanel />);
		expect(await screen.findByText("界面更新")).toBeInTheDocument();
		expect(screen.getByText(/rev 3/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /检查界面更新/ }));
		await waitFor(() => expect(checkRendererUpdate).toHaveBeenCalled());
	});

	it("renders ready state from the renderer push stream", async () => {
		vi.mocked(getRendererUpdateCapability).mockResolvedValue({
			enabled: true,
			currentRev: 3,
			source: "downloaded",
		});

		render(<UpdatesPanel />);
		await screen.findByText("界面更新");

		const pushRendererStatus = async (status: RendererUpdateStatus) => {
			const listener = vi.mocked(subscribeRendererUpdateStatus).mock.calls.at(-1)?.[0];
			if (!listener) throw new Error("no renderer subscriber attached");
			await act(async () => {
				listener(status);
			});
		};

		await pushRendererStatus({
			phase: "downloading",
			currentRev: 3,
			targetRev: 4,
			progress: { percent: 30, transferred: 3_000_000, total: 10_000_000 },
		});
		expect(screen.getByText(/30\.0%/)).toBeInTheDocument();

		await pushRendererStatus({ phase: "ready", currentRev: 3, targetRev: 4 });
		expect(screen.getByText(/rev 4.*已就绪/)).toBeInTheDocument();

		await pushRendererStatus({
			phase: "requires-full-update",
			currentRev: 3,
			targetRev: 5,
		});
		expect(screen.getByText("需要完整更新")).toBeInTheDocument();
	});
});
