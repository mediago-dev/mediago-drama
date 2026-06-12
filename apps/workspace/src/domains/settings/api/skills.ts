import { createResource } from "@/shared/lib/api-factory";

export type SkillSource = "builtin" | "user";

export interface SkillMeta {
	name: string;
	title?: string;
	description: string;
	source: SkillSource;
	hint?: Record<string, string>;
}

export interface SkillDocument extends SkillMeta {
	content: string;
}

export const skillsKey = "/skills";

interface SkillsResponse {
	skills: SkillMeta[];
}

interface CreateSkillInput {
	name: string;
	content: string;
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

export const createSkill = (name: string, content: string): Promise<SkillDocument> =>
	skillResource.create({ name, content });

export const deleteSkill = skillResource.remove;
