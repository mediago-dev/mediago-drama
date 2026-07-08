import httpClient from "@/shared/lib/http";

export interface LicenseStatus {
	configured: boolean;
	activated: boolean;
	licenseId?: string;
	plan?: string;
	entitlements?: string[];
	expiresAt?: string;
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

export const deactivateLicense = async (): Promise<LicenseStatus> => {
	const response = await httpClient.delete<LicenseStatus>(licenseStatusKey);
	return response.data;
};
