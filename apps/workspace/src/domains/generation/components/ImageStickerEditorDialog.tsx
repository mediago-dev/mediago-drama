import {
	Canvas,
	FabricImage,
	FabricObject,
	PencilBrush,
	Rect,
	Textbox,
	type FabricObject as FabricObjectInstance,
} from "fabric";
import type React from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ImageStickerEditorDialogView } from "./ImageStickerEditorDialogView";

export interface ImageStickerEditorSaveResult {
	file: File;
	mimeType: string;
}

export interface ImageStickerEditorDialogProps {
	onOpenChange: (open: boolean) => void;
	onSave: (result: ImageStickerEditorSaveResult) => Promise<void> | void;
	open: boolean;
	source: string;
	title?: string;
}

type EditorRole = "base" | "drawing" | "mosaic" | "shape" | "sticker" | "text";
type EditorObject = FabricObjectInstance & { editorRole?: EditorRole; isEditing?: boolean };
type EditorImageObject = FabricImage & EditorObject;
type LayerSummary = Record<Exclude<EditorRole, "base">, number>;
type EditorTool = "brush" | "select";
type EditorPhase = "closed" | "loading" | "ready" | "loadError";

interface EditorSelectionState {
	hasShapeSelection: boolean;
	layerSummary: LayerSummary;
	selectionCount: number;
	selectedOpacity: number;
	selectedShapeAngle: number;
	selectedShapeColor: string;
}

interface EditorDialogState extends EditorSelectionState {
	activeTool: EditorTool;
	brushColor: string;
	brushWidth: number;
	busyTool: string | null;
	canRedo: boolean;
	canUndo: boolean;
	canvasElement: HTMLCanvasElement | null;
	canvasSize: { height: number; width: number };
	loadError: string | null;
	phase: EditorPhase;
	saveError: string | null;
	saving: boolean;
}

type EditorDialogAction =
	| { canvasElement: HTMLCanvasElement | null; type: "canvasElementChanged" }
	| { canRedo: boolean; canUndo: boolean; type: "historyChanged" }
	| { activeTool: EditorTool; type: "activeToolChanged" }
	| { brushColor: string; type: "brushColorChanged" }
	| { brushWidth: number; type: "brushWidthChanged" }
	| { busyTool: string | null; type: "busyToolChanged" }
	| { loadError: string; type: "loadFailed" }
	| { canvasSize: { height: number; width: number }; type: "loadSucceeded" }
	| { type: "openReset" }
	| { type: "closedReset" }
	| { saveError: string | null; type: "saveErrorChanged" }
	| { saving: boolean; type: "savingChanged" }
	| { selection: EditorSelectionState; type: "selectionChanged" }
	| { selectedOpacity: number; type: "selectedOpacityChanged" }
	| { selectedShapeAngle: number; type: "selectedShapeAngleChanged" }
	| { selectedShapeColor: string; type: "selectedShapeColorChanged" };

const editorRoleProperty = "editorRole";
const maxCanvasWidth = 960;
const maxCanvasHeight = 640;
const maxHistorySnapshots = 80;
const imageLoadTimeoutMs = 12_000;
const mosaicBlockSize = 12;
const defaultRectangleFill = "#0ea5e9";
const defaultRectangleStroke = "#0369a1";
const defaultShapeAngle = 0;
const defaultBrushColor = "#ef4444";
const defaultBrushWidth = 6;
const rotateControlCursor = "grab";
const emptyLayerSummary: LayerSummary = {
	drawing: 0,
	mosaic: 0,
	shape: 0,
	sticker: 0,
	text: 0,
};
const initialSelectionState: EditorSelectionState = {
	hasShapeSelection: false,
	layerSummary: emptyLayerSummary,
	selectionCount: 0,
	selectedOpacity: 100,
	selectedShapeAngle: defaultShapeAngle,
	selectedShapeColor: defaultRectangleFill,
};
const initialEditorDialogState: EditorDialogState = {
	...initialSelectionState,
	activeTool: "select",
	brushColor: defaultBrushColor,
	brushWidth: defaultBrushWidth,
	busyTool: null,
	canRedo: false,
	canUndo: false,
	canvasElement: null,
	canvasSize: { height: 0, width: 0 },
	loadError: null,
	phase: "closed",
	saveError: null,
	saving: false,
};

const editorDialogReducer = (
	state: EditorDialogState,
	action: EditorDialogAction,
): EditorDialogState => {
	switch (action.type) {
		case "activeToolChanged":
			return { ...state, activeTool: action.activeTool };
		case "brushColorChanged":
			return { ...state, brushColor: action.brushColor };
		case "brushWidthChanged":
			return { ...state, brushWidth: action.brushWidth };
		case "busyToolChanged":
			return { ...state, busyTool: action.busyTool };
		case "canvasElementChanged":
			return { ...state, canvasElement: action.canvasElement };
		case "closedReset":
			return initialEditorDialogState;
		case "historyChanged":
			return { ...state, canRedo: action.canRedo, canUndo: action.canUndo };
		case "loadFailed":
			return {
				...state,
				...initialSelectionState,
				canvasSize: { height: 0, width: 0 },
				loadError: action.loadError,
				phase: "loadError",
			};
		case "loadSucceeded":
			return {
				...state,
				canvasSize: action.canvasSize,
				loadError: null,
				phase: "ready",
			};
		case "openReset":
			return {
				...initialEditorDialogState,
				canvasElement: state.canvasElement,
				phase: "loading",
			};
		case "saveErrorChanged":
			return { ...state, saveError: action.saveError };
		case "savingChanged":
			return { ...state, saving: action.saving };
		case "selectionChanged":
			return { ...state, ...action.selection };
		case "selectedOpacityChanged":
			return { ...state, selectedOpacity: action.selectedOpacity };
		case "selectedShapeAngleChanged":
			return { ...state, selectedShapeAngle: action.selectedShapeAngle };
		case "selectedShapeColorChanged":
			return { ...state, selectedShapeColor: action.selectedShapeColor };
	}
};

