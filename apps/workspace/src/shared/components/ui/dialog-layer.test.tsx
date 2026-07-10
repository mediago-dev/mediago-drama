import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogLayer, useDialogLayerStore } from "./dialog-layer";

const resetLayers = () => useDialogLayerStore.setState({ layerIds: [] });

describe("dialog layer registry", () => {
	beforeEach(resetLayers);
	afterEach(() => {
		cleanup();
		resetLayers();
		document.querySelectorAll("[data-dialog-layer]").forEach((element) => element.remove());
	});

	it("orders active layer ids and supports removing a middle layer", () => {
		const { activate, deactivate } = useDialogLayerStore.getState();

		act(() => activate("a"));
		act(() => activate("b"));
		expect(useDialogLayerStore.getState().layerIds).toEqual(["a", "b"]);

		act(() => activate("a"));
		expect(useDialogLayerStore.getState().layerIds).toEqual(["b", "a"]);

		act(() => deactivate("b"));
		expect(useDialogLayerStore.getState().layerIds).toEqual(["a"]);

		act(() => deactivate("missing"));
		expect(useDialogLayerStore.getState().layerIds).toEqual(["a"]);
	});

	it("moves the latest opened portal container to the end of body", () => {
		const { rerender } = render(
			<>
				<LayerProbe name="lower" open />
				<LayerProbe name="upper" open={false} />
			</>,
		);

		expect(layerNames()).toEqual(["lower"]);
		expect(screen.getByTestId("lower")).toHaveAttribute("data-is-top", "true");

		rerender(
			<>
				<LayerProbe name="lower" open />
				<LayerProbe name="upper" open />
			</>,
		);

		expect(layerNames()).toEqual(["lower", "upper"]);
		expect(screen.getByTestId("lower")).toHaveAttribute("data-is-top", "false");
		expect(screen.getByTestId("upper")).toHaveAttribute("data-is-top", "true");
	});

	it("keeps a closed container for exit animation and removes it on unmount", () => {
		const { rerender, unmount } = render(<LayerProbe name="dialog" open />);
		const container = document.querySelector<HTMLElement>('[data-dialog-layer-name="dialog"]');

		expect(container).not.toBeNull();
		expect(container).toHaveAttribute("data-dialog-layer-state", "top");

		rerender(<LayerProbe name="dialog" open={false} />);
		expect(container?.isConnected).toBe(true);
		expect(container).toHaveAttribute("data-dialog-layer-state", "closed");
		expect(useDialogLayerStore.getState().layerIds).toEqual([]);

		unmount();
		expect(container?.isConnected).toBe(false);
	});

	it("allows only the top layer to request dismissal", () => {
		const onLowerOpenChange = vi.fn();
		const onUpperOpenChange = vi.fn();

		render(
			<>
				<LayerProbe name="lower" open onOpenChange={onLowerOpenChange} />
				<LayerProbe name="upper" open onOpenChange={onUpperOpenChange} />
			</>,
		);

		fireEvent.click(screen.getByRole("button", { name: "close lower" }));
		fireEvent.click(screen.getByRole("button", { name: "close upper" }));

		expect(onLowerOpenChange).not.toHaveBeenCalled();
		expect(onUpperOpenChange).toHaveBeenCalledWith(false);
	});

	it("cleans up StrictMode registrations", () => {
		const { unmount } = render(
			<StrictMode>
				<LayerProbe name="strict" open />
			</StrictMode>,
		);

		expect(useDialogLayerStore.getState().layerIds).toHaveLength(1);
		expect(layerNames()).toEqual(["strict"]);

		unmount();
		expect(useDialogLayerStore.getState().layerIds).toEqual([]);
		expect(layerNames()).toEqual([]);
	});

	it("supports an uncontrolled default-open layer", () => {
		render(<UncontrolledLayerProbe />);

		expect(screen.getByTestId("uncontrolled")).toHaveAttribute("data-open", "true");
		fireEvent.click(screen.getByRole("button", { name: "close uncontrolled" }));
		expect(screen.getByTestId("uncontrolled")).toHaveAttribute("data-open", "false");
	});
});

const LayerProbe = ({
	name,
	onOpenChange,
	open,
}: {
	name: string;
	onOpenChange?: (open: boolean) => void;
	open: boolean;
}) => {
	const layer = useDialogLayer({ onOpenChange, open });

	if (layer.portalContainer) layer.portalContainer.dataset.dialogLayerName = name;

	return (
		<div data-testid={name} data-is-top={String(layer.isTop)}>
			<button type="button" onClick={() => layer.requestOpenChange(false)}>
				close {name}
			</button>
		</div>
	);
};

const UncontrolledLayerProbe = () => {
	const [lastOpen, setLastOpen] = useState(true);
	const layer = useDialogLayer({
		defaultOpen: true,
		onOpenChange: setLastOpen,
	});

	return (
		<div data-testid="uncontrolled" data-open={String(layer.open && lastOpen)}>
			<button type="button" onClick={() => layer.requestOpenChange(false)}>
				close uncontrolled
			</button>
		</div>
	);
};

const layerNames = () =>
	Array.from(document.querySelectorAll<HTMLElement>("[data-dialog-layer-name]")).map(
		(element) => element.dataset.dialogLayerName,
	);
