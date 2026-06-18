import {
	ArrowDown,
	ArrowUp,
	Grid3X3,
	ImagePlus,
	Loader2,
	RotateCcw,
	Save,
	SlidersHorizontal,
	Square,
	Trash2,
	Type,
	Undo2,
	Upload,
	X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
	Canvas,
	FabricImage,
	FabricObject,
	Rect,
	Textbox,
	type FabricObject as FabricObjectInstance,
} from "fabric";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

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

type EditorRole = "base" | "mosaic" | "shape" | "sticker" | "text";
type EditorObject = FabricObjectInstance & { editorRole?: EditorRole; isEditing?: boolean };
type EditorImageObject = FabricImage & EditorObject;

const editorRoleProperty = "editorRole";
const maxCanvasWidth = 960;
const maxCanvasHeight = 640;
const maxHistorySnapshots = 80;
const imageLoadTimeoutMs = 12_000;
const mosaicBlockSize = 12;
const defaultRectangleFill = "#0ea5e9";
const defaultRectangleStroke = "#0369a1";
const defaultShapeAngle = 0;
const rectangleColorOptions = ["#0ea5e9", "#ef4444", "#f59e0b", "#22c55e", "#a855f7", "#111827"];

FabricObject.customProperties = Array.from(
	new Set([...FabricObject.customProperties, editorRoleProperty]),
);

