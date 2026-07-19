import type React from "react";
import { useEffect, useRef, useState } from "react";

export interface CascadedPickerPoint {
	x: number;
	y: number;
}

export interface CascadedPickerRect {
	bottom: number;
	left: number;
	right: number;
	top: number;
}

export interface CascadedPickerSafeTriangleInput {
	activeRect?: CascadedPickerRect | null;
	origin?: CascadedPickerPoint | null;
	point: CascadedPickerPoint;
	submenuRect?: CascadedPickerRect | null;
}

interface CascadedPickerPendingIntent {
	mode: "forward" | "return";
	point: CascadedPickerPoint;
	sourceId: string;
}

interface CascadedPickerHoverIntentOptions {
	activeSourceId?: string;
	forwardDelayMs?: number;
	onActivateSource: (sourceId: string) => void;
	returnDelayMs?: number;
}

const CASCADED_PICKER_SAFE_TRIANGLE_EDGE_PADDING = 8;
export const CASCADED_PICKER_FORWARD_HOVER_INTENT_MS = 180;
export const CASCADED_PICKER_RETURN_DEBOUNCE_MS = 150;

/**
 * useCascadedPickerHoverIntent keeps submenu entry forgiving without making the
 * return trip feel sticky. Left-to-right movement uses the safe triangle;
 * right-to-left movement uses a short trailing debounce.
 */
export const useCascadedPickerHoverIntent = ({
	activeSourceId = "",
	forwardDelayMs = CASCADED_PICKER_FORWARD_HOVER_INTENT_MS,
	onActivateSource,
	returnDelayMs = CASCADED_PICKER_RETURN_DEBOUNCE_MS,
}: CascadedPickerHoverIntentOptions) => {
	const [suppressedSourceHoverId, setSuppressedSourceHoverId] = useState<string | null>(null);
	const sourceButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	const sourcePaneRef = useRef<HTMLElement | null>(null);
	const submenuRef = useRef<HTMLElement | null>(null);
	const safeTriangleOriginRef = useRef<{
		point: CascadedPickerPoint;
		sourceId: string;
	} | null>(null);
	const pendingIntentRef = useRef<CascadedPickerPendingIntent | null>(null);
	const activationTimerRef = useRef<number | null>(null);
	const returningFromSubmenuRef = useRef(false);
	const activeSourceIdRef = useRef(activeSourceId);
	const onActivateSourceRef = useRef(onActivateSource);
	activeSourceIdRef.current = activeSourceId;
	onActivateSourceRef.current = onActivateSource;

	const clearActivationTimer = () => {
		const timer = activationTimerRef.current;
		if (timer !== null) {
			window.clearTimeout(timer);
			activationTimerRef.current = null;
		}
		pendingIntentRef.current = null;
	};

	useEffect(() => () => clearActivationTimer(), []);

	const clearHoverIntent = () => {
		clearActivationTimer();
		returningFromSubmenuRef.current = false;
		safeTriangleOriginRef.current = null;
		setSuppressedSourceHoverId(null);
	};

	const rememberSourcePointer = (sourceId: string, point: CascadedPickerPoint) => {
		clearActivationTimer();
		returningFromSubmenuRef.current = false;
		safeTriangleOriginRef.current = { point, sourceId };
		setSuppressedSourceHoverId(null);
	};

	const activateSourceFromPointer = (sourceId: string, point: CascadedPickerPoint) => {
		if (sourceId !== activeSourceIdRef.current) {
			onActivateSourceRef.current(sourceId);
		}
		rememberSourcePointer(sourceId, point);
	};

	const scheduleSourceActivation = (
		sourceId: string,
		point: CascadedPickerPoint,
		mode: CascadedPickerPendingIntent["mode"],
	) => {
		const pendingIntent = pendingIntentRef.current;
		if (
			mode === "return" &&
			pendingIntent?.mode === mode &&
			pendingIntent.sourceId === sourceId &&
			activationTimerRef.current !== null
		) {
			pendingIntent.point = point;
			return;
		}

		clearActivationTimer();
		setSuppressedSourceHoverId(sourceId === activeSourceIdRef.current ? null : sourceId);
		pendingIntentRef.current = { mode, point, sourceId };
		activationTimerRef.current = window.setTimeout(
			() => {
				activationTimerRef.current = null;
				const intent = pendingIntentRef.current;
				pendingIntentRef.current = null;
				if (!intent) return;
				activateSourceFromPointer(intent.sourceId, intent.point);
			},
			mode === "return" ? returnDelayMs : forwardDelayMs,
		);
	};

	const shouldPreserveActiveSource = (point: CascadedPickerPoint) => {
		const currentActiveSourceId = activeSourceIdRef.current;
		const activeButton = currentActiveSourceId
			? sourceButtonRefs.current.get(currentActiveSourceId)
			: null;
		const origin =
			safeTriangleOriginRef.current?.sourceId === currentActiveSourceId
				? safeTriangleOriginRef.current.point
				: null;

		return shouldKeepCascadedPickerSourceActive({
			activeRect: activeButton?.getBoundingClientRect(),
			origin,
			point,
			submenuRect: submenuRef.current?.getBoundingClientRect(),
		});
	};

	const handleSourcePointer = (sourceId: string, point: CascadedPickerPoint) => {
		if (returningFromSubmenuRef.current) {
			scheduleSourceActivation(sourceId, point, "return");
			return;
		}

		if (sourceId === activeSourceIdRef.current) {
			rememberSourcePointer(sourceId, point);
			return;
		}

		if (shouldPreserveActiveSource(point)) {
			scheduleSourceActivation(sourceId, point, "forward");
			return;
		}

		activateSourceFromPointer(sourceId, point);
	};

	const beginReturnDebounce = () => {
		returningFromSubmenuRef.current = true;
		clearActivationTimer();
		safeTriangleOriginRef.current = null;
		setSuppressedSourceHoverId(null);
		activationTimerRef.current = window.setTimeout(() => {
			activationTimerRef.current = null;
			returningFromSubmenuRef.current = false;
		}, returnDelayMs);
	};

	const handleSourcePanePointerEnter = (event: React.PointerEvent<HTMLElement>) => {
		if (elementContainsEventTarget(submenuRef.current, event.relatedTarget)) {
			beginReturnDebounce();
		}
	};

	const handleSourcePointerEnter = (
		sourceId: string,
		event: React.PointerEvent<HTMLButtonElement>,
	) => {
		if (elementContainsEventTarget(submenuRef.current, event.relatedTarget)) {
			returningFromSubmenuRef.current = true;
		}
		handleSourcePointer(sourceId, pointerEventPoint(event));
	};

	const handleSourcePointerMove = (
		sourceId: string,
		event: React.PointerEvent<HTMLButtonElement>,
	) => handleSourcePointer(sourceId, pointerEventPoint(event));
	const handleSubmenuPointerLeave = (event: React.PointerEvent<HTMLElement>) => {
		event.stopPropagation();
		beginReturnDebounce();
	};

	const activateSource = (sourceId: string) => {
		onActivateSourceRef.current(sourceId);
		clearHoverIntent();
	};

	const registerSourceButton = (sourceId: string, node: HTMLButtonElement | null) => {
		if (node) sourceButtonRefs.current.set(sourceId, node);
		else sourceButtonRefs.current.delete(sourceId);
	};

	return {
		activateSource,
		clearHoverIntent,
		handleSourcePanePointerEnter,
		handleSourcePointerEnter,
		handleSourcePointerMove,
		handleSubmenuPointerLeave,
		registerSourceButton,
		sourcePaneRef,
		submenuRef,
		suppressedSourceHoverId,
	};
};

