import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewDocumentDialog } from "./NewDocumentDialog";

describe("NewDocumentDialog", () => {
	it("renders typed document options and a material handoff", () => {
		const onOpenSourceMaterial = vi.fn();
		render(
			<NewDocumentDialog
				open
				onOpenChange={vi.fn()}
				onCreate={vi.fn()}
				onOpenSourceMaterial={onOpenSourceMaterial}
			/>,
		);

		expect(screen.getByRole("button", { name: /剧本/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /角色/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /场景/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /道具/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /分镜/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /素材/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "上传文件" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /素材/ }));

		expect(onOpenSourceMaterial).toHaveBeenCalledTimes(1);
	});
});
