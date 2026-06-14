import { FileText, ImageIcon, Loader2, X } from "lucide-react";
import type React from "react";
import { uploadMediaAsset } from "@/domains/workspace/api/media";
import type { AgentA2UIPayload } from "@/domains/agent/api/agent";

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

export const createAttachmentDecisionBatchId = () =>
	`attachment-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const createAttachmentDecisionA2UIPayload = (
	batchId: string,
	files: Array<Pick<AgentAttachment, "name" | "size">>,
): AgentA2UIPayload => {
	const surfaceId = `attachment-import-${safeA2UIID(batchId)}`;
	const fileSummary = files
		.map((file, index) => `${index + 1}. ${file.name}（${formatBytes(file.size)}）`)
		.join("\n");
	return {
		version: "v0.9",
		surfaceId,
		messages: [
			{
				version: "v0.9",
				createSurface: {
					surfaceId,
					catalogId: a2uiBasicCatalogID,
				},
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId,
					components: [
						{
							id: "root",
							component: "Column",
							children: ["title", "summary", "files", "actions"],
							align: "stretch",
						},
						{
							id: "title",
							component: "Text",
							text: "是否添加到素材库？",
							variant: "h5",
						},
						{
							id: "summary",
							component: "Text",
							text: "附件可以作为本次对话上下文，也可以原文件保存到素材库。",
						},
						{
							id: "files",
							component: "Text",
							text: fileSummary || "未选择文件。",
							variant: "caption",
						},
						{
							id: "actions",
							component: "Row",
							children: ["cancel", "use-once", "add-to-library"],
							justify: "end",
							align: "center",
						},
						{
							id: "cancel-label",
							component: "Text",
							text: "取消",
						},
						{
							id: "use-once-label",
							component: "Text",
							text: "仅本次使用",
						},
						{
							id: "add-to-library-label",
							component: "Text",
							text: "添加到素材库",
						},
						attachmentDecisionButton("cancel", "cancel-label", "borderless", batchId, "cancel"),
						attachmentDecisionButton("use-once", "use-once-label", "default", batchId, "use_once"),
						attachmentDecisionButton(
							"add-to-library",
							"add-to-library-label",
							"primary",
							batchId,
							"add_to_library",
						),
					],
				},
			},
		],
	};
};

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

export const appendAttachmentContext = (prompt: string, attachments: AgentAttachment[]) => {
	if (attachments.length === 0) return prompt;

	const attachmentContext = attachments
		.map((attachment, index) => {
			const heading = `${index + 1}. ${attachment.kind === "image" ? "图片" : "文件"}：${attachment.name}`;
			const meta = [`MIME：${attachment.mimeType}`, `大小：${formatBytes(attachment.size)}`];
			if (attachment.kind === "image") {
				return [heading, ...meta, `URL：${attachment.url}`].join("\n");
			}

			if (attachment.text === undefined) {
				return [heading, ...meta, "说明：该文件已作为原始附件保留，无法作为文本内联读取。"].join(
					"\n",
				);
			}

			return [
				heading,
				...meta,
				attachment.truncated ? "说明：内容过长，已截取前半部分。" : undefined,
				"内容：",
				"```",
				attachment.text ?? "",
				"```",
			]
				.filter(Boolean)
				.join("\n");
		})
		.join("\n\n");

	return `${prompt}\n\n附件上下文：\n${attachmentContext}`;
};

export const defaultAgentPrompt = (attachments: AgentAttachment[]) =>
	attachments.length > 0 ? "请根据附件内容处理当前文档。" : "";

export const getAttachmentError = (err: unknown) =>
	err instanceof Error ? err.message : "附件读取失败。";

const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const a2uiBasicCatalogID = "https://a2ui.org/specification/v0_9/basic_catalog.json";

const attachmentDecisionButton = (
	id: string,
	child: string,
	variant: "borderless" | "default" | "primary",
	batchId: string,
	decision: "add_to_library" | "use_once" | "cancel",
) => ({
	id,
	component: "Button",
	child,
	variant,
	action: {
		event: {
			name: "attachment.import.decide",
			context: {
				kind: "attachment_import_decision",
				batchId,
				decision,
			},
		},
	},
});

const safeA2UIID = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");

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
