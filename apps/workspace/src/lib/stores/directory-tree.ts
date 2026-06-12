import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

interface DirectoryTreeState {
	collapsedByProject: Record<string, Record<string, boolean>>;
	expandFolder: (projectId: string, folderId: string) => void;
	setFolderCollapsed: (projectId: string, folderId: string, collapsed: boolean) => void;
	toggleFolder: (projectId: string, folderId: string) => void;
}

export const useDirectoryTreeStore = create<DirectoryTreeState>()(
	persist(
		immer((set) => ({
			collapsedByProject: {},
			expandFolder: (projectId, folderId) =>
				set((state) => {
					if (state.collapsedByProject[projectId]) {
						state.collapsedByProject[projectId][folderId] = false;
					}
				}),
			setFolderCollapsed: (projectId, folderId, collapsed) =>
				set((state) => {
					state.collapsedByProject[projectId] ??= {};
					state.collapsedByProject[projectId][folderId] = collapsed;
				}),
			toggleFolder: (projectId, folderId) =>
				set((state) => {
					state.collapsedByProject[projectId] ??= {};
					state.collapsedByProject[projectId][folderId] =
						!state.collapsedByProject[projectId][folderId];
				}),
		})),
		{ name: "agent-directory-tree", version: 1 },
	),
);