FabricObject.customProperties = Array.from(
	new Set([...FabricObject.customProperties, editorRoleProperty]),
);

export const ImageStickerEditorDialog: React.FC<ImageStickerEditorDialogProps> = (props) => {
	const controller = useImageStickerEditorDialogController(props);
	return <ImageStickerEditorDialogView controller={controller} />;
};

const useImageStickerEditorDialogController = ({
	onOpenChange,
	onSave,
	open,
	source,
	title,
}: ImageStickerEditorDialogProps) => {
	const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
	const canvasRef = useRef<Canvas | null>(null);
	const baseImageElementRef = useRef<CanvasImageSource | null>(null);
	const exportMultiplierRef = useRef(1);
	const initialSnapshotRef = useRef<string | null>(null);
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const historyTimerRef = useRef<number | null>(null);
	const restoringRef = useRef(false);
	const [editorState, dispatchEditor] = useReducer(editorDialogReducer, initialEditorDialogState);
	const [, setRedoSnapshots] = useState<string[]>([]);
	const [, setUndoSnapshots] = useState<string[]>([]);
	const {
		activeTool,
		brushColor,
		brushWidth,
		busyTool,
		canRedo,
		canUndo,
		canvasElement,
		canvasSize,
		hasShapeSelection,
		layerSummary,
		loadError,
		saveError,
		saving,
		selectionCount,
		selectedOpacity,
		selectedShapeAngle,
		selectedShapeColor,
	} = editorState;
	const ready = editorState.phase === "ready";

	const updateSelectionCount = useCallback((canvas = canvasRef.current) => {
		if (!canvas) {
			dispatchEditor({ selection: initialSelectionState, type: "selectionChanged" });
			return;
		}
		const selectedObjects = canvas.getActiveObjects().filter(isEditableObject);
		const shapeObject = selectedObjects.find(
			(object) => (object as EditorObject).editorRole === "shape",
		) as (EditorObject & { angle?: unknown; fill?: unknown }) | undefined;
		dispatchEditor({
			selection: {
				hasShapeSelection: Boolean(shapeObject),
				layerSummary: summarizeCanvasLayers(canvas),
				selectionCount: selectedObjects.length,
				selectedOpacity: Math.round((selectedObjects[0]?.opacity ?? 1) * 100),
				selectedShapeAngle:
					typeof shapeObject?.angle === "number"
						? normalizeAngle(shapeObject.angle)
						: defaultShapeAngle,
				selectedShapeColor:
					typeof shapeObject?.fill === "string"
						? normalizeHexColor(shapeObject.fill) || defaultRectangleFill
						: defaultRectangleFill,
			},
			type: "selectionChanged",
		});
	}, []);

	const setEditorCanvasElement = useCallback((node: HTMLCanvasElement | null) => {
		canvasElementRef.current = node;
		if (node) dispatchEditor({ canvasElement: node, type: "canvasElementChanged" });
	}, []);

	const syncHistoryState = useCallback((undo: string[], redo: string[]) => {
		dispatchEditor({
			canRedo: redo.length > 0,
			canUndo: undo.length > 1,
			type: "historyChanged",
		});
	}, []);

	const clearPendingHistoryCapture = useCallback(() => {
		if (historyTimerRef.current === null) return;
		window.clearTimeout(historyTimerRef.current);
		historyTimerRef.current = null;
	}, []);

	const captureHistory = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas || restoringRef.current) return;
		clearPendingHistoryCapture();
		historyTimerRef.current = window.setTimeout(() => {
			historyTimerRef.current = null;
			const snapshot = serializeCanvas(canvas);
			setUndoSnapshots((current) => {
				if (current[current.length - 1] === snapshot) return current;
				const next = [...current, snapshot].slice(-maxHistorySnapshots);
				setRedoSnapshots([]);
				syncHistoryState(next, []);
				return next;
			});
		}, 120);
	}, [clearPendingHistoryCapture, syncHistoryState]);

	const restoreSnapshot = useCallback(
		async (snapshot: string) => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			clearPendingHistoryCapture();
			restoringRef.current = true;
			try {
				await canvas.loadFromJSON(snapshot);
				normalizeCanvasObjects(canvas);
				canvas.discardActiveObject();
				setCanvasTool(canvas, activeTool, brushColor, brushWidth);
				canvas.requestRenderAll();
				updateSelectionCount(canvas);
			} finally {
				restoringRef.current = false;
			}
		},
		[activeTool, brushColor, brushWidth, clearPendingHistoryCapture, updateSelectionCount],
	);

	const changeEditorTool = useCallback(
		(nextTool: EditorTool) => {
			const canvas = canvasRef.current;
			dispatchEditor({ activeTool: nextTool, type: "activeToolChanged" });
			if (!canvas || !ready) return;
			setCanvasTool(canvas, nextTool, brushColor, brushWidth);
			updateSelectionCount(canvas);
		},
		[brushColor, brushWidth, ready, updateSelectionCount],
	);

	const undo = useCallback(() => {
		if (restoringRef.current) return;
		setUndoSnapshots((current) => {
			if (current.length <= 1) return current;
			const currentSnapshot = current[current.length - 1];
			const nextUndo = current.slice(0, -1);
			const previousSnapshot = nextUndo[nextUndo.length - 1];
			setRedoSnapshots((redo) => {
				const nextRedo = [currentSnapshot, ...redo].slice(0, maxHistorySnapshots);
				syncHistoryState(nextUndo, nextRedo);
				return nextRedo;
			});
			void restoreSnapshot(previousSnapshot);
			return nextUndo;
		});
	}, [restoreSnapshot, syncHistoryState]);

	const redo = useCallback(() => {
		if (restoringRef.current) return;
		setRedoSnapshots((current) => {
			const nextSnapshot = current[0];
			if (!nextSnapshot) return current;
			const nextRedo = current.slice(1);
			setUndoSnapshots((undo) => {
				const nextUndo = [...undo, nextSnapshot].slice(-maxHistorySnapshots);
				syncHistoryState(nextUndo, nextRedo);
				return nextUndo;
			});
			void restoreSnapshot(nextSnapshot);
			return nextRedo;
		});
	}, [restoreSnapshot, syncHistoryState]);

	const addImageSticker = useCallback(
		async (dataUrl: string, label: string) => {
			const canvas = canvasRef.current;
			if (!canvas || !ready) return;
			dispatchEditor({ activeTool: "select", type: "activeToolChanged" });
			setCanvasTool(canvas, "select", brushColor, brushWidth);
			dispatchEditor({ busyTool: label, type: "busyToolChanged" });
			dispatchEditor({ saveError: null, type: "saveErrorChanged" });
			try {
				const sticker = await loadFabricImage(dataUrl);
				const minDimension = Math.max(1, Math.min(canvas.getWidth(), canvas.getHeight()));
				sticker.scaleToWidth(Math.max(72, Math.min(180, minDimension * 0.28)));
				configureEditableObject(sticker as EditorObject, canvas, "sticker");
				canvas.add(sticker);
				canvas.setActiveObject(sticker);
				canvas.requestRenderAll();
				updateSelectionCount(canvas);
			} catch {
				dispatchEditor({
					saveError: "贴纸添加失败，请换一张图片再试。",
					type: "saveErrorChanged",
				});
			} finally {
				dispatchEditor({ busyTool: null, type: "busyToolChanged" });
			}
		},
		[brushColor, brushWidth, ready, updateSelectionCount],
	);

	const addTextSticker = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas || !ready) return;
		dispatchEditor({ activeTool: "select", type: "activeToolChanged" });
		setCanvasTool(canvas, "select", brushColor, brushWidth);
		dispatchEditor({ saveError: null, type: "saveErrorChanged" });
		const minDimension = Math.max(1, Math.min(canvas.getWidth(), canvas.getHeight()));
		const textbox = new Textbox("贴纸文字", {
			fill: "#ffffff",
			fontFamily: "Inter, system-ui, sans-serif",
			fontSize: Math.max(24, Math.min(42, Math.round(minDimension * 0.075))),
			fontWeight: "700",
			paintFirst: "stroke",
			stroke: "#111827",
			strokeWidth: 5,
			textAlign: "center",
			width: Math.max(160, Math.min(360, canvas.getWidth() * 0.45)),
		});
		configureEditableObject(textbox as EditorObject, canvas, "text");
		canvas.add(textbox);
		canvas.setActiveObject(textbox);
		canvas.requestRenderAll();
		updateSelectionCount(canvas);
	}, [brushColor, brushWidth, ready, updateSelectionCount]);

	const addRectangle = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas || !ready) return;
		dispatchEditor({ activeTool: "select", type: "activeToolChanged" });
		setCanvasTool(canvas, "select", brushColor, brushWidth);
		dispatchEditor({ saveError: null, type: "saveErrorChanged" });
		const rectWidth = Math.max(120, Math.min(320, canvas.getWidth() * 0.36));
		const rectHeight = Math.max(72, Math.min(220, canvas.getHeight() * 0.26));
		const rectangle = new Rect({
			fill: defaultRectangleFill,
			height: rectHeight,
			opacity: 0.35,
			rx: 2,
			ry: 2,
			stroke: defaultRectangleStroke,
			strokeUniform: true,
			strokeWidth: 2,
			width: rectWidth,
		});
		configureEditableObject(rectangle as EditorObject, canvas, "shape");
		canvas.add(rectangle);
		canvas.setActiveObject(rectangle);
		canvas.requestRenderAll();
		updateSelectionCount(canvas);
	}, [brushColor, brushWidth, ready, updateSelectionCount]);

	const addMosaic = useCallback(() => {
		const canvas = canvasRef.current;
		const baseImageElement = baseImageElementRef.current;
		if (!canvas || !ready) return;
		dispatchEditor({ activeTool: "select", type: "activeToolChanged" });
		setCanvasTool(canvas, "select", brushColor, brushWidth);
		if (!baseImageElement) {
			dispatchEditor({
				saveError: "马赛克添加失败，请重新打开编辑器后再试。",
				type: "saveErrorChanged",
			});
			return;
		}
		dispatchEditor({ saveError: null, type: "saveErrorChanged" });
		try {
			const region = defaultMosaicRegion(canvas);
			const mosaicCanvas = createMosaicCanvas(baseImageElement, canvas, region);
			const mosaic = new FabricImage(mosaicCanvas) as EditorImageObject;
			configureEditableObject(mosaic, canvas, "mosaic");
			mosaic.set({
				height: region.height,
				left: region.left + region.width / 2,
				lockRotation: true,
				scaleX: 1,
				scaleY: 1,
				top: region.top + region.height / 2,
				width: region.width,
			});
			canvas.add(mosaic);
			canvas.setActiveObject(mosaic);
			canvas.requestRenderAll();
			updateSelectionCount(canvas);
		} catch {
			dispatchEditor({
				saveError: "马赛克添加失败，可能是原图源不允许浏览器读取。",
				type: "saveErrorChanged",
			});
		}
	}, [brushColor, brushWidth, ready, updateSelectionCount]);

	const changeBrushColor = useCallback(
		(color: string) => {
			const normalizedColor = normalizeHexColor(color);
			if (!normalizedColor) return;
			const canvas = canvasRef.current;
			dispatchEditor({ brushColor: normalizedColor, type: "brushColorChanged" });
			if (!canvas || !ready) return;
			configureCanvasBrush(canvas, normalizedColor, brushWidth);
		},
		[brushWidth, ready],
	);

	const changeBrushWidth = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const nextWidth = clamp(Math.round(Number(event.currentTarget.value)), 1, 32);
			const canvas = canvasRef.current;
			dispatchEditor({ brushWidth: nextWidth, type: "brushWidthChanged" });
			if (!canvas || !ready) return;
			configureCanvasBrush(canvas, brushColor, nextWidth);
		},
		[brushColor, ready],
	);

	const changeSelectionOpacity = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const nextOpacity = Number(event.currentTarget.value);
			const canvas = canvasRef.current;
			dispatchEditor({
				selectedOpacity: nextOpacity,
				type: "selectedOpacityChanged",
			});
			if (!canvas || !ready) return;
			const selectedObjects = canvas.getActiveObjects().filter(isEditableObject);
			if (selectedObjects.length === 0) return;
			for (const object of selectedObjects) {
				object.set({ opacity: nextOpacity / 100 });
			}
			canvas.requestRenderAll();
			captureHistory();
		},
		[captureHistory, ready],
	);

	const changeShapeColor = useCallback(
		(color: string) => {
			const normalizedColor = normalizeHexColor(color);
			if (!normalizedColor) return;
			const canvas = canvasRef.current;
			dispatchEditor({
				selectedShapeColor: normalizedColor,
				type: "selectedShapeColorChanged",
			});
			if (!canvas || !ready) return;
			const selectedShapes = canvas
				.getActiveObjects()
				.filter((object) => (object as EditorObject).editorRole === "shape");
			if (selectedShapes.length === 0) return;
			for (const object of selectedShapes) {
				object.set({ fill: normalizedColor, stroke: rectangleStrokeForFill(normalizedColor) });
			}
			canvas.requestRenderAll();
			captureHistory();
		},
		[captureHistory, ready],
	);

	const changeShapeAngle = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const nextAngle = normalizeAngle(Number(event.currentTarget.value));
			const canvas = canvasRef.current;
			dispatchEditor({
				selectedShapeAngle: nextAngle,
				type: "selectedShapeAngleChanged",
			});
			if (!canvas || !ready) return;
			const selectedShapes = canvas
				.getActiveObjects()
				.filter((object) => (object as EditorObject).editorRole === "shape");
			if (selectedShapes.length === 0) return;
			for (const object of selectedShapes) {
				object.set({ angle: nextAngle });
				object.setCoords();
			}
			canvas.requestRenderAll();
			captureHistory();
		},
		[captureHistory, ready],
	);

	const deleteSelection = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas || !ready) return;
		const selected = canvas.getActiveObjects().filter(isEditableObject);
		if (selected.length === 0) return;
		canvas.remove(...selected);
		canvas.discardActiveObject();
		canvas.requestRenderAll();
		updateSelectionCount(canvas);
	}, [ready, updateSelectionCount]);

	const moveSelection = useCallback(
		(direction: "backward" | "forward") => {
			const canvas = canvasRef.current;
			if (!canvas || !ready) return;
			const selected = canvas.getActiveObject() as EditorObject | undefined;
			if (!selected || !isEditableObject(selected)) return;
			const changed =
				direction === "forward"
					? canvas.bringObjectForward(selected)
					: canvas.sendObjectBackwards(selected);
			if (!changed) return;
			keepBaseImageAtBack(canvas);
			canvas.requestRenderAll();
			captureHistory();
		},
		[captureHistory, ready],
	);

	const resetCanvas = useCallback(() => {
		const snapshot = initialSnapshotRef.current;
		if (!snapshot || !ready) return;
		setUndoSnapshots([snapshot]);
		setRedoSnapshots([]);
		syncHistoryState([snapshot], []);
		void restoreSnapshot(snapshot);
	}, [ready, restoreSnapshot, syncHistoryState]);

	const saveCanvas = useCallback(async () => {
		const canvas = canvasRef.current;
		if (!canvas || !ready || saving) return;
		dispatchEditor({ saving: true, type: "savingChanged" });
		dispatchEditor({ saveError: null, type: "saveErrorChanged" });
		try {
			canvas.discardActiveObject();
			normalizeCanvasObjects(canvas);
			canvas.renderAll();
			const mimeType = "image/png";
			const blob = await canvas.toBlob({
				enableRetinaScaling: false,
				format: "png",
				multiplier: exportMultiplierRef.current,
				quality: 1,
			});
			if (!blob) throw new Error("empty export");
			const filename = `${sanitizeExportFilename(title?.trim() || "图片编辑")}.png`;
			const file = new File([blob], filename, { type: mimeType });
			await onSave({ file, mimeType });
		} catch {
			dispatchEditor({
				saveError: "图片保存失败，请稍后重试。",
				type: "saveErrorChanged",
			});
		} finally {
			dispatchEditor({ saving: false, type: "savingChanged" });
		}
	}, [onSave, ready, saving, title]);

	const handleUploadClick = useCallback(() => {
		uploadInputRef.current?.click();
	}, []);

	const handleUploadChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.currentTarget.files?.[0];
			event.currentTarget.value = "";
			if (!file) return;
			if (!file.type.startsWith("image/")) {
				dispatchEditor({ saveError: "请选择图片文件。", type: "saveErrorChanged" });
				return;
			}
			dispatchEditor({ busyTool: "upload", type: "busyToolChanged" });
			dispatchEditor({ activeTool: "select", type: "activeToolChanged" });
			if (canvasRef.current) setCanvasTool(canvasRef.current, "select", brushColor, brushWidth);
			void readFileAsDataURL(file)
				.then((dataUrl) => addImageSticker(dataUrl, "upload"))
				.catch(() =>
					dispatchEditor({
						saveError: "贴纸文件读取失败。",
						type: "saveErrorChanged",
					}),
				)
				.finally(() => dispatchEditor({ busyTool: null, type: "busyToolChanged" }));
		},
		[addImageSticker, brushColor, brushWidth],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const active = canvasRef.current?.getActiveObject() as EditorObject | undefined;
			if (active?.isEditing) return;
			const key = event.key.toLowerCase();
			if ((event.metaKey || event.ctrlKey) && key === "z") {
				event.preventDefault();
				if (event.shiftKey) redo();
				else undo();
				return;
			}
			if ((event.metaKey || event.ctrlKey) && key === "y") {
				event.preventDefault();
				redo();
				return;
			}
			if (event.key === "Delete" || event.key === "Backspace") {
				event.preventDefault();
				deleteSelection();
			}
		},
		[deleteSelection, redo, undo],
	);

	useEffect(() => {
		if (open) return;
		canvasElementRef.current = null;
		dispatchEditor({ type: "closedReset" });
		setUndoSnapshots([]);
		setRedoSnapshots([]);
		syncHistoryState([], []);
		initialSnapshotRef.current = null;
		baseImageElementRef.current = null;
	}, [open, syncHistoryState]);

	useEffect(() => {
		if (!open) return;
		const trimmedSource = source.trim();
		dispatchEditor({ type: "openReset" });
		setUndoSnapshots([]);
		setRedoSnapshots([]);
		syncHistoryState([], []);
		baseImageElementRef.current = null;

		if (!trimmedSource) {
			dispatchEditor({
				loadError: "图片载入失败，找不到可编辑的图片源。",
				type: "loadFailed",
			});
			return;
		}

		if (!canvasElement) {
			return;
		}

		const abortController = new AbortController();
		let disposed = false;
		let canvas: Canvas;
		try {
			canvas = new Canvas(canvasElement, {
				backgroundColor: "#111827",
				preserveObjectStacking: true,
				selection: true,
				uniformScaling: false,
			});
		} catch {
			dispatchEditor({
				loadError: "图片编辑器初始化失败，请关闭后重试。",
				type: "loadFailed",
			});
			return;
		}
		canvasRef.current = canvas;

		const loadBaseImage = async () => {
			try {
				const baseImage = await loadFabricImage(trimmedSource, abortController.signal);
				if (disposed) return;
				baseImageElementRef.current = baseImage.getElement() as CanvasImageSource;
				const imageWidth = Math.max(1, baseImage.width ?? baseImage.getScaledWidth());
				const imageHeight = Math.max(1, baseImage.height ?? baseImage.getScaledHeight());
				const fitScale = Math.min(1, maxCanvasWidth / imageWidth, maxCanvasHeight / imageHeight);
				const canvasWidth = Math.max(1, Math.round(imageWidth * fitScale));
				const canvasHeight = Math.max(1, Math.round(imageHeight * fitScale));
				exportMultiplierRef.current = Math.max(
					imageWidth / canvasWidth,
					imageHeight / canvasHeight,
				);
				canvas.setDimensions({ height: canvasHeight, width: canvasWidth });
				baseImage.set({
					evented: false,
					hasControls: false,
					hasBorders: false,
					hoverCursor: "default",
					left: 0,
					lockMovementX: true,
					lockMovementY: true,
					lockRotation: true,
					lockScalingFlip: true,
					lockScalingX: true,
					lockScalingY: true,
					originX: "left",
					originY: "top",
					scaleX: fitScale,
					scaleY: fitScale,
					selectable: false,
				});
				(baseImage as EditorObject).editorRole = "base";
				canvas.add(baseImage);
				canvas.sendObjectToBack(baseImage);
				canvas.renderAll();
				const initialSnapshot = serializeCanvas(canvas);
				initialSnapshotRef.current = initialSnapshot;
				setUndoSnapshots([initialSnapshot]);
				setRedoSnapshots([]);
				syncHistoryState([initialSnapshot], []);
				updateSelectionCount(canvas);
				dispatchEditor({
					canvasSize: { height: canvasHeight, width: canvasWidth },
					type: "loadSucceeded",
				});
			} catch {
				if (!disposed) {
					dispatchEditor({
						loadError: "图片载入失败，可能是图片地址已失效或不允许浏览器读取。",
						type: "loadFailed",
					});
				}
			}
		};

		const handleObjectModified = ({ target }: { target?: FabricObjectInstance }) => {
			const editorObject = target as EditorObject | undefined;
			if (editorObject?.editorRole === "mosaic" && target instanceof FabricImage) {
				const baseImageElement = baseImageElementRef.current;
				if (baseImageElement) {
					refreshMosaicObject(target as EditorImageObject, canvas, baseImageElement);
				}
			}
			updateSelectionCount(canvas);
			captureHistory();
		};

		const handlePathCreated = ({ path }: { path?: FabricObjectInstance }) => {
			if (!path) return;
			configureDrawingObject(path as EditorObject);
			keepBaseImageAtBack(canvas);
			updateSelectionCount(canvas);
			captureHistory();
		};

		const disposers = [
			canvas.on("object:added", captureHistory),
			canvas.on("object:modified", handleObjectModified),
			canvas.on("object:removed", captureHistory),
			canvas.on("path:created", handlePathCreated),
			canvas.on("selection:created", () => updateSelectionCount(canvas)),
			canvas.on("selection:updated", () => updateSelectionCount(canvas)),
			canvas.on("selection:cleared", () => updateSelectionCount(canvas)),
			canvas.on("text:editing:exited", captureHistory),
		];
		void loadBaseImage();

		return () => {
			disposed = true;
			abortController.abort();
			disposers.forEach((dispose) => dispose());
			clearPendingHistoryCapture();
			if (canvasRef.current === canvas) canvasRef.current = null;
			void canvas.dispose();
			initialSnapshotRef.current = null;
			baseImageElementRef.current = null;
		};
	}, [
		captureHistory,
		canvasElement,
		clearPendingHistoryCapture,
		open,
		source,
		syncHistoryState,
		updateSelectionCount,
	]);

	const titleText = title?.trim() || "图片编辑工作台";
	const hasSelection = selectionCount > 0;
	const editableLayerCount =
		layerSummary.drawing +
		layerSummary.mosaic +
		layerSummary.shape +
		layerSummary.sticker +
		layerSummary.text;
	const canvasSizeLabel =
		canvasSize.width > 0 && canvasSize.height > 0
			? `${canvasSize.width} x ${canvasSize.height}px`
			: "--";

	return {
		addImageSticker,
		addMosaic,
		addRectangle,
		addTextSticker,
		activeTool,
		brushColor,
		brushWidth,
		busyTool,
		canRedo,
		canUndo,
		canvasSizeLabel,
		changeBrushColor,
		changeBrushWidth,
		changeSelectionOpacity,
		changeShapeAngle,
		changeShapeColor,
		deleteSelection,
		editableLayerCount,
		handleKeyDown,
		handleUploadChange,
		handleUploadClick,
		hasSelection,
		hasShapeSelection,
		layerSummary,
		loadError,
		moveSelection,
		onOpenChange,
		open,
		ready,
		redo,
		resetCanvas,
		saveCanvas,
		saveError,
		saving,
		selectedOpacity,
		selectedShapeAngle,
		selectedShapeColor,
		selectionCount,
		setEditorCanvasElement,
		switchToBrushTool: () => changeEditorTool("brush"),
		switchToSelectTool: () => changeEditorTool("select"),
		titleText,
		undo,
		uploadInputRef,
	};
};

