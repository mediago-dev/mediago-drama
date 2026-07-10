import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateLicense, getLicenseStatus } from "@/domains/settings/api/license";
import { isProEdition } from "@/shared/lib/edition";
import { LicenseGate } from "./LicenseGate";

vi.mock("@/shared/lib/edition", () => ({
	isProEdition: vi.fn(),
}));

vi.mock("@/domains/settings/api/license", () => ({
	activateLicense: vi.fn(),
	getLicenseStatus: vi.fn(),
	licenseStatusKey: "/license",
}));

vi.mock("@/domains/workspace/lib/desktop-window-drag", () => ({
	useDesktopWindowDrag: () => vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

describe("LicenseGate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("renders the app directly in community builds without fetching license", () => {
		vi.mocked(isProEdition).mockReturnValue(false);
		renderGate();
		expect(screen.getByText("APP CONTENT")).toBeInTheDocument();
		expect(getLicenseStatus).not.toHaveBeenCalled();
	});

	it("renders the app when a Pro build is already activated", async () => {
		vi.mocked(isProEdition).mockReturnValue(true);
		vi.mocked(getLicenseStatus).mockResolvedValue({ configured: true, activated: true });
		renderGate();
		expect(await screen.findByText("APP CONTENT")).toBeInTheDocument();
	});

	it("blocks the app behind the activation wall when a Pro build is not activated", async () => {
		vi.mocked(isProEdition).mockReturnValue(true);
		vi.mocked(getLicenseStatus).mockResolvedValue({ configured: true, activated: false });
		renderGate();
		expect(await screen.findByLabelText("激活码")).toBeInTheDocument();
		expect(screen.queryByText("APP CONTENT")).not.toBeInTheDocument();
	});

	it("unlocks the app after a successful activation", async () => {
		vi.mocked(isProEdition).mockReturnValue(true);
		vi.mocked(getLicenseStatus).mockResolvedValue({ configured: true, activated: false });
		vi.mocked(activateLicense).mockResolvedValue({
			configured: true,
			activated: true,
			plan: "pro",
		});
		renderGate();
		const input = await screen.findByLabelText("激活码");
		fireEvent.change(input, { target: { value: "MG-GOOD-CODE" } });
		fireEvent.click(screen.getByRole("button", { name: /激活并进入/ }));
		await waitFor(() => expect(screen.getByText("APP CONTENT")).toBeInTheDocument());
	});

	it("disables activation when the license server is not configured", async () => {
		vi.mocked(isProEdition).mockReturnValue(true);
		vi.mocked(getLicenseStatus).mockResolvedValue({ configured: false, activated: false });
		renderGate();
		expect(await screen.findByText(/未配置授权服务器/)).toBeInTheDocument();
		expect(screen.getByLabelText("激活码")).toBeDisabled();
	});
});

const renderGate = () =>
	render(
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
			<LicenseGate>
				<div>APP CONTENT</div>
			</LicenseGate>
		</SWRConfig>,
	);