export const ImageStickerEditorDialog: React.FC<ImageStickerEditorDialogProps> = ({
	onOpenChange,
	onSave,
	open,
	source,
	title,
}) => {
	const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
	const canvasRef = useRef<Canvas | null>(null);
	const baseImageElementRef = useRef<CanvasImageSource | null>(null);
	const exportMultiplierRef = useRef(1);
	const initialSnapshotRef = useRef<string | null>(null);
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const historyTimerRef = useRef<number | null>(null);
	const restoringRef = useRef(false);
	const [busyTool, setBusyTool] = useState<string | null>(null);
	const [canRedo, setCanRedo] = useState(false);
	const [canUndo, setCanUndo] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
	const [hasShapeSelection, setHasShapeSelection] = useState(false);
	const [selectionCount, setSelectionCount] = useState(0);
	const [selectedShapeAngle, setSelectedShapeAngle] = useState(defaultShapeAngle);
	const [selectedShapeColor, setSelectedShapeColor] = useState(defaultRectangleFill);
	const [selectedOpacity, setSelectedOpacity] = useState(100);
	const [, setRedoSnapshots] = useState<string[]>([]);
	const [, setUndoSnapshots] = useState<string[]>([]);

	const updateSelectionCount = useCallback((canvas = canvasRef.current) => {
		if (!canvas) {
			setHasShapeSelection(false);
			setSelectionCount(0);
			setSelectedShapeAngle(defaultShapeAngle);
			setSelectedShapeColor(defaultRectangleFill);
			setSelectedOpacity(100);
			return;
		}
		const selectedObjects = canvas.getActiveObjects().filter(isEditableObject);
		const shapeObject = selectedObjects.find(
			(object) => (object as EditorObject).editorRole === "shape",
		) as (EditorObject & { angle?: unknown; fill?: unknown }) | undefined;
		setHasShapeSelection(Boolean(shapeObject));
		setSelectionCount(selectedObjects.length);
		setSelectedShapeAngle(
			typeof shapeObject?.angle === "number"
				? normalizeAngle(shapeObject.angle)
				: defaultShapeAngle,
		);
		setSelectedShapeColor(
			typeof shapeObject?.fill === "string"
				? normalizeHexColor(shapeObject.fill) || defaultRectangleFill
				: defaultRectangleFill,
		);
		setSelectedOpacity(Math.round((selectedObjects[0]?.opacity ?? 1) * 100));
	}, []);

	const setEditorCanvasElement = useCallback((node: HTMLCanvasElement | null) => {
		canvasElementRef.current = node;
		if (node) setCanvasElement(node);
	}, []);

	const syncHistoryState = useCallback((undo: string[], redo: string[]) => {
		setCanUndo(undo.length > 1);
		setCanRedo(redo.length > 0);
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
				canvas.requestRenderAll();
				updateSelectionCount(canvas);
			} finally {
				restoringRef.current = false;
			}
		},
		[clearPendingHistoryCapture, updateSelectionCount],
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
			setBusyTool(label);
			setSaveError(null);
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
				setSaveError("贴纸添加失败，请换一张图片再试。");
			} finally {
				setBusyTool(null);
			}
		},
		[ready, updateSelectionCount],
	);

	const addTextSticker = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas || !ready) return;
		setSaveError(null);
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
	}, [ready, updateSelectionCount]);

	const addRectangle = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas || !ready) return;
		setSaveError(null);
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
	}, [ready, updateSelectionCount]);

	const addMosaic = useCallback(() => {
		const canvas = canvasRef.current;
		const baseImageElement = baseImageElementRef.current;
		if (!canvas || !ready) return;
		if (!baseImageElement) {
			setSaveError("马赛克添加失败，请重新打开编辑器后再试。");
			return;
		}
		setSaveError(null);
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
			setSaveError("马赛克添加失败，可能是原图源不允许浏览器读取。");
		}
	}, [ready, updateSelectionCount]);

	const changeSelectionOpacity = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const nextOpacity = Number(event.currentTarget.value);
			const canvas = canvasRef.current;
			setSelectedOpacity(nextOpacity);
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
			setSelectedShapeColor(normalizedColor);
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
			setSelectedShapeAngle(nextAngle);
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
		setSaving(true);
		setSaveError(null);
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
			setSaveError("图片保存失败，请稍后重试。");
		} finally {
			setSaving(false);
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
				setSaveError("请选择图片文件。");
				return;
			}
			setBusyTool("upload");
			void readFileAsDataURL(file)
				.then((dataUrl) => addImageSticker(dataUrl, "upload"))
				.catch(() => setSaveError("贴纸文件读取失败。"))
				.finally(() => setBusyTool(null));
		},
		[addImageSticker],
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
		setCanvasElement(null);
		setReady(false);
		setLoadError(null);
		setSaveError(null);
		setHasShapeSelection(false);
		setSelectionCount(0);
		setSelectedShapeAngle(defaultShapeAngle);
		setSelectedShapeColor(defaultRectangleFill);
		setSelectedOpacity(100);
		setUndoSnapshots([]);
		setRedoSnapshots([]);
		syncHistoryState([], []);
		initialSnapshotRef.current = null;
		baseImageElementRef.current = null;
	}, [open, syncHistoryState]);

	useEffect(() => {
		if (!open) return;
		const trimmedSource = source.trim();
		setReady(false);
		setLoadError(null);
		setSaveError(null);
		setHasShapeSelection(false);
		setSelectionCount(0);
		setSelectedShapeAngle(defaultShapeAngle);
		setSelectedShapeColor(defaultRectangleFill);
		setSelectedOpacity(100);
		setUndoSnapshots([]);
		setRedoSnapshots([]);
		syncHistoryState([], []);
		baseImageElementRef.current = null;

		if (!trimmedSource) {
			setLoadError("图片载入失败，找不到可编辑的图片源。");
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
			});
		} catch {
			setLoadError("图片编辑器初始化失败，请关闭后重试。");
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
				setReady(true);
			} catch {
				if (!disposed) {
					setLoadError("图片载入失败，可能是图片地址已失效或不允许浏览器读取。");
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

		const disposers = [
			canvas.on("object:added", captureHistory),
			canvas.on("object:modified", handleObjectModified),
			canvas.on("object:removed", captureHistory),
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

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-foreground/70 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className="fixed left-1/2 top-1/2 z-[71] flex max-h-[calc(100vh-2rem)] w-[min(74rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-sm border border-border bg-card text-card-foreground shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
					onKeyDown={handleKeyDown}
				>
					<header className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-card px-4">
						<DialogPrimitive.Title className="min-w-0 truncate text-sm font-semibold">
							{titleText}
						</DialogPrimitive.Title>
						<div className="flex shrink-0 items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								disabled={!ready || saving}
								onClick={saveCanvas}
							>
								{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
								<span>保存</span>
							</Button>
							<DialogPrimitive.Close asChild>
								<Button type="button" variant="ghost" size="icon" aria-label="关闭编辑器">
									<X className="size-4" />
								</Button>
							</DialogPrimitive.Close>
						</div>
					</header>
					<div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)] max-lg:grid-cols-1 max-lg:grid-rows-[auto_minmax(0,1fr)]">
						<aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-border bg-ide-toolbar p-3 max-lg:max-h-52 max-lg:border-b max-lg:border-r-0">
							<div className="grid gap-2">
								<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
									<ImagePlus className="size-4" />
									<span>贴纸</span>
								</div>
								<div className="grid grid-cols-2 gap-2">
									{stickerPresets.map((preset) => (
										<Button
											key={preset.id}
											type="button"
											variant="outline"
											size="sm"
											className="h-10 justify-start px-2"
											disabled={!ready || busyTool !== null}
											onClick={() => void addImageSticker(preset.source, preset.id)}
										>
											<span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border bg-background">
												<img src={preset.source} alt="" className="size-5 object-contain" />
											</span>
											<span className="min-w-0 truncate">{preset.label}</span>
										</Button>
									))}
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="justify-start"
									disabled={!ready || busyTool !== null}
									onClick={handleUploadClick}
								>
									{busyTool === "upload" ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Upload className="size-4" />
									)}
									<span>上传贴纸</span>
								</Button>
								<input
									ref={uploadInputRef}
									type="file"
									accept="image/*"
									className="hidden"
									onChange={handleUploadChange}
								/>
							</div>
							<div className="grid gap-2">
								<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
									<Type className="size-4" />
									<span>文字</span>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="justify-start"
									disabled={!ready}
									onClick={addTextSticker}
								>
									<Type className="size-4" />
									<span>添加文字</span>
								</Button>
							</div>
							<div className="grid gap-2">
								<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
									<Square className="size-4" />
									<span>标注</span>
								</div>
								<div className="grid grid-cols-2 gap-2">
									<ToolButton
										label="矩形"
										disabled={!ready}
										icon={<Square className="size-4" />}
										onClick={addRectangle}
									/>
									<ToolButton
										label="马赛克"
										disabled={!ready}
										icon={<Grid3X3 className="size-4" />}
										onClick={addMosaic}
									/>
								</div>
							</div>
							<div className="grid gap-2">
								<div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
									<span className="flex min-w-0 items-center gap-2">
										<SlidersHorizontal className="size-4" />
										<span>属性</span>
									</span>
									<span className="shrink-0 tabular-nums">
										{hasSelection ? `${selectedOpacity}%` : "--"}
									</span>
								</div>
								<div className="grid gap-1.5 text-xs text-muted-foreground">
									<span>颜色</span>
									<div className="flex items-center gap-1.5">
										{rectangleColorOptions.map((color) => (
											<button
												key={color}
												type="button"
												aria-label={`矩形颜色 ${color}`}
												disabled={!ready || !hasShapeSelection}
												className={cn(
													"size-6 rounded-sm border border-border shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40",
													selectedShapeColor === color && "ring-2 ring-ring ring-offset-1",
												)}
												style={{ backgroundColor: color }}
												onClick={() => changeShapeColor(color)}
											/>
										))}
										<input
											type="color"
											aria-label="自定义矩形颜色"
											value={selectedShapeColor}
											disabled={!ready || !hasShapeSelection}
											className="size-7 rounded-sm border border-border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
											onChange={(event) => changeShapeColor(event.currentTarget.value)}
										/>
									</div>
								</div>
								<label className="grid gap-1.5 text-xs text-muted-foreground">
									<span className="flex items-center justify-between gap-2">
										<span>旋转</span>
										<span className="tabular-nums">
											{hasShapeSelection ? `${selectedShapeAngle}°` : "--"}
										</span>
									</span>
									<input
										type="range"
										aria-label="矩形旋转角度"
										min={0}
										max={360}
										step={1}
										value={selectedShapeAngle}
										disabled={!ready || !hasShapeSelection}
										className="h-2 w-full accent-primary disabled:opacity-50"
										onChange={changeShapeAngle}
									/>
								</label>
								<label className="grid gap-1.5 text-xs text-muted-foreground">
									<span>透明度</span>
									<input
										type="range"
										min={10}
										max={100}
										step={5}
										value={selectedOpacity}
										disabled={!ready || !hasSelection}
										className="h-2 w-full accent-primary disabled:opacity-50"
										onChange={changeSelectionOpacity}
									/>
								</label>
							</div>
							<div className="grid gap-2">
								<div className="text-xs font-medium text-muted-foreground">编辑</div>
								<div className="grid grid-cols-2 gap-2">
									<ToolButton
										label="撤销"
										disabled={!canUndo}
										icon={<Undo2 className="size-4" />}
										onClick={undo}
									/>
									<ToolButton
										label="重做"
										disabled={!canRedo}
										icon={<Undo2 className="size-4 rotate-180" />}
										onClick={redo}
									/>
									<ToolButton
										label="前移"
										disabled={!hasSelection}
										icon={<ArrowUp className="size-4" />}
										onClick={() => moveSelection("forward")}
									/>
									<ToolButton
										label="后移"
										disabled={!hasSelection}
										icon={<ArrowDown className="size-4" />}
										onClick={() => moveSelection("backward")}
									/>
									<ToolButton
										label="删除"
										disabled={!hasSelection}
										icon={<Trash2 className="size-4" />}
										onClick={deleteSelection}
									/>
									<ToolButton
										label="重置"
										disabled={!ready}
										icon={<RotateCcw className="size-4" />}
										onClick={resetCanvas}
									/>
								</div>
							</div>
							{saveError ? (
								<div role="alert" className="text-xs leading-5 text-destructive">
									{saveError}
								</div>
							) : null}
						</aside>
						<section className="relative flex min-h-[24rem] min-w-0 items-center justify-center overflow-auto bg-ide-editor p-4">
							<div
								className={cn(
									"inline-flex max-w-full shrink-0 items-center justify-center border border-border bg-muted/40 shadow-sm",
									!ready && "opacity-60",
								)}
							>
								<canvas ref={setEditorCanvasElement} />
							</div>
							{!ready && !loadError ? (
								<div className="absolute inset-0 flex items-center justify-center bg-card/40">
									<Loader2 className="size-6 animate-spin text-muted-foreground" />
								</div>
							) : null}
							{loadError ? (
								<div
									role="alert"
									className="absolute left-1/2 top-1/2 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-destructive/40 bg-card p-4 text-center text-xs leading-5 text-destructive shadow-lg"
								>
									{loadError}
								</div>
							) : null}
						</section>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};

