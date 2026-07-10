import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogTitle,
} from "./alert-dialog";
import { DialogClose, DialogDismissButton } from "./dialog-dismiss";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "./sheet";

describe("dialog dismiss actions", () => {
	afterEach(async () => {
		cleanup();
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});

	it("runs button handlers without leaking pointerdown to an ancestor", () => {
		const ancestorPointerDown = vi.fn();
		const buttonPointerDown = vi.fn();
		const buttonClick = vi.fn();

		render(
			<div onPointerDown={ancestorPointerDown}>
				<DialogDismissButton onPointerDown={buttonPointerDown} onClick={buttonClick}>
					取消
				</DialogDismissButton>
			</div>,
		);

		const button = screen.getByRole("button", { name: "取消" });
		fireEvent.pointerDown(button, { button: 0 });
		fireEvent.click(button);

		expect(buttonPointerDown).toHaveBeenCalledTimes(1);
		expect(ancestorPointerDown).not.toHaveBeenCalled();
		expect(buttonClick).toHaveBeenCalledTimes(1);
	});

	it("closes its Radix dialog without leaking pointerdown", async () => {
		const documentPointerDown = vi.fn();
		document.addEventListener("pointerdown", documentPointerDown);
		render(<DialogCloseHarness />);

		const closeButton = screen.getByRole("button", { name: "关闭测试弹窗" });
		fireEvent.pointerDown(closeButton, { button: 0 });
		document.removeEventListener("pointerdown", documentPointerDown);
		expect(documentPointerDown).not.toHaveBeenCalled();
		fireEvent.click(closeButton);

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it.each([
		["取消确认", "cancel"],
		["确认操作", "action"],
	] as const)("isolates AlertDialog %s", async (buttonName, action) => {
		render(<AlertDismissHarness action={action} />);
		const button = screen.getByRole("button", { name: buttonName });
		expectPointerDownIsolated(button);
		fireEvent.click(button);

		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	});

	it("isolates SheetClose", async () => {
		render(<SheetCloseHarness />);
		const button = screen.getByRole("button", { name: "关闭抽屉" });
		expectPointerDownIsolated(button);
		fireEvent.click(button);

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
});

const expectPointerDownIsolated = (target: Element) => {
	const documentPointerDown = vi.fn();
	document.addEventListener("pointerdown", documentPointerDown);
	fireEvent.pointerDown(target, { button: 0 });
	document.removeEventListener("pointerdown", documentPointerDown);
	expect(documentPointerDown).not.toHaveBeenCalled();
};

const DialogCloseHarness = () => {
	const [open, setOpen] = useState(true);

	return (
		<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Content aria-describedby={undefined}>
					<DialogPrimitive.Title>测试弹窗</DialogPrimitive.Title>
					<DialogClose asChild>
						<button type="button" aria-label="关闭测试弹窗">
							关闭
						</button>
					</DialogClose>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};

const AlertDismissHarness = ({ action }: { action: "action" | "cancel" }) => {
	const [open, setOpen] = useState(true);

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogContent>
				<AlertDialogTitle>确认弹窗</AlertDialogTitle>
				{action === "cancel" ? (
					<AlertDialogCancel>取消确认</AlertDialogCancel>
				) : (
					<AlertDialogAction>确认操作</AlertDialogAction>
				)}
			</AlertDialogContent>
		</AlertDialog>
	);
};

const SheetCloseHarness = () => {
	const [open, setOpen] = useState(true);

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetContent>
				<SheetTitle>生成历史</SheetTitle>
				<SheetClose asChild>
					<button type="button">关闭抽屉</button>
				</SheetClose>
			</SheetContent>
		</Sheet>
	);
};
