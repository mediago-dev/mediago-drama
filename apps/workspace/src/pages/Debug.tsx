import { PackageOpen } from "lucide-react";
import type React from "react";
import { PromptPacksPanel } from "@/domains/settings/components/debug/PromptPacksPanel";

export type DebugTabValue = "prompt-packs";

export const debugTabs: {
	description: string;
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: DebugTabValue;
}[] = [
	{
		value: "prompt-packs",
		label: "提示词包",
		description: "安装并编辑指令、技能与提示词",
		icon: PackageOpen,
	},
];

export const DebugTabPanel: React.FC<{
	value: DebugTabValue;
}> = ({ value }) => {
	switch (value) {
		case "prompt-packs":
			return (
				<div className="h-full min-h-0 overflow-hidden">
					<PromptPacksPanel />
				</div>
			);
	}
};
