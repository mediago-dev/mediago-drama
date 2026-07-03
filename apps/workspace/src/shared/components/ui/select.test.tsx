import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

describe("SelectItem", () => {
	beforeEach(() => {
		ensurePointerCaptureMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("renders options without a selected item indicator", async () => {
		render(
			<Select defaultValue="default">
				<SelectTrigger aria-label="模型">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="default">默认样式</SelectItem>
					<SelectItem value="plain">普通样式</SelectItem>
				</SelectContent>
			</Select>,
		);

		fireEvent.pointerDown(screen.getByRole("combobox", { name: "模型" }), {
			button: 0,
			ctrlKey: false,
			pageX: 0,
			pageY: 0,
			pointerId: 1,
			pointerType: "mouse",
		});

		const defaultOption = await screen.findByRole("option", { name: "默认样式" });
		const plainOption = screen.getByRole("option", { name: "普通样式" });

		expect(defaultOption.querySelector("[data-select-item-indicator]")).toBeNull();
		expect(defaultOption.className).toContain("pl-2");
		expect(plainOption.className).toContain("pl-2");
	});
});

const ensurePointerCaptureMocks = () => {
	const pointerCaptureMethods = {
		hasPointerCapture: () => false,
		releasePointerCapture: () => undefined,
		scrollIntoView: () => undefined,
		setPointerCapture: () => undefined,
	};

	for (const [methodName, implementation] of Object.entries(pointerCaptureMethods)) {
		if (methodName in HTMLElement.prototype) continue;
		Object.defineProperty(HTMLElement.prototype, methodName, {
			configurable: true,
			value: implementation,
		});
	}
};
