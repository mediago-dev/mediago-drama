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
