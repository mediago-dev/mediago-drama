import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
} from "./alert-dialog";
import { useDialogLayerStore } from "./dialog-layer";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

describe("layered AlertDialog", () => {
	afterEach(() => {
		cleanup();
		useDialogLayerStore.setState({ layerIds: [] });
		document.body.innerHTML = "";
	});

	it("keeps the generation-history Sheet open while the AlertDialog is active", async () => {
		render(<AlertAboveSheetHarness />);

		const sheet = screen.getByRole("dialog", { name: "生成历史" });
		const input = screen.getByRole("textbox", { name: "会话筛选" });
		fireEvent.change(input, { target: { value: "主角" } });
		fireEvent.click(screen.getByRole("button", { name: "新建会话" }));

		const alert = await screen.findByRole("alertdialog", { name: "创建生成会话" });
		expect(sheet).toHaveAttribute("data-state", "open");
		expect(sheet.closest("[data-dialog-layer]")).toHaveAttribute(
			"data-dialog-layer-state",
			"covered",
		);
		expect(alert.closest("[data-dialog-layer]")).toHaveAttribute("data-dialog-layer-state", "top");

		fireEvent.click(screen.getByRole("button", { name: "取消" }));

		await waitFor(() => {
			expect(screen.queryByRole("alertdialog", { name: "创建生成会话" })).toBeNull();
		});
		expect(screen.getByRole("dialog", { name: "生成历史" })).toBe(sheet);
		expect(screen.getByRole("textbox", { name: "会话筛选" })).toBe(input);
		expect(input).toHaveValue("主角");
	});
});

const AlertAboveSheetHarness = () => {
	const [sheetOpen, setSheetOpen] = useState(true);
	const [alertOpen, setAlertOpen] = useState(false);

	return (
		<>
			<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
				<SheetContent>
					<SheetTitle>生成历史</SheetTitle>
					<SheetDescription>查看历史生成记录。</SheetDescription>
					<input aria-label="会话筛选" defaultValue="" />
					<button type="button" onClick={() => setAlertOpen(true)}>
						新建会话
					</button>
				</SheetContent>
			</Sheet>
			<AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
				<AlertDialogContent>
					<AlertDialogTitle>创建生成会话</AlertDialogTitle>
					<AlertDialogDescription>填写会话名称。</AlertDialogDescription>
					<AlertDialogCancel>取消</AlertDialogCancel>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};
