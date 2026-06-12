import type React from "react";
import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const useTauriWindowDrag = () =>
	useCallback((event: React.PointerEvent<HTMLElement>) => {
		if (!canStartTauriWindowDrag(event)) return;
		void getCurrentWindow().startDragging();
	}, []);

export const useTauriWindowTopRegionDrag = (
	heightVariable = "--tauri-drag-region-height",
	fallbackHeight = 44,
) =>
	useCallback(
		(event: React.PointerEvent<HTMLElement>) => {
			if (!canStartTauriWindowDrag(event)) return;
			const bounds = event.currentTarget.getBoundingClientRect();
			const dragHeight = readCssLengthPx(heightVariable, fallbackHeight);
			if (event.clientY - bounds.top > dragHeight) return;
			void getCurrentWindow().startDragging();
		},
		[fallbackHeight, heightVariable],
	);

const canStartTauriWindowDrag = (event: React.PointerEvent<HTMLElement>) => {
	if (event.button !== 0 || !("__TAURI_INTERNALS__" in window)) return false;
	return !isTauriNoDragTarget(event.target);
};

const tauriNoDragSelector = [
	"[data-tauri-no-drag]",
	"button",
	"a[href]",
	"input",
	"select",
	"textarea",
	"summary",
	"[role='button']",
	"[role='link']",
	"[contenteditable='true']",
].join(",");

export const isTauriNoDragTarget = (target: EventTarget | null) =>
	target instanceof Element && Boolean(target.closest(tauriNoDragSelector));

const readCssLengthPx = (variableName: string, fallback: number) => {
	const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
	const numeric = Number.parseFloat(value);
	if (!Number.isFinite(numeric)) return fallback;
	if (value.endsWith("rem")) {
		const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
		return Number.isFinite(rootFontSize) ? numeric * rootFontSize : fallback;
	}
	if (value.endsWith("em")) {
		const bodyFontSize = Number.parseFloat(getComputedStyle(document.body).fontSize);
		return Number.isFinite(bodyFontSize) ? numeric * bodyFontSize : fallback;
	}
	return numeric;
};
