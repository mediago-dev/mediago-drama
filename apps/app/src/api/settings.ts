import httpClient from "@/lib/http";

export interface APIKeyProvider {
	id: string;
	label: string;
	description: string;
	configured: boolean;
	source: "settings" | "none";
	masked?: string;
	credentialLabel?: string;
	placeholder?: string;
	help?: string;
}

export interface APIKeyListResponse {
	providers: APIKeyProvider[];
}

export const apiKeysKey = "/settings/api-keys";

export const getAPIKeys = async () => {
	const response = await httpClient.get<APIKeyListResponse>(apiKeysKey);
	return response.data;
};
