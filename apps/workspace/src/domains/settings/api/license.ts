import httpClient from "@/shared/lib/http";

export interface LicenseActivation {
	licenseId: string;
	plan?: string;
	entitlements?: string[];
	expiresAt?: string;
	expired?: boolean;
}

export interface LicenseStatus {
	configured: boolean;
	hasAppAccess: boolean;
	entitlements?: string[];
	activations?: LicenseActivation[];
}

export const licenseStatusKey = "/license";

export const getLicenseStatus = async (): Promise<LicenseStatus> => {
	const response = await httpClient.get<LicenseStatus>(licenseStatusKey);
	return response.data;
};

export const activateLicense = async (code: string): Promise<LicenseStatus> => {
	const response = await httpClient.post<LicenseStatus>("/license/activate", { code });
	return response.data;
};

export const deactivateLicense = async (licenseId?: string): Promise<LicenseStatus> => {
	const response = await httpClient.delete<LicenseStatus>(licenseStatusKey, {
		params: licenseId ? { licenseId } : undefined,
	});
	return response.data;
};
