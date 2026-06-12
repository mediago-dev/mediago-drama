import { File, FileText, ImageIcon, Video } from "lucide-react";
import type { ComponentType } from "react";

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
	const response = await fetch(url);
	if (!response.ok) throw new Error(`文本读取失败：${response.status}`);
	return response.text();
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

export const truncateTextPreview = (text: string) => {
	const maxLength = 80_000;
	return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n\n...`;
};
