import type React from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import type { HoveredBlockRect } from "./types";

export type SectionGenerateKind = "image" | "audio" | "video";

const sectionGenerateActions: Array<{
	ariaLabel: string;
	icon: React.ReactNode;
	kind: SectionGenerateKind;
	label: string;
	title: string;
}> = [
	{
		ariaLabel: "根据当前标题区域生成图片",
		icon: <ArrowUpRight className="size-3.5" />,
		kind: "image",
		label: "生成图片",
		title: "根据当前标题区域生成图片",
	},
	{
		ariaLabel: "根据当前标题区域生成语音",
		icon: <ArrowUpRight className="size-3.5" />,
		kind: "audio",
		label: "生成语音",
		title: "根据当前标题区域生成语音",
	},
	{
		ariaLabel: "根据当前标题区域生成视频",
		icon: <ArrowUpRight className="size-3.5" />,
		kind: "video",
		label: "生成视频",
		title: "根据当前标题区域生成视频",
	},
];

export const SectionGenerateButton: React.FC<{
	onGenerate: (kind: SectionGenerateKind) => void;
	onMouseLeave: () => void;
	rect: HoveredBlockRect;
}> = ({ onGenerate, onMouseLeave, rect }) => (
	<div
		className="tiptap-section-generate-action tiptap-section-generate-action-group"
		style={{ top: Math.max(rect.top - 28, 0) }}
		onMouseDown={(event) => event.preventDefault()}
		onMouseLeave={onMouseLeave}
	>
		{sectionGenerateActions.map((action) => (
			<button
				key={action.kind}
				type="button"
				className="tiptap-section-generate-button"
				aria-label={action.ariaLabel}
				title={action.title}
				onClick={() => onGenerate(action.kind)}
			>
				{action.icon}
				<span>{action.label}</span>
			</button>
		))}
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
