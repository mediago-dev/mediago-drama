import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageStickerEditorDialog } from "./ImageStickerEditorDialog";

vi.mock("fabric", () => {
	let lastActiveObject: MockFabricObject | null = null;
	let lastCanvasState: MockCanvasState | null = null;
	let lastCanvasOptions: Record<string, unknown> | null = null;

	interface MockCanvasState {
		brushColor: string | null;
		brushWidth: number | null;
		defaultCursor: string;
		hoverCursor: string;
		isDrawingMode: boolean;
		selection: boolean;
	}

	class MockFabricObject {
		static customProperties: string[] = [];

		angle = 0;
		controls = { mtr: { cursorStyle: "crosshair" } };
		editorRole?: string;
		height = 0;
		left = 0;
		opacity = 1;
		scaleX = 1;
		scaleY = 1;
		top = 0;
		width = 0;

		set(values: Record<string, unknown>) {
			Object.assign(this, values);
			return this;
		}

		setCoords() {}

		getCenterPoint() {
			return { x: this.left, y: this.top };
		}

		getScaledWidth() {
			return this.width * this.scaleX;
		}

		getScaledHeight() {
			return this.height * this.scaleY;
		}
	}

	class MockFabricImage extends MockFabricObject {
		private element: CanvasImageSource;

		constructor(element: CanvasImageSource) {
			super();
			this.element = element;
			const image = element as { naturalHeight?: number; naturalWidth?: number };
			this.width = image.naturalWidth ?? 320;
			this.height = image.naturalHeight ?? 180;
		}

		getElement() {
			return this.element;
		}

		setElement(element: CanvasImageSource, size?: { height?: number; width?: number }) {
			this.element = element;
			this.width = size?.width ?? this.width;
			this.height = size?.height ?? this.height;
		}
	}

	class MockRect extends MockFabricObject {
		constructor(options: Record<string, unknown>) {
			super();
			this.set(options);
		}
	}

	class MockTextbox extends MockRect {}

	class MockPencilBrush {
		color = "";
		width = 1;

		constructor(_canvas: MockCanvas) {}
	}

	class MockCanvas {
		private activeObject: MockFabricObject | null = null;
		private canvasState: MockCanvasState = {
			brushColor: null,
			brushWidth: null,
			defaultCursor: "default",
			hoverCursor: "move",
			isDrawingMode: false,
			selection: true,
		};
		private drawingBrush: MockPencilBrush | null = null;
		private objects: MockFabricObject[] = [];
		private width = 1;
		private height = 1;

		constructor(_element: HTMLCanvasElement, options?: Record<string, unknown>) {
			lastCanvasOptions = options ?? null;
			lastCanvasState = this.canvasState;
		}

		get defaultCursor() {
			return this.canvasState.defaultCursor;
		}

		set defaultCursor(value: string) {
			this.canvasState.defaultCursor = value;
		}

		get freeDrawingBrush() {
			return this.drawingBrush;
		}

		set freeDrawingBrush(value: MockPencilBrush | null) {
			this.drawingBrush = value;
			this.canvasState.brushColor = value?.color ?? null;
			this.canvasState.brushWidth = value?.width ?? null;
		}

		get hoverCursor() {
			return this.canvasState.hoverCursor;
		}

		set hoverCursor(value: string) {
			this.canvasState.hoverCursor = value;
		}

		get isDrawingMode() {
			return this.canvasState.isDrawingMode;
		}

		set isDrawingMode(value: boolean) {
			this.canvasState.isDrawingMode = value;
		}

		get selection() {
			return this.canvasState.selection;
		}

		set selection(value: boolean) {
			this.canvasState.selection = value;
		}

		add(...objects: MockFabricObject[]) {
			this.objects.push(...objects);
		}

		bringObjectForward() {
			return true;
		}

		discardActiveObject() {
			this.activeObject = null;
			lastActiveObject = null;
		}

		dispose() {
			return Promise.resolve(true);
		}

		getActiveObject() {
			return this.activeObject;
		}

		getActiveObjects() {
			return this.activeObject ? [this.activeObject] : [];
		}

		getHeight() {
			return this.height;
		}

		getObjects() {
			return this.objects;
		}

		getWidth() {
			return this.width;
		}

		loadFromJSON() {
			return Promise.resolve();
		}

		on() {
			return () => {};
		}

		remove(...objects: MockFabricObject[]) {
			this.objects = this.objects.filter((object) => !objects.includes(object));
		}

		renderAll() {}

		requestRenderAll() {}

		sendObjectBackwards() {
			return true;
		}

		sendObjectToBack(_object: MockFabricObject) {}

		setActiveObject(object: MockFabricObject) {
			this.activeObject = object;
			lastActiveObject = object;
		}

		setDimensions(size: { height: number; width: number }) {
			this.width = size.width;
			this.height = size.height;
		}

		toDataURL() {
			return "data:image/png;base64,edited";
		}

		toObject() {
			return { objects: this.objects.map((object) => ({ editorRole: object.editorRole })) };
		}
	}

	return {
		Canvas: MockCanvas,
		FabricImage: MockFabricImage,
		FabricObject: MockFabricObject,
		PencilBrush: MockPencilBrush,
		Rect: MockRect,
		Textbox: MockTextbox,
		__getLastActiveObject: () => lastActiveObject,
		__getLastCanvasState: () => lastCanvasState,
		__getLastCanvasOptions: () => lastCanvasOptions,
	};
});

