import {
	ArrowDown,
	ArrowUp,
	Grid3X3,
	ImagePlus,
	Layers,
	Loader2,
	MousePointer2,
	Palette,
	Paintbrush,
	PanelRight,
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
import type React from "react";
import { Button } from "@/shared/components/ui/button";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { cn } from "@/shared/lib/utils";
import type { ImageStickerEditorDialogController } from "./ImageStickerEditorDialog";

const rectangleColorOptions = ["#0ea5e9", "#ef4444", "#f59e0b", "#22c55e", "#a855f7", "#111827"];

export const ImageStickerEditorDialogView: React.FC<{
	controller: ImageStickerEditorDialogController;
}> = ({ controller }) => {
	const {
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
		titleText,
		undo,
		uploadInputRef,
		switchToBrushTool,
		switchToSelectTool,
	} = controller;

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className={cn(
						"fixed inset-3 z-[71] flex flex-col overflow-hidden rounded-sm border border-white/15 bg-[#202124] text-[#e8eaed] shadow-2xl outline-none sm:inset-4",
						dialogContentMotion,
					)}
					onKeyDown={handleKeyDown}
				>
					<ImageStickerEditorHeader
						ready={ready}
						saving={saving}
						titleText={titleText}
						onSave={saveCanvas}
					/>
					<div className="flex min-h-0 flex-1 max-lg:flex-col">
						<ImageStickerToolRail
							activeTool={activeTool}
							busyTool={busyTool}
							hasSelection={hasSelection}
							ready={ready}
							uploadInputRef={uploadInputRef}
							onAddMosaic={addMosaic}
							onAddRectangle={addRectangle}
							onAddText={addTextSticker}
							onDeleteSelection={deleteSelection}
							onResetCanvas={resetCanvas}
							onSelectBrush={switchToBrushTool}
							onSelectPointer={switchToSelectTool}
							onUploadChange={handleUploadChange}
							onUploadClick={handleUploadClick}
						/>

						<div className="flex min-w-0 flex-1 flex-col max-lg:min-h-0">
							<ImageStickerCanvasTopbar
								canRedo={canRedo}
								canUndo={canUndo}
								canvasSizeLabel={canvasSizeLabel}
								hasSelection={hasSelection}
								selectionCount={selectionCount}
								onMoveSelection={moveSelection}
								onRedo={redo}
								onUndo={undo}
							/>
							<ImageStickerCanvasStage
								loadError={loadError}
								ready={ready}
								onCanvasElement={setEditorCanvasElement}
							/>
							<ImageStickerStatusBar
								canvasSizeLabel={canvasSizeLabel}
								editableLayerCount={editableLayerCount}
								loadError={loadError}
								ready={ready}
							/>
						</div>

						<ImageStickerInspector
							activeTool={activeTool}
							brushColor={brushColor}
							brushWidth={brushWidth}
							busyTool={busyTool}
							editableLayerCount={editableLayerCount}
							hasSelection={hasSelection}
							hasShapeSelection={hasShapeSelection}
							layerSummary={layerSummary}
							ready={ready}
							saveError={saveError}
							selectedOpacity={selectedOpacity}
							selectedShapeAngle={selectedShapeAngle}
							selectedShapeColor={selectedShapeColor}
							onAddImageSticker={addImageSticker}
							onChangeBrushColor={changeBrushColor}
							onChangeBrushWidth={changeBrushWidth}
							onChangeSelectionOpacity={changeSelectionOpacity}
							onChangeShapeAngle={changeShapeAngle}
							onChangeShapeColor={changeShapeColor}
							onDeleteSelection={deleteSelection}
							onMoveSelection={moveSelection}
							onResetCanvas={resetCanvas}
						/>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};

const ImageStickerEditorHeader: React.FC<{
	onSave: () => void;
	ready: boolean;
	saving: boolean;
	titleText: string;
}> = ({ onSave, ready, saving, titleText }) => (
	<header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#2b2d31] px-3">
		<div className="flex min-w-0 items-center gap-4">
			<DialogPrimitive.Title className="min-w-0 truncate text-sm font-semibold text-white">
				{titleText}
			</DialogPrimitive.Title>
			<nav className="hidden items-center gap-1 text-[0.6875rem] text-[#b9bec8] md:flex">
				<span className="rounded-sm px-2 py-1 hover:bg-white/10">文件</span>
				<span className="rounded-sm px-2 py-1 hover:bg-white/10">编辑</span>
				<span className="rounded-sm px-2 py-1 hover:bg-white/10">图层</span>
				<span className="rounded-sm px-2 py-1 hover:bg-white/10">视图</span>
			</nav>
		</div>
		<div className="flex shrink-0 items-center gap-2">
			<Button
				type="button"
				variant="default"
				size="sm"
				className="border border-[#2f74ff] bg-[#2f74ff] text-white shadow-none hover:bg-[#2563eb]"
				disabled={!ready || saving}
				onClick={onSave}
			>
				{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
				<span>保存</span>
			</Button>
			<DialogPrimitive.Close asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="关闭编辑器"
					className="text-[#c9ced8] hover:bg-white/10 hover:text-white"
				>
					<X className="size-4" />
				</Button>
			</DialogPrimitive.Close>
		</div>
	</header>
);

const ImageStickerToolRail: React.FC<{
	activeTool: ImageStickerEditorDialogController["activeTool"];
	busyTool: string | null;
	hasSelection: boolean;
	onAddMosaic: () => void;
	onAddRectangle: () => void;
	onAddText: () => void;
	onDeleteSelection: () => void;
	onResetCanvas: () => void;
	onSelectBrush: () => void;
	onSelectPointer: () => void;
	onUploadChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
	onUploadClick: () => void;
	ready: boolean;
	uploadInputRef: React.RefObject<HTMLInputElement | null>;
}> = ({
	activeTool,
	busyTool,
	hasSelection,
	onAddMosaic,
	onAddRectangle,
	onAddText,
	onDeleteSelection,
	onResetCanvas,
	onSelectBrush,
	onSelectPointer,
	onUploadChange,
	onUploadClick,
	ready,
	uploadInputRef,
}) => (
	<aside className="flex w-13 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-[#282a2f] px-1.5 py-2 max-lg:h-13 max-lg:w-full max-lg:flex-row max-lg:border-b max-lg:border-r-0">
		<WorkbenchIconButton
			label="选择"
			icon={<MousePointer2 className="size-4" />}
			active={activeTool === "select"}
			disabled={!ready}
			onClick={onSelectPointer}
		/>
		<WorkbenchIconButton
			label="画笔"
			icon={<Paintbrush className="size-4" />}
			active={activeTool === "brush"}
			disabled={!ready}
			onClick={onSelectBrush}
		/>
		<WorkbenchIconButton
			label="上传贴纸"
			icon={
				busyTool === "upload" ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Upload className="size-4" />
				)
			}
			disabled={!ready || busyTool !== null}
			onClick={onUploadClick}
		/>
		<WorkbenchIconButton
			label="添加文字"
			icon={<Type className="size-4" />}
			disabled={!ready}
			onClick={onAddText}
		/>
		<WorkbenchIconButton
			label="矩形"
			icon={<Square className="size-4" />}
			disabled={!ready}
			onClick={onAddRectangle}
		/>
		<WorkbenchIconButton
			label="马赛克"
			icon={<Grid3X3 className="size-4" />}
			disabled={!ready}
			onClick={onAddMosaic}
		/>
		<div className="my-1 h-px w-7 bg-white/10 max-lg:mx-1 max-lg:h-7 max-lg:w-px" />
		<WorkbenchIconButton
			label="删除"
			icon={<Trash2 className="size-4" />}
			disabled={!hasSelection}
			onClick={onDeleteSelection}
		/>
		<WorkbenchIconButton
			label="重置"
			icon={<RotateCcw className="size-4" />}
			disabled={!ready}
			onClick={onResetCanvas}
		/>
		<input
			ref={uploadInputRef}
			type="file"
			accept="image/*"
			className="hidden"
			onChange={onUploadChange}
		/>
	</aside>
);

const ImageStickerCanvasTopbar: React.FC<{
	canRedo: boolean;
	canUndo: boolean;
	canvasSizeLabel: string;
	hasSelection: boolean;
	onMoveSelection: (direction: "backward" | "forward") => void;
	onRedo: () => void;
	onUndo: () => void;
	selectionCount: number;
}> = ({
	canRedo,
	canUndo,
	canvasSizeLabel,
	hasSelection,
	onMoveSelection,
	onRedo,
	onUndo,
	selectionCount,
}) => (
	<div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#26282d] px-3 text-[0.6875rem] text-[#c0c5cf]">
		<div className="flex min-w-0 items-center gap-1">
			<TopbarButton
				label="撤销"
				icon={<Undo2 className="size-4" />}
				disabled={!canUndo}
				onClick={onUndo}
			/>
			<TopbarButton
				label="重做"
				icon={<Undo2 className="size-4 rotate-180" />}
				disabled={!canRedo}
				onClick={onRedo}
			/>
			<span className="mx-1 h-4 w-px bg-white/10" />
			<TopbarButton
				label="前移"
				icon={<ArrowUp className="size-4" />}
				disabled={!hasSelection}
				onClick={() => onMoveSelection("forward")}
			/>
			<TopbarButton
				label="后移"
				icon={<ArrowDown className="size-4" />}
				disabled={!hasSelection}
				onClick={() => onMoveSelection("backward")}
			/>
		</div>
		<div className="hidden min-w-0 items-center gap-3 tabular-nums sm:flex">
			<span className="truncate">{canvasSizeLabel}</span>
			<span>{hasSelection ? `已选 ${selectionCount}` : "未选择"}</span>
		</div>
	</div>
);

const ImageStickerCanvasStage: React.FC<{
	loadError: string | null;
	onCanvasElement: (node: HTMLCanvasElement | null) => void;
	ready: boolean;
}> = ({ loadError, onCanvasElement, ready }) => (
	<section className="relative min-h-[24rem] min-w-0 flex-1 overflow-hidden bg-[#151619] max-lg:min-h-0">
		<div
			className="pointer-events-none absolute left-8 right-0 top-0 z-10 h-6 border-b border-white/10 bg-[#202226]"
			style={{
				backgroundImage:
					"repeating-linear-gradient(90deg, rgba(255,255,255,.18) 0 1px, transparent 1px 40px)",
			}}
		/>
		<div
			className="pointer-events-none absolute bottom-0 left-0 top-6 z-10 w-8 border-r border-white/10 bg-[#202226]"
			style={{
				backgroundImage:
					"repeating-linear-gradient(0deg, rgba(255,255,255,.16) 0 1px, transparent 1px 40px)",
			}}
		/>
		<div className="pointer-events-none absolute left-0 top-0 z-10 size-8 border-b border-r border-white/10 bg-[#2a2d32]" />
		<div className="h-full w-full overflow-auto pl-8 pt-6">
			<div className="flex min-h-full min-w-max items-center justify-center p-8">
				<div
					className={cn(
						"relative inline-flex shrink-0 items-center justify-center border border-black/80 bg-[#30343a] p-3 shadow-[0_24px_80px_rgba(0,0,0,.42)]",
						!ready && "opacity-60",
					)}
				>
					<div
						className="absolute inset-3"
						style={{
							backgroundColor: "#3a3d42",
							backgroundImage:
								"linear-gradient(45deg, #2f3237 25%, transparent 25%), linear-gradient(-45deg, #2f3237 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2f3237 75%), linear-gradient(-45deg, transparent 75%, #2f3237 75%)",
							backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
							backgroundSize: "16px 16px",
						}}
					/>
					<canvas ref={onCanvasElement} className="relative z-10" />
				</div>
			</div>
		</div>
		{!ready && !loadError ? (
			<div className="absolute inset-0 z-20 flex items-center justify-center bg-[#151619]/50">
				<Loader2 className="size-6 animate-spin text-[#c0c5cf]" />
			</div>
		) : null}
		{loadError ? (
			<div
				role="alert"
				className="absolute left-1/2 top-1/2 z-20 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-red-400/40 bg-[#2a1f22] p-4 text-center text-xs leading-5 text-red-200 shadow-lg"
			>
				{loadError}
			</div>
		) : null}
	</section>
);

const ImageStickerStatusBar: React.FC<{
	canvasSizeLabel: string;
	editableLayerCount: number;
	loadError: string | null;
	ready: boolean;
}> = ({ canvasSizeLabel, editableLayerCount, loadError, ready }) => (
	<footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-[#2b2d31] px-3 text-[0.6875rem] text-[#b9bec8]">
		<span>{ready ? "就绪" : loadError ? "载入失败" : "载入中"}</span>
		<span className="tabular-nums">
			{canvasSizeLabel} · {editableLayerCount} 图层
		</span>
	</footer>
);

const ImageStickerInspector: React.FC<{
	activeTool: ImageStickerEditorDialogController["activeTool"];
	brushColor: string;
	brushWidth: number;
	busyTool: string | null;
	editableLayerCount: number;
	hasSelection: boolean;
	hasShapeSelection: boolean;
	layerSummary: ImageStickerEditorDialogController["layerSummary"];
	onAddImageSticker: (dataUrl: string, label: string) => Promise<void>;
	onChangeBrushColor: (color: string) => void;
	onChangeBrushWidth: (event: React.ChangeEvent<HTMLInputElement>) => void;
	onChangeSelectionOpacity: (event: React.ChangeEvent<HTMLInputElement>) => void;
	onChangeShapeAngle: (event: React.ChangeEvent<HTMLInputElement>) => void;
	onChangeShapeColor: (color: string) => void;
	onDeleteSelection: () => void;
	onMoveSelection: (direction: "backward" | "forward") => void;
	onResetCanvas: () => void;
	ready: boolean;
	saveError: string | null;
	selectedOpacity: number;
	selectedShapeAngle: number;
	selectedShapeColor: string;
}> = ({
	activeTool,
	brushColor,
	brushWidth,
	busyTool,
	editableLayerCount,
	hasSelection,
	hasShapeSelection,
	layerSummary,
	onAddImageSticker,
	onChangeBrushColor,
	onChangeBrushWidth,
	onChangeSelectionOpacity,
	onChangeShapeAngle,
	onChangeShapeColor,
	onDeleteSelection,
	onMoveSelection,
	onResetCanvas,
	ready,
	saveError,
	selectedOpacity,
	selectedShapeAngle,
	selectedShapeColor,
}) => (
	<aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-[#25272c] max-xl:w-64 max-lg:h-72 max-lg:max-h-72 max-lg:w-full max-lg:border-l-0 max-lg:border-t">
		<PanelSection title="贴纸库" icon={<ImagePlus className="size-4" />}>
			<div className="grid grid-cols-2 gap-2">
				{stickerPresets.map((preset) => (
					<button
						key={preset.id}
						type="button"
						disabled={!ready || busyTool !== null}
						className="flex min-w-0 items-center gap-2 rounded-sm border border-white/10 bg-[#303238] px-2 py-2 text-left text-xs text-[#d7dbe3] transition hover:border-[#4d8bff] hover:bg-[#343943] disabled:cursor-not-allowed disabled:opacity-45"
						onClick={() => void onAddImageSticker(preset.source, preset.id)}
					>
						<span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-white/10 bg-[#1d1f23]">
							<img src={preset.source} alt="" className="size-6 object-contain" />
						</span>
						<span className="min-w-0 truncate">{preset.label}</span>
					</button>
				))}
			</div>
		</PanelSection>

		<PanelSection
			title="属性"
			icon={<SlidersHorizontal className="size-4" />}
			aside={
				activeTool === "brush" ? `${brushWidth}px` : hasSelection ? `${selectedOpacity}%` : "--"
			}
		>
			<div className="grid gap-2 text-xs text-[#b9bec8]">
				<span className="flex items-center gap-2 font-medium text-[#d7dbe3]">
					<Palette className="size-4" />
					颜色
				</span>
				<div className="flex flex-wrap items-center gap-1.5">
					{rectangleColorOptions.map((color) => (
						<button
							key={color}
							type="button"
							aria-label={activeTool === "brush" ? `画笔颜色 ${color}` : `矩形颜色 ${color}`}
							disabled={!ready || (activeTool !== "brush" && !hasShapeSelection)}
							className={cn(
								"size-6 rounded-sm border border-white/20 shadow-sm transition disabled:cursor-not-allowed disabled:opacity-35",
								(activeTool === "brush" ? brushColor : selectedShapeColor) === color &&
									"ring-2 ring-[#7fb1ff] ring-offset-1 ring-offset-[#25272c]",
							)}
							style={{ backgroundColor: color }}
							onClick={() =>
								activeTool === "brush" ? onChangeBrushColor(color) : onChangeShapeColor(color)
							}
						/>
					))}
					<input
						type="color"
						aria-label={activeTool === "brush" ? "自定义画笔颜色" : "自定义矩形颜色"}
						value={activeTool === "brush" ? brushColor : selectedShapeColor}
						disabled={!ready || (activeTool !== "brush" && !hasShapeSelection)}
						className="size-7 rounded-sm border border-white/20 bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-35"
						onChange={(event) =>
							activeTool === "brush"
								? onChangeBrushColor(event.currentTarget.value)
								: onChangeShapeColor(event.currentTarget.value)
						}
					/>
				</div>
			</div>
			<label className="grid gap-1.5 text-xs text-[#b9bec8]">
				<span className="flex items-center justify-between gap-2">
					<span>画笔粗细</span>
					<span className="tabular-nums text-[#e8eaed]">
						{activeTool === "brush" ? `${brushWidth}px` : "--"}
					</span>
				</span>
				<input
					type="range"
					aria-label="画笔粗细"
					min={1}
					max={32}
					step={1}
					value={brushWidth}
					disabled={!ready || activeTool !== "brush"}
					className="h-2 w-full accent-[#4d8bff] disabled:opacity-35"
					onChange={onChangeBrushWidth}
				/>
			</label>
			<label className="grid gap-1.5 text-xs text-[#b9bec8]">
				<span className="flex items-center justify-between gap-2">
					<span>旋转</span>
					<span className="tabular-nums text-[#e8eaed]">
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
					className="h-2 w-full accent-[#4d8bff] disabled:opacity-35"
					onChange={onChangeShapeAngle}
				/>
			</label>
			<label className="grid gap-1.5 text-xs text-[#b9bec8]">
				<span className="flex items-center justify-between gap-2">
					<span>透明度</span>
					<span className="tabular-nums text-[#e8eaed]">
						{hasSelection ? `${selectedOpacity}%` : "--"}
					</span>
				</span>
				<input
					type="range"
					min={10}
					max={100}
					step={5}
					value={selectedOpacity}
					disabled={!ready || !hasSelection}
					className="h-2 w-full accent-[#4d8bff] disabled:opacity-35"
					onChange={onChangeSelectionOpacity}
				/>
			</label>
		</PanelSection>

		<PanelSection title="图层" icon={<Layers className="size-4" />} aside={editableLayerCount}>
			<div className="grid gap-1.5">
				<LayerRow label="原图" count={1} active={!hasSelection} />
				<LayerRow label="贴纸" count={layerSummary.sticker} />
				<LayerRow label="文字" count={layerSummary.text} />
				<LayerRow label="画笔" count={layerSummary.drawing} />
				<LayerRow label="标注" count={layerSummary.shape} />
				<LayerRow label="马赛克" count={layerSummary.mosaic} />
			</div>
		</PanelSection>

		<PanelSection title="排列" icon={<PanelRight className="size-4" />}>
			<div className="grid grid-cols-2 gap-2">
				<PanelButton
					label="前移"
					icon={<ArrowUp className="size-4" />}
					disabled={!hasSelection}
					onClick={() => onMoveSelection("forward")}
				/>
				<PanelButton
					label="后移"
					icon={<ArrowDown className="size-4" />}
					disabled={!hasSelection}
					onClick={() => onMoveSelection("backward")}
				/>
				<PanelButton
					label="删除"
					icon={<Trash2 className="size-4" />}
					disabled={!hasSelection}
					onClick={onDeleteSelection}
				/>
				<PanelButton
					label="重置"
					icon={<RotateCcw className="size-4" />}
					disabled={!ready}
					onClick={onResetCanvas}
				/>
			</div>
		</PanelSection>

		{saveError ? (
			<div
				role="alert"
				className="border-t border-white/10 px-3 py-2 text-xs leading-5 text-red-200"
			>
				{saveError}
			</div>
		) : null}
	</aside>
);

const WorkbenchIconButton: React.FC<{
	active?: boolean;
	disabled?: boolean;
	icon: React.ReactNode;
	label: string;
	onClick?: () => void;
}> = ({ active = false, disabled, icon, label, onClick }) => (
	<button
		type="button"
		aria-label={label}
		aria-pressed={active}
		title={label}
		disabled={disabled}
		className={cn(
			"flex size-9 shrink-0 items-center justify-center rounded-sm border text-[#c9ced8] transition hover:border-white/10 hover:bg-[#343943] hover:text-white disabled:cursor-not-allowed disabled:opacity-35",
			active ? "border-[#4d8bff]/70 bg-[#213452] text-white" : "border-transparent",
		)}
		onClick={onClick}
	>
		{icon}
	</button>
);

const TopbarButton: React.FC<{
	disabled?: boolean;
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
}> = ({ disabled, icon, label, onClick }) => (
	<button
		type="button"
		aria-label={label}
		title={label}
		disabled={disabled}
		className="flex h-7 items-center gap-1 rounded-sm px-2 text-[#c9ced8] transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
		onClick={onClick}
	>
		{icon}
		<span className="hidden text-[0.6875rem] sm:inline">{label}</span>
	</button>
);

const PanelSection: React.FC<{
	aside?: React.ReactNode;
	children: React.ReactNode;
	icon: React.ReactNode;
	title: string;
}> = ({ aside, children, icon, title }) => (
	<section className="border-b border-white/10">
		<header className="flex h-9 items-center justify-between gap-2 bg-[#2b2d31] px-3 text-xs font-semibold text-[#e8eaed]">
			<span className="flex min-w-0 items-center gap-2">
				{icon}
				<span className="truncate">{title}</span>
			</span>
			{aside !== undefined ? (
				<span className="shrink-0 text-[0.6875rem] font-medium tabular-nums text-[#aeb4c0]">
					{aside}
				</span>
			) : null}
		</header>
		<div className="grid gap-3 p-3">{children}</div>
	</section>
);

const PanelButton: React.FC<{
	disabled?: boolean;
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
}> = ({ disabled, icon, label, onClick }) => (
	<button
		type="button"
		disabled={disabled}
		className="flex h-8 items-center justify-center gap-1.5 rounded-sm border border-white/10 bg-[#303238] px-2 text-xs font-medium text-[#d7dbe3] transition hover:border-[#4d8bff] hover:bg-[#343943] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
		onClick={onClick}
	>
		{icon}
		<span>{label}</span>
	</button>
);

const LayerRow: React.FC<{ active?: boolean; count: number; label: string }> = ({
	active,
	count,
	label,
}) => (
	<div
		className={cn(
			"flex h-8 items-center justify-between gap-2 rounded-sm border px-2 text-xs",
			active
				? "border-[#4d8bff]/60 bg-[#213452] text-[#dbe8ff]"
				: "border-white/10 bg-[#303238] text-[#c9ced8]",
		)}
	>
		<span className="min-w-0 truncate">{label}</span>
		<span className="rounded-sm bg-black/20 px-1.5 py-0.5 text-[0.625rem] tabular-nums text-[#aeb4c0]">
			{count}
		</span>
	</div>
);

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
