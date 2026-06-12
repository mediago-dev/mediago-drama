import type React from "react";
import { useCallback } from "react";
import { clampSidebarWidth } from "@/domains/workspace/components/SidebarContentLayout";
import { useUIPreferencesStore } from "@/shared/stores/ui-preferences";

const generationInspectorWidth = {
	default: 448,
	max: 576,
	min: 320,
	resizeStep: 12,
} as const;

export const useGenerationInspectorWidth = () => {
	const width = useUIPreferencesStore((state) =>
		clampSidebarWidth(
			state.generationInspectorWidth,
			generationInspectorWidth.min,
			generationInspectorWidth.max,
		),
	);
	const setStoredWidth = useUIPreferencesStore((state) => state.setGenerationInspectorWidth);

	const updateWidth = useCallback(
		(nextWidth: number) => {
			setStoredWidth(
				clampSidebarWidth(nextWidth, generationInspectorWidth.min, generationInspectorWidth.max),
			);
		},
		[setStoredWidth],
	);

	return [width, updateWidth] as const;
};

export const GenerationInspectorResizeHandle: React.FC<{
	onWidthChange: (width: number) => void;
	width: number;
}> = ({ onWidthChange, width }) => {
	const startResize = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = width;
			const originalCursor = document.body.style.cursor;
			const originalUserSelect = document.body.style.userSelect;

			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";

			const move = (moveEvent: PointerEvent) => {
				onWidthChange(
					clampSidebarWidth(
						startWidth - (moveEvent.clientX - startX),
						generationInspectorWidth.min,
						generationInspectorWidth.max,
					),
				);
			};

			const stop = () => {
				document.body.style.cursor = originalCursor;
				document.body.style.userSelect = originalUserSelect;
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", stop);
				window.removeEventListener("pointercancel", stop);
			};

			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", stop);
			window.addEventListener("pointercancel", stop);
		},
		[onWidthChange, width],
	);

	const resizeWithKeyboard = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				onWidthChange(width + generationInspectorWidth.resizeStep);
			} else if (event.key === "ArrowRight") {
				event.preventDefault();
				onWidthChange(width - generationInspectorWidth.resizeStep);
			} else if (event.key === "Home") {
				event.preventDefault();
				onWidthChange(generationInspectorWidth.min);
			} else if (event.key === "End") {
				event.preventDefault();
				onWidthChange(generationInspectorWidth.max);
			}
		},
		[onWidthChange, width],
	);

	return (
		<div
			role="separator"
			aria-label="调整生成侧边栏宽度"
			aria-orientation="vertical"
			aria-valuemin={generationInspectorWidth.min}
			aria-valuemax={generationInspectorWidth.max}
			aria-valuenow={width}
			tabIndex={0}
			onPointerDown={startResize}
			onKeyDown={resizeWithKeyboard}
			className="navigator-resize-handle absolute inset-y-0 left-0 z-40 w-3 cursor-col-resize touch-none outline-none"
		>
			<span className="navigator-resize-line absolute inset-y-0 left-0 rounded-full" />
		</div>
	);
};
