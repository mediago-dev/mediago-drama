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

	it("activates with the submitted code", async () => {
		vi.mocked(getLicenseStatus).mockResolvedValue({
			configured: true,
			hasAppAccess: false,
			activations: [],
		});
		vi.mocked(activateLicense).mockResolvedValue({
			configured: true,
			hasAppAccess: false,
			entitlements: ["pack.import.pro"],
			activations: [
				{
					licenseId: "lic_123",
					plan: "pro",
					entitlements: ["pack.import.pro"],
					expiresAt: "2027-01-01T00:00:00Z",
				},
			],
		});

		renderPanel();
		const input = await screen.findByLabelText("激活码");
		fireEvent.change(input, { target: { value: "MG-TEST-CODE" } });
		fireEvent.click(screen.getByRole("button", { name: /激活/ }));

		await waitFor(() => expect(activateLicense).toHaveBeenCalledWith("MG-TEST-CODE"));
		await screen.findByText("已激活");
		expect(screen.getByText("pro")).toBeTruthy();
	});

	it("lists each activation with entitlements and a per-activation deactivate", async () => {
		vi.mocked(getLicenseStatus).mockResolvedValue({
			configured: true,
			hasAppAccess: true,
			entitlements: ["app.access", "pack.import.pro"],
			activations: [
				{ licenseId: "lic_app", plan: "app", entitlements: ["app.access"] },
				{ licenseId: "lic_456", plan: "pro", entitlements: ["pack.import.pro"] },
			],
		});
		vi.mocked(deactivateLicense).mockResolvedValue({
			configured: true,
			hasAppAccess: true,
			activations: [{ licenseId: "lic_app", plan: "app", entitlements: ["app.access"] }],
		});

		renderPanel();
		await screen.findByText("已激活（2）");
		expect(screen.getByText("app.access")).toBeTruthy();
		expect(screen.getByText("pack.import.pro")).toBeTruthy();

		fireEvent.click(screen.getAllByRole("button", { name: /取消激活/ })[1]);
		await waitFor(() => expect(deactivateLicense).toHaveBeenCalledWith("lic_456"));
	});

	it("disables the code input when license server is not configured", async () => {
		vi.mocked(getLicenseStatus).mockResolvedValue({
			configured: false,
			hasAppAccess: false,
			activations: [],
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
