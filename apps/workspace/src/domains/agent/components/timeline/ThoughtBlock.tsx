import { Brain, ChevronRight } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { AgentMessage } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";
import { compact, formatTime } from "./format";

export const ThoughtBlock: React.FC<{ messages: AgentMessage[] }> = ({ messages }) => {
	const [expanded, setExpanded] = useState(false);
	const content = readableThoughtContent(messages);

	return (
		<article className="w-full text-xs">
			<div className="flex items-start gap-2 px-1 py-1">
				<span className="mt-1 flex shrink-0 items-center gap-1 text-warning-foreground">
					<span className="size-1.5 rounded-full bg-current" />
					<Brain className="size-4" />
				</span>
				<div className="min-w-0 flex-1">
					<button
						type="button"
						className="flex w-full items-start justify-between gap-2 text-left"
						onClick={() => setExpanded((value) => !value)}
						aria-expanded={expanded}
					>
						<span className="min-w-0">
							<span className="block truncate font-medium italic text-muted-foreground">
								思考 ({messages.length} 段)
							</span>
							<span className="mt-0.5 block truncate text-caption italic text-muted-foreground">
								{compact(content)}
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
							{formatTime(messages[0]?.createdAt)}
							<ChevronRight
								className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
							/>
						</span>
					</button>
					{expanded ? (
						<div className="mt-1.5 w-full min-w-0 rounded-sm bg-ide-toolbar/50 px-2.5 py-2 leading-5 text-muted-foreground">
							<p className="whitespace-pre-wrap break-words italic">{content}</p>
						</div>
					) : null}
				</div>
			</div>
		</article>
	);
};

export const readableThoughtContent = (messages: AgentMessage[]) => {
	const segments = messages.map((message) => message.content.trim()).filter(Boolean);
	return segments.reduce((content, segment) => {
		if (!content) return segment;
		const separator = thoughtSegmentSeparator(content, segment);
		return `${content}${separator}${segment}`;
	}, "");
};

const thoughtSegmentSeparator = (content: string, segment: string) => {
	if (startsBlock(segment) || endsBlock(content)) return "\n";
	if (flowsTogether(content, segment)) return "";
	return " ";
};

const startsBlock = (value: string) => /^(```|#{1,6}\s|[-*]\s|\d+[.)]\s)/.test(value.trimStart());

const endsBlock = (value: string) => value.trimEnd().endsWith("```");

const flowsTogether = (left: string, right: string) => {
	const previous = lastTextCharacter(left);
	const next = firstTextCharacter(right);
	if (!previous || !next) return true;
	if (closingPunctuation.test(next)) return true;
	if (openingPunctuation.test(previous)) return true;
	if (isCJK(previous) && (isCJK(next) || cjkPunctuation.test(next))) return true;
	if (cjkPunctuation.test(previous) && isCJK(next)) return true;
	return false;
};

const lastTextCharacter = (value: string) => value.trimEnd().at(-1) ?? "";

const firstTextCharacter = (value: string) => value.trimStart().at(0) ?? "";

const closingPunctuation = /^[,.;:!?%。，、；：？！）】》」』”’]/;
const openingPunctuation = /^[([{（【《「『“‘]$/;
const cjkPunctuation = /^[。，、；：？！]/;
const isCJK = (value: string) => /\p{Script=Han}/u.test(value);
