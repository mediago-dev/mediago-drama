import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "./dropdown-menu";

describe("DropdownMenu", () => {
	it("renders submenu content outside the parent menu content", () => {
		render(
			<DropdownMenu open modal={false}>
				<DropdownMenuTrigger>模型</DropdownMenuTrigger>
				<DropdownMenuContent data-testid="menu-content" forceMount>
					<DropdownMenuSub open>
						<DropdownMenuSubTrigger>GPT Image 2</DropdownMenuSubTrigger>
						<DropdownMenuSubContent data-testid="submenu-content" forceMount>
							<DropdownMenuItem>OpenAI</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				</DropdownMenuContent>
			</DropdownMenu>,
		);

		const menuContent = screen.getByTestId("menu-content");
		const submenuContent = screen.getByTestId("submenu-content");

		expect(menuContent.contains(submenuContent)).toBe(false);
	});
});
