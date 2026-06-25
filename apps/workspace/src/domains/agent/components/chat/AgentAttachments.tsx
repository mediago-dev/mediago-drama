import { FileText, ImageIcon, Loader2, X } from "lucide-react";
import type React from "react";
import { uploadMediaAsset } from "@/domains/workspace/api/media";

export type AttachmentStatus = "uploading" | "ready" | "error";
export type AttachmentKind = "image" | "file";

export interface AgentAttachment {
	id: string;
	error?: string;
	file: File;
	kind: AttachmentKind;
	mimeType: string;
	name: string;
	size: number;
	status: AttachmentStatus;
	text?: string;
	truncated?: boolean;
	url?: string;
}

export const agentAttachmentAccept = undefined;

const maxTextAttachmentBytes = 220_000;

const readableTextExtensions = new Set([
	".csv",
	".css",
	".html",
	".js",
	".json",
	".jsx",
	".md",
	".ts",
	".tsx",
	".txt",
	".yaml",
	".yml",
]);

export const createPendingAttachment = (file: File): AgentAttachment => ({
	id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	file,
	kind: file.type.startsWith("image/") ? "image" : "file",
	mimeType: file.type || "application/octet-stream",
	name: file.name,
	size: file.size,
	status: "uploading",
});

export const readAgentAttachment = async (
	file: File,
	id: string,
	projectId?: string | null,
): Promise<AgentAttachment> => {
	if (file.type.startsWith("image/")) {
		const asset = await uploadMediaAsset(file, projectId);
		return {
			id,
			file,
			kind: "image",
			mimeType: asset.mimeType,
			name: asset.filename || file.name,
			size: asset.sizeBytes || file.size,
			status: "ready",
			url: new URL(asset.url, window.location.origin).toString(),
		};
	}

	if (!isReadableTextFile(file)) {
		return {
			id,
			file,
			kind: "file",
			mimeType: file.type || "application/octet-stream",
			name: file.name,
			size: file.size,
			status: "ready",
		};
	}

	const text = await file.slice(0, maxTextAttachmentBytes).text();
	return {
		id,
		file,
		kind: "file",
		mimeType: file.type || "text/plain",
		name: file.name,
		size: file.size,
		status: "ready",
		text,
		truncated: file.size > maxTextAttachmentBytes,
	};
};

const isReadableTextFile = (file: File) => {
	if (file.type.startsWith("text/")) return true;
	const name = file.name.toLowerCase();
	return [...readableTextExtensions].some((extension) => name.endsWith(extension));
};

export const getAttachmentError = (err: unknown) =>
	err instanceof Error ? err.message : "附件读取失败。";

const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const AttachmentChip: React.FC<{
	attachment: AgentAttachment;
	disabled: boolean;
	onRemove: () => void;
}> = ({ attachment, disabled, onRemove }) => {
	const isUploading = attachment.status === "uploading";
	const isError = attachment.status === "error";
	const Icon = attachment.kind === "image" ? ImageIcon : FileText;

	return (
		<div
			className={`agent-attachment-chip inline-flex max-w-full items-center gap-1.5 rounded-sm border px-2 py-1 text-caption ${
				isError
					? "border-error-border bg-error-surface text-error-foreground"
					: "border-border bg-ide-toolbar text-ide-toolbar-foreground"
			}`}
			title={isError ? attachment.error : attachment.name}
		>
			{isUploading ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
			<span className="max-w-32 truncate">{attachment.name}</span>
			<span className="shrink-0 text-muted-foreground">
				{isError ? attachment.error : isUploading ? "上传中" : formatBytes(attachment.size)}
			</span>
			<button
				type="button"
				className="ml-0.5 inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground"
				disabled={disabled}
				onClick={onRemove}
				aria-label={`移除 ${attachment.name}`}
			>
				<X className="size-3" />
			</button>
		</div>
	);
};
