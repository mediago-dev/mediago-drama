import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatesPanel } from "@/domains/settings/components/UpdatesPanel";
import {
	checkDesktopUpdate,
	downloadDesktopUpdate,
	installDesktopUpdate,
	subscribeDesktopUpdateStatus,
	getDesktopAppVersion,
} from "@/shared/desktop/actions";

vi.mock("@/shared/desktop/actions", () => ({
	checkDesktopUpdate: vi.fn(),
	downloadDesktopUpdate: vi.fn(),
	getDesktopAppVersion: vi.fn(),
	installDesktopUpdate: vi.fn(),
	subscribeDesktopUpdateStatus: vi.fn(() => vi.fn()),
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

describe("UpdatesPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDesktopAppVersion).mockResolvedValue("1.0.0");
	});

	afterEach(() => {
		cleanup();
	});

	it("checks updates and enables download", async () => {
		vi.mocked(checkDesktopUpdate).mockResolvedValue({
			supported: true,
			status: {
				currentVersion: "1.0.0",
				phase: "available",
			},
			info: {
				version: "1.1.0",
			},
		});
		render(<UpdatesPanel />);

		fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
		await waitFor(() => expect(checkDesktopUpdate).toHaveBeenCalled());
		expect(screen.getByText("可用版本")).toBeInTheDocument();
		expect(screen.getByText("1.1.0")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "下载更新" })).not.toBeDisabled();
	});

	it("keeps download disabled when the app is already up to date", async () => {
		vi.mocked(checkDesktopUpdate).mockResolvedValue({
			supported: true,
			status: {
				currentVersion: "1.0.0",
				phase: "up-to-date",
			},
		});
		render(<UpdatesPanel />);

		fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
		await waitFor(() => expect(checkDesktopUpdate).toHaveBeenCalled());
		expect(screen.getByText("已是最新版本")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "下载更新" })).toBeDisabled();
	});

	it("downloads update package", async () => {
		vi.mocked(checkDesktopUpdate).mockResolvedValue({
			supported: true,
			status: {
				currentVersion: "1.0.0",
				phase: "available",
			},
			info: {
				version: "1.1.0",
			},
		});
		vi.mocked(downloadDesktopUpdate).mockResolvedValue({ supported: true, ok: true });
		vi.mocked(subscribeDesktopUpdateStatus).mockImplementation((listener) => {
			listener({
				currentVersion: "1.0.0",
				phase: "download-progress",
				progress: {
					percent: 50,
					transferred: 50,
					total: 100,
					bytesPerSecond: 1,
				},
			});
			return vi.fn();
		});

		render(<UpdatesPanel />);
		fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
		await waitFor(() => expect(checkDesktopUpdate).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: "下载更新" }));
		await waitFor(() => expect(downloadDesktopUpdate).toHaveBeenCalled());
	});

	it("install update button", async () => {
		vi.mocked(checkDesktopUpdate).mockResolvedValue({
			supported: true,
			status: {
				currentVersion: "1.0.0",
				phase: "downloaded",
			},
			info: {
				version: "1.1.0",
			},
		});
		vi.mocked(installDesktopUpdate).mockResolvedValue({ supported: true, ok: true });

		render(<UpdatesPanel />);
		fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
		await waitFor(() => expect(checkDesktopUpdate).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: "安装更新并重启" }));
		await waitFor(() => expect(installDesktopUpdate).toHaveBeenCalled());
	});
});
