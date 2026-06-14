import { Check, ChevronRight, Clipboard } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { collapseAllNested, darkStyles, defaultStyles, JsonView } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { useThemeStore } from "@/shared/stores/theme";
import type { AgentACPContentBlock } from "@/domains/agent/stores";
import { cn } from "@/shared/lib/utils";
import { byteLength, compactDiffLines, countTextLines, formatBytes, isLargeText } from "./format";
import { XtermView } from "./XtermView";

export const CodeBlock: React.FC<{ content: string }> = ({ content }) => (
	<pre className="agent-code-block max-h-64 overflow-auto whitespace-pre-wrap font-mono text-caption leading-5 text-foreground">
		<code>{content}</code>
	</pre>
);

export const TextOutputBlock: React.FC<{ label: string; text: string }> = ({ label, text }) => {
	const [expanded, setExpanded] = useState(!isLargeText(text));
	const summary = `${countTextLines(text)} lines · ${formatBytes(byteLength(text))}`;

	return (
		<section className="agent-output-block border border-border bg-ide-editor">
			<div className="flex items-center justify-between gap-2 border-b border-border bg-ide-toolbar px-2 py-1">
				<button
					type="button"
					className="flex min-w-0 items-center gap-1 text-left text-caption text-muted-foreground"
					onClick={() => setExpanded((value) => !value)}
					aria-expanded={expanded}
				>
					<ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
					<span className="truncate">{label}</span>
					<span className="shrink-0">{summary}</span>
				</button>
				<CopyButton text={text} />
			</div>
			{expanded ? <CodeBlock content={text} /> : null}
		</section>
	);
};

export const JsonViewBlock: React.FC<{ label: string; value: unknown }> = ({ label, value }) => {
	const jsonText = stringifyJson(value);
	const [expanded, setExpanded] = useState(!isLargeText(jsonText));
	const mode = useThemeStore((state) => state.mode);
	if (!isJsonViewValue(value)) {
		return <TextOutputBlock label={label} text={jsonText} />;
	}

	const summary = `${formatBytes(byteLength(jsonText))} JSON`;

	return (
		<section className="agent-output-block border border-border bg-ide-editor">
			<div className="flex items-center justify-between gap-2 border-b border-border bg-ide-toolbar px-2 py-1">
				<button
					type="button"
					className="flex min-w-0 items-center gap-1 text-left text-caption text-muted-foreground"
					onClick={() => setExpanded((value) => !value)}
					aria-expanded={expanded}
				>
					<ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
					<span className="truncate">{label}</span>
					<span className="shrink-0">{summary}</span>
				</button>
				<CopyButton text={jsonText} />
			</div>
			{expanded ? (
				<div className="max-h-80 overflow-auto px-2 py-2 font-mono text-caption leading-5 text-foreground">
					<JsonView
						data={value}
						style={tokenizedJsonStyles(mode === "dark" ? darkStyles : defaultStyles)}
						shouldExpandNode={(level) => level < 2 || collapseAllNested(level)}
						clickToExpandNode
						compactTopLevel={false}
						aria-label={label}
					/>
				</div>
			) : null}
		</section>
	);
};

export const DiffBlock: React.FC<{ block: AgentACPContentBlock }> = ({ block }) => {
	const text = [
		`--- ${block.path || "before"}`,
		block.oldText ?? "",
		`+++ ${block.path || "after"}`,
		block.newText ?? "",
	].join("\n");
	const lines = compactDiffLines([
		...(block.oldText ?? "")
			.split(/\r\n|\r|\n/)
			.map((line) => ({ kind: "remove" as const, text: line })),
		...(block.newText ?? "")
			.split(/\r\n|\r|\n/)
			.map((line) => ({ kind: "add" as const, text: line })),
	]);

	return (
		<section className="agent-output-block border border-border bg-ide-editor">
			<div className="flex items-center justify-between gap-2 border-b border-border bg-ide-toolbar px-2 py-1">
				<div className="min-w-0 text-caption text-muted-foreground">
					<span className="font-mono">{block.path || "diff"}</span>
					<span className="ml-1">
						{countTextLines(text)} lines · {formatBytes(byteLength(text))}
					</span>
				</div>
				<CopyButton text={text} />
			</div>
			<pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-caption leading-5">
				{lines.map((line, index) =>
					line.kind === "omitted" ? (
						<div key={`omitted-${index}`} className="px-2 py-1 text-muted-foreground">
							... {line.count} lines omitted ...
						</div>
					) : (
						<div
							key={`${line.kind}-${index}`}
							className={cn(
								"px-2",
								line.kind === "remove"
									? "bg-error-surface text-error-foreground"
									: "bg-success-surface text-success-foreground",
							)}
						>
							{line.kind === "remove" ? "-" : "+"}
							{line.text}
						</div>
					),
				)}
			</pre>
		</section>
	);
};

