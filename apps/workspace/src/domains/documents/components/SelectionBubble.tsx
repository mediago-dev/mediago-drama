import { MessageSquarePlus } from "lucide-react";
import type React from "react";
import { Button } from "@/shared/components/ui/button";

interface SelectionBubbleProps {
	x: number;
	y: number;
	selectedText: string;
	onComment: () => void;
}

const bubbleOffsetY = 42;

export const SelectionBubble: React.FC<SelectionBubbleProps> = ({
	x,
	y,
	selectedText,
	onComment,
}) => {
	if (!selectedText.trim()) return null;

	return (
		<div
			className="fixed z-50 -translate-x-1/2 rounded-sm border border-border bg-ide-panel p-1 text-ide-panel-foreground shadow-lg"
			style={{ left: x, top: Math.max(y - bubbleOffsetY, 8) }}
			onMouseDown={(event) => event.preventDefault()}
		>
			<div className="flex items-center gap-1">
				<Button type="button" size="sm" className="h-7 rounded-sm px-2" onClick={onComment}>
					<MessageSquarePlus />
					<span>评论</span>
				</Button>
			</div>
		</div>
	);
};
