import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	MentionSectionCreateDialog,
	openMentionSectionCreateDialog,
	shouldIgnoreMentionSectionCreateEnter,
} from "./MentionSectionCreateDialog";

describe("MentionSectionCreateDialog", () => {
	afterEach(() => {
		cleanup();
	});

	it("resolves a normalized section title", async () => {
		render(<MentionSectionCreateDialog />);
		let resultPromise!: ReturnType<typeof openMentionSectionCreateDialog>;

		act(() => {
			resultPromise = openMentionSectionCreateDialog({
				createLabel: "新增角色",
				documentTitle: "角色设定：《海鲜面》",
			});
		});

		expect(screen.getByRole("heading", { name: "新增角色" })).toBeTruthy();
		expect(screen.getByText("将在《角色设定：《海鲜面》》末尾插入二级标题。")).toBeTruthy();

		const confirmButton = screen.getByRole("button", { name: "确认" });
		expect(confirmButton).toBeDisabled();

		fireEvent.change(screen.getByLabelText("名称"), { target: { value: "  ## 顾依依  " } });
		expect(confirmButton).not.toBeDisabled();
		fireEvent.click(confirmButton);

		await expect(resultPromise).resolves.toEqual({ title: "顾依依" });
	});

	it("resolves null when cancelled", async () => {
		render(<MentionSectionCreateDialog />);
		let resultPromise!: ReturnType<typeof openMentionSectionCreateDialog>;

		act(() => {
			resultPromise = openMentionSectionCreateDialog({
				createLabel: "新增场景",
				documentTitle: "场景设定：《海鲜面》",
			});
		});

		fireEvent.click(screen.getByRole("button", { name: "取消" }));

		await expect(resultPromise).resolves.toBeNull();
	});

	it("does not submit when Enter is used by an IME composition", async () => {
		render(<MentionSectionCreateDialog />);
		let resultPromise!: ReturnType<typeof openMentionSectionCreateDialog>;

		act(() => {
			resultPromise = openMentionSectionCreateDialog({
				createLabel: "新增角色",
				documentTitle: "角色设定：《海鲜面》",
			});
		});

		const input = screen.getByLabelText("名称");
		fireEvent.change(input, { target: { value: "顾依依" } });
		fireEvent.compositionStart(input);
		fireEvent.keyDown(input, { code: "Enter", isComposing: true, key: "Enter" });

		expect(screen.getByRole("heading", { name: "新增角色" })).toBeTruthy();

		fireEvent.compositionEnd(input);
		fireEvent.keyDown(input, { code: "Enter", key: "Enter" });

		expect(screen.getByRole("heading", { name: "新增角色" })).toBeTruthy();

		await act(async () => {
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		});
		fireEvent.keyDown(input, { code: "Enter", key: "Enter" });

		await expect(resultPromise).resolves.toEqual({ title: "顾依依" });
	});

	it("detects IME enter states", () => {
		expect(
			shouldIgnoreMentionSectionCreateEnter({ isComposing: true, keyCode: 13 }, false, false),
		).toBe(true);
		expect(
			shouldIgnoreMentionSectionCreateEnter({ isComposing: false, keyCode: 229 }, false, false),
		).toBe(true);
		expect(
			shouldIgnoreMentionSectionCreateEnter({ isComposing: false, keyCode: 13 }, false, true),
		).toBe(true);
		expect(
			shouldIgnoreMentionSectionCreateEnter({ isComposing: false, keyCode: 13 }, false, false),
		).toBe(false);
	});
});
