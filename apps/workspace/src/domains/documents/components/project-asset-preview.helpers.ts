import { File, FileText, ImageIcon, Video } from "lucide-react";
import type { ComponentType } from "react";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import { apiResourceURL } from "@/shared/lib/api-base";

export const assetPreviewIcon = (kind: string): ComponentType<{ className?: string }> => {
	switch (kind) {
		case "image":
			return ImageIcon;
		case "text":
			return FileText;
		case "video":
			return Video;
		default:
			return File;
	}
};

export const errorMessage = (error: unknown, fallback: string) => {
	if (error instanceof Error && error.message.trim()) return error.message;
	return fallback;
};

export const fetchTextAsset = async (url: string) => {
	if (!url.trim()) throw new Error("素材地址缺失。");
	const response = await fetchTextPreviewResponse(url);
	if (!response.ok) throw new Error(`文本读取失败：${response.status}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const text = decodeTextPreview(bytes);
	if (isHTMLResponse(response, text)) {
		throw new Error("文本读取失败：素材接口返回了前端页面。");
	}
	return truncateTextPreview(text);
};

// Text assets are stored verbatim, so a Chinese .txt saved in GBK/GB18030 (the
// dominant legacy encoding) renders as mojibake when forced through UTF-8.
// Response.text() always assumes UTF-8, so sniff the bytes and pick a decoder.
const decodeTextPreview = (bytes: Uint8Array) =>
	new TextDecoder(detectTextEncoding(bytes)).decode(bytes);

const detectTextEncoding = (bytes: Uint8Array): string => {
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
	// A UTF-8 BOM is valid UTF-8, so it falls through and TextDecoder strips it.
	return isValidUtf8(bytes) ? "utf-8" : "gb18030";
};

const isValidUtf8 = (bytes: Uint8Array): boolean => {
	try {
		// stream: true tolerates a multibyte sequence sliced off by the ranged
		// preview fetch; any genuinely invalid byte still throws, which points to
		// a legacy (non-UTF-8) encoding.
		new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
		return true;
	} catch {
		return false;
	}
};

// 512 KiB always decodes to at least textPreviewMaxChars characters (UTF-8 and
// GB18030 both spend at most 4 bytes per character), so a ranged fetch never
// truncates below the preview cap.
const textPreviewMaxBytes = 512 * 1024;

const fetchTextPreviewResponse = async (url: string) => {
	const ranged = await fetch(url, {
		headers: { Range: `bytes=0-${textPreviewMaxBytes - 1}` },
	});
	// A zero-length body satisfies no byte range, so empty files come back 416.
	if (ranged.status === 416) return fetch(url);
	return ranged;
};

export const projectAssetContentPath = (projectId: string, assetId: string) =>
	`/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/content`;

export const projectAssetContentURL = (
	asset: Pick<ProjectAsset, "id" | "projectId" | "url">,
	projectId?: string | null,
) => {
	const explicitURL = apiResourceURL(asset.url);
	if (explicitURL) return explicitURL;

	const resolvedProjectId = (projectId ?? asset.projectId).trim();
	const assetId = asset.id.trim();
	if (!resolvedProjectId || !assetId) return "";
	return apiResourceURL(projectAssetContentPath(resolvedProjectId, assetId));
};

export const formatBytes = (bytes: number) => {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	const precision = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

export const textPreviewMaxChars = 80_000;

export const truncateTextPreview = (text: string) =>
	text.length <= textPreviewMaxChars ? text : `${text.slice(0, textPreviewMaxChars)}\n\n...`;

const isHTMLResponse = (response: Response, text: string) => {
	const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
	if (contentType.includes("text/html")) return true;
	return /^\s*<!doctype\s+html/i.test(text) || /^\s*<html[\s>]/i.test(text);
};
