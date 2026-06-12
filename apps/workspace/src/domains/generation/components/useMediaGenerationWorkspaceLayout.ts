import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { clampNumber } from "@/domains/generation/components/mediaGenerationHelpers";
import { useUIPreferencesStore } from "@/shared/stores/ui-preferences";

const inputPanelDefaultHeight = 300;
const inputPanelMinHeight = 220;
const resultPanelMinHeight = 220;

export const resizeHandleHeight = 1;
export const historyResizeHandleWidth = 1;
export const resizeKeyboardStep = 24;
export const historyPanelWidth = {
	default: 380,
	max: 520,
	min: 280,
	resultMin: 480,
	storageKey: "generation.historyPanelWidth",
} as const;

export const useMediaGenerationWorkspaceLayout = ({
	rightPaneRef,
	workspaceRef,
}: {
	rightPaneRef: React.RefObject<HTMLDivElement | null>;
	workspaceRef: React.RefObject<HTMLFormElement | null>;
}) => {
	const setStoredHistoryWidth = useUIPreferencesStore(
		(state) => state.setGenerationHistoryPanelWidth,
	);
	const setStoredInputPanelHeight = useUIPreferencesStore(
		(state) => state.setGenerationInputPanelHeight,
	);
	const [inputPanelHeight, setInputPanelHeight] = useState(() => readInputPanelHeightPreference());
	const [historyWidth, setHistoryWidth] = useState(() => readHistoryPanelWidthPreference());

	const clampInputPanelHeight = useCallback(
		(height: number, paneHeight?: number) => {
			const measuredPaneHeight =
				paneHeight ?? rightPaneRef.current?.getBoundingClientRect().height ?? 0;
			if (measuredPaneHeight <= 0) return Math.max(inputPanelMinHeight, height);

			const maxHeight = Math.max(
				inputPanelMinHeight,
				measuredPaneHeight - resultPanelMinHeight - resizeHandleHeight,
			);
			return Math.min(Math.max(height, inputPanelMinHeight), maxHeight);
		},
		[rightPaneRef],
	);

	const clampHistoryWidth = useCallback(
		(width: number, containerWidth?: number) => {
			const measuredContainerWidth =
				containerWidth ?? workspaceRef.current?.getBoundingClientRect().width ?? 0;
			const responsiveMax =
				measuredContainerWidth > 0
					? Math.min(
							historyPanelWidth.max,
							measuredContainerWidth - historyPanelWidth.resultMin - historyResizeHandleWidth,
						)
					: historyPanelWidth.max;
			const maxWidth = Math.max(historyPanelWidth.min, responsiveMax);

			return clampNumber(width, historyPanelWidth.min, maxWidth);
		},
		[workspaceRef],
	);

	useEffect(() => {
		setStoredHistoryWidth(historyWidth);
	}, [historyWidth, setStoredHistoryWidth]);

	useEffect(() => {
		setStoredInputPanelHeight(inputPanelHeight);
	}, [inputPanelHeight, setStoredInputPanelHeight]);

	useEffect(() => {
		const clampToContainer = () => {
			setHistoryWidth((width) => clampHistoryWidth(width));
		};

		clampToContainer();
		window.addEventListener("resize", clampToContainer);
		return () => window.removeEventListener("resize", clampToContainer);
	}, [clampHistoryWidth]);

	useEffect(() => {
		const clampToContainer = () => {
			setInputPanelHeight((height) => clampInputPanelHeight(height));
		};

		clampToContainer();
		window.addEventListener("resize", clampToContainer);
		return () => window.removeEventListener("resize", clampToContainer);
	}, [clampInputPanelHeight]);

	const startHistoryResize = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const workspace = workspaceRef.current;
			if (!workspace) return;

			event.preventDefault();
			const startX = event.clientX;
			const startWidth = historyWidth;
			const containerWidth = workspace.getBoundingClientRect().width;
			const previousCursor = document.body.style.cursor;
			const previousUserSelect = document.body.style.userSelect;

			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";

			const resize = (moveEvent: PointerEvent) => {
				setHistoryWidth(clampHistoryWidth(startWidth + moveEvent.clientX - startX, containerWidth));
			};
			const stopResize = () => {
				document.body.style.cursor = previousCursor;
				document.body.style.userSelect = previousUserSelect;
				window.removeEventListener("pointermove", resize);
				window.removeEventListener("pointerup", stopResize);
				window.removeEventListener("pointercancel", stopResize);
			};

			window.addEventListener("pointermove", resize);
			window.addEventListener("pointerup", stopResize);
			window.addEventListener("pointercancel", stopResize);
		},
		[clampHistoryWidth, historyWidth, workspaceRef],
	);

	const startInputPanelResize = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const pane = rightPaneRef.current;
			if (!pane) return;

			event.preventDefault();
			const startY = event.clientY;
			const startHeight = inputPanelHeight;
			const paneHeight = pane.getBoundingClientRect().height;
			const previousCursor = document.body.style.cursor;
			const previousUserSelect = document.body.style.userSelect;

			document.body.style.cursor = "row-resize";
			document.body.style.userSelect = "none";

			const resize = (moveEvent: PointerEvent) => {
				setInputPanelHeight(
					clampInputPanelHeight(startHeight + startY - moveEvent.clientY, paneHeight),
				);
			};
			const stopResize = () => {
				document.body.style.cursor = previousCursor;
				document.body.style.userSelect = previousUserSelect;
				window.removeEventListener("pointermove", resize);
				window.removeEventListener("pointerup", stopResize);
				window.removeEventListener("pointercancel", stopResize);
			};

			window.addEventListener("pointermove", resize);
			window.addEventListener("pointerup", stopResize);
			window.addEventListener("pointercancel", stopResize);
		},
		[clampInputPanelHeight, inputPanelHeight, rightPaneRef],
	);

	const nudgeHistoryWidth = useCallback(
		(delta: number) => {
			setHistoryWidth((width) => clampHistoryWidth(width + delta));
		},
		[clampHistoryWidth],
	);

	const nudgeInputPanelHeight = useCallback(
		(delta: number) => {
			setInputPanelHeight((height) => clampInputPanelHeight(height + delta));
		},
		[clampInputPanelHeight],
	);

	return {
		historyWidth,
		inputPanelHeight,
		nudgeHistoryWidth,
		nudgeInputPanelHeight,
		startHistoryResize,
		startInputPanelResize,
	};
};

const readHistoryPanelWidthPreference = () =>
	clampNumber(
		useUIPreferencesStore.getState().generationHistoryPanelWidth,
		historyPanelWidth.min,
		historyPanelWidth.max,
	);

const readInputPanelHeightPreference = () =>
	Math.max(
		useUIPreferencesStore.getState().generationInputPanelHeight || inputPanelDefaultHeight,
		inputPanelMinHeight,
	);