const ToolButton: React.FC<{
	disabled?: boolean;
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
}> = ({ disabled, icon, label, onClick }) => (
	<Button
		type="button"
		variant="outline"
		size="sm"
		className="justify-start"
		disabled={disabled}
		onClick={onClick}
	>
		{icon}
		<span>{label}</span>
	</Button>
);

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

const configureEditableObject = (object: EditorObject, canvas: Canvas, role: EditorRole) => {
	object.editorRole = role;
	object.set({
		borderColor: "#0ea5e9",
		cornerColor: "#f8fafc",
		cornerSize: 10,
		cornerStrokeColor: "#0f172a",
		cornerStyle: "circle",
		left: canvas.getWidth() / 2,
		originX: "center",
		originY: "center",
		padding: 4,
		top: canvas.getHeight() / 2,
		transparentCorners: false,
	});
	if (role === "mosaic") {
		object.set({ lockRotation: true });
	}
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

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const stickerPresets = [
	{
		id: "star",
		label: "星标",
		source: svgDataUrl(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path fill="#facc15" stroke="#854d0e" stroke-width="8" stroke-linejoin="round" d="M64 10l15.5 34.3 37.2 4-27.6 25.3 7.8 36.7L64 91.6 31.1 110.3l7.8-36.7L11.3 48.3l37.2-4L64 10z"/></svg>`,
		),
	},
	{
		id: "bubble",
		label: "气泡",
		source: svgDataUrl(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 112"><path fill="#f8fafc" stroke="#2563eb" stroke-width="8" stroke-linejoin="round" d="M28 10h104c10 0 18 8 18 18v44c0 10-8 18-18 18H74l-30 16 8-16H28c-10 0-18-8-18-18V28c0-10 8-18 18-18z"/></svg>`,
		),
	},
	{
		id: "label",
		label: "标签",
		source: svgDataUrl(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 168 96"><path fill="#fb7185" stroke="#881337" stroke-width="8" stroke-linejoin="round" d="M10 18c0-6.6 5.4-12 12-12h124l12 42-12 42H22c-6.6 0-12-5.4-12-12V18z"/><circle cx="128" cy="48" r="8" fill="#fff1f2"/></svg>`,
		),
	},
	{
		id: "ring",
		label: "圈注",
		source: svgDataUrl(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="46" fill="none" stroke="#22c55e" stroke-width="14"/><path fill="none" stroke="#14532d" stroke-width="5" stroke-linecap="round" d="M35 88c18 14 42 14 59 0"/></svg>`,
		),
	},
] as const;