export type ImageStickerEditorDialogController = ReturnType<
	typeof useImageStickerEditorDialogController
>;

const summarizeCanvasLayers = (canvas: Canvas): LayerSummary => {
	const summary: LayerSummary = { ...emptyLayerSummary };
	for (const object of canvas.getObjects()) {
		const role = (object as EditorObject).editorRole;
		if (role && role !== "base") summary[role] += 1;
	}
	return summary;
};

const serializeCanvas = (canvas: Canvas) => JSON.stringify(canvas.toObject([editorRoleProperty]));

const loadFabricImage = async (source: string, signal?: AbortSignal) => {
	const shouldTryCors = /^https?:/iu.test(source);
	try {
		return new FabricImage(
			await loadImageElement(source, signal, shouldTryCors ? "anonymous" : null),
		);
	} catch (error) {
		if (!shouldTryCors || signal?.aborted) throw error;
		return new FabricImage(await loadImageElement(source, signal, null));
	}
};

const loadImageElement = (
	source: string,
	signal: AbortSignal | undefined,
	crossOrigin: HTMLImageElement["crossOrigin"],
) =>
	new Promise<HTMLImageElement>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}

		const image = new Image();
		let settled = false;
		let timeoutId: number | undefined;
		const cleanup = () => {
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
			signal?.removeEventListener("abort", abort);
			image.onload = null;
			image.onerror = null;
		};
		const settle = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const abort = () => {
			settle(() => reject(new DOMException("Aborted", "AbortError")));
		};

		image.onload = () => settle(() => resolve(image));
		image.onerror = () => settle(() => reject(new Error("图片载入失败。")));
		if (crossOrigin) image.crossOrigin = crossOrigin;
		signal?.addEventListener("abort", abort, { once: true });
		timeoutId = window.setTimeout(
			() => settle(() => reject(new Error("图片载入超时。"))),
			imageLoadTimeoutMs,
		);
		image.src = source;
	});

