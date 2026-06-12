import { ChevronRight, type LucideIcon } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/utils";

export interface DirectoryItemMenuPosition {
	x: number;
	y: number;
}

export interface DirectoryItemMenuItem {
	children?: DirectoryItemMenuItem[];
	icon: LucideIcon;
	iconStyle?: React.CSSProperties;
	label: string;
	onSelect: () => void;
	variant?: "default" | "danger";
}

const VIEWPORT_GAP = 8;

export const DirectoryItemMenu: React.FC<{
	ariaLabel: string;
	items: DirectoryItemMenuItem[];
	onClose: () => void;
	position: DirectoryItemMenuPosition;
}> = ({ ariaLabel, items, onClose, position }) => {
	const menuRef = useRef<HTMLDivElement>(null);
	const [menuPosition, setMenuPosition] = useState(position);
	const [activeSubmenuLabel, setActiveSubmenuLabel] = useState<string | null>(null);

	useLayoutEffect(() => {
		setMenuPosition(position);
		if (typeof window === "undefined") return;
		const menu = menuRef.current;
		if (!menu) return;

		const rect = menu.getBoundingClientRect();
		setMenuPosition({
			x: Math.max(
				VIEWPORT_GAP,
				Math.min(position.x, window.innerWidth - rect.width - VIEWPORT_GAP),
			),
			y: Math.max(
				VIEWPORT_GAP,
				Math.min(position.y, window.innerHeight - rect.height - VIEWPORT_GAP),
			),
		});
	}, [position]);

	useEffect(() => {
		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (menuRef.current?.contains(event.target as Node)) return;
			onClose();
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};

		window.document.addEventListener("pointerdown", closeOnOutsidePointer);
		window.document.addEventListener("keydown", closeOnEscape);
		return () => {
			window.document.removeEventListener("pointerdown", closeOnOutsidePointer);
			window.document.removeEventListener("keydown", closeOnEscape);
		};
	}, [onClose]);

	const menu = (
		<div
			ref={menuRef}
			role="menu"
			aria-label={ariaLabel}
			className="fixed z-50 min-w-36 rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
			style={{ left: menuPosition.x, top: menuPosition.y }}
		>
			{items.map((item) => (
				<DirectoryMenuItemButton
					key={item.label}
					activeSubmenuLabel={activeSubmenuLabel}
					item={item}
					onClose={onClose}
					onSubmenuOpen={setActiveSubmenuLabel}
				/>
			))}
		</div>
	);

	if (typeof document === "undefined") return menu;
	return createPortal(menu, document.body);
};

const DirectoryMenuItemButton: React.FC<{
	activeSubmenuLabel: string | null;
	item: DirectoryItemMenuItem;
	onClose: () => void;
	onSubmenuOpen: (label: string | null) => void;
}> = ({ activeSubmenuLabel, item, onClose, onSubmenuOpen }) => {
	const Icon = item.icon;
	const hasSubmenu = Boolean(item.children?.length);
	const isSubmenuOpen = hasSubmenu && activeSubmenuLabel === item.label;
	const itemClassName = cn(
		"flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-xs transition-colors focus-visible:outline-none",
		item.variant === "danger"
			? "text-error-foreground hover:bg-error-surface focus-visible:bg-error-surface"
			: "hover:bg-ide-list-hover focus-visible:bg-ide-list-hover",
		isSubmenuOpen && "bg-ide-list-hover",
	);

	return (
		<div className="relative" onMouseEnter={() => onSubmenuOpen(hasSubmenu ? item.label : null)}>
			<button
				type="button"
				role="menuitem"
				aria-haspopup={hasSubmenu ? "menu" : undefined}
				aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
				onClick={() => {
					if (hasSubmenu) {
						onSubmenuOpen(isSubmenuOpen ? null : item.label);
						return;
					}
					onClose();
					item.onSelect();
				}}
				onFocus={() => onSubmenuOpen(hasSubmenu ? item.label : null)}
				className={itemClassName}
			>
				<Icon className="size-3.5 shrink-0" style={item.iconStyle} />
				<span className="min-w-0 flex-1 truncate">{item.label}</span>
				{hasSubmenu ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : null}
			</button>
			{isSubmenuOpen ? (
				<div
					role="menu"
					aria-label={item.label}
					className="absolute left-[calc(100%+4px)] top-0 z-50 min-w-32 rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
				>
					{item.children?.map((child) => (
						<DirectoryMenuItemButton
							key={child.label}
							activeSubmenuLabel={null}
							item={child}
							onClose={onClose}
							onSubmenuOpen={() => undefined}
						/>
					))}
				</div>
			) : null}
		</div>
	);
};
