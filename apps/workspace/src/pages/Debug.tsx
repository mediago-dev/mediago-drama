import { MessageSquareText, PackageOpen } from "lucide-react";
import type React from "react";
import { InstructionTemplatesPanel } from "@/domains/settings/components/debug/InstructionTemplatesPanel";
import { PromptPacksPanel } from "@/domains/settings/components/debug/PromptPacksPanel";

export type DebugTabValue = "instructions" | "prompt-packs";

export const debugTabs: {
	description: string;
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: DebugTabValue;
}[] = [
	{
		value: "instructions",
		label: "智能体指令",
		description: "编辑智能体系统指令",
		icon: MessageSquareText,
	},
	{
		value: "prompt-packs",
		label: "技能包",
		description: "安装并管理技能与提示词",
		icon: PackageOpen,
	},
];

export const DebugTabPanel: React.FC<{
	value: DebugTabValue;
}> = ({ value }) => {
	switch (value) {
		case "instructions":
			return (
				<div className="h-full min-h-0 overflow-hidden">
					<InstructionTemplatesPanel />
				</div>
			);
		case "prompt-packs":
			return (
				<div className="h-full min-h-0 overflow-hidden">
					<PromptPacksPanel />
				</div>
			);
	}
};