const defaultMosaicRegion = (canvas: Canvas) => {
	const width = Math.max(96, Math.min(280, canvas.getWidth() * 0.32));
	const height = Math.max(72, Math.min(200, canvas.getHeight() * 0.24));
	return {
		height,
		left: (canvas.getWidth() - width) / 2,
		top: (canvas.getHeight() - height) / 2,
		width,
	};
};

const refreshMosaicObject = (
	object: EditorImageObject,
	canvas: Canvas,
	baseImageElement: CanvasImageSource,
) => {
	const width = clamp(Math.round(object.getScaledWidth()), 16, Math.round(canvas.getWidth()));
	const height = clamp(Math.round(object.getScaledHeight()), 16, Math.round(canvas.getHeight()));
	const center = object.getCenterPoint();
	const left = clamp(center.x - width / 2, 0, Math.max(0, canvas.getWidth() - width));
	const top = clamp(center.y - height / 2, 0, Math.max(0, canvas.getHeight() - height));
	const mosaicCanvas = createMosaicCanvas(baseImageElement, canvas, { height, left, top, width });

	object.setElement(mosaicCanvas, { height, width });
	object.set({
		height,
		left: left + width / 2,
		scaleX: 1,
		scaleY: 1,
		top: top + height / 2,
		width,
	});
	object.setCoords();
	canvas.requestRenderAll();
};

