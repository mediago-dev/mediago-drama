import useSWR from "swr";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";

export const useProjectName = (projectId?: string | null) => {
	const { data } = useSWR(projectId ? projectsKey : null, getProjects);
	return data?.projects.find((project) => project.id === projectId)?.name ?? null;
};
