import type React from "react";
import { useCallback } from "react";
import {
	useTauriWindowDrag,
	useTauriWindowTopRegionDrag,
} from "@/domains/workspace/lib/tauri-window-drag";
import { cn } from "@/shared/lib/utils";
import { useUIPreferencesStore } from "@/shared/stores/ui-preferences";

export const workspaceSidebarWidth = {
	default: 260,
	max: 420,
	min: 220,
	resizeStep: 12,
} as const;

interface SidebarContentLayoutProps {
	children: React.ReactNode;
	className?: string;
	contentClassName?: string;
	contentInset?: boolean;
	mainClassName?: string;
	maxSidebarWidth?: number;
	minSidebarWidth?: number;
	onSidebarWidthChange?: (width: number) => void;
	resizeLabel?: string;
	resizeStep?: number;
	showTauriDragRegion?: boolean;
	sidebar?: React.ReactNode;
	sidebarClassName?: string;
	sidebarHidden?: boolean;
	sidebarWidth?: number | string;
	style?: React.CSSProperties;
}

export const SidebarContentLayout: React.FC<SidebarContentLayoutProps> = ({
	children,
	className,
	contentClassName,
	contentInset = false,
	mainClassName,
	maxSidebarWidth = workspaceSidebarWidth.max,
	minSidebarWidth = workspaceSidebarWidth.min,
	onSidebarWidthChange,
	resizeLabel = "调整侧边栏宽度",
	resizeStep = workspaceSidebarWidth.resizeStep,
	showTauriDragRegion = false,
	sidebar,
	sidebarClassName,
	sidebarHidden = false,
	sidebarWidth = "var(--workspace-sidebar-default-width)",
	style,
}) => {
	const resolvedSidebarWidth = resolveSidebarWidth(sidebarWidth);
	const startSidebarWindowDrag = useTauriWindowTopRegionDrag();
	const layoutStyle = {
		...style,
		"--workspace-sidebar-width": sidebarHidden ? "0px" : resolvedSidebarWidth,
	} as React.CSSProperties;
	const canResizeSidebar = Boolean(
		onSidebarWidthChange && typeof sidebarWidth === "number" && !sidebarHidden,
	);

	return (
		<div
			className={cn("flex h-full w-full overflow-hidden bg-background text-foreground", className)}
			style={layoutStyle}
		>
			{showTauriDragRegion ? <TauriWindowDragRegion /> : null}
			{sidebar ? (
				<aside
					className={cn(
						"native-sidebar-panel tauri-sidebar-chrome-offset relative h-full shrink-0 overflow-hidden transition-[width,transform,opacity] duration-200 ease-out",
						sidebarHidden && "pointer-events-none -translate-x-full opacity-0",
						sidebarClassName,
					)}
					style={{ width: sidebarHidden ? 0 : resolvedSidebarWidth }}
					aria-hidden={sidebarHidden}
					onPointerDown={startSidebarWindowDrag}
				>
					{sidebar}
					{canResizeSidebar ? (
						<SidebarResizeHandle
							label={resizeLabel}
							maxWidth={maxSidebarWidth}
							minWidth={minSidebarWidth}
							step={resizeStep}
							width={sidebarWidth as number}
							onWidthChange={onSidebarWidthChange as (width: number) => void}
						/>
					) : null}
				</aside>
			) : null}
			<section
				className={cn(
					"flex min-w-0 flex-1 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground",
					contentInset && "rounded-l-2xl border-l border-border",
					contentClassName,
				)}
			>
				<main className={cn("min-h-0 flex-1 overflow-hidden", mainClassName)}>{children}</main>
			</section>
		</div>
	);
};

const TauriWindowDragRegion: React.FC = () => {
	const startWindowDrag = useTauriWindowDrag();

	return (
		<div
			className="tauri-window-drag-region"
			data-tauri-drag-region
			aria-hidden="true"
			onPointerDown={startWindowDrag}
		/>
	);
};

export const clampSidebarWidth = (width: number, minWidth: number, maxWidth: number) =>
	Math.min(maxWidth, Math.max(minWidth, Math.round(width)));

export const useWorkspaceSidebarWidth = () => {
	const width = useUIPreferencesStore((state) =>
		clampSidebarWidth(
			state.workspaceSidebarWidth,
			workspaceSidebarWidth.min,
			workspaceSidebarWidth.max,
		),
	);
	const setStoredWidth = useUIPreferencesStore((state) => state.setWorkspaceSidebarWidth);

	const updateWidth = useCallback(
		(nextWidth: number) => {
			setStoredWidth(
				clampSidebarWidth(nextWidth, workspaceSidebarWidth.min, workspaceSidebarWidth.max),
			);
		},
		[setStoredWidth],
	);

	return [width, updateWidth] as const;
};

const SidebarResizeHandle: React.FC<{
	label: string;
	maxWidth: number;
	minWidth: number;
	onWidthChange: (width: number) => void;
	step: number;
	width: number;
}> = ({ label, maxWidth, minWidth, onWidthChange, step, width }) => {
	const startResize = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			const startX = event.clientX;
			const startWidth = width;
			const originalCursor = document.body.style.cursor;
			const originalUserSelect = document.body.style.userSelect;

			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";

			const move = (moveEvent: PointerEvent) => {
				onWidthChange(
					clampSidebarWidth(startWidth + moveEvent.clientX - startX, minWidth, maxWidth),
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
		[maxWidth, minWidth, onWidthChange, width],
	);

	const resizeWithKeyboard = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				onWidthChange(clampSidebarWidth(width - step, minWidth, maxWidth));
			} else if (event.key === "ArrowRight") {
				event.preventDefault();
				onWidthChange(clampSidebarWidth(width + step, minWidth, maxWidth));
			} else if (event.key === "Home") {
				event.preventDefault();
				onWidthChange(minWidth);
			} else if (event.key === "End") {
				event.preventDefault();
				onWidthChange(maxWidth);
			}
		},
		[maxWidth, minWidth, onWidthChange, step, width],
	);

	return (
		<div
			role="separator"
			aria-label={label}
			aria-orientation="vertical"
			aria-valuemin={minWidth}
			aria-valuemax={maxWidth}
			aria-valuenow={width}
			tabIndex={0}
			data-tauri-no-drag
			onPointerDown={startResize}
			onKeyDown={resizeWithKeyboard}
			className="navigator-resize-handle absolute inset-y-0 right-0 z-40 w-3 cursor-col-resize touch-none outline-none"
		>
			<span className="navigator-resize-line absolute inset-y-0 right-0 rounded-full" />
		</div>
	);
};

const resolveSidebarWidth = (sidebarWidth: number | string) =>
	typeof sidebarWidth === "number" ? `${sidebarWidth}px` : sidebarWidth;
