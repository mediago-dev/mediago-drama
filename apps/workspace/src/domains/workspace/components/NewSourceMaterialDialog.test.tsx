import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NewSourceMaterialDialog, openNewSourceMaterialDialog } from "./NewSourceMaterialDialog";

describe("NewSourceMaterialDialog", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders material actions without document type choices", () => {
		render(<NewSourceMaterialDialog />);
		act(() => {
			void openNewSourceMaterialDialog();
		});

		expect(screen.getByRole("heading", { name: "新建素材" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "上传文件" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "新建空白素材" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /剧本/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /角色/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /场景/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /分镜/ })).toBeNull();
	});

	it("creates a blank source material document", async () => {
		render(<NewSourceMaterialDialog />);
		let resultPromise!: ReturnType<typeof openNewSourceMaterialDialog>;

		act(() => {
			resultPromise = openNewSourceMaterialDialog();
		});

		fireEvent.click(screen.getByRole("button", { name: "新建空白素材" }));

		await expect(resultPromise).resolves.toEqual({
			kind: "document",
			category: "source-material",
		});
	});

	it("uploads a selected file", async () => {
		render(<NewSourceMaterialDialog />);
		let resultPromise!: ReturnType<typeof openNewSourceMaterialDialog>;

		act(() => {
			resultPromise = openNewSourceMaterialDialog();
		});
		const file = new File(["notes"], "notes.txt", { type: "text/plain" });
		const input = screen.getByLabelText("选择素材文件");

		fireEvent.change(input, { target: { files: [file] } });

		await expect(resultPromise).resolves.toEqual({ kind: "upload", file });
	});
});
