import type React from "react";

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

const CASCADED_PICKER_SAFE_TRIANGLE_EDGE_PADDING = 8;

export const pointerEventPoint = (event: React.PointerEvent<HTMLElement>): CascadedPickerPoint => ({
	x: event.clientX,
	y: event.clientY,
});

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
