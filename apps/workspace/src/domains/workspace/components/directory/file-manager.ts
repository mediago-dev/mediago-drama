import type { DocumentFolder, MarkdownDocument } from "@/domains/documents/stores";
import { isDesktopRuntime } from "@/domains/projects/lib/project-directory";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { openNativePath, revealNativePath } from "@/shared/desktop/actions";
import type { DirectoryFileEntry } from "./types";

type RevealableDirectoryFileEntry =
	| DirectoryFileEntry
	| {
			kind: "document";
			id: string;
			document: MarkdownDocument;
			folderId?: string | null;
	  }
	| {
			kind: "asset";
			id: string;
			asset: ProjectAsset;
			folderId?: string | null;
	  };

export const canShowInFileManager = (workspaceDir: string) => workspaceDir.trim().length > 0;

export const revealPathInFileManager = async (path: string) => {
	const safePath = path.trim();
	if (!safePath) throw new Error("本地路径为空。");
	if (!isDesktopRuntime()) throw new Error("当前运行环境不支持打开本地文件管理器。");

	try {
		await revealNativePath(safePath);
	} catch {
		await openNativePath(safePath);
	}
};

export const revealDirectoryFolderInFileManager = async ({
	folder,
	folders,
	workspaceDir,
}: {
	folder: DocumentFolder;
	folders: DocumentFolder[];
	workspaceDir: string;
}) => {
	await revealPathInFileManager(resolveDirectoryFolderPath({ folder, folders, workspaceDir }));
};

export const revealDirectoryFileInFileManager = async ({
	documents,
	entry,
	folders,
	workspaceDir,
}: {
	documents: MarkdownDocument[];
	entry: RevealableDirectoryFileEntry;
	folders: DocumentFolder[];
	workspaceDir: string;
}) => {
	await revealPathInFileManager(
		resolveDirectoryFilePath({ documents, entry, folders, workspaceDir }),
	);
};

export const resolveDirectoryFolderPath = ({
	folder,
	folders,
	workspaceDir,
}: {
	folder: DocumentFolder;
	folders: DocumentFolder[];
	workspaceDir: string;
}) => {
	const folderPath = buildDocumentFolderPathById(folders).get(folder.id);
	if (!folderPath) return joinLocalPath(workRootPath(workspaceDir), folderPathSegment(folder));
	return joinLocalPath(workRootPath(workspaceDir), folderPath);
};

export const resolveDirectoryFilePath = ({
	documents,
	entry,
	folders,
	workspaceDir,
}: {
	documents: MarkdownDocument[];
	entry: RevealableDirectoryFileEntry;
	folders: DocumentFolder[];
	workspaceDir: string;
}) => {
	const folderPathById = buildDocumentFolderPathById(folders);
	if (entry.kind === "asset") {
		const folderId = entry.asset.folderId ?? entry.folderId ?? null;
		const folderPath = folderId ? (folderPathById.get(folderId) ?? "") : "";
		return joinLocalPath(
			workRootPath(workspaceDir),
			folderPath,
			cleanRelativePath(entry.asset.filename, "untitled"),
		);
	}

	const folderId = entry.document.folderId ?? entry.folderId ?? null;
	const folderPath = folderId ? (folderPathById.get(folderId) ?? "") : "";
	const filename =
		buildDocumentFilenameById(documents).get(entry.document.id) ?? documentFilename(entry.document);
	return joinLocalPath(workRootPath(workspaceDir), folderPath, filename);
};

export const describeFileManagerError = (error: unknown) =>
	error instanceof Error ? error.message : "无法打开本地文件管理器。";

const workRootPath = (workspaceDir: string) => joinLocalPath(workspaceDir, "work");

export const buildDocumentFolderPathById = (folders: DocumentFolder[]) => {
	const normalizedFolders = normalizeFolders(folders);
	const childrenByParent = new Map<string, DocumentFolder[]>();
	for (const folder of normalizedFolders) {
		const parentId = folder.parentId ?? "";
		childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder]);
	}
	for (const [parentId, children] of childrenByParent) {
		childrenByParent.set(parentId, children.sort(compareFolders));
	}

	const paths = new Map<string, string>();
	const visit = (parentId: string, parentPath: string) => {
		const usedSegments = new Set<string>();
		for (const folder of childrenByParent.get(parentId) ?? []) {
			const segment = uniquePathSegment(folderPathSegment(folder), usedSegments);
			const relativePath = parentPath ? `${parentPath}/${segment}` : segment;
			paths.set(folder.id, relativePath);
			visit(folder.id, relativePath);
		}
	};
	visit("", "");
	return paths;
};

export const buildDocumentFilenameById = (documents: MarkdownDocument[]) => {
	const filenames = new Map<string, string>();
	const usedByFolder = new Map<string, Set<string>>();

	for (const document of documents) {
		const folderId = document.folderId ?? "";
		const used = usedByFolder.get(folderId) ?? new Set<string>();
		usedByFolder.set(folderId, used);
		filenames.set(document.id, uniqueDocumentFilename(documentFilename(document), used));
	}

	return filenames;
};

