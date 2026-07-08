import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	activateLicense,
	deactivateLicense,
	getLicenseStatus,
} from "@/domains/settings/api/license";
import { LicensePanel } from "./LicensePanel";

vi.mock("@/domains/settings/api/license", () => ({
	activateLicense: vi.fn(),
	deactivateLicense: vi.fn(),
	getLicenseStatus: vi.fn(),
	licenseStatusKey: "/license",
}));

vi.mock("@/domains/workspace/lib/desktop-window-drag", () => ({
	useDesktopWindowDrag: () => vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

describe("LicensePanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("activates with the submitted code when not activated", async () => {
		vi.mocked(getLicenseStatus).mockResolvedValue({
			configured: true,
			activated: false,
		});
		vi.mocked(activateLicense).mockResolvedValue({
			configured: true,
			activated: true,
			licenseId: "lic_123",
			plan: "pro",
			entitlements: ["pro-packs"],
			expiresAt: "2027-01-01T00:00:00Z",
		});

		renderPanel();
		const input = await screen.findByLabelText("激活码");
		fireEvent.change(input, { target: { value: "MG-TEST-CODE" } });
		fireEvent.click(screen.getByRole("button", { name: /激活/ }));

		await waitFor(() => expect(activateLicense).toHaveBeenCalledWith("MG-TEST-CODE"));
		await screen.findByText("已激活");
		expect(screen.getByText("pro")).toBeTruthy();
	});

	it("shows plan, entitlements and deactivate button when activated", async () => {
		vi.mocked(getLicenseStatus).mockResolvedValue({
			configured: true,
			activated: true,
			licenseId: "lic_456",
			plan: "pro",
			entitlements: ["pro-packs", "cloud-render"],
			expiresAt: "2027-06-30T00:00:00Z",
		});
		vi.mocked(deactivateLicense).mockResolvedValue({
			configured: true,
			activated: false,
		});

		renderPanel();
		await screen.findByText("已激活");
		expect(screen.getByText("pro")).toBeTruthy();
		expect(screen.getByText("pro-packs")).toBeTruthy();
		expect(screen.getByText("cloud-render")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /取消激活/ }));
		await waitFor(() => expect(deactivateLicense).toHaveBeenCalled());
		await screen.findByLabelText("激活码");
	});

	it("disables the code input when license server is not configured", async () => {
		vi.mocked(getLicenseStatus).mockResolvedValue({
			configured: false,
			activated: false,
		});

		renderPanel();
		await screen.findByText("未配置授权服务器，暂时无法激活。");

		const input = screen.getByLabelText("激活码") as HTMLInputElement;
		expect(input.disabled).toBe(true);
		const submit = screen.getByRole("button", { name: /激活/ }) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
		expect(activateLicense).not.toHaveBeenCalled();
	});
});

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<LicensePanel />
		</SWRConfig>,
	);
