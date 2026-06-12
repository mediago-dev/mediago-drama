import type React from "react";
import { memo, useMemo } from "react";
import type { AgentMessage } from "@/domains/agent/stores";
import { isTauriRuntime } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/utils";
import { CodeBlock } from "./CodeBlocks";
import { ThoughtBlock } from "./ThoughtBlock";

export const MarkdownContent: React.FC<{ content: string }> = memo(({ content }) => {
	const segments = useMemo(
		() =>
			splitMarkdownCodeFences(content).flatMap((segment) =>
				segment.type === "text" ? splitInlineThinkTags(segment.content) : [segment],
			),
		[content],
	);

	return (
		<div className="space-y-2">
			{segments.map((segment, index) =>
				segment.type === "code" ? (
					<CodeBlock key={`${segment.type}-${index}`} content={segment.content} />
				) : segment.type === "think" ? (
					<InlineThoughtBlock
						key={`${segment.type}-${index}`}
						content={segment.content}
						index={index}
					/>
				) : (
					<TextMarkdownBlock key={`${segment.type}-${index}`} content={segment.content} />
				),
			)}
		</div>
	);
});

const InlineThoughtBlock: React.FC<{ content: string; index: number }> = ({ content, index }) => {
	const message: AgentMessage = {
		id: `inline-thought-${index}`,
		role: "assistant",
		content,
		kind: "thought",
		status: "complete",
	};
	return <ThoughtBlock messages={[message]} />;
};

const TextMarkdownBlock: React.FC<{ content: string }> = ({ content }) => {
	const nodes: React.ReactNode[] = [];
	let listItems: Array<{ kind: "ordered" | "unordered"; content: string }> = [];

	const flushList = () => {
		if (listItems.length === 0) return;
		const items = listItems;
		listItems = [];
		const kind = items[0]?.kind ?? "unordered";
		const List = kind === "ordered" ? "ol" : "ul";
		nodes.push(
			<List
				key={`list-${nodes.length}`}
				className={cn("space-y-1 pl-4", kind === "ordered" ? "list-decimal" : "list-disc")}
			>
				{items.map((item, index) => (
					<li key={`${item.content}-${index}`} className="break-words">
						{renderInlineMarkdown(item.content)}
					</li>
				))}
			</List>,
		);
	};

	const lines = content.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const trimmed = line.trim();
		if (!trimmed) {
			flushList();
			continue;
		}

		const table = readMarkdownTable(lines, index);
		if (table) {
			flushList();
			nodes.push(<MarkdownTable key={`table-${nodes.length}`} table={table} />);
			index = table.endIndex;
			continue;
		}

		const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
		if (heading) {
			flushList();
			nodes.push(
				<p key={`heading-${nodes.length}`} className="font-semibold text-foreground">
					{renderInlineMarkdown(heading[2])}
				</p>,
			);
			continue;
		}

		const bullet = trimmed.match(/^[-*]\s+(.+)$/);
		if (bullet) {
			listItems.push({ kind: "unordered", content: bullet[1] });
			continue;
		}

		const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
		if (ordered) {
			listItems.push({ kind: "ordered", content: ordered[1] });
			continue;
		}

		flushList();
		nodes.push(
			<p key={`paragraph-${nodes.length}`} className="whitespace-pre-wrap break-words">
				{renderInlineMarkdown(line)}
			</p>,
		);
	}

	flushList();
	return <>{nodes}</>;
};

type MarkdownTableAlignment = "left" | "center" | "right";

interface MarkdownTableData {
	alignments: MarkdownTableAlignment[];
	endIndex: number;
	headers: string[];
	rows: string[][];
}

