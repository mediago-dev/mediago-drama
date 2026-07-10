import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import { useDialogLayerStore } from "@/shared/components/ui/dialog-layer";
import { GenerationDialogShell } from "./GenerationDialogShell";

describe("GenerationDialogShell", () => {
	afterEach(() => {
		cleanup();
		useDialogLayerStore.setState({ layerIds: [] });
		document.body.innerHTML = "";
	});

	it("keeps the lower generation modal open while the secondary dialog completes", async () => {
		render(<GenerationDialogShellHarness />);

		const lowerDialog = screen.getByRole("dialog", { name: "生成图片" });
		const lowerInput = screen.getByRole("textbox", { name: "提示词草稿" });
		fireEvent.change(lowerInput, { target: { value: "保留草稿" } });
		fireEvent.click(screen.getByRole("button", { name: "打开素材选择" }));

		const upperDialog = await screen.findByRole("dialog", { name: "素材选择" });
		const lowerLayer = lowerDialog.closest<HTMLElement>("[data-dialog-layer]");
		const upperLayer = upperDialog.closest<HTMLElement>("[data-dialog-layer]");

		expect(lowerDialog).toHaveAttribute("data-state", "open");
		expect(lowerLayer).toHaveAttribute("data-dialog-layer-state", "covered");
		expect(upperLayer).toHaveAttribute("data-dialog-layer-state", "top");

		fireEvent.click(screen.getByRole("button", { name: "完成素材选择" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "素材选择" })).toBeNull();
		});
		expect(screen.getByRole("dialog", { name: "生成图片" })).toBe(lowerDialog);
		expect(screen.getByRole("textbox", { name: "提示词草稿" })).toBe(lowerInput);
		expect(lowerInput).toHaveValue("保留草稿");
		expect(lowerLayer).toHaveAttribute("data-dialog-layer-state", "top");
	});

	it("honors closeDisabled on the top secondary dialog", async () => {
		render(<GenerationDialogShellHarness closeDisabled />);
		fireEvent.click(screen.getByRole("button", { name: "打开素材选择" }));
		await screen.findByRole("dialog", { name: "素材选择" });

		fireEvent.keyDown(document, { key: "Escape" });

		await waitFor(() => {
			expect(screen.getByRole("dialog", { name: "素材选择" })).toBeTruthy();
		});
		expect(screen.getByRole("dialog", { name: "生成图片", hidden: true })).toBeTruthy();
	});
});

const GenerationDialogShellHarness = ({ closeDisabled = false }: { closeDisabled?: boolean }) => {
	const [lowerOpen, setLowerOpen] = useState(true);
	const [upperOpen, setUpperOpen] = useState(false);

	return (
		<>
			<GenerationModalShell
				open={lowerOpen}
				title="生成图片"
				titleId="generate-image-title"
				onOpenChange={setLowerOpen}
			>
				<input aria-label="提示词草稿" defaultValue="" />
				<button type="button" onClick={() => setUpperOpen(true)}>
					打开素材选择
				</button>
			</GenerationModalShell>
			<GenerationDialogShell
				closeDisabled={closeDisabled}
				open={upperOpen}
				title="素材选择"
				titleId="material-selection-title"
				onOpenChange={setUpperOpen}
			>
				<button type="button" onClick={() => setUpperOpen(false)}>
					完成素材选择
				</button>
			</GenerationDialogShell>
		</>
	);
};
