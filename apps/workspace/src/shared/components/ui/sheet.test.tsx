import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import { useDialogLayerStore } from "./dialog-layer";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

describe("layered Sheet", () => {
	afterEach(() => {
		cleanup();
		useDialogLayerStore.setState({ layerIds: [] });
		document.body.innerHTML = "";
	});

	it("keeps the Sheet open while a later generation dialog opens and closes", async () => {
		render(<SheetBelowDialogHarness />);

		const sheet = screen.getByRole("dialog", { name: "生成历史" });
		const draft = screen.getByRole("textbox", { name: "历史筛选" });
		fireEvent.change(draft, { target: { value: "角色" } });
		fireEvent.click(screen.getByRole("button", { name: "打开生成图片" }));

		const dialog = await screen.findByRole("dialog", { name: "生成图片" });
		expect(sheet).toHaveAttribute("data-state", "open");
		expect(sheet.closest("[data-dialog-layer]")).toHaveAttribute(
			"data-dialog-layer-state",
			"covered",
		);
		expect(dialog.closest("[data-dialog-layer]")).toHaveAttribute("data-dialog-layer-state", "top");

		fireEvent.click(screen.getByRole("button", { name: "完成生成" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "生成图片" })).toBeNull();
		});
		expect(screen.getByRole("dialog", { name: "生成历史" })).toBe(sheet);
		expect(screen.getByRole("textbox", { name: "历史筛选" })).toBe(draft);
		expect(draft).toHaveValue("角色");
	});

	it("keeps the generation dialog open while a later Sheet opens and closes", async () => {
		render(<DialogBelowSheetHarness />);

		const dialog = screen.getByRole("dialog", { name: "生成图片" });
		fireEvent.click(screen.getByRole("button", { name: "打开生成历史" }));
		const sheet = await screen.findByRole("dialog", { name: "生成历史" });

		expect(dialog).toHaveAttribute("data-state", "open");
		expect(dialog.closest("[data-dialog-layer]")).toHaveAttribute(
			"data-dialog-layer-state",
			"covered",
		);
		expect(sheet.closest("[data-dialog-layer]")).toHaveAttribute("data-dialog-layer-state", "top");

		fireEvent.click(screen.getByRole("button", { name: "关闭生成历史" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "生成历史" })).toBeNull();
		});
		expect(screen.getByRole("dialog", { name: "生成图片" })).toBe(dialog);
	});
});

const SheetBelowDialogHarness = () => {
	const [sheetOpen, setSheetOpen] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<>
			<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
				<SheetContent>
					<SheetTitle>生成历史</SheetTitle>
					<SheetDescription>查看历史生成记录。</SheetDescription>
					<input aria-label="历史筛选" defaultValue="" />
					<button type="button" onClick={() => setDialogOpen(true)}>
						打开生成图片
					</button>
				</SheetContent>
			</Sheet>
			<GenerationModalShell
				open={dialogOpen}
				title="生成图片"
				titleId="image-generation-title"
				onOpenChange={setDialogOpen}
			>
				<button type="button" onClick={() => setDialogOpen(false)}>
					完成生成
				</button>
			</GenerationModalShell>
		</>
	);
};

const DialogBelowSheetHarness = () => {
	const [dialogOpen, setDialogOpen] = useState(true);
	const [sheetOpen, setSheetOpen] = useState(false);

	return (
		<>
			<GenerationModalShell
				open={dialogOpen}
				title="生成图片"
				titleId="image-generation-title"
				onOpenChange={setDialogOpen}
			>
				<button type="button" onClick={() => setSheetOpen(true)}>
					打开生成历史
				</button>
			</GenerationModalShell>
			<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
				<SheetContent>
					<SheetTitle>生成历史</SheetTitle>
					<SheetDescription>查看历史生成记录。</SheetDescription>
					<button type="button" onClick={() => setSheetOpen(false)}>
						关闭生成历史
					</button>
				</SheetContent>
			</Sheet>
		</>
	);
};
