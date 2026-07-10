import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NewDocumentDialog, openNewDocumentDialog } from "./NewDocumentDialog";

describe("NewDocumentDialog", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders typed document options and resolves a reference handoff", async () => {
		render(<NewDocumentDialog />);
		let resultPromise!: ReturnType<typeof openNewDocumentDialog>;

		act(() => {
			resultPromise = openNewDocumentDialog({ showReferenceHandoff: true });
		});

		expect(screen.getByRole("radio", { name: /^剧本/ }).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("radio", { name: /^角色/ })).toBeTruthy();
		expect(screen.getByRole("radio", { name: /^场景/ })).toBeTruthy();
		expect(screen.getByRole("radio", { name: /^道具/ })).toBeTruthy();
		expect(screen.getByRole("radio", { name: /^分镜/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /资料/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "上传文件" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /资料/ }));

		await expect(resultPromise).resolves.toEqual({ kind: "reference" });
	});

	it("supports keyboard selection and creates the selected document type", async () => {
		render(<NewDocumentDialog />);
		let resultPromise!: ReturnType<typeof openNewDocumentDialog>;

		act(() => {
			resultPromise = openNewDocumentDialog();
		});

		const screenplayOption = screen.getByRole("radio", { name: /^剧本/ });
		fireEvent.keyDown(screenplayOption, { key: "ArrowRight" });

		expect(screen.getByRole("radio", { name: /^角色/ }).getAttribute("aria-checked")).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "创建角色" }));

		await expect(resultPromise).resolves.toEqual({ kind: "document", category: "character" });
	});
});
