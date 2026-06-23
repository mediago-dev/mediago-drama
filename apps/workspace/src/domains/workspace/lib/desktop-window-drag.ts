import type React from "react";
import { useCallback } from "react";
import { isDesktopRuntime } from "@/shared/desktop/runtime";
import { startDesktopWindowDrag } from "@/shared/desktop/window-drag";

export const useDesktopWindowDrag = () =>
	useCallback((event: React.PointerEvent<HTMLElement>) => {
		if (!canStartDesktopWindowDrag(event)) return;
		void startDesktopWindowDrag();
	}, []);

export const useDesktopWindowTopRegionDrag = (
	heightVariable = "--desktop-drag-region-height",
	fallbackHeight = 44,
) =>
	useCallback(
		(event: React.PointerEvent<HTMLElement>) => {
			if (!canStartDesktopWindowDrag(event)) return;
			const bounds = event.currentTarget.getBoundingClientRect();
			const dragHeight = readCssLengthPx(heightVariable, fallbackHeight);
			if (event.clientY - bounds.top > dragHeight) return;
			void startDesktopWindowDrag();
		},
		[fallbackHeight, heightVariable],
	);

const canStartDesktopWindowDrag = (event: React.PointerEvent<HTMLElement>) => {
	if (event.button !== 0 || !isDesktopRuntime()) return false;
	return !isDesktopNoDragTarget(event.target);
};

const desktopNoDragSelector = [
	"[data-desktop-no-drag]",
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

export const isDesktopNoDragTarget = (target: EventTarget | null) =>
	target instanceof Element && Boolean(target.closest(desktopNoDragSelector));

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
