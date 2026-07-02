import { promptCategoriesKey } from "@/domains/generation/api/prompt-categories";
import { promptPresetsKey } from "@/domains/generation/api/prompt-presets";
import { skillsKey } from "@/domains/settings/api/skills";

export const isSkillCacheKey = (key: unknown) =>
	typeof key === "string" && (key === skillsKey || key.startsWith(`${skillsKey}/`));

export const isPromptLibraryCacheKey = (key: unknown) =>
	typeof key === "string" && (key === promptCategoriesKey || key.startsWith(promptPresetsKey));

export const isPromptPackContentCacheKey = (key: unknown) =>
	isSkillCacheKey(key) || isPromptLibraryCacheKey(key);
