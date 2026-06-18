import { ImageIcon, Sparkles } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentReference } from "@/domains/agent/api/agent";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/components/ui/popover";
import {
	documentCategory,
	fallbackMentionCategory,
	stringAttribute,
} from "@/domains/documents/lib/mention-suggestion";
import {
	resolveMentionPayload,
	type ResolvedMention,
} from "@/domains/documents/lib/mention-resolver";
import {
	findMarkdownSectionEndLine,
	findMarkdownSectionHeadingLine,
	listDocumentSections,
	normalizeHeadingText,
	stripSectionIdCommentLines,
} from "@/domains/documents/lib/sections";
import { createSectionGenerationPrompt } from "@/domains/documents/lib/section-generation-prompt";
import type { MarkdownDocument } from "@/domains/documents/stores";
import { apiResourceURL } from "@/shared/lib/api-base";

export interface DocumentMentionHoverPopoverProps {
	allAssets: ProjectAsset[];
	allDocuments: MarkdownDocument[];
	children: React.ReactNode;
	onGenerateReference?: (section: MarkdownSectionContext) => void;
}

export const DocumentMentionHoverPopover: React.FC<DocumentMentionHoverPopoverProps> = ({
	allAssets,
	allDocuments,
	children,
	onGenerateReference,
}) => {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [hoveredMention, setHoveredMention] = useState<HoveredMentionState | null>(null);

	const clearCloseTimer = useCallback(() => {
		if (closeTimerRef.current === null) return;
		clearTimeout(closeTimerRef.current);
		closeTimerRef.current = null;
	}, []);
	const closeMentionPopover = useCallback(() => {
		clearCloseTimer();
		setHoveredMention(null);
	}, [clearCloseTimer]);
	const scheduleCloseMentionPopover = useCallback(() => {
		clearCloseTimer();
		closeTimerRef.current = setTimeout(() => {
			setHoveredMention(null);
			closeTimerRef.current = null;
		}, mentionHoverCloseDelayMs);
	}, [clearCloseTimer]);
	const mentionExtensions = useMemo(
		() => ({ allAssets, allDocuments, onGenerateReference }),
		[allAssets, allDocuments, onGenerateReference],
	);

	const showMentionPopover = useCallback(
		(element: HTMLElement) => {
			const root = rootRef.current;
			if (!root) return;

			const reference = referenceFromMentionElement(element);
			if (!reference) return;

			const mention = resolveMentionPayload(
				reference,
				mentionExtensions.allDocuments,
				mentionExtensions.allAssets,
			);
			const targetSection = mentionExtensions.onGenerateReference
				? mentionSectionContext(mention.reference, mentionExtensions.allDocuments)
				: null;
			const rootRect = root.getBoundingClientRect();
			const mentionRect = element.getBoundingClientRect();
			clearCloseTimer();

			setHoveredMention({
				anchor: {
					height: Math.max(1, mentionRect.height),
					left: mentionRect.left - rootRect.left,
					top: mentionRect.top - rootRect.top,
					width: Math.max(1, mentionRect.width),
				},
				mention,
				targetSection,
			});
		},
		[clearCloseTimer, mentionExtensions],
	);

	const handlePointerOver = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const target = event.target;
			if (!(target instanceof Element)) return;

			const mentionElement = target.closest<HTMLElement>(".agent-reference-mention");
			if (!mentionElement || !rootRef.current?.contains(mentionElement)) {
				return;
			}

			showMentionPopover(mentionElement);
		},
		[showMentionPopover],
	);

	const generateReferenceImage = useCallback(() => {
		if (!hoveredMention?.targetSection) return;

		onGenerateReference?.(hoveredMention.targetSection);
		setHoveredMention(null);
	}, [hoveredMention, onGenerateReference]);

	useEffect(
		() => () => {
			clearCloseTimer();
		},
		[clearCloseTimer],
	);

	return (
		<div
			ref={rootRef}
			className="relative min-w-0"
			onPointerOver={handlePointerOver}
			onPointerLeave={scheduleCloseMentionPopover}
		>
			{children}
			<MentionReferencePopover
				state={hoveredMention}
				onClose={closeMentionPopover}
				onGenerate={generateReferenceImage}
				onKeepOpen={clearCloseTimer}
				onRequestClose={scheduleCloseMentionPopover}
			/>
		</div>
	);
};

const mentionHoverCloseDelayMs = 320;

interface HoveredMentionState {
	anchor: {
		height: number;
		left: number;
		top: number;
		width: number;
	};
	mention: ResolvedMention;
	targetSection: MarkdownSectionContext | null;
}

