import type { AgentReference } from "@/domains/agent/api/agent";
import {
	hasRichDisplaySegment,
	normalizeDisplaySegments,
} from "@/domains/agent/lib/display-segments";
import type {
	AgentDisplayAttachment,
	AgentDisplaySegment,
	AgentMessageMetadata,
} from "@/domains/agent/stores";

export interface AgentDisplayAttachmentSource {
	id?: string;
	kind?: "image" | "file" | string;
	mimeType?: string;
	name: string;
	size?: number;
	url?: string;
}

// Attachment cards come from uploaded files, plus @-mentioned image assets so
// their thumbnails stay visible; every other mention renders only as an
// inline chip via display segments.
export const buildAgentDisplayMetadata = (
	attachments: AgentDisplayAttachmentSource[],
	displaySegments: AgentDisplaySegment[] = [],
	references: AgentReference[] = [],
): AgentMessageMetadata | undefined => {
	const displayAttachments = uniqueDisplayAttachments([
		...attachments.map(displayAttachmentFromSource),
		...references.filter(isImageAssetReference).map(displayAttachmentFromImageReference),
	]);
	const segments = normalizeDisplaySegments(displaySegments);
	const includeSegments = hasRichDisplaySegment(segments);
	if (displayAttachments.length === 0 && !includeSegments) return undefined;

	return {
		...(displayAttachments.length > 0 ? { displayAttachments } : {}),
		...(includeSegments ? { displaySegments: segments } : {}),
	};
};

const isImageAssetReference = (reference: AgentReference) =>
	reference.kind === "asset" &&
	Boolean(reference.url) &&
	(reference.assetKind === "image" || (reference.mimeType?.startsWith("image/") ?? false));

const displayAttachmentFromImageReference = (
	reference: AgentReference,
): AgentDisplayAttachment => ({
	id: reference.assetId || reference.documentId,
	kind: "image",
	mimeType: reference.mimeType,
	name: reference.title.trim(),
	url: reference.url,
});

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
