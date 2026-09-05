import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useEscapeBackNavigation } from "./useEscapeBackNavigation";

afterEach(cleanup);

const EscapeProbe = ({ withDialog = false }: { withDialog?: boolean }) => {
	const navigate = useNavigate();
	const location = useLocation();
	const [dialogOpen, setDialogOpen] = useState(withDialog);
	useEscapeBackNavigation(navigate);

	return (
		<>
			<output data-testid="route">{location.pathname}</output>
			{dialogOpen ? (
				<div aria-modal="true" role="dialog">
					<button type="button" onClick={() => setDialogOpen(false)}>
						取消
					</button>
				</div>
			) : null}
		</>
	);
};

describe("useEscapeBackNavigation", () => {
	it("does nothing when no modal is open", () => {
		render(
			<MemoryRouter initialEntries={["/", "/settings"]} initialIndex={1}>
				<EscapeProbe />
			</MemoryRouter>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.getByTestId("route")).toHaveTextContent("/settings");
	});

	it("cancels the active modal instead of navigating behind it", () => {
		render(
			<MemoryRouter initialEntries={["/", "/settings"]} initialIndex={1}>
				<EscapeProbe withDialog />
			</MemoryRouter>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.getByTestId("route")).toHaveTextContent("/settings");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});
