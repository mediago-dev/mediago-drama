import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	NewReferenceDocumentDialog,
	openNewReferenceDocumentDialog,
} from "./NewReferenceDocumentDialog";

describe("NewReferenceDocumentDialog", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders reference actions without document type choices", () => {
		render(<NewReferenceDocumentDialog />);
		act(() => {
			void openNewReferenceDocumentDialog();
		});

		expect(screen.getByRole("heading", { name: "新建资料" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "上传文件" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "新建空白资料" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /剧本/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /角色/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /场景/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /分镜/ })).toBeNull();
	});

	it("creates a blank reference document", async () => {
		render(<NewReferenceDocumentDialog />);
		let resultPromise!: ReturnType<typeof openNewReferenceDocumentDialog>;

		act(() => {
			resultPromise = openNewReferenceDocumentDialog();
		});

		fireEvent.click(screen.getByRole("button", { name: "新建空白资料" }));

		await expect(resultPromise).resolves.toEqual({
			kind: "document",
			category: "reference",
		});
	});

	it("uploads a selected file", async () => {
		render(<NewReferenceDocumentDialog />);
		let resultPromise!: ReturnType<typeof openNewReferenceDocumentDialog>;

		act(() => {
			resultPromise = openNewReferenceDocumentDialog();
		});
		const file = new File(["notes"], "notes.txt", { type: "text/plain" });
		const input = screen.getByLabelText("选择资料文件");

		fireEvent.change(input, { target: { files: [file] } });

		await expect(resultPromise).resolves.toEqual({ kind: "upload", file });
	});
});