const MentionReferencePopover: React.FC<{
	onClose: () => void;
	onGenerate: () => void;
	onKeepOpen: () => void;
	onRequestClose: () => void;
	state: HoveredMentionState | null;
}> = ({ onClose, onGenerate, onKeepOpen, onRequestClose, state }) => {
	if (!state) return null;

	const images = state.mention.status === "ok" ? state.mention.images : [];
	const canGenerate = Boolean(state.targetSection);

	return (
		<Popover
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<PopoverAnchor asChild>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute"
					style={{
						height: state.anchor.height,
						left: state.anchor.left,
						top: state.anchor.top,
						width: state.anchor.width,
					}}
				/>
			</PopoverAnchor>
			<PopoverContent
				data-mention-reference-popover
				align="start"
				side="bottom"
				sideOffset={6}
				collisionPadding={12}
				className="grid w-[26rem] max-w-[calc(100vw-1.5rem)] gap-2 p-2"
				onCloseAutoFocus={(event) => event.preventDefault()}
				onOpenAutoFocus={(event) => event.preventDefault()}
				onPointerDown={(event) => event.stopPropagation()}
				onPointerEnter={onKeepOpen}
				onPointerLeave={onRequestClose}
			>
				{images.length > 0 ? (
					<div className={images.length === 1 ? "grid gap-1.5" : "grid grid-cols-2 gap-1.5"}>
						{images.slice(0, 6).map((image, index) => (
							<div
								key={`${image.mediaAssetId ?? image.url}:${index}`}
								className={
									images.length === 1
										? "max-h-80 overflow-hidden rounded-sm border border-border bg-muted"
										: "aspect-square overflow-hidden rounded-sm border border-border bg-muted"
								}
							>
								<img
									src={apiResourceURL(image.url)}
									alt=""
									className={
										images.length === 1
											? "max-h-80 w-full object-contain"
											: "size-full object-cover"
									}
									loading="lazy"
								/>
							</div>
						))}
					</div>
				) : canGenerate ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 justify-center rounded-sm border-input text-xs font-semibold"
						onClick={onGenerate}
					>
						<Sparkles className="size-3.5 text-primary" />
						<span>生成引用图片</span>
					</Button>
				) : (
					<div className="flex items-center gap-2 rounded-sm border border-dashed border-border bg-muted px-2 py-2 text-xs text-muted-foreground">
						<ImageIcon className="size-3.5" />
						<span>暂无生成图片</span>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
};

const referenceFromMentionElement = (element: HTMLElement): AgentReference | null => {
	const kind =
		element.dataset.kind === "section"
			? "section"
			: element.dataset.kind === "asset"
				? "asset"
				: "document";
	const documentId = stringAttribute(element.dataset.documentId);
	const title =
		stringAttribute(element.dataset.title) ||
		stringAttribute(element.dataset.label) ||
		element.textContent?.replace(/^@/u, "").trim() ||
		"";
	if (!documentId || !title) return null;

	if (kind === "asset") {
		const assetId = stringAttribute(element.dataset.assetId) || documentId;
		return {
			assetId,
			assetKind: stringAttribute(element.dataset.assetKind),
			category: fallbackMentionCategory,
			documentId: assetId,
			kind,
			mimeType: stringAttribute(element.dataset.mimeType),
			title,
			url: stringAttribute(element.dataset.url),
		};
	}

	const blockId = kind === "section" ? stringAttribute(element.dataset.blockId) : undefined;
	const category = documentCategory(element.dataset.category);

	return {
		documentId,
		...(blockId ? { blockId } : {}),
		kind,
		title,
		...(category ? { category } : {}),
	};
};

const mentionSectionContext = (
	reference: AgentReference,
	documents: MarkdownDocument[],
): MarkdownSectionContext | null => {
	if (reference.kind !== "section" || !reference.blockId) return null;

	const document = documents.find((item) => item.id === reference.documentId);
	if (!document) return null;

	const sections = listDocumentSections(document);
	const sectionIndex = sections.findIndex((item) => item.blockId === reference.blockId);
	const summary = sections[sectionIndex];
	if (!summary) return null;

	const headingOccurrence = sections
		.slice(0, sectionIndex + 1)
		.filter(
			(item) =>
				item.level === summary.level &&
				normalizeHeadingText(item.title) === normalizeHeadingText(summary.title),
		).length;
	const identity = {
		blockId: reference.blockId,
		documentId: document.id,
		headingLevel: summary.level,
		headingOccurrence,
		headingText: summary.title,
	};
	const lines = document.content.split("\n");
	const headingIndex = findMarkdownSectionHeadingLine(lines, identity);
	if (headingIndex < 0) return null;

	const endIndex = findMarkdownSectionEndLine(lines, headingIndex, summary.level);
	const markdown = lines.slice(headingIndex, endIndex).join("\n").trim();
	if (!markdown) return null;

	const plainText = markdownPlainText(markdown);

	return {
		...identity,
		markdown,
		plainText,
		prompt: createSectionGenerationPrompt(markdown, summary.title),
	};
};

const markdownPlainText = (markdown: string) =>
	stripSectionIdCommentLines(markdown)
		.split("\n")
		.flatMap((line) => {
			const trimmed = line.trim();
			if (!trimmed || markdownImageLinePattern.test(trimmed)) return [];
			return [trimmed.replace(/^#{1,6}\s+/u, "")];
		})
		.join("\n\n")
		.trim();

const markdownImageLinePattern = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$/;
