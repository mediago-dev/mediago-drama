import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { useThemeStore } from "@/shared/stores/theme";
import { stripAnsiEscape } from "./format";

interface XtermViewProps {
	text: string;
}

export const XtermView: React.FC<XtermViewProps> = ({ text }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const writtenTextRef = useRef("");
	const mode = useThemeStore((state) => state.mode);
	const rows = useMemo(() => estimateTerminalRows(text), [text]);
	const height = terminalHeight(rows);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const terminal = new Terminal({
			convertEol: true,
			cursorBlink: false,
			disableStdin: true,
			fontFamily: cssVar("--font-family-mono"),
			fontSize: 11,
			lineHeight: 1.45,
			rows,
			scrollback: 5000,
			theme: readTerminalTheme(),
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(container);
		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;

		const fit = () => {
			try {
				fitAddon.fit();
			} catch {
				// xterm can throw while the element is briefly detached during React layout work.
			}
		};
		fit();
		const resizeObserver = new ResizeObserver(fit);
		resizeObserver.observe(container);

		return () => {
			resizeObserver.disconnect();
			terminal.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
			writtenTextRef.current = "";
		};
	}, []);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal) return;
		window.requestAnimationFrame(() => fitAddonRef.current?.fit());
	}, [height]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal) return;

		const previous = writtenTextRef.current;
		if (text.startsWith(previous)) {
			const delta = text.slice(previous.length);
			if (delta) terminal.write(delta);
		} else {
			terminal.clear();
			terminal.write(text);
		}
		writtenTextRef.current = text;
	}, [text]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal) return;
		terminal.options.theme = readTerminalTheme();
		terminal.options.fontFamily = cssVar("--font-family-mono");
		fitAddonRef.current?.fit();
	}, [mode]);

	return (
		<div
			ref={containerRef}
			className="box-border w-full overflow-hidden px-2 py-2"
			style={{ height }}
		/>
	);
};

const minRows = 3;
const maxRows = 12;
const linePixelHeight = 16;
const verticalPadding = 16;

const estimateTerminalRows = (text: string) => {
	if (!text) return minRows;
	const visualRows = text.split(/\r\n|\r|\n/).reduce((count, line) => {
		const cleanLength = stripAnsiEscape(line).length;
		return count + Math.max(1, Math.ceil(cleanLength / 120));
	}, 0);
	return Math.min(maxRows, Math.max(minRows, visualRows));
};

const terminalHeight = (rows: number) => rows * linePixelHeight + verticalPadding;

const cssVar = (name: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const readTerminalTheme = (): ITheme => ({
	background: cssVar("--ide-editor"),
	black: cssVar("--foreground"),
	blue: cssVar("--info-foreground"),
	brightBlack: cssVar("--muted-foreground"),
	brightBlue: cssVar("--info-foreground"),
	brightCyan: cssVar("--info-foreground"),
	brightGreen: cssVar("--success-foreground"),
	brightMagenta: cssVar("--secondary-foreground"),
	brightRed: cssVar("--error-foreground"),
	brightWhite: cssVar("--foreground"),
	brightYellow: cssVar("--warning-foreground"),
	cursor: cssVar("--ring"),
	cyan: cssVar("--info-foreground"),
	foreground: cssVar("--ide-editor-foreground"),
	green: cssVar("--success-foreground"),
	magenta: cssVar("--secondary-foreground"),
	red: cssVar("--error-foreground"),
	selectionBackground: cssVar("--ide-selection"),
	white: cssVar("--foreground"),
	yellow: cssVar("--warning-foreground"),
});
