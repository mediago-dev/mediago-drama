import type React from "react";
import type { HoveredBlockRect } from "./types";

export const HeadingActionButton: React.FC<{
	ariaLabel: string;
	icon: React.ReactNode;
	label: string;
	onAction: () => void;
	onMouseLeave: () => void;
	rect: HoveredBlockRect;
	title: string;
}> = ({ ariaLabel, icon, label, onAction, onMouseLeave, rect, title }) => (
	<div
		className="tiptap-section-generate-action"
		style={{ top: Math.max(rect.top - 28, 0) }}
		onMouseDown={(event) => event.preventDefault()}
		onMouseLeave={onMouseLeave}
	>
		<button
			type="button"
			className="tiptap-section-generate-button"
			aria-label={ariaLabel}
			title={title}
			onClick={onAction}
		>
			{icon}
			<span>{label}</span>
		</button>
	</div>
);
