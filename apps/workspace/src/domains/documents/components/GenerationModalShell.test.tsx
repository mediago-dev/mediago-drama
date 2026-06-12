import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GenerationModalShell,
	isPhotoViewPortalTarget,
} from "@/domains/documents/components/GenerationModalShell";

const waitForRadixOutsideListeners = () => new Promise((resolve) => window.setTimeout(resolve, 0));

describe("GenerationModalShell", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("recognizes events coming from the PhotoView portal", () => {
		const portal = document.createElement("div");
		const closeButton = document.createElement("button");
		const closeLabel = document.createTextNode("close");

		portal.className = "PhotoView-Portal";
		closeButton.append(closeLabel);
		portal.append(closeButton);

		expect(isPhotoViewPortalTarget(closeButton)).toBe(true);
		expect(isPhotoViewPortalTarget(closeLabel)).toBe(true);
		expect(isPhotoViewPortalTarget(document.createElement("button"))).toBe(false);
		expect(isPhotoViewPortalTarget(null)).toBe(false);
	});

	it("keeps the generation modal open when PhotoView emits an outside pointer event", async () => {
		const onOpenChange = vi.fn();
		const outsideButton = document.createElement("button");
		const photoViewPortal = document.createElement("div");
		const photoViewClose = document.createElement("button");

		photoViewPortal.className = "PhotoView-Portal";
		photoViewPortal.append(photoViewClose);
		document.body.append(outsideButton, photoViewPortal);

		render(
			<GenerationModalShell
				open
				title="生成视觉素材"
				titleId="section-generation-title"
				onOpenChange={onOpenChange}
			>
				<div>生成内容</div>
			</GenerationModalShell>,
		);

		await waitForRadixOutsideListeners();
		fireEvent.pointerDown(photoViewClose);

		await waitFor(() => expect(onOpenChange).not.toHaveBeenCalled());

		fireEvent.pointerDown(outsideButton);

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		expect(screen.getByText("生成内容").textContent).toBe("生成内容");
	});
});
