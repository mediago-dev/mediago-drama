import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);

const createMemoryStorage = (): Storage => {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		key: (index: number) => Array.from(values.keys())[index] ?? null,
		removeItem: (key: string) => values.delete(key),
		setItem: (key: string, value: string) => values.set(key, value),
	};
};

if (typeof globalThis.localStorage?.getItem !== "function") {
	Object.defineProperty(globalThis, "localStorage", {
		value: createMemoryStorage(),
		configurable: true,
	});
}

const createTestRect = (): DOMRect => new DOMRect(0, 0, 1, 1);

const createRectList = (rect = createTestRect()): DOMRectList =>
	({
		0: rect,
		length: 1,
		item: (index: number) => (index === 0 ? rect : null),
		[Symbol.iterator]: function* () {
			yield rect;
		},
	}) as DOMRectList;

if (typeof Range !== "undefined") {
	if (typeof Range.prototype.getBoundingClientRect !== "function") {
		Range.prototype.getBoundingClientRect = createTestRect;
	}

	if (typeof Range.prototype.getClientRects !== "function") {
		Range.prototype.getClientRects = createRectList;
	}
}

if (typeof HTMLCanvasElement !== "undefined") {
	Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
		value: () => null,
		configurable: true,
	});
}

if (typeof globalThis.ResizeObserver === "undefined") {
	class ResizeObserverMock implements ResizeObserver {
		private callback: ResizeObserverCallback;

		constructor(callback: ResizeObserverCallback) {
			this.callback = callback;
		}

		observe = (target: Element) => {
			const rect = target.getBoundingClientRect();
			const entry = {
				target,
				contentRect: rect.width || rect.height ? rect : new DOMRect(0, 0, 800, 600),
			} as ResizeObserverEntry;

			queueMicrotask(() => this.callback([entry], this));
		};
		unobserve = () => {};
		disconnect = () => {};
	}

	Object.defineProperty(globalThis, "ResizeObserver", {
		value: ResizeObserverMock,
		configurable: true,
	});
}