export const pointerEventPoint = (event: React.PointerEvent<HTMLElement>): CascadedPickerPoint => ({
	x: event.clientX,
	y: event.clientY,
});

const elementContainsEventTarget = (element: HTMLElement | null, target: EventTarget | null) =>
	element !== null && target instanceof Node && element.contains(target);

export const shouldKeepCascadedPickerSourceActive = ({
	activeRect,
	origin,
	point,
	submenuRect,
}: CascadedPickerSafeTriangleInput) => {
	if (!activeRect || !origin || !submenuRect) return false;
	const verticalPadding = Math.max(
		CASCADED_PICKER_SAFE_TRIANGLE_EDGE_PADDING,
		activeRect.bottom - activeRect.top,
	);
	if (origin.y < activeRect.top - verticalPadding) return false;
	if (origin.y > activeRect.bottom + verticalPadding) return false;
	if (point.x <= origin.x) return false;
	if (point.x >= submenuRect.left) return false;

	return pointInTriangle(
		point,
		origin,
		{
			x: submenuRect.left,
			y: submenuRect.top - verticalPadding,
		},
		{
			x: submenuRect.left,
			y: submenuRect.bottom + verticalPadding,
		},
	);
};

const pointInTriangle = (
	point: CascadedPickerPoint,
	first: CascadedPickerPoint,
	second: CascadedPickerPoint,
	third: CascadedPickerPoint,
) => {
	const firstSign = triangleSign(point, first, second);
	const secondSign = triangleSign(point, second, third);
	const thirdSign = triangleSign(point, third, first);
	const hasNegative = firstSign < 0 || secondSign < 0 || thirdSign < 0;
	const hasPositive = firstSign > 0 || secondSign > 0 || thirdSign > 0;
	return !(hasNegative && hasPositive);
};

const triangleSign = (
	first: CascadedPickerPoint,
	second: CascadedPickerPoint,
	third: CascadedPickerPoint,
) => (first.x - third.x) * (second.y - third.y) - (second.x - third.x) * (first.y - third.y);

const cascadedPickerWheelDeltaY = (event: React.WheelEvent, pageHeight: number) => {
	switch (event.deltaMode) {
		case WheelEvent.DOM_DELTA_LINE:
			return event.deltaY * 16;
		case WheelEvent.DOM_DELTA_PAGE:
			return event.deltaY * pageHeight;
		default:
			return event.deltaY;
	}
};

/**
 * scrollCascadedPickerListOnWheel forwards a wheel event to its own list.
 *
 * Cascaded pickers render their popover in a portal that lands outside the
 * enclosing modal dialog's `react-remove-scroll` guard, which blocks native
 * wheel scrolling on the list. Manually applying the delta keeps the options
 * scrollable while still preventing the wheel event from leaking to the page.
 */
export const scrollCascadedPickerListOnWheel = (
	event: React.WheelEvent<HTMLDivElement>,
	onScroll?: () => void,
) => {
	const node = event.currentTarget;
	const maxScrollTop = node.scrollHeight - node.clientHeight;
	if (maxScrollTop <= 0) return;

	const deltaY = cascadedPickerWheelDeltaY(event, node.clientHeight);
	if (deltaY === 0) return;

	const nextScrollTop = Math.max(0, Math.min(maxScrollTop, node.scrollTop + deltaY));
	if (Math.abs(nextScrollTop - node.scrollTop) < 0.5) return;

	event.preventDefault();
	event.stopPropagation();
	node.scrollTop = nextScrollTop;
	onScroll?.();
};
