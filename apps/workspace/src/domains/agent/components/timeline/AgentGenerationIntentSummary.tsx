import { ChevronRight, FileText, ImageIcon, Layers3, LockKeyhole, Video } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { AgentGenerationPlanIntent, AgentGenerationPlanIntentItem } from "@/api/types/agent";
import { cn } from "@/shared/lib/utils";

interface AgentGenerationIntentSummaryProps {
	intent?: AgentGenerationPlanIntent;
	className?: string;
}

const collapsedPromptLength = 96;
const expandablePromptLength = 120;

export const AgentGenerationIntentSummary: React.FC<AgentGenerationIntentSummaryProps> = ({
	intent,
	className,
}) => {
	const [detailsExpanded, setDetailsExpanded] = useState(false);
	if (!isRenderableGenerationIntent(intent)) return null;

	const isBatch = intent.operation === "create_batch" || intent.items.length > 1;
	const kindLabel = generationKindLabel(intent.items);
	const operationLabel = `${isBatch ? "批量" : "单项"}${kindLabel}`;
	const OperationIcon = isBatch ? Layers3 : intent.items[0]?.kind === "video" ? Video : ImageIcon;
	const items = isBatch && !detailsExpanded ? [] : intent.items;

	return (
		<section
			className={cn(
				"rounded-sm border border-info-border bg-info-surface/50 text-foreground",
				className,
			)}
			aria-label="本次生成内容"
		>
			<div className="flex min-w-0 items-start gap-2 px-2.5 py-2">
				<span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm bg-info-surface text-info-foreground">
					<LockKeyhole className="size-3.5" aria-hidden="true" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="font-semibold text-foreground">本次生成内容</span>
						<span className="inline-flex items-center gap-1 rounded-sm border border-info-border bg-background/70 px-1.5 py-0.5 text-2xs font-medium text-info-foreground">
							<OperationIcon className="size-3" aria-hidden="true" />
							{operationLabel}
						</span>
						<span className="text-2xs text-muted-foreground">共 {intent.items.length} 项</span>
					</div>
					{intent.conversationTitle ? (
						<p className="mt-0.5 truncate text-caption text-muted-foreground">
							用于「{intent.conversationTitle}」
						</p>
					) : null}
				</div>
			</div>

			{isBatch ? (
				<button
					type="button"
					className="flex min-h-8 w-full items-center gap-1.5 border-t border-info-border px-2.5 py-1.5 text-left text-caption font-medium text-info-foreground outline-none transition-colors hover:bg-info-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
					onClick={() => setDetailsExpanded((current) => !current)}
					aria-expanded={detailsExpanded}
				>
					<ChevronRight
						className={cn("size-3.5 transition-transform", detailsExpanded && "rotate-90")}
						aria-hidden="true"
					/>
					{detailsExpanded ? "收起生成明细" : `展开生成明细（${intent.items.length} 项）`}
				</button>
			) : null}

			{items.length > 0 ? (
				<ol
					className={cn(
						"border-t border-info-border px-2.5 py-2",
						isBatch && "max-h-80 space-y-2 overflow-y-auto",
					)}
				>
					{items.map((item, index) => (
						<GenerationIntentItem
							key={`${item.id}-${index}`}
							item={item}
							index={index}
							showIndex={isBatch}
						/>
					))}
				</ol>
			) : null}

			<p className="border-t border-info-border px-2.5 py-1.5 text-2xs leading-4 text-muted-foreground">
				提示词、目标或固定参考图如需调整，请取消后在对话中说明。
			</p>
		</section>
	);
};

const GenerationIntentItem: React.FC<{
	item: AgentGenerationPlanIntentItem;
	index: number;
	showIndex: boolean;
}> = ({ item, index, showIndex }) => {
	const [promptExpanded, setPromptExpanded] = useState(false);
	const longPrompt = item.prompt.length > expandablePromptLength;
	const prompt =
		longPrompt && !promptExpanded
			? `${item.prompt.slice(0, collapsedPromptLength).trimEnd()}…`
			: item.prompt;
	const referenceCount = item.referenceAssetIds?.length ?? 0;

	return (
		<li
			className={cn("min-w-0", showIndex && "rounded-sm border border-border bg-background/70 p-2")}
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<span className="shrink-0 text-2xs font-semibold text-info-foreground">
					{showIndex ? `${index + 1}.` : item.kind === "video" ? "视频" : "图片"}
				</span>
				<span className="truncate font-medium text-foreground">
					{item.assetTitle || `生成${item.kind === "video" ? "视频" : "图片"} ${index + 1}`}
				</span>
				{showIndex ? (
					<span className="ml-auto shrink-0 text-2xs text-muted-foreground">
						{item.kind === "video" ? "视频" : "图片"}
					</span>
				) : null}
			</div>

			<p className="mt-1 whitespace-pre-wrap break-words text-caption leading-5 text-foreground">
				{prompt}
			</p>
			{longPrompt ? (
				<button
					type="button"
					className="mt-0.5 rounded-sm text-2xs font-medium text-info-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => setPromptExpanded((current) => !current)}
					aria-expanded={promptExpanded}
				>
					{promptExpanded ? "收起完整提示词" : "查看完整提示词"}
				</button>
			) : null}

			<div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
				<span className="inline-flex min-w-0 items-center gap-1">
					<FileText className="size-3 shrink-0" aria-hidden="true" />
					<span className="truncate">{generationTargetLabel(item)}</span>
				</span>
				<span className="inline-flex items-center gap-1">
					<ImageIcon className="size-3" aria-hidden="true" />
					固定参考图 {referenceCount} 张
				</span>
			</div>
		</li>
	);
};