export const TerminalBlock: React.FC<{ block: AgentACPContentBlock }> = ({ block }) => {
	const text = block.text || block.terminalId || "";
	const [expanded, setExpanded] = useState(!isLargeText(text));

	return (
		<section className="agent-output-block border border-border bg-ide-editor">
			<div className="flex items-center justify-between gap-2 border-b border-border bg-ide-toolbar px-2 py-1">
				<button
					type="button"
					className="flex min-w-0 items-center gap-1 text-left text-caption text-muted-foreground"
					onClick={() => setExpanded((value) => !value)}
					aria-expanded={expanded}
				>
					<ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
					<span className="truncate">terminal</span>
					<span className="shrink-0">
						{countTextLines(text)} lines · {formatBytes(byteLength(text))}
					</span>
				</button>
				<CopyButton text={text} />
			</div>
			{expanded ? (
				<>
					<div className="max-h-80 overflow-auto bg-ide-editor text-ide-editor-foreground">
						<XtermView text={text} />
					</div>
					{block.exitCode !== undefined ? (
						<div className="border-t border-border bg-ide-toolbar px-2 py-1 text-2xs text-muted-foreground">
							exitCode {block.exitCode}
						</div>
					) : null}
				</>
			) : null}
		</section>
	);
};

const isJsonViewValue = (value: unknown): value is Record<string, unknown> | unknown[] =>
	typeof value === "object" && value !== null;

const stringifyJson = (value: unknown) => {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
};

type JsonViewStyle = NonNullable<React.ComponentProps<typeof JsonView>["style"]>;

const tokenizedJsonStyles = (base: JsonViewStyle): JsonViewStyle => ({
	...base,
	booleanValue: "agent-json-boolean",
	collapseIcon: "agent-json-icon agent-json-collapse",
	collapsedContent: "agent-json-muted",
	container: "agent-json-container",
	expandIcon: "agent-json-icon agent-json-expand",
	label: "agent-json-key",
	clickableLabel: "agent-json-key agent-json-clickable",
	nullValue: "agent-json-null",
	numberValue: "agent-json-number",
	otherValue: "agent-json-string",
	punctuation: "agent-json-punctuation",
	stringValue: "agent-json-string",
	undefinedValue: "agent-json-null",
});

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
	const [copied, setCopied] = useState(false);
	const mountedRef = useRef(true);
	const resetTimerRef = useRef<number | null>(null);

	useEffect(
		() => () => {
			mountedRef.current = false;
			if (resetTimerRef.current !== null) {
				window.clearTimeout(resetTimerRef.current);
			}
		},
		[],
	);

	return (
		<button
			type="button"
			className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-ide-editor hover:text-foreground"
			onClick={() => {
				const write = navigator.clipboard?.writeText(text);
				if (!write) return;
				void write.then(() => {
					if (!mountedRef.current) return;
					if (resetTimerRef.current !== null) {
						window.clearTimeout(resetTimerRef.current);
					}
					setCopied(true);
					resetTimerRef.current = window.setTimeout(() => {
						resetTimerRef.current = null;
						if (mountedRef.current) setCopied(false);
					}, 1200);
				});
			}}
			aria-label="复制"
		>
			{copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
		</button>
	);
};
