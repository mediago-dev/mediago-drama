import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GenerationModalShell,
	isPhotoViewPortalOpen,
	isPhotoViewPortalTarget,
} from "@/domains/documents/components/GenerationModalShell";

const waitForRadixOutsideListeners = () => new Promise((resolve) => window.setTimeout(resolve, 0));

const fireRadixOutsideClick = async (target: Element) => {
	await waitForRadixOutsideListeners();
	fireEvent.pointerDown(target, { button: 0 });
	fireEvent.click(target);
	await waitForRadixOutsideListeners();
};

describe("GenerationModalShell", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
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

	it("recognizes when the PhotoView portal is open", () => {
		expect(isPhotoViewPortalOpen()).toBe(false);

		const photoViewPortal = document.createElement("div");
		photoViewPortal.className = "PhotoView-Portal";
		document.body.append(photoViewPortal);

		expect(isPhotoViewPortalOpen()).toBe(true);
	});

	it("lets Radix associate the dialog title without accessibility warnings", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		render(
			<GenerationModalShell
				open
				title="生成视觉素材"
				titleId="section-generation-title"
				onOpenChange={vi.fn()}
			>
				<div>生成内容</div>
			</GenerationModalShell>,
		);

		await waitForRadixOutsideListeners();

		const radixMessages = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
			.flat()
			.map(String)
			.filter(
				(message) =>
					message.includes("DialogContent") ||
					message.includes("DialogTitle") ||
					message.includes("aria-describedby"),
			);
		expect(radixMessages).toEqual([]);
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
		await fireRadixOutsideClick(photoViewClose);

		await waitFor(() => expect(onOpenChange).not.toHaveBeenCalled());

		await fireRadixOutsideClick(outsideButton);

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		expect(screen.getByText("生成内容").textContent).toBe("生成内容");
	});

	it("keeps the generation modal open when PhotoView handles escape", async () => {
		const onOpenChange = vi.fn();
		const photoViewPortal = document.createElement("div");

		photoViewPortal.className = "PhotoView-Portal";
		document.body.append(photoViewPortal);

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
		fireEvent.keyDown(document, { key: "Escape" });

		await waitFor(() => expect(onOpenChange).not.toHaveBeenCalled());
		expect(screen.getByText("生成内容").textContent).toBe("生成内容");
	});

	it("keeps the default escape close when no PhotoView preview is open", async () => {
		const onOpenChange = vi.fn();

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
		fireEvent.keyDown(document, { key: "Escape" });

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});
});
