import {
	createWorkspaceFolder,
	deleteWorkspaceFolder,
	getWorkspaceDocuments,
	updateWorkspaceDocumentRecord,
	updateWorkspaceFolder,
} from "@/domains/workspace/api/workspace";
import { updateProjectAsset } from "@/domains/workspace/api/project-assets";
import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import type { DocumentActionContext, DocumentsActions } from "./action-types";
import type { DocumentFolder, FolderMovePosition } from "./types";
import {
	collectFolderDescendantIds,
	createUntitledFolder,
	isCurrentWorkspaceMutationSnapshot,
	nextFolderSortOrder,
	normalizeFolders,
	rollbackSnapshot,
	validFolderId,
} from "./helpers";
import type { WorkspaceMutationSnapshot } from "./helpers";

type FolderActions = Pick<
	DocumentsActions,
	| "createFolder"
	| "deleteFolder"
	| "moveFolder"
	| "moveItemToFolder"
	| "organizeIntoChapter"
	| "renameFolder"
>;

export const createFolderActions = ({
	dependencies,
	get,
	set,
}: DocumentActionContext): FolderActions => ({
	createFolder: (name, parentId = null) => {
		let createdFolder: ReturnType<DocumentsActions["createFolder"]> = null;
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const safeParentId = validFolderId(state.folders, parentId);
			if (folderNameExists(state.folders, safeParentId, name)) {
				return {
					syncStatus: "error",
					syncMessage: "同级文件夹已存在",
				};
			}
			const folder = createUntitledFolder(
				name,
				safeParentId,
				nextFolderSortOrder(state.folders, safeParentId),
			);
			createdFolder = folder;
			const folders = normalizeFolders([...state.folders, folder]);
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			persistMutation = () => {
				void createWorkspaceFolder(
					{
						id: folder.id,
						name: folder.name,
						parentId: folder.parentId,
						sortOrder: folder.sortOrder,
					},
					capturedProjectId,
				)
					.then(({ state: savedState }) => {
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端创建文件夹失败",
						);
					});
			};
			return {
				folders,
				syncStatus: "syncing",
				syncMessage: "正在创建文件夹",
			};
		});
		runDeferredMutation(persistMutation);
		return createdFolder;
	},
	deleteFolder: (id) => {
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const folder = state.folders.find((item) => item.id === id);
			if (!folder) return state;
			const folders = normalizeFolders(
				state.folders
					.filter((item) => item.id !== id)
					.map((item) => (item.parentId === id ? { ...item, parentId: folder.parentId } : item)),
			);
			const documents = state.documents.map((document) =>
				document.folderId === id ? { ...document, folderId: folder.parentId } : document,
			);
			const assets = state.assets.map((asset) =>
				asset.folderId === id ? { ...asset, folderId: folder.parentId } : asset,
			);
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			persistMutation = () => {
				void deleteWorkspaceFolder(id, capturedProjectId)
					.then(({ state: savedState }) => {
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端删除文件夹失败",
						);
					});
			};
			return {
				folders,
				documents,
				assets,
				syncStatus: "syncing",
				syncMessage: "正在删除文件夹",
			};
		});
		runDeferredMutation(persistMutation);
	},
	moveFolder: (folderId, targetFolderId, position = "inside") => {
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const folder = state.folders.find((item) => item.id === folderId);
			if (!folder) return state;
			const targetFolder = targetFolderId
				? state.folders.find((item) => item.id === targetFolderId)
				: null;
			if (targetFolderId && !targetFolder) return state;
			if (targetFolderId === folderId) return state;
			if (
				targetFolderId &&
				collectFolderDescendantIds(state.folders, folderId).has(targetFolderId)
			) {
				return state;
			}
			const result = moveFolderInTree(state.folders, folderId, targetFolderId, position);
			if (!result.changed) return state;
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			const expectedSnapshot: WorkspaceMutationSnapshot = {
				assets: state.assets,
				documents: state.documents,
				folders: result.folders,
			};
			persistMutation = () => {
				void Promise.all(
					result.changedFolders.map((changedFolder) =>
						updateWorkspaceFolder(
							changedFolder.id,
							{ parentId: changedFolder.parentId, sortOrder: changedFolder.sortOrder },
							capturedProjectId,
						),
					),
				)
					.then(() => getWorkspaceDocuments(capturedProjectId))
					.then((savedState) => {
						if (!isCurrentWorkspaceMutationSnapshot(get(), capturedProjectId, expectedSnapshot)) {
							return;
						}
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						if (!isCurrentWorkspaceMutationSnapshot(get(), capturedProjectId, expectedSnapshot)) {
							return;
						}
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端移动文件夹失败",
						);
					});
			};
			return {
				folders: result.folders,
				syncStatus: "syncing",
				syncMessage: "正在移动文件夹",
			};
		});
		runDeferredMutation(persistMutation);
	},
	moveItemToFolder: (kind, id, folderId) => {
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const safeFolderId = validFolderId(state.folders, folderId);
			const capturedProjectId = state.projectId;
			if (!capturedProjectId) return state;
			const rollback = rollbackSnapshot(state);
			if (kind === "document") {
				const document = state.documents.find((item) => item.id === id);
				if (!document || isOverviewDocumentId(document.id)) return state;
				if ((document.folderId ?? null) === safeFolderId) return state;
				const documents = state.documents.map((item) =>
					item.id === id
						? {
								...item,
								folderId: safeFolderId,
								version: item.version + 1,
								updatedAt: new Date().toISOString(),
							}
						: item,
				);
				const expectedSnapshot: WorkspaceMutationSnapshot = {
					assets: state.assets,
					documents,
					folders: state.folders,
				};
				persistMutation = () => {
					void updateWorkspaceDocumentRecord(
						id,
						{ folderId: safeFolderId ?? "" },
						capturedProjectId,
					)
						.then(({ state: savedState }) => {
							if (!isCurrentWorkspaceMutationSnapshot(get(), capturedProjectId, expectedSnapshot)) {
								return;
							}
							dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
						})
						.catch((err) => {
							if (!isCurrentWorkspaceMutationSnapshot(get(), capturedProjectId, expectedSnapshot)) {
								return;
							}
							dependencies.rollbackWorkspaceStateForProject(
								capturedProjectId,
								rollback,
								`后端移动文档失败：${errorMessage(err)}`,
							);
						});
				};
				return {
					documents,
					syncStatus: "syncing",
					syncMessage: "正在移动文档",
				};
			}

			const asset = state.assets.find((item) => item.id === id);
			if (!asset || (asset.folderId ?? null) === safeFolderId) return state;
			const assets = state.assets.map((item) =>
				item.id === id
					? {
							...item,
							folderId: safeFolderId,
							updatedAt: new Date().toISOString(),
						}
					: item,
			);
			const expectedSnapshot: WorkspaceMutationSnapshot = {
				assets,
				documents: state.documents,
				folders: state.folders,
			};
			persistMutation = () => {
				void updateProjectAsset(capturedProjectId, id, { folderId: safeFolderId ?? "" })
					.then(() => getWorkspaceDocuments(capturedProjectId))
					.then((savedState) => {
						if (!isCurrentWorkspaceMutationSnapshot(get(), capturedProjectId, expectedSnapshot)) {
							return;
						}
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch((err) => {
						if (!isCurrentWorkspaceMutationSnapshot(get(), capturedProjectId, expectedSnapshot)) {
							return;
						}
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							`后端移动素材失败：${errorMessage(err)}`,
						);
					});
			};
			return {
				assets,
				syncStatus: "syncing",
				syncMessage: "正在移动素材",
			};
		});
		runDeferredMutation(persistMutation);
	},
	organizeIntoChapter: () => {
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const capturedProjectId = state.projectId;
			if (!capturedProjectId) return state;
			const folder = createUntitledFolder("第一章", null, nextFolderSortOrder(state.folders, null));
			const folders = normalizeFolders([...state.folders, folder]);
			const documents = state.documents.map((document) =>
				isOverviewDocumentId(document.id) ? document : { ...document, folderId: folder.id },
			);
			const assets = state.assets.map((asset) => ({ ...asset, folderId: folder.id }));
			const rollback = rollbackSnapshot(state);
			const expectedSnapshot: WorkspaceMutationSnapshot = {
				assets,
				documents,
				folders,
			};
			persistMutation = () => {
				void createWorkspaceFolder(
					{ id: folder.id, name: folder.name, parentId: null, sortOrder: folder.sortOrder },
					capturedProjectId,
				)
					.then(() =>
						Promise.all([
							...documents
								.filter((document) => !isOverviewDocumentId(document.id))
								.map((document) =>
									updateWorkspaceDocumentRecord(
										document.id,
										{ folderId: folder.id },
										capturedProjectId,
									),
								),
							...assets.map((asset) =>
								updateProjectAsset(capturedProjectId, asset.id, { folderId: folder.id }),
							),
						]),
					)
					.then(() => getWorkspaceDocuments(capturedProjectId))
					.then((savedState) => {
						if (!isCurrentWorkspaceMutationSnapshot(get(), capturedProjectId, expectedSnapshot)) {
							return;
						}
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						if (!isCurrentWorkspaceMutationSnapshot(get(), capturedProjectId, expectedSnapshot)) {
							return;
						}
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端整理目录失败",
						);
					});
			};
			return {
				folders,
				documents,
				assets,
				syncStatus: "syncing",
				syncMessage: "正在整理到第一章",
			};
		});
		runDeferredMutation(persistMutation);
	},
	renameFolder: (id, name) => {
		const nextName = name.trim();
		if (!nextName) return;
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const folder = state.folders.find((item) => item.id === id);
			if (!folder || folder.name === nextName) return state;
			if (folderNameExists(state.folders, folder.parentId ?? null, nextName, id)) {
				return {
					syncStatus: "error",
					syncMessage: "同级文件夹已存在",
				};
			}
			const folders = state.folders.map((item) =>
				item.id === id ? { ...item, name: nextName, updatedAt: new Date().toISOString() } : item,
			);
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			persistMutation = () => {
				void updateWorkspaceFolder(id, { name: nextName }, capturedProjectId)
					.then(({ state: savedState }) => {
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端重命名文件夹失败",
						);
					});
			};
			return {
				folders,
				syncStatus: "syncing",
				syncMessage: "正在重命名文件夹",
			};
		});
		runDeferredMutation(persistMutation);
	},
});

