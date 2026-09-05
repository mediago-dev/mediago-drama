import { useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";

const isVisible = (element: HTMLElement) =>
	!element.hasAttribute("hidden") &&
	getComputedStyle(element).display !== "none" &&
	getComputedStyle(element).visibility !== "hidden";

const getOpenDialog = () =>
	Array.from(
		document.querySelectorAll<HTMLElement>(
			'[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
		),
	)
		.filter(isVisible)
		.at(-1);

const getDismissButton = (dialog: HTMLElement) =>
	Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
		if (button.disabled) return false;
		const label = `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`.trim();
		return /取消|关闭|返回/.test(label);
	});

/**
 * Escape only dismisses the top-most modal. It must never navigate or switch views.
 */
export const useEscapeBackNavigation = (_navigate: NavigateFunction) => {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;

			const dialog = getOpenDialog();
			if (dialog) {
				const dismissButton = getDismissButton(dialog);
				// Never navigate behind an open modal. A modal without a cancel control
				// owns Escape itself (for example, a protected generation task).
				if (!dismissButton) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				dismissButton.click();
				return;
			}

			// Menus, dropdowns, editors and the rest of the page own Escape when no modal is open.
			return;
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, []);
};
