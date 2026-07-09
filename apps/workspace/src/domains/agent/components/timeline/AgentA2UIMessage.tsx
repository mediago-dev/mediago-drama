import {
	A2uiSurface,
	MarkdownContext,
	basicCatalog,
	type ReactComponentImplementation,
} from "@a2ui/react/v0_9";
import {
	A2uiMessageListWrapperSchema,
	A2uiMessageSchema,
	MessageProcessor,
	type A2uiClientAction,
	type A2uiMessage,
	type A2uiMessageListWrapper,
} from "@a2ui/web_core/v0_9";
import type React from "react";
import { useMemo } from "react";
import { agentSelectionRefFromA2UI } from "@/domains/agent/lib/a2ui-selections";
import { resolvedSelectionFromRecord } from "@/domains/agent/lib/resolved-selection";
import { useResolvedAgentSelection } from "@/domains/agent/lib/useResolvedAgentSelection";
import { useSupersededSelectionCard } from "@/domains/agent/lib/useSupersededSelectionCard";
import type { AgentMessage } from "@/domains/agent/stores";
import { ResolvedSelectionPreview } from "@/domains/agent/components/timeline/ResolvedSelectionPreview";
import { cn } from "@/shared/lib/utils";

export const AgentA2UIMessage: React.FC<{
	message: AgentMessage;
	onAction?: (message: AgentMessage, action: A2uiClientAction) => void;
}> = ({ message, onAction }) => {
	// A transcript hydrate re-materializes the original interactive selection
	// card even after the user decided it (the chat store is rebuilt from the
	// server); render the decision as a frozen summary instead so the card
	// can't be clicked twice. The local persisted decision wins; otherwise the
	// server's selection record decides — covering cards decided before local
	// persistence existed, in another window, or re-asked by the agent.
	const ref = useMemo(
		() => agentSelectionRefFromA2UI(message.metadata?.a2ui),
		[message.metadata?.a2ui],
	);
	const resolved = useResolvedAgentSelection(
		ref?.selectionId,
		ref?.projectId,
		resolvedSelectionFromRecord,
	);
	// Freeze a selection card the flow has already moved past even if it was
	// never decided: an ask timeout leaves the record pending, so without this
	// the card keeps live options that would submit into an already-continued
	// flow. Only selection cards (those with a ref) freeze; plain informational
	// A2UI surfaces have nothing to act on.
	const superseded = useSupersededSelectionCard(message.id);
	const result = useMemo(() => renderA2UIPayload(message, onAction), [message, onAction]);

	if (resolved) {
		return (
			<article className="agent-a2ui-card max-w-[var(--message-bubble-max-width)] rounded-sm border border-border bg-card px-3 py-3 text-xs shadow-sm">
				<h5 className="m-0 text-sm font-semibold text-foreground">
					{resolved.title || "用户选择"}
				</h5>
				<ResolvedSelectionPreview
					imageUrl={resolved.imageUrl}
					alt={resolved.summary || resolved.title || "已选择的图片"}
				/>
				<p className="mt-1 whitespace-pre-wrap break-words leading-5 text-muted-foreground">
					{resolved.summary || "该选择已处理。"}
				</p>
			</article>
		);
	}

	if (ref && superseded) {
		return (
			<article className="agent-a2ui-card max-w-[var(--message-bubble-max-width)] rounded-sm border border-border bg-card px-3 py-3 text-xs shadow-sm">
				<h5 className="m-0 text-sm font-semibold text-foreground">用户选择</h5>
				<p className="mt-1 whitespace-pre-wrap break-words leading-5 text-muted-foreground">
					流程已继续，无需操作。
				</p>
			</article>
		);
	}

	if (result.error) {
		return (
			<article className="agent-a2ui-card rounded-sm border border-error-border bg-error-surface px-3 py-2 text-xs leading-5 text-error-foreground">
				{result.error}
			</article>
		);
	}

	if (result.surfaces.length === 0) return null;

	return (
		<article
			className={cn(
				"agent-a2ui-card max-w-[var(--message-bubble-max-width)] rounded-sm border border-border bg-card px-3 py-3 text-xs shadow-sm",
				"[--a2ui-button-border-radius:var(--radius-scale-sm)] [--a2ui-color-border:var(--border)]",
				"[--a2ui-color-input:var(--input)] [--a2ui-color-on-background:var(--foreground)]",
				"[--a2ui-color-on-primary:var(--primary-foreground)] [--a2ui-color-on-surface:var(--card-foreground)]",
				"[--a2ui-color-primary:var(--primary)] [--a2ui-color-surface:var(--card)]",
				"[--a2ui-font-family-title:inherit] [--a2ui-font-size-m:0.75rem] [--a2ui-font-size-s:0.6875rem]",
				"[--a2ui-spacing-l:0.75rem] [--a2ui-spacing-m:0.5rem] [--a2ui-spacing-s:0.375rem] [--a2ui-spacing-xs:0.25rem]",
				"[--a2ui-image-small-feature-size:100%]",
				"[&_button]:inline-flex [&_button]:min-h-7 [&_button]:max-w-full [&_button]:items-center [&_button]:justify-center [&_button]:rounded-sm",
				"[&_button]:whitespace-normal [&_button]:border [&_button]:border-border [&_button]:bg-background [&_button]:px-2.5 [&_button]:py-1 [&_button]:text-center [&_button]:text-xs [&_button]:leading-4",
				"[&_button]:font-medium [&_button]:text-foreground [&_button]:transition-colors [&_button:hover]:bg-ide-list-hover",
				"[&_button]:cursor-pointer [&_button:hover]:border-primary",
				"[&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-50",
				"[&_em]:not-italic [&_em]:text-muted-foreground [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h4]:m-0 [&_h5]:m-0",
				"[&_h5]:text-sm [&_h5]:font-semibold [&_p]:m-0 [&_p]:break-words [&_p]:leading-5",
				"[&_img]:max-h-40 [&_img]:max-w-full [&_img]:rounded-sm [&_img]:border [&_img]:border-border [&_img]:object-cover",
				"[&_div[style*='flex-direction:_row']:has(img)]:flex-wrap",
				"[&_div[style*='flex-direction:_row']:has(img)>div]:min-w-0 [&_div[style*='flex-direction:_row']:has(img)>div]:flex-[1_1_10.5rem]",
				"[&_div[style*='flex-direction:_row']:has(img)>div]:max-w-56",
				"[&_div[style*='flex-direction:_row']:has(img)>div_img]:w-full",
				"[&_div[style*='flex-direction:_row']:has(img)>div_img]:max-h-80",
			)}
		>
			<MarkdownContext.Provider value={renderA2UIMarkdown}>
				<div className="space-y-2">
					{result.surfaces.map((surface) => (
						<A2uiSurface key={surface.id} surface={surface} />
					))}
				</div>
			</MarkdownContext.Provider>
		</article>
	);
};

