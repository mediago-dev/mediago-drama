import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewDocumentDialog } from "./NewDocumentDialog";

describe("NewDocumentDialog", () => {
	it("renders only typed document options", () => {
		render(<NewDocumentDialog open onOpenChange={vi.fn()} onCreate={vi.fn()} />);

		expect(screen.getByRole("button", { name: /剧本/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /角色/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /场景/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /分镜/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /素材/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "上传文件" })).toBeNull();
	});
});