const createMosaicCanvas = (
	source: CanvasImageSource,
	canvas: Canvas,
	region: { height: number; left: number; top: number; width: number },
) => {
	const outputWidth = Math.max(1, Math.round(region.width));
	const outputHeight = Math.max(1, Math.round(region.height));
	const sourceSize = canvasSourceSize(source);
	const sourceLeft = clamp(region.left / canvas.getWidth(), 0, 1) * sourceSize.width;
	const sourceTop = clamp(region.top / canvas.getHeight(), 0, 1) * sourceSize.height;
	const sourceWidth = clamp(region.width / canvas.getWidth(), 0, 1) * sourceSize.width;
	const sourceHeight = clamp(region.height / canvas.getHeight(), 0, 1) * sourceSize.height;
	const sampleWidth = Math.max(1, Math.ceil(outputWidth / mosaicBlockSize));
	const sampleHeight = Math.max(1, Math.ceil(outputHeight / mosaicBlockSize));
	const sampleCanvas = document.createElement("canvas");
	sampleCanvas.width = sampleWidth;
	sampleCanvas.height = sampleHeight;
	const sampleContext = sampleCanvas.getContext("2d");
	const mosaicCanvas = document.createElement("canvas");
	mosaicCanvas.width = outputWidth;
	mosaicCanvas.height = outputHeight;
	const mosaicContext = mosaicCanvas.getContext("2d");
	if (!sampleContext || !mosaicContext || sourceWidth <= 0 || sourceHeight <= 0) {
		throw new Error("unable to create mosaic");
	}

	sampleContext.drawImage(
		source,
		sourceLeft,
		sourceTop,
		sourceWidth,
		sourceHeight,
		0,
		0,
		sampleWidth,
		sampleHeight,
	);
	mosaicContext.imageSmoothingEnabled = false;
	mosaicContext.drawImage(
		sampleCanvas,
		0,
		0,
		sampleWidth,
		sampleHeight,
		0,
		0,
		outputWidth,
		outputHeight,
	);
	return mosaicCanvas;
};