const runDeferredMutation = (mutation: (() => void) | null) => {
	if (mutation) mutation();
};

const moveFolderInTree = (
	folders: DocumentFolder[],
	folderId: string,
	targetFolderId: string | null,
	position: FolderMovePosition,
) => {
	const source = folders.find((folder) => folder.id === folderId);
	if (!source) return { folders, changed: false, changedFolders: [] };

	const target = targetFolderId ? folders.find((folder) => folder.id === targetFolderId) : null;
	if (targetFolderId && !target) return { folders, changed: false, changedFolders: [] };
	if (target?.id === source.id) return { folders, changed: false, changedFolders: [] };
	if (target && collectFolderDescendantIds(folders, source.id).has(target.id)) {
		return { folders, changed: false, changedFolders: [] };
	}

	const nextParentId =
		target && position !== "inside"
			? (target.parentId ?? null)
			: validFolderId(folders, targetFolderId, source.id);
	const withoutSource = folders.filter((folder) => folder.id !== source.id);
	const siblings = withoutSource
		.filter((folder) => (folder.parentId ?? null) === nextParentId)
		.sort(compareFoldersForTree);
	const targetSiblingIndex = target ? siblings.findIndex((folder) => folder.id === target.id) : -1;
	const insertIndex =
		target && position === "before"
			? Math.max(targetSiblingIndex, 0)
			: target && position === "after"
				? Math.min(Math.max(targetSiblingIndex + 1, 0), siblings.length)
				: siblings.length;
	const now = new Date().toISOString();
	const movedFolder: DocumentFolder = {
		...source,
		parentId: nextParentId,
		updatedAt: now,
	};
	const nextSiblings = [
		...siblings.slice(0, insertIndex),
		movedFolder,
		...siblings.slice(insertIndex),
	].map((folder, sortOrder) => ({
		...folder,
		parentId: nextParentId,
		sortOrder,
		updatedAt: folder.id === source.id ? now : folder.updatedAt,
	}));
	const updates = new Map(nextSiblings.map((folder) => [folder.id, folder]));
	const nextFolders = normalizeFolders(folders.map((folder) => updates.get(folder.id) ?? folder));
	const changedFolders = nextFolders.filter((folder) => {
		const previous = folders.find((item) => item.id === folder.id);
		return (
			previous &&
			((previous.parentId ?? null) !== (folder.parentId ?? null) ||
				previous.sortOrder !== folder.sortOrder)
		);
	});

	return {
		folders: nextFolders,
		changed: changedFolders.length > 0,
		changedFolders,
	};
};

const compareFoldersForTree = (first: DocumentFolder, second: DocumentFolder) =>
	first.sortOrder - second.sortOrder || first.name.localeCompare(second.name, "zh-CN");

const folderNameExists = (
	folders: DocumentFolder[],
	parentId: string | null,
	name: string,
	excludeId = "",
) => {
	const nextName = name.trim();
	if (!nextName) return false;
	return folders.some(
		(folder) =>
			folder.id !== excludeId &&
			(folder.parentId ?? null) === parentId &&
			folder.name.trim().toLocaleLowerCase() === nextName.toLocaleLowerCase(),
	);
};

const errorMessage = (err: unknown) =>
	err instanceof Error
		? err.message
		: typeof err === "object" && err !== null && "message" in err && typeof err.message === "string"
			? err.message
			: "未知错误";