// Sidebar label for a document: its real on-disk filename stem as reported by the
// backend, so duplicate suffixes like "-2" remain visible without showing ".md".
// Falls back to the title only when the backend did not provide a filename.
export const documentSidebarLabel = (document: MarkdownDocument) => {
	const filename = document.filename?.trim();
	if (!filename) return document.title;
	const basename = filename.split("/").pop()?.trim();
	if (!basename) return document.title;
	const stem = basename.replace(/\.[^.]*$/, "").trim();
	return stem || basename;
};

export const compareDirectoryLabels = (first: string, second: string) =>
	first.localeCompare(second, "zh-CN", { numeric: true }) || compareRawStrings(first, second);

const compareRawStrings = (first: string, second: string) => {
	if (first < second) return -1;
	if (first > second) return 1;
	return 0;
};

const normalizeFolders = (folders: DocumentFolder[]) => {
	const seen = new Set<string>();
	const normalized: DocumentFolder[] = [];
	for (const [index, folder] of folders.entries()) {
		const id = folder.id.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		normalized.push({
			...folder,
			id,
			name: folder.name.trim() || "未命名文件夹",
			parentId: folder.parentId?.trim() || null,
			sortOrder: folder.sortOrder < 0 ? index : folder.sortOrder,
		});
	}

	const knownIds = new Set(normalized.map((folder) => folder.id));
	return normalized.map((folder) => ({
		...folder,
		parentId: folder.parentId && knownIds.has(folder.parentId) ? folder.parentId : null,
	}));
};

const compareFolders = (first: DocumentFolder, second: DocumentFolder) => {
	if (first.sortOrder !== second.sortOrder) return first.sortOrder - second.sortOrder;
	if (first.name !== second.name) return first.name < second.name ? -1 : 1;
	if (first.id !== second.id) return first.id < second.id ? -1 : 1;
	return 0;
};

const documentFilename = (document: MarkdownDocument) => {
	const stem = cleanFilenameStem(document.title) || cleanFilenameStem(document.id) || "untitled";
	return `${stem}.md`;
};

const uniqueDocumentFilename = (filename: string, used: Set<string>) => {
	const stem = filename.endsWith(".md") ? filename.slice(0, -3) : filename.replace(/\.[^.]*$/, "");
	const safeStem = stem || "untitled";
	let candidate = `${safeStem}.md`;
	for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) {
		candidate = `${safeStem}-${suffix}.md`;
	}
	used.add(candidate.toLowerCase());
	return candidate;
};

const folderPathSegment = (folder: DocumentFolder) =>
	cleanFilenameStem(folder.name) || cleanFilenameStem(folder.id) || "untitled-folder";

const uniquePathSegment = (segment: string, used: Set<string>) => {
	const safeSegment = segment.trim() || "untitled-folder";
	let candidate = safeSegment;
	for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) {
		candidate = `${safeSegment}-${suffix}`;
	}
	used.add(candidate.toLowerCase());
	return candidate;
};

const cleanFilenameStem = (value: string) => {
	const cleaned = removeControlCharacters(value.trim().replace(/[\\/:*?"<>|]/g, "-"))
		.replace(/\s+/g, " ")
		.replace(/^[.\-\s]+|[.\-\s]+$/g, "");
	return Array.from(cleaned).slice(0, 80).join("").trim();
};

const cleanRelativePath = (value: string, fallback: string) => {
	const parts = value
		.trim()
		.split(/[\\/]+/)
		.map((part) => cleanRelativePathSegment(part))
		.filter(Boolean);
	return parts.length > 0 ? parts.join("/") : fallback;
};

const cleanRelativePathSegment = (value: string) =>
	removeControlCharacters(value.trim().replace(/[\\/:*?"<>|]/g, "-")).replace(/^[. ]+|[. ]+$/g, "");

const removeControlCharacters = (value: string) =>
	Array.from(value)
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f);
		})
		.join("");

const joinLocalPath = (...segments: Array<string | null | undefined>) => {
	const [first, ...rest] = segments
		.map((segment) => segment?.trim().replace(/\\/g, "/") ?? "")
		.filter(Boolean);
	if (!first) return "";

	const base = trimTrailingPathSeparators(first);
	const tail = rest.flatMap((segment) =>
		segment
			.split("/")
			.map((part) => part.trim())
			.filter(Boolean),
	);
	if (tail.length === 0) return base;
	if (base === "/") return `/${tail.join("/")}`;
	return `${base}/${tail.join("/")}`;
};

const trimTrailingPathSeparators = (value: string) => {
	if (value === "/" || /^[A-Za-z]:\/$/.test(value)) return value;
	return value.replace(/\/+$/g, "");
};
