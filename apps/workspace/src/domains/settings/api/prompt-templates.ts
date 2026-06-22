import httpClient from "@/shared/lib/http";

export type PromptTemplateSource = "official" | "user";

export interface PromptTemplate {
	id: string;
	name: string;
	description?: string;
	content: string;
	source: PromptTemplateSource;
	overridden?: boolean;
}

export const promptTemplatesKey = "/prompt-templates";

interface PromptTemplatesResponse {
	templates: PromptTemplate[];
}

export const listPromptTemplates = async (): Promise<PromptTemplate[]> => {
	const response = await httpClient.get<PromptTemplatesResponse>("/prompt-templates");
	return response.data.templates;
};

export const updatePromptTemplate = async (
	id: string,
	template: PromptTemplate,
): Promise<PromptTemplate> => {
	const response = await httpClient.put<PromptTemplate>(
		`/prompt-templates/${encodeURIComponent(id)}`,
		template,
	);
	return response.data;
};

export const resetPromptTemplate = async (id: string): Promise<PromptTemplate> => {
	const response = await httpClient.post<PromptTemplate>(
		`/prompt-templates/${encodeURIComponent(id)}/reset`,
	);
	return response.data;
};
