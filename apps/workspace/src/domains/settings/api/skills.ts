import { createResource } from "@/shared/lib/api-factory";
import httpClient from "@/shared/lib/http";

export type SkillSource = "pack" | "user";

export interface SkillMeta {
	name: string;
	title?: string;
	description: string;
	source: SkillSource;
	overridden?: boolean;
	templateId?: string;
	hint?: Record<string, string>;
	packId?: string;
	releaseId?: string;
	sourcePackageId?: string;
	sourceReleaseId?: string;
}

export interface SkillTemplate {
	id: string;
	name: string;
	description?: string;
	documentCategory: string;
	content?: string;
}

export interface SkillDocument extends SkillMeta {
	content: string;
	template?: SkillTemplate;
}

export const skillsKey = "/skills";

interface SkillsResponse {
	skills: SkillMeta[];
}

interface CreateSkillInput {
	name: string;
	content: string;
	packId?: string;
}

const skillResource = createResource<
	SkillDocument,
	CreateSkillInput,
	string,
	SkillsResponse,
	SkillMeta[]
>("/skills", {
	key: skillsKey,
	selectList: (response) => response.skills,
});

export const listSkills = skillResource.list;

export const getSkill = skillResource.get;

export const updateSkill = (name: string, content: string): Promise<SkillDocument> => {
	return skillResource.update(name, content, { headers: { "Content-Type": "text/plain" } });
};

export const createSkill = (
	name: string,
	content: string,
	packId?: string,
): Promise<SkillDocument> => skillResource.create({ name, content, packId });

export const deleteSkill = skillResource.remove;

export const resetSkill = async (name: string): Promise<SkillDocument> => {
	const response = await httpClient.post<SkillDocument>(
		`${skillsKey}/${encodeURIComponent(name)}/reset`,
	);
	return response.data;
};
