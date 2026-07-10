import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
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
		cleanup();
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

	it("keeps the lower dialog open and mounted while a later dialog is open", async () => {
		render(<LayeredGenerationModalHarness />);

		const lowerDialog = screen.getByRole("dialog", { name: "资源列表" });
		const lowerInput = screen.getByRole("textbox", { name: "资源备注" });
		fireEvent.change(lowerInput, { target: { value: "保留这段输入" } });

		fireEvent.click(screen.getByRole("button", { name: "打开生成图片" }));
		const upperDialog = await screen.findByRole("dialog", { name: "生成图片" });

		expect(lowerDialog).toHaveAttribute("data-state", "open");
		expect(upperDialog).toHaveAttribute("data-state", "open");
		expect(screen.getByRole("textbox", { name: "资源备注", hidden: true })).toBe(lowerInput);
		expect(lowerInput).toHaveValue("保留这段输入");

		fireEvent.pointerDown(screen.getByRole("button", { name: "发送生成" }), { button: 0 });
		fireEvent.click(screen.getByRole("button", { name: "发送生成" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "生成图片" })).toBeNull();
		});
		expect(screen.getByRole("dialog", { name: "资源列表" })).toBe(lowerDialog);
		expect(screen.getByRole("textbox", { name: "资源备注" })).toBe(lowerInput);
		expect(lowerInput).toHaveValue("保留这段输入");
	});

	it("keeps the lower dialog open when the upper header close button is clicked", async () => {
		render(<LayeredGenerationModalHarness />);
		await waitForRadixOutsideListeners();

		const lowerDialog = screen.getByRole("dialog", { name: "资源列表" });
		fireEvent.click(screen.getByRole("button", { name: "打开生成图片" }));
		const upperDialog = await screen.findByRole("dialog", { name: "生成图片" });
		const upperCloseButton = within(upperDialog).getByRole("button", { name: "关闭弹窗" });
		const documentPointerDown = vi.fn();
		document.addEventListener("pointerdown", documentPointerDown);

		fireEvent.pointerDown(upperCloseButton, { button: 0 });
		document.removeEventListener("pointerdown", documentPointerDown);
		expect(documentPointerDown).not.toHaveBeenCalled();
		fireEvent.click(upperCloseButton);

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "生成图片" })).toBeNull();
		});
		expect(screen.getByRole("dialog", { name: "资源列表" })).toBe(lowerDialog);
		expect(lowerDialog).toHaveAttribute("data-state", "open");
	});

	it("closes one generation modal per Escape key press", async () => {
		render(<LayeredGenerationModalHarness upperInitiallyOpen />);
		await waitForRadixOutsideListeners();

		fireEvent.keyDown(document, { key: "Escape" });

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "生成图片" })).toBeNull();
		});
		expect(screen.getByRole("dialog", { name: "资源列表" })).toBeTruthy();

		fireEvent.keyDown(document, { key: "Escape" });

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "资源列表" })).toBeNull();
		});
	});
});

const LayeredGenerationModalHarness = ({ upperInitiallyOpen = false }) => {
	const [lowerOpen, setLowerOpen] = useState(true);
	const [upperOpen, setUpperOpen] = useState(upperInitiallyOpen);

	return (
		<>
			<GenerationModalShell
				open={lowerOpen}
				title="资源列表"
				titleId="resource-list-title"
				onOpenChange={setLowerOpen}
			>
				<label>
					<span>资源备注</span>
					<input aria-label="资源备注" defaultValue="" />
				</label>
				<button type="button" onClick={() => setUpperOpen(true)}>
					打开生成图片
				</button>
			</GenerationModalShell>
			<GenerationModalShell
				open={upperOpen}
				title="生成图片"
				titleId="generate-image-title"
				onOpenChange={setUpperOpen}
			>
				<button
					type="button"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={() => setUpperOpen(false)}
				>
					发送生成
				</button>
			</GenerationModalShell>
		</>
	);
};
