import type { AgentDisplayAttachment } from "@/domains/agent/stores";

// Parses the legacy text-embedded attachment format ("附件上下文：" /
// "已保存到资料的原始文件：" sections appended to the message content) so old
// transcripts keep rendering attachment cards. New messages carry structured
// metadata.displayAttachments instead.

export const visibleUserContent = (content: string) => {
	const markerIndex = firstLegacyAttachmentMarkerIndex(content);
	if (markerIndex < 0) return content;
	return content.slice(0, markerIndex).trim() || "已上传附件";
};

export const legacyDisplayAttachments = (content: string): AgentDisplayAttachment[] => [
	...legacyInlineAttachments(content),
	...legacySavedAssetAttachments(content),
];

const firstLegacyAttachmentMarkerIndex = (content: string) => {
	const indexes = legacyAttachmentMarkers
		.map((marker) => content.indexOf(marker))
		.filter((index) => index >= 0);
	return indexes.length > 0 ? Math.min(...indexes) : -1;
};

const savedAssetAttachmentMarkers = ["已保存到资料的原始文件：", "已保存到素材库的原始文件："];
const legacyAttachmentMarkers = ["附件上下文：", ...savedAssetAttachmentMarkers];

const legacyInlineAttachments = (content: string): AgentDisplayAttachment[] => {
	const section = legacySection(content, "附件上下文：");
	if (!section) return [];

	const attachments: AgentDisplayAttachment[] = [];
	const headingPattern = /^(\d+)\.\s*(图片|文件)：(.+)$/gm;
	let match: RegExpExecArray | null;
	while ((match = headingPattern.exec(section)) !== null) {
		const start = match.index + match[0].length;
		const next = section.slice(start).search(/\n\d+\.\s*(?:图片|文件)：/);
		const block = next >= 0 ? section.slice(start, start + next) : section.slice(start);
		attachments.push({
			kind: match[2] === "图片" ? "image" : "file",
			mimeType: legacyLineValue(block, "MIME"),
			name: match[3].trim(),
			size: parseLegacySize(legacyLineValue(block, "大小")),
			url: legacyLineValue(block, "URL"),
		});
	}
	return attachments;
};

const legacySavedAssetAttachments = (content: string): AgentDisplayAttachment[] => {
	const attachments: AgentDisplayAttachment[] = [];
	for (const marker of savedAssetAttachmentMarkers) {
		const section = legacySection(content, marker);
		if (!section) continue;

		const headingPattern = /^(\d+)\.\s*(.+)$/gm;
		let match: RegExpExecArray | null;
		while ((match = headingPattern.exec(section)) !== null) {
			const start = match.index + match[0].length;
			const next = section.slice(start).search(/\n\d+\.\s*.+/);
			const block = next >= 0 ? section.slice(start, start + next) : section.slice(start);
			attachments.push({
				kind: legacyLineValue(block, "类型") || "file",
				mimeType: legacyLineValue(block, "MIME"),
				name: match[2].trim(),
				size: parseLegacySize(legacyLineValue(block, "大小")),
				url: legacyLineValue(block, "URL"),
			});
		}
	}
	return attachments;
};

const legacySection = (content: string, marker: string) => {
	const start = content.indexOf(marker);
	if (start < 0) return "";
	const afterMarker = content.slice(start + marker.length);
	const nextMarkerIndexes = legacyAttachmentMarkers
		.filter((item) => item !== marker)
		.map((item) => afterMarker.indexOf(item))
		.filter((index) => index >= 0);
	const end = nextMarkerIndexes.length > 0 ? Math.min(...nextMarkerIndexes) : afterMarker.length;
	return afterMarker.slice(0, end).trim();
};

const legacyLineValue = (block: string, label: string) => {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = block.match(new RegExp(`^${escaped}：\\s*(.+)$`, "m"));
	return match?.[1]?.trim() || undefined;
};

const parseLegacySize = (value?: string) => {
	if (!value) return undefined;
	const match = value.match(/^([\d.]+)\s*(bytes?|B|KB|MB|GB)$/i);
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount)) return undefined;
	const unit = match[2].toUpperCase();
	if (unit === "GB") return Math.round(amount * 1024 * 1024 * 1024);
	if (unit === "MB") return Math.round(amount * 1024 * 1024);
	if (unit === "KB") return Math.round(amount * 1024);
	return Math.round(amount);
};