const MarkdownTable: React.FC<{ table: MarkdownTableData }> = ({ table }) => (
	<div className="overflow-x-auto">
		<table className="min-w-full border-collapse text-xs leading-5">
			<thead>
				<tr>
					{table.headers.map((header, index) => (
						<th
							key={`${header}-${index}`}
							className={cn(
								"border border-border bg-muted px-2 py-1 align-top font-semibold text-foreground",
								markdownTableAlignmentClass(table.alignments[index]),
							)}
						>
							{renderInlineMarkdown(header)}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{table.rows.map((row, rowIndex) => (
					<tr key={`row-${rowIndex}`}>
						{row.map((cell, cellIndex) => (
							<td
								key={`${cell}-${cellIndex}`}
								className={cn(
									"border border-border px-2 py-1 align-top text-foreground",
									markdownTableAlignmentClass(table.alignments[cellIndex]),
								)}
							>
								{renderInlineMarkdown(cell)}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	</div>
);

const readMarkdownTable = (lines: string[], startIndex: number): MarkdownTableData | null => {
	const headers = parseMarkdownTableRow(lines[startIndex]);
	const alignments = parseMarkdownTableSeparator(lines[startIndex + 1] ?? "");
	if (!headers || !alignments || headers.length !== alignments.length) return null;

	const rows: string[][] = [];
	let index = startIndex + 2;
	for (; index < lines.length; index += 1) {
		const cells = parseMarkdownTableRow(lines[index]);
		if (!cells) break;
		rows.push(normalizeMarkdownTableCells(cells, headers.length));
	}

	return {
		alignments,
		endIndex: index - 1,
		headers,
		rows,
	};
};

const parseMarkdownTableRow = (line: string): string[] | null => {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) return null;

	const withoutLeadingPipe = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
	const withoutOuterPipes = withoutLeadingPipe.endsWith("|")
		? withoutLeadingPipe.slice(0, -1)
		: withoutLeadingPipe;
	const cells = splitMarkdownTableCells(withoutOuterPipes).map((cell) => cell.trim());
	if (cells.length < 2) return null;
	return cells;
};

const parseMarkdownTableSeparator = (line: string): MarkdownTableAlignment[] | null => {
	const cells = parseMarkdownTableRow(line);
	if (!cells) return null;

	const alignments: MarkdownTableAlignment[] = [];
	for (const cell of cells) {
		const marker = cell.replace(/\s/g, "");
		if (!/^:?-{3,}:?$/.test(marker)) return null;

		if (marker.startsWith(":") && marker.endsWith(":")) {
			alignments.push("center");
		} else if (marker.endsWith(":")) {
			alignments.push("right");
		} else {
			alignments.push("left");
		}
	}
	return alignments;
};

const splitMarkdownTableCells = (row: string) => {
	const cells: string[] = [];
	let current = "";

	for (let index = 0; index < row.length; index += 1) {
		const char = row[index];
		if (char === "\\" && row[index + 1] === "|") {
			current += "|";
			index += 1;
			continue;
		}
		if (char === "|") {
			cells.push(current);
			current = "";
			continue;
		}
		current += char;
	}

	cells.push(current);
	return cells;
};

const normalizeMarkdownTableCells = (cells: string[], count: number) =>
	Array.from({ length: count }, (_, index) => cells[index] ?? "");

const markdownTableAlignmentClass = (alignment?: MarkdownTableAlignment) => {
	if (alignment === "center") return "text-center";
	if (alignment === "right") return "text-right";
	return "text-left";
};

const renderInlineMarkdown = (text: string): React.ReactNode[] => {
	const nodes: React.ReactNode[] = [];
	const pattern =
		/(\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\s)\n]+))\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_)/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text)) !== null) {
		if (match.index > lastIndex) {
			nodes.push(text.slice(lastIndex, match.index));
		}

		const [
			raw,
			,
			linkText,
			angleHref,
			bareHref,
			code,
			boldStar,
			boldUnderscore,
			italicStar,
			italicUnderscore,
		] = match;
		const key = `inline-${match.index}-${raw}`;
		const markdownHref = normalizedMarkdownHref(angleHref ?? bareHref ?? "");
		if (linkText && markdownHref) {
			nodes.push(<MarkdownLink key={key} href={markdownHref} text={linkText} />);
		} else if (code) {
			nodes.push(
				<code key={key} className="rounded-sm bg-muted px-1 font-mono text-caption">
					{code}
				</code>,
			);
		} else if (boldStar || boldUnderscore) {
			nodes.push(<strong key={key}>{boldStar ?? boldUnderscore}</strong>);
		} else if (italicStar || italicUnderscore) {
			nodes.push(<em key={key}>{italicStar ?? italicUnderscore}</em>);
		} else {
			nodes.push(raw);
		}

		lastIndex = pattern.lastIndex;
	}

	if (lastIndex < text.length) {
		nodes.push(text.slice(lastIndex));
	}

	return nodes;
};

const MarkdownLink: React.FC<{ href: string; text: string }> = ({ href, text }) => {
	const anchorHref = markdownAnchorHref(href);
	const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
		if (!localPathFromMarkdownHref(href) || !isTauriRuntime()) return;
		event.preventDefault();
		void openLocalMarkdownHref(href);
	};

	return (
		<a
			href={anchorHref}
			target="_blank"
			rel="noreferrer"
			title={href}
			className="text-primary underline underline-offset-2"
			onClick={handleClick}
		>
			{text}
		</a>
	);
};

