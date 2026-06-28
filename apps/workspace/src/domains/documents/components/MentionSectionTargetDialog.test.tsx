import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	MentionSectionTargetDialog,
	openMentionSectionTargetDialog,
} from "./MentionSectionTargetDialog";

describe("MentionSectionTargetDialog", () => {
	afterEach(() => {
		cleanup();
	});

	it("lets the user choose a target document category", async () => {
		render(<MentionSectionTargetDialog />);
		let resultPromise!: ReturnType<typeof openMentionSectionTargetDialog>;

		act(() => {
			resultPromise = openMentionSectionTargetDialog({ title: "你是" });
		});

		expect(screen.getByRole("heading", { name: "选择新增位置" })).toBeTruthy();
		expect(screen.getByText("将「你是」新增到哪类文档？")).toBeTruthy();
		expect(screen.getByRole("button", { name: /角色文档/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /道具文档/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /场景文档/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /分镜文档/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /剧本文档/ })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /角色文档/ }));

		await expect(resultPromise).resolves.toEqual({ category: "character" });
	});

	it("resolves null when cancelled", async () => {
		render(<MentionSectionTargetDialog />);
		let resultPromise!: ReturnType<typeof openMentionSectionTargetDialog>;

		act(() => {
			resultPromise = openMentionSectionTargetDialog({ title: "你是" });
		});

		fireEvent.click(screen.getByRole("button", { name: "取消" }));

		await expect(resultPromise).resolves.toBeNull();
	});
});
