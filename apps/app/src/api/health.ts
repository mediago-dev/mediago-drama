import httpClient from "@/lib/http";

export interface HealthResponse {
	status: string;
}

export const healthKey = "/health";

export const getHealth = async () => {
	const response = await httpClient.get<HealthResponse>(healthKey);
	return response.data;
};