const renderA2UIPayload = (
	message: AgentMessage,
	onAction?: (message: AgentMessage, action: A2uiClientAction) => void,
) => {
	const payload = message.metadata?.a2ui;
	if (!payload) return { error: "A2UI payload missing.", surfaces: [] };
	if (payload.version && payload.version !== "v0.9") {
		return { error: `Unsupported A2UI version: ${payload.version}`, surfaces: [] };
	}

	const normalized = normalizeA2UIMessages(payload.messages);
	if (normalized.error) return { error: normalized.error, surfaces: [] };

	try {
		const processor = new MessageProcessor<ReactComponentImplementation>([basicCatalog], (action) =>
			onAction?.(message, action),
		);
		processor.processMessages(normalized.messages);

		const surfaces = Array.from(processor.model.surfacesMap.values());
		if (!payload.surfaceId) return { error: "", surfaces };

		const surface = processor.model.surfacesMap.get(payload.surfaceId);
		return {
			error: surface ? "" : `A2UI surface not found: ${payload.surfaceId}`,
			surfaces: surface ? [surface] : [],
		};
	} catch (err) {
		return { error: getA2UIError(err), surfaces: [] };
	}
};

const normalizeA2UIMessages = (
	raw: unknown,
): { error: string; messages: A2uiMessage[] | A2uiMessageListWrapper } => {
	if (Array.isArray(raw)) {
		const messages: A2uiMessage[] = [];
		for (const item of raw) {
			const parsed = A2uiMessageSchema.safeParse(item);
			if (!parsed.success) return { error: "Invalid A2UI message payload.", messages: [] };
			messages.push(parsed.data);
		}
		return { error: "", messages };
	}

	const parsed = A2uiMessageListWrapperSchema.safeParse(raw);
	if (!parsed.success) return { error: "Invalid A2UI message list.", messages: [] };
	return { error: "", messages: parsed.data };
};

const getA2UIError = (err: unknown) =>
	err instanceof Error ? err.message : "Failed to render A2UI payload.";

const renderA2UIMarkdown = async (markdown: string) => {
	const trimmed = markdown.trim();
	if (!trimmed) return "";

	const caption = trimmed.match(/^\*([\s\S]+)\*$/);
	if (caption) return `<em>${escapeHTML(caption[1]).replace(/\n/g, "<br />")}</em>`;

	return trimmed
		.split("\n")
		.map((line) => {
			const heading = line.match(/^(#{1,6})\s+(.+)$/);
			if (heading) {
				const level = Math.min(heading[1].length, 6);
				return `<h${level}>${escapeHTML(heading[2])}</h${level}>`;
			}
			return `<p>${escapeHTML(line)}</p>`;
		})
		.join("");
};

const escapeHTML = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