class TestImage {
	crossOrigin: string | null = null;
	height = 180;
	naturalHeight = 180;
	naturalWidth = 320;
	onerror: (() => void) | null = null;
	onload: (() => void) | null = null;
	width = 320;

	set src(_value: string) {
		queueMicrotask(() => this.onload?.());
	}
}

describe("ImageStickerEditorDialog", () => {
	beforeEach(() => {
		vi.stubGlobal("Image", TestImage);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("waits for the canvas node before initializing Fabric", async () => {
		render(
			<ImageStickerEditorDialog
				open
				source="data:image/png;base64,source"
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		expect(screen.queryByText("图片编辑器初始化失败，请关闭后重试。")).not.toBeInTheDocument();

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
		});
	});

	it("allows corner handles to resize without preserving aspect ratio by default", async () => {
		render(
			<ImageStickerEditorDialog
				open
				source="data:image/png;base64,source"
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
		});

		const fabricModule = (await import("fabric")) as unknown as {
			__getLastCanvasOptions: () => Record<string, unknown> | null;
		};

		expect(fabricModule.__getLastCanvasOptions()).toMatchObject({ uniformScaling: false });
	});

	it("switches into brush mode and applies brush controls", async () => {
		render(
			<ImageStickerEditorDialog
				open
				source="data:image/png;base64,source"
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
		});

		fireEvent.click(screen.getByRole("button", { name: "画笔" }));

		const fabricModule = (await import("fabric")) as unknown as {
			__getLastCanvasState: () => {
				brushColor: string | null;
				brushWidth: number | null;
				isDrawingMode: boolean;
				selection: boolean;
			} | null;
		};

		expect(fabricModule.__getLastCanvasState()).toMatchObject({
			brushColor: "#ef4444",
			brushWidth: 6,
			isDrawingMode: true,
			selection: false,
		});

		fireEvent.change(screen.getByLabelText("画笔粗细"), { target: { value: "14" } });
		fireEvent.click(screen.getByRole("button", { name: "画笔颜色 #22c55e" }));

		expect(fabricModule.__getLastCanvasState()).toMatchObject({
			brushColor: "#22c55e",
			brushWidth: 14,
			isDrawingMode: true,
			selection: false,
		});

		fireEvent.click(screen.getByRole("button", { name: "选择" }));

		expect(fabricModule.__getLastCanvasState()).toMatchObject({
			isDrawingMode: false,
			selection: true,
		});
	});

	it("shows a load error when opened without an image source", () => {
		render(<ImageStickerEditorDialog open source="" onOpenChange={vi.fn()} onSave={vi.fn()} />);

		expect(screen.getByRole("alert")).toHaveTextContent("图片载入失败，找不到可编辑的图片源。");
		expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
	});

	it("enables rectangle color controls for selected rectangles", async () => {
		render(
			<ImageStickerEditorDialog
				open
				source="data:image/png;base64,source"
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
		});

		fireEvent.click(screen.getByRole("button", { name: "矩形" }));
		fireEvent.click(screen.getByRole("button", { name: "矩形颜色 #ef4444" }));

		expect(screen.getByLabelText("自定义矩形颜色")).toHaveValue("#ef4444");
	});

	it("enables rectangle rotation controls for selected rectangles", async () => {
		render(
			<ImageStickerEditorDialog
				open
				source="data:image/png;base64,source"
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
		});

		fireEvent.click(screen.getByRole("button", { name: "矩形" }));
		fireEvent.change(screen.getByLabelText("矩形旋转角度"), { target: { value: "45" } });

		expect(screen.getByLabelText("矩形旋转角度")).toHaveValue("45");
		expect(screen.getByText("45°")).toBeInTheDocument();
	});

	it("uses a rotation cursor for the rotate handle", async () => {
		render(
			<ImageStickerEditorDialog
				open
				source="data:image/png;base64,source"
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
		});

		fireEvent.click(screen.getByRole("button", { name: "矩形" }));

		const fabricModule = (await import("fabric")) as unknown as {
			__getLastActiveObject: () => { controls: { mtr: { cursorStyle: string } } } | null;
		};
		const cursorStyle = fabricModule.__getLastActiveObject()?.controls.mtr.cursorStyle;

		expect(cursorStyle).toBe("grab");
	});
});