const canvasSourceSize = (source: CanvasImageSource) => {
	if (source instanceof HTMLImageElement) {
		return {
			height: Math.max(1, source.naturalHeight || source.height),
			width: Math.max(1, source.naturalWidth || source.width),
		};
	}
	if (source instanceof HTMLVideoElement) {
		return {
			height: Math.max(1, source.videoHeight || source.height),
			width: Math.max(1, source.videoWidth || source.width),
		};
	}
	if (source instanceof SVGImageElement) {
		return {
			height: Math.max(1, source.height.baseVal.value),
			width: Math.max(1, source.width.baseVal.value),
		};
	}
	const sizedSource = source as {
		displayHeight?: number;
		displayWidth?: number;
		height?: number;
		width?: number;
	};
	return {
		height: Math.max(1, Number(sizedSource.height ?? sizedSource.displayHeight) || 1),
		width: Math.max(1, Number(sizedSource.width ?? sizedSource.displayWidth) || 1),
	};
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeAngle = (value: number) => {
	if (!Number.isFinite(value)) return defaultShapeAngle;
	const normalized = Math.round(value) % 360;
	return normalized < 0 ? normalized + 360 : normalized;
};

const normalizeHexColor = (value: string) => {
	const match = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/iu);
	if (!match?.[1]) return null;
	const hex = match[1].toLowerCase();
	if (hex.length === 6) return `#${hex}`;
	return `#${hex
		.split("")
		.map((character) => character + character)
		.join("")}`;
};

