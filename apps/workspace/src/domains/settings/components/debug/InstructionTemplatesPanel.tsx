import { MessageSquareText } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
import { PromptPackActionsSlotProvider } from "./PromptPackActionsSlot";
import { PromptTemplateEditorPanel } from "./PromptTemplateEditorPanel";

export const InstructionTemplatesPanel: React.FC = () => {
	const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
	const startWindowDrag = useDesktopWindowDrag();

	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<header
				className="shrink-0 border-b border-border bg-ide-editor px-5 py-4"
				data-desktop-drag-region
				onPointerDown={startWindowDrag}
			>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 flex-1" data-desktop-drag-region>
						<div className="flex items-center gap-2">
							<MessageSquareText className="size-4 text-muted-foreground" />
							<h2 className="truncate text-sm font-semibold text-foreground">智能体指令</h2>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							编辑智能体系统指令；这些内容独立于技能包，不会随包安装或卸载变化。
						</p>
					</div>
					<div
						ref={setActionsSlot}
						className="flex min-h-8 shrink-0 flex-wrap items-center justify-end gap-2"
						data-desktop-no-drag
					/>
				</div>
			</header>
			<PromptPackActionsSlotProvider slotEl={actionsSlot}>
				<div className="min-h-0 flex-1 overflow-hidden">
					<PromptTemplateEditorPanel />
				</div>
			</PromptPackActionsSlotProvider>
		</section>
	);
};
