import httpClient from "@/shared/lib/http";

export interface CapabilityRecord {
	id: string;
	name: string;
	description: string;
	kind: string;
	category: "generation" | "understanding" | "processing";
	icon: string;
	surface: "generation" | "asset-action" | "placeholder";
	inputs: string[];
	outputs: string[];
	relatedRoutes: string[];
	status: "available" | "planned" | "hidden";
	available: boolean;
}

export interface CapabilityManifestResponse {
	capabilities: CapabilityRecord[];
}

export const capabilitiesKey = "/capabilities";

export const getCapabilities = async () => {
	const response = await httpClient.get<CapabilityManifestResponse>(capabilitiesKey);
	return response.data;
};
