import type { AgentReference } from "@/domains/agent/api/agent";
import type { AgentDisplayAttachment, AgentMessageMetadata } from "@/domains/agent/stores";

export interface AgentDisplayAttachmentSource {
	id?: string;
	kind?: "image" | "file" | string;
	mimeType?: string;
	name: string;
	size?: number;
	url?: string;
}

export const buildAgentDisplayMetadata = (
	attachments: AgentDisplayAttachmentSource[],
	references: AgentReference[] = [],
): AgentMessageMetadata | undefined => {
	const displayAttachments = uniqueDisplayAttachments([
		...attachments.map(displayAttachmentFromSource),
		...references.map(displayAttachmentFromReference).filter(isDisplayAttachment),
	]);

	return displayAttachments.length > 0 ? { displayAttachments } : undefined;
};

export const displayAttachmentFromReference = (
	reference: AgentReference,
): AgentDisplayAttachment | null => {
	const name = reference.title.trim();
	if (!name) return null;

	return {
		id: displayAttachmentReferenceId(reference),
		kind: displayAttachmentKindFromReference(reference),
		mimeType: displayAttachmentReferenceMeta(reference),
		name,
		url: reference.url,
	};
};

const displayAttachmentFromSource = (
	attachment: AgentDisplayAttachmentSource,
): AgentDisplayAttachment => ({
	id: attachment.id,
	kind: attachment.kind,
	mimeType: attachment.mimeType,
	name: attachment.name,
	size: attachment.size,
	url: attachment.url,
});

const displayAttachmentKindFromReference = (reference: AgentReference) => {
	if (reference.kind === "asset" && isImageReference(reference)) return "image";
	return "file";
};

const displayAttachmentReferenceMeta = (reference: AgentReference) => {
	if (reference.kind === "document") return "文档";
	if (reference.kind === "section") return "文档片段";
	return reference.mimeType || assetKindLabel(reference.assetKind) || "资料";
};

const displayAttachmentReferenceId = (reference: AgentReference) => {
	if (reference.kind === "asset") return reference.assetId || reference.documentId;
	if (reference.kind === "section") return `${reference.documentId}:${reference.blockId ?? ""}`;
	return reference.documentId;
};

const isImageReference = (reference: AgentReference) =>
	reference.assetKind === "image" || (reference.mimeType?.startsWith("image/") ?? false);

const assetKindLabel = (assetKind?: string) => {
	switch (assetKind) {
		case "image":
			return "图片";
		case "video":
			return "视频";
		case "audio":
			return "音频";
		case "text":
			return "文本";
		default:
			return "";
	}
};

const isDisplayAttachment = (
	attachment: AgentDisplayAttachment | null,
): attachment is AgentDisplayAttachment => attachment !== null;

const uniqueDisplayAttachments = (attachments: AgentDisplayAttachment[]) => {
	const seen = new Set<string>();
	return attachments.filter((attachment) => {
		const key = displayAttachmentFingerprint(attachment);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

const displayAttachmentFingerprint = (attachment: AgentDisplayAttachment) =>
	[
		attachment.name.trim().toLowerCase(),
		normalizedDisplayAttachmentKind(attachment.kind),
		attachment.mimeType?.trim().toLowerCase() ?? "",
	].join("\u0000");

const normalizedDisplayAttachmentKind = (kind?: string) => {
	const normalized = kind?.trim().toLowerCase() ?? "";
	return normalized === "image" ? "image" : "file";
};
