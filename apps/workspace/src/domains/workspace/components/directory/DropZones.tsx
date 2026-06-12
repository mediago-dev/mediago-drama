import { useDroppable } from "@dnd-kit/core";
import type React from "react";
import type { FolderMovePosition } from "@/domains/documents/stores";
import { cn } from "@/shared/lib/utils";
import type { DirectoryDragPreviewData, DirectoryDropData } from "./types";
import { folderDropId, rootDropId, rootTailDropId } from "./types";

export const DirectoryRootDropZone: React.FC<{
	children: React.ReactNode;
	isActive: boolean;
}> = ({ children, isActive }) => {
	const { setNodeRef } = useDroppable({
		id: rootDropId,
		data: {
			dropTarget: { folderId: null, position: "inside" } satisfies DirectoryDropData,
		},
	});

	return (
		<div
			ref={setNodeRef}
			className={cn("space-y-1", isActive && "rounded-sm bg-ide-list-hover/40")}
		>
			{children}
			<DirectoryRootTailDropZone />
		</div>
	);
};

const DirectoryRootTailDropZone: React.FC = () => {
	const { setNodeRef } = useDroppable({
		id: rootTailDropId,
		data: {
			dropTarget: { folderId: null, position: "inside" } satisfies DirectoryDropData,
		},
	});

	return <div ref={setNodeRef} className="h-14" data-testid="directory-root-drop-tail" />;
};

export const FolderDropZones: React.FC<{ folderId: string }> = ({ folderId }) => (
	<div className="pointer-events-none absolute inset-0">
		<FolderDropZone
			folderId={folderId}
			position="before"
			className="absolute inset-x-0 top-0 h-2"
		/>
		<FolderDropZone
			folderId={folderId}
			position="after"
			className="absolute inset-x-0 bottom-0 h-2"
		/>
	</div>
);

const FolderDropZone: React.FC<{
	className: string;
	folderId: string;
	position: FolderMovePosition;
}> = ({ className, folderId, position }) => {
	const { setNodeRef } = useDroppable({
		id: folderDropId(folderId, position),
		data: {
			dropTarget: { folderId, position } satisfies DirectoryDropData,
		},
	});

	return <div ref={setNodeRef} className={className} />;
};

export const DirectoryDragPreview: React.FC<{ preview: DirectoryDragPreviewData }> = ({
	preview,
}) => {
	const PreviewIcon = preview.icon;

	return (
		<div className="flex h-7 w-72 max-w-[min(18rem,70vw)] items-center gap-1.5 rounded-sm border border-border bg-popover/95 px-2 text-xs text-popover-foreground shadow-lg backdrop-blur">
			<PreviewIcon
				className="size-3.5 shrink-0"
				style={preview.colorVar ? { color: `var(${preview.colorVar})` } : undefined}
			/>
			<span className="min-w-0 flex-1 truncate">{preview.title}</span>
			{preview.detail ? (
				<span className="shrink-0 rounded-sm bg-ide-toolbar px-1 py-0.5 text-2xs leading-none text-muted-foreground">
					{preview.detail}
				</span>
			) : null}
		</div>
	);
};
