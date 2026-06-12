export interface ProjectState {
	activeProjectId: string | null;
	setActiveProjectId: (projectId: string | null) => void;
}
