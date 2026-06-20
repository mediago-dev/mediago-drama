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

		expect(screen.getByRole("button", { name: /剧本/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /角色/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /场景/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /道具/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /分镜/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /资料/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "上传文件" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /资料/ }));

		await expect(resultPromise).resolves.toEqual({ kind: "reference" });
	});
});