const normalizedMarkdownHref = (href: string) => {
	const trimmed = href.trim();
	if (isRemoteMarkdownHref(trimmed) || localPathFromMarkdownHref(trimmed)) return trimmed;
	return "";
};

const markdownAnchorHref = (href: string) => {
	const localPath = localPathFromMarkdownHref(href);
	if (!localPath) return href;
	return `file://${encodeFilePath(localPath)}`;
};

const openLocalMarkdownHref = async (href: string) => {
	const localPath = localPathFromMarkdownHref(href);
	if (!localPath) return;
	const { openPath } = await import("@tauri-apps/plugin-opener");
	await openPath(localPath);
};

const localPathFromMarkdownHref = (href: string) => {
	if (isAbsoluteLocalPath(href)) return stripLineSuffix(href);
	if (!isFileMarkdownHref(href)) return "";

	try {
		return stripLineSuffix(decodeURIComponent(new URL(href).pathname));
	} catch {
		return "";
	}
};

const stripLineSuffix = (path: string) => path.replace(/:\d+(?:-\d+)?$/, "");

const encodeFilePath = (path: string) =>
	path
		.split("/")
		.map((segment, index) => (index === 0 ? "" : encodeURIComponent(segment)))
		.join("/");

const isRemoteMarkdownHref = (href: string) => /^(https?:\/\/|mailto:)/i.test(href);

const isFileMarkdownHref = (href: string) => /^file:\/\//i.test(href);

const isAbsoluteLocalPath = (href: string) => href.startsWith("/") && !href.startsWith("//");

type MarkdownSegment =
	| { type: "text"; content: string }
	| { type: "code"; content: string }
	| { type: "think"; content: string };

const splitMarkdownCodeFences = (content: string) => {
	const segments: MarkdownSegment[] = [];
	const pattern = /```(?:\w+)?\n?([\s\S]*?)```/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(content)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ type: "text", content: content.slice(lastIndex, match.index) });
		}
		segments.push({ type: "code", content: match[1].trim() });
		lastIndex = pattern.lastIndex;
	}

	if (lastIndex < content.length) {
		segments.push({ type: "text", content: content.slice(lastIndex) });
	}

	return segments.length > 0 ? segments : [{ type: "text" as const, content }];
};

const splitInlineThinkTags = (content: string): MarkdownSegment[] => {
	const segments: MarkdownSegment[] = [];
	const openPattern = /<think>/gi;
	let cursor = 0;
	let openMatch: RegExpExecArray | null;

	while ((openMatch = openPattern.exec(content)) !== null) {
		if (openMatch.index > cursor) {
			segments.push({ type: "text", content: content.slice(cursor, openMatch.index) });
		}

		const start = openPattern.lastIndex;
		const closePattern = /<\/think>/gi;
		closePattern.lastIndex = start;
		const closeMatch = closePattern.exec(content);
		if (!closeMatch) {
			const thought = content.slice(start).trim();
			if (thought) segments.push({ type: "think", content: thought });
			cursor = content.length;
			break;
		}

		const thought = content.slice(start, closeMatch.index).trim();
		if (thought) segments.push({ type: "think", content: thought });
		cursor = closeMatch.index + closeMatch[0].length;
		openPattern.lastIndex = cursor;
	}

	if (cursor < content.length) {
		segments.push({ type: "text", content: content.slice(cursor) });
	}

	return segments;
};
