import type { StateCreator } from "zustand";
import type { ProjectState } from "./types";

type ProjectActions = Pick<ProjectState, "setActiveProjectId">;
type ProjectSet = Parameters<StateCreator<ProjectState>>[0];

export const createProjectActions = (set: ProjectSet): ProjectActions => ({
	setActiveProjectId: (projectId) =>
		set({
			activeProjectId: projectId,
		}),
});
