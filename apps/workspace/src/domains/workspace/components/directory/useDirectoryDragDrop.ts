import {
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useState } from "react";
import type { DocumentFolder, FolderMovePosition } from "@/domains/documents/stores";
import type { DirectoryDropData, DragPayload } from "./types";
import { resolveDndDropTarget } from "./helpers";

interface UseDirectoryDragDropOptions {
	canMutate: boolean;
	folders: DocumentFolder[];
	moveFolder: (folderId: string, parentId: string | null, position?: FolderMovePosition) => void;
	moveItemToFolder: (kind: "document" | "asset", id: string, folderId: string | null) => void;
	onAutoExpandFolder: (folderId: string) => void;
}

export const useDirectoryDragDrop = ({
	canMutate,
	folders,
	moveFolder,
	moveItemToFolder,
	onAutoExpandFolder,
}: UseDirectoryDragDropOptions) => {
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 4 },
		}),
	);
	const [dropTarget, setDropTarget] = useState<ReturnType<typeof resolveDndDropTarget>>(null);
	const [activePayload, setActivePayload] = useState<DragPayload | null>(null);
	const autoExpandFolderId =
		activePayload && dropTarget?.position === "inside" ? dropTarget.folderId : null;

	useEffect(() => {
		if (!autoExpandFolderId) return;

		const timerId = window.setTimeout(() => {
			onAutoExpandFolder(autoExpandFolderId);
		}, 500);

		return () => window.clearTimeout(timerId);
	}, [autoExpandFolderId, onAutoExpandFolder]);

	const clearDragState = useCallback(() => {
		setDropTarget(null);
		setActivePayload(null);
	}, []);

	const moveDragPayloadToFolder = useCallback(
		(payload: DragPayload, folderId: string | null, position: FolderMovePosition = "inside") => {
			if (!canMutate) return;
			if (payload.kind === "folder") {
				moveFolder(payload.id, folderId, position);
				return;
			}
			moveItemToFolder(payload.kind, payload.id, folderId);
		},
		[canMutate, moveFolder, moveItemToFolder],
	);

	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			if (!canMutate) return;
			const payload = event.active.data.current?.payload as DragPayload | undefined;
			if (!payload) return;
			setActivePayload(payload);
			setDropTarget(null);
		},
		[canMutate],
	);

	const handleDragOver = useCallback(
		(event: DragOverEvent) => {
			if (!canMutate) return;
			const payload =
				activePayload ?? (event.active.data.current?.payload as DragPayload | undefined);
			if (!payload) {
				setDropTarget(null);
				return;
			}
			const nextDropTarget = resolveDndDropTarget(
				payload,
				event.over?.data.current?.dropTarget as DirectoryDropData | undefined,
				folders,
			);
			setDropTarget(nextDropTarget);
		},
		[activePayload, canMutate, folders],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			if (!canMutate) {
				clearDragState();
				return;
			}
			const payload =
				activePayload ?? (event.active.data.current?.payload as DragPayload | undefined);
			const nextDropTarget = payload
				? (resolveDndDropTarget(
						payload,
						event.over?.data.current?.dropTarget as DirectoryDropData | undefined,
						folders,
					) ?? dropTarget)
				: null;
			if (payload && nextDropTarget) {
				moveDragPayloadToFolder(payload, nextDropTarget.folderId, nextDropTarget.position);
			}
			clearDragState();
		},
		[activePayload, canMutate, clearDragState, dropTarget, folders, moveDragPayloadToFolder],
	);

	return {
		activePayload,
		clearDragState,
		dropTarget,
		handleDragEnd,
		handleDragOver,
		handleDragStart,
		sensors,
	};
};