const rectangleStrokeForFill = (fill: string) => {
	const normalized = normalizeHexColor(fill);
	if (!normalized) return defaultRectangleStroke;
	const red = Number.parseInt(normalized.slice(1, 3), 16);
	const green = Number.parseInt(normalized.slice(3, 5), 16);
	const blue = Number.parseInt(normalized.slice(5, 7), 16);
	return `#${[red, green, blue]
		.map((channel) =>
			Math.max(0, Math.round(channel * 0.62))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
};

const sanitizeExportFilename = (value: string) => {
	const sanitized = value
		.replace(/[\\/:*?"<>|]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	return sanitized || "图片编辑";
};

const setCanvasTool = (
	canvas: Canvas,
	tool: EditorTool,
	brushColor: string,
	brushWidth: number,
) => {
	canvas.isDrawingMode = tool === "brush";
	canvas.selection = tool === "select";
	canvas.defaultCursor = tool === "brush" ? "crosshair" : "default";
	canvas.hoverCursor = tool === "brush" ? "crosshair" : "move";
	if (tool === "brush") {
		canvas.discardActiveObject();
		configureCanvasBrush(canvas, brushColor, brushWidth);
	}
	canvas.requestRenderAll();
};

const configureCanvasBrush = (canvas: Canvas, color: string, width: number) => {
	const brush = canvas.freeDrawingBrush ?? new PencilBrush(canvas);
	brush.color = color;
	brush.width = clamp(width, 1, 32);
	canvas.freeDrawingBrush = brush;
};

const configureObjectControls = (object: FabricObjectInstance) => {
	configureRotateCursor(object);
	object.set({
		borderColor: "#0ea5e9",
		cornerColor: "#f8fafc",
		cornerSize: 10,
		cornerStrokeColor: "#0f172a",
		cornerStyle: "circle",
		padding: 4,
		transparentCorners: false,
	});
};

const configureEditableObject = (object: EditorObject, canvas: Canvas, role: EditorRole) => {
	object.editorRole = role;
	configureObjectControls(object);
	object.set({
		left: canvas.getWidth() / 2,
		originX: "center",
		originY: "center",
		top: canvas.getHeight() / 2,
	});
	if (role === "mosaic") {
		object.set({ lockRotation: true });
	}
};

const configureDrawingObject = (object: EditorObject) => {
	object.editorRole = "drawing";
	configureObjectControls(object);
	object.set({
		evented: true,
		selectable: true,
	});
	object.setCoords();
};

const normalizeCanvasObjects = (canvas: Canvas) => {
	for (const [index, object] of canvas.getObjects().entries()) {
		const editorObject = object as EditorObject;
		if (editorObject.editorRole === "base" || index === 0) {
			editorObject.editorRole = "base";
			editorObject.set({
				evented: false,
				hasBorders: false,
				hasControls: false,
				lockMovementX: true,
				lockMovementY: true,
				lockRotation: true,
				lockScalingFlip: true,
				lockScalingX: true,
				lockScalingY: true,
				selectable: false,
			});
			continue;
		}
		if (!editorObject.editorRole) editorObject.editorRole = "sticker";
		configureObjectControls(editorObject);
		editorObject.set({
			evented: true,
			lockRotation: editorObject.editorRole === "mosaic",
			selectable: true,
		});
	}
	keepBaseImageAtBack(canvas);
};

const keepBaseImageAtBack = (canvas: Canvas) => {
	const baseImage = canvas
		.getObjects()
		.find((object) => (object as EditorObject).editorRole === "base");
	if (baseImage) canvas.sendObjectToBack(baseImage);
};

const isEditableObject = (object: FabricObjectInstance): boolean =>
	(object as EditorObject).editorRole !== "base";

const configureRotateCursor = (object: FabricObjectInstance) => {
	const rotateControl = (object as { controls?: { mtr?: { cursorStyle: string } } }).controls?.mtr;
	if (rotateControl) rotateControl.cursorStyle = rotateControlCursor;
};

const readFileAsDataURL = (file: File) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error);
		reader.onload = () => {
			const result = reader.result;
			if (typeof result === "string") resolve(result);
			else reject(new Error("unsupported result"));
		};
		reader.readAsDataURL(file);
	});
