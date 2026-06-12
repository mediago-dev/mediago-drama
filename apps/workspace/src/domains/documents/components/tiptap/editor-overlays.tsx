import type React from "react";
import { Plus, Sparkles } from "lucide-react";
import type { HoveredBlockRect } from "./types";

export const SectionGenerateButton: React.FC<{
	onGenerate: () => void;
	onMouseLeave: () => void;
	rect: HoveredBlockRect;
}> = ({ onGenerate, onMouseLeave, rect }) => (
	<div
		className="tiptap-section-generate-action"
		style={{ top: Math.max(rect.top - 28, 0) }}
		onMouseDown={(event) => event.preventDefault()}
		onMouseLeave={onMouseLeave}
	>
		<button
			type="button"
			className="tiptap-section-generate-button"
			aria-label="根据当前标题区域生成素材"
			title="根据当前标题区域生成素材"
			onClick={onGenerate}
		>
			<Sparkles className="size-3.5" />
			<span>生成</span>
		</button>
	</div>
);

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

export const BlockHandle: React.FC<{
	onInsertAfter: () => void;
	onMouseLeave: () => void;
	rect: HoveredBlockRect;
}> = ({ onInsertAfter, onMouseLeave, rect }) => (
	<div
		className="tiptap-block-handle"
		style={{ top: rect.top + Math.max((rect.height - 28) / 2, 0) }}
		onMouseDown={(event) => event.preventDefault()}
		onMouseLeave={onMouseLeave}
	>
		<button
			type="button"
			className="tiptap-block-handle-button"
			aria-label="在下方插入段落"
			title="在下方插入段落"
			onClick={onInsertAfter}
		>
			<Plus className="size-3.5" />
		</button>
	</div>
);
