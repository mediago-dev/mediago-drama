import { copyDesktopFileToDirectory, pickDesktopDirectory } from "@/shared/desktop/actions";

export type DownloadFileKind = "image" | "video" | "audio" | "text" | "binary" | string;

export interface DownloadFilenameOptions {
	fallback?: string;
	kind?: DownloadFileKind | null;
	mimeType?: string | null;
	prefix?: string;
	suffix?: string;
	title?: string | null;
}

export interface DownloadLocalFileOptions extends DownloadFilenameOptions {
	directory?: string | null;
	sourcePath?: string | null;
}

export const pickDownloadDirectory = () => pickDesktopDirectory("选择下载位置");

export const copyLocalFileToDirectory = async ({
	directory,
	sourcePath,
	...filenameOptions
}: DownloadLocalFileOptions) => {
	const cleanSourcePath = sourcePath?.trim();
	if (!cleanSourcePath) {
		throw new Error("当前文件缺少本地路径，无法复制到下载位置。");
	}
	const cleanDirectory = directory?.trim();
	if (!cleanDirectory) {
		throw new Error("缺少下载位置，无法复制文件。");
	}

	const filename = downloadFilename(filenameOptions);
	const result = await copyDesktopFileToDirectory({
		directory: cleanDirectory,
		filename,
		sourcePath: cleanSourcePath,
	});
	if (!result) throw new Error("复制到下载位置失败。");
	return result;
};

export const downloadLocalFileWithDirectoryPicker = async ({
	sourcePath,
	...filenameOptions
}: DownloadLocalFileOptions) => {
	const directory = await pickDownloadDirectory();
	if (!directory) return null;
	return copyLocalFileToDirectory({ ...filenameOptions, directory, sourcePath });
};

export const downloadFilename = ({
	fallback = "download",
	kind,
	mimeType,
	prefix = "",
	suffix = "",
	title,
}: DownloadFilenameOptions) => {
	const cleanTitle = sanitizeDownloadTitle(title || fallback);
	const { extension: titleExtension, stem } = splitFilename(cleanTitle);
	const extension = titleExtension || extensionForMimeType(mimeType, kind);
	const base = `${prefix}${truncateFilenameStem(stem || sanitizeDownloadTitle(fallback))}${suffix}`;
	return `${base || "download"}${extension}`;
};

export const sanitizeDownloadTitle = (value: string) => {
	const sanitized = value
		.replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return sanitized || "download";
};

const truncateFilenameStem = (value: string) => {
	const maxLength = 80;
	return value.length <= maxLength ? value : value.slice(0, maxLength).trim() || "download";
};

const splitFilename = (filename: string) => {
	const extensionMatch = filename.match(/(\.[a-z0-9]{2,5})$/iu);
	const extension = extensionMatch?.[1] ?? "";
	const stem = extension ? filename.slice(0, -extension.length) : filename;
	return { extension, stem };
};

const extensionForMimeType = (mimeType?: string | null, kind?: DownloadFileKind | null) => {
	const normalized = mimeType?.toLowerCase() ?? "";
	if (normalized.includes("png")) return ".png";
	if (normalized.includes("webp")) return ".webp";
	if (normalized.includes("gif")) return ".gif";
	if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
	if (normalized.includes("quicktime")) return ".mov";
	if (normalized.includes("webm")) return ".webm";
	if (normalized.includes("mp4")) return ".mp4";
	if (normalized.includes("mpeg") || normalized.includes("mp3")) return ".mp3";
	if (normalized.includes("wav")) return ".wav";
	if (normalized.includes("flac")) return ".flac";
	if (normalized.includes("markdown")) return ".md";
	if (normalized.includes("plain") || normalized.includes("text")) return ".txt";
	if (normalized.includes("pdf")) return ".pdf";
	if (kind === "video") return ".mp4";
	if (kind === "audio") return ".mp3";
	if (kind === "text") return ".txt";
	if (kind === "binary") return ".bin";
	return ".png";
};
