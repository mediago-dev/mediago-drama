import httpClient from "@/shared/lib/http";

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
	credentialKind?: "apiKey" | "oauth" | string;
	capabilities?: string[];
}

export interface APIKeyListResponse {
	providers: APIKeyProvider[];
}

export interface ModelPlatform {
	id: string;
	label: string;
	kind: "unified" | "custom" | string;
	description: string;
	apiKeyProviderId: string;
	modelGroups?: ModelPlatformModelGroup[];
}

export interface ModelPlatformModelGroup {
	label: string;
	models: string[];
}

export interface ModelPlatformsResponse {
	platforms: ModelPlatform[];
}

export interface APIKeyLoginChallenge {
	status: "pending" | "completed" | string;
	verificationUri?: string;
	userCode?: string;
	deviceCode?: string;
	message?: string;
}

export interface APIKeyLoginResponse extends APIKeyListResponse {
	login: APIKeyLoginChallenge;
}

export interface AgentModelProfileAPIKeyStatus {
	configured: boolean;
	source: "settings" | "none" | string;
	masked?: string;
}

export interface AgentModelProfile {
	id: string;
	name: string;
	providerId: string;
	providerLabel: string;
	baseURL: string;
	model: string;
	modelDisplayName: string;
	enabled: boolean;
	isDefault: boolean;
	supportsImages: boolean;
	supportsTools: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
	temperature?: number;
	apiKey: AgentModelProfileAPIKeyStatus;
}

export interface AgentModelProfileTemplate {
	id: string;
	name: string;
	providerId: string;
	providerLabel: string;
	baseURL: string;
	model: string;
	modelDisplayName: string;
	supportsImages: boolean;
	supportsTools: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
	temperature?: number;
}

export interface AgentModelProfilesResponse {
	profiles: AgentModelProfile[];
	defaultProfileId?: string;
	templates: AgentModelProfileTemplate[];
}

export interface JianyingDraftSettings {
	draftsRoot: string;
}

export interface AgentModelProfileMutation {
	templateId?: string;
	name?: string;
	providerId?: string;
	providerLabel?: string;
	baseURL?: string;
	model?: string;
	modelDisplayName?: string;
	enabled?: boolean;
	isDefault?: boolean;
	supportsImages?: boolean;
	supportsTools?: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
	temperature?: number;
}

export const apiKeysKey = "/settings/api-keys";
export const modelPlatformsKey = "/settings/model-platforms";
export const agentModelProfilesKey = "/settings/agent-model-profiles";
export const jianyingDraftSettingsKey = "/settings/jianying-draft";

export const getAPIKeys = async () => {
	const response = await httpClient.get<APIKeyListResponse>(apiKeysKey);
	return response.data;
};

export const getModelPlatforms = async () => {
	const response = await httpClient.get<ModelPlatformsResponse>(modelPlatformsKey);
	return response.data;
};

export const getJianyingDraftSettings = async () => {
	const response = await httpClient.get<JianyingDraftSettings>(jianyingDraftSettingsKey);
	return response.data;
};

export const saveJianyingDraftSettings = async (draftsRoot: string) => {
	const response = await httpClient.put<JianyingDraftSettings>(jianyingDraftSettingsKey, {
		draftsRoot,
	});
	return response.data;
};

export const saveAPIKey = async (providerID: string, apiKey: string) => {
	const response = await httpClient.put<APIKeyListResponse>(
		`/settings/api-keys/${encodeURIComponent(providerID)}`,
		{ apiKey },
	);
	return response.data;
};

export const beginProviderLogin = async (providerID: string, force = false) => {
	const response = await httpClient.post<APIKeyLoginResponse>(
		`/settings/api-keys/${encodeURIComponent(providerID)}/login`,
		{ force },
	);
	return response.data;
};

export const completeProviderLogin = async (providerID: string, deviceCode: string) => {
	const response = await httpClient.post<APIKeyLoginResponse>(
		`/settings/api-keys/${encodeURIComponent(providerID)}/login/check`,
		{ deviceCode },
	);
	return response.data;
};

export const getAgentModelProfiles = async () => {
	const response = await httpClient.get<AgentModelProfilesResponse>(agentModelProfilesKey);
	return response.data;
};

export const createAgentModelProfile = async (input: AgentModelProfileMutation) => {
	const response = await httpClient.post<AgentModelProfilesResponse>(agentModelProfilesKey, input);
	return response.data;
};

export const updateAgentModelProfile = async (
	profileID: string,
	input: AgentModelProfileMutation,
) => {
	const response = await httpClient.patch<AgentModelProfilesResponse>(
		`${agentModelProfilesKey}/${encodeURIComponent(profileID)}`,
		input,
	);
	return response.data;
};

export const deleteAgentModelProfile = async (profileID: string) => {
	const response = await httpClient.delete<AgentModelProfilesResponse>(
		`${agentModelProfilesKey}/${encodeURIComponent(profileID)}`,
	);
	return response.data;
};

export const setDefaultAgentModelProfile = async (profileID: string) => {
	const response = await httpClient.put<AgentModelProfilesResponse>(
		`${agentModelProfilesKey}/${encodeURIComponent(profileID)}/default`,
	);
	return response.data;
};

export const saveAgentModelProfileAPIKey = async (profileID: string, apiKey: string) => {
	const response = await httpClient.put<AgentModelProfilesResponse>(
		`${agentModelProfilesKey}/${encodeURIComponent(profileID)}/api-key`,
		{ apiKey },
	);
	return response.data;
};

export const clearAgentModelProfileAPIKey = async (profileID: string) => {
	const response = await httpClient.delete<AgentModelProfilesResponse>(
		`${agentModelProfilesKey}/${encodeURIComponent(profileID)}/api-key`,
	);
	return response.data;
};

export const clearAPIKey = async (providerID: string) => {
	const response = await httpClient.delete<APIKeyListResponse>(
		`/settings/api-keys/${encodeURIComponent(providerID)}`,
	);
	return response.data;
};