const generationKindLabel = (items: AgentGenerationPlanIntentItem[]) => {
	const kinds = new Set(items.map((item) => item.kind));
	if (kinds.size > 1) return "图片 / 视频";
	return items[0]?.kind === "video" ? "视频" : "图片";
};

const generationTargetLabel = (item: AgentGenerationPlanIntentItem) => {
	const documentTitle = item.notificationTarget?.documentTitle?.trim();
	const heading = item.notificationTarget?.section?.headingText?.trim();
	if (documentTitle && heading) return `目标：${documentTitle} / ${heading}`;
	if (documentTitle) return `目标：${documentTitle}`;
	if (heading) return `目标章节：${heading}`;

	const documentId =
		item.documentId?.trim() ||
		item.documentContext?.documentId?.trim() ||
		item.notificationTarget?.documentId?.trim();
	if (documentId) return `目标文档：${documentId}`;
	if (item.resourceType?.trim()) return `目标资源：${resourceTypeLabel(item.resourceType)}`;
	return "目标：当前生成任务";
};

const resourceTypeLabel = (resourceType: string) => {
	switch (resourceType.trim().toLowerCase()) {
		case "image":
			return "图片";
		case "video":
			return "视频";
		case "document":
			return "文档";
		case "section":
			return "文档章节";
		default:
			return resourceType.trim();
	}
};

const isRenderableGenerationIntent = (value: unknown): value is AgentGenerationPlanIntent => {
	if (!isUnknownRecord(value)) return false;
	if (typeof value.version !== "number" || !Number.isInteger(value.version)) return false;
	if (!isGenerationOperation(value.operation)) return false;
	if (value.conversationTitle !== undefined && typeof value.conversationTitle !== "string") {
		return false;
	}
	if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > 50) {
		return false;
	}
	return value.items.every(isRenderableGenerationIntentItem);
};

const isRenderableGenerationIntentItem = (
	value: unknown,
): value is AgentGenerationPlanIntentItem => {
	if (!isUnknownRecord(value)) return false;
	if (typeof value.id !== "string" || typeof value.prompt !== "string") return false;
	if (value.kind !== "image" && value.kind !== "video") return false;
	for (const key of [
		"assetTitle",
		"capabilityId",
		"sessionId",
		"scopeId",
		"documentId",
		"sectionId",
		"resourceType",
	]) {
		if (value[key] !== undefined && typeof value[key] !== "string") return false;
	}
	if (
		value.referenceAssetIds !== undefined &&
		(!Array.isArray(value.referenceAssetIds) ||
			value.referenceAssetIds.some((item) => typeof item !== "string"))
	) {
		return false;
	}
	if (!hasOptionalStringObject(value.documentContext, ["projectId", "documentId", "sectionId"])) {
		return false;
	}
	if (value.notificationTarget !== undefined) {
		if (!isUnknownRecord(value.notificationTarget)) return false;
		if (
			!hasOptionalStringObject(value.notificationTarget, [
				"kind",
				"projectId",
				"documentId",
				"documentTitle",
			])
		) {
			return false;
		}
		if (
			!hasOptionalStringObject(value.notificationTarget.section, [
				"blockId",
				"documentId",
				"headingText",
				"markdown",
				"plainText",
				"prompt",
			])
		) {
			return false;
		}
	}
	return true;
};

const hasOptionalStringObject = (value: unknown, keys: string[]) => {
	if (value === undefined) return true;
	if (!isUnknownRecord(value)) return false;
	return keys.every((key) => value[key] === undefined || typeof value[key] === "string");
};

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isGenerationOperation = (value: unknown): value is AgentGenerationPlanIntent["operation"] =>
	value === "create_single" || value === "create_batch";
