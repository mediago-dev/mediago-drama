import { useCallback, useId, useLayoutEffect, useState } from "react";
import { createStore } from "@/shared/lib/utils";

interface DialogLayerState {
	activate: (id: string) => void;
	deactivate: (id: string) => void;
	layerIds: string[];
}

export const useDialogLayerStore = createStore<DialogLayerState>(
	(set) => ({
		layerIds: [],
		activate: (id) =>
			set((state) => {
				const nextLayerIds = [...state.layerIds.filter((layerId) => layerId !== id), id];
				if (
					nextLayerIds.length === state.layerIds.length &&
					nextLayerIds.every((layerId, index) => layerId === state.layerIds[index])
				) {
					return state;
				}
				return { layerIds: nextLayerIds };
			}),
		deactivate: (id) =>
			set((state) => {
				if (!state.layerIds.includes(id)) return state;
				return { layerIds: state.layerIds.filter((layerId) => layerId !== id) };
			}),
	}),
	"dialogLayerStore",
);

interface DialogDismissEvent {
	preventDefault: () => void;
}

interface UseDialogLayerOptions {
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
}

export interface DialogLayerController {
	isTop: boolean;
	layerId: string;
	open: boolean;
	portalContainer: HTMLElement | null;
	preventDismissWhenCovered: (event: DialogDismissEvent) => void;
	requestOpenChange: (open: boolean) => void;
}

export const useDialogLayer = ({
	defaultOpen = false,
	onOpenChange,
	open: controlledOpen,
}: UseDialogLayerOptions): DialogLayerController => {
	const layerId = useId();
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
	const [portalContainer] = useState<HTMLElement | null>(() => {
		if (typeof document === "undefined") return null;
		const container = document.createElement("div");
		container.dataset.dialogLayer = "";
		return container;
	});
	const open = controlledOpen ?? uncontrolledOpen;
	const isTop = useDialogLayerStore(
		(state) => open && state.layerIds[state.layerIds.length - 1] === layerId,
	);

	useLayoutEffect(() => {
		if (!portalContainer) return;
		portalContainer.dataset.dialogLayerId = layerId;

		return () => {
			useDialogLayerStore.getState().deactivate(layerId);
			portalContainer.remove();
		};
	}, [layerId, portalContainer]);

	useLayoutEffect(() => {
		if (!portalContainer || !open) {
			useDialogLayerStore.getState().deactivate(layerId);
			return;
		}

		document.body.append(portalContainer);
		useDialogLayerStore.getState().activate(layerId);

		return () => useDialogLayerStore.getState().deactivate(layerId);
	}, [layerId, open, portalContainer]);

	useLayoutEffect(() => {
		if (!portalContainer) return;
		portalContainer.dataset.dialogLayerState = open ? (isTop ? "top" : "covered") : "closed";
	}, [isTop, open, portalContainer]);

	const requestOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen && open && !isTop) return;
			if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
			onOpenChange?.(nextOpen);
		},
		[controlledOpen, isTop, onOpenChange, open],
	);

	const preventDismissWhenCovered = useCallback(
		(event: DialogDismissEvent) => {
			if (open && !isTop) event.preventDefault();
		},
		[isTop, open],
	);

	return {
		isTop,
		layerId,
		open,
		portalContainer,
		preventDismissWhenCovered,
		requestOpenChange,
	};
};
