import { KeyRound, MessageSquareText, PackageOpen } from "lucide-react";
import type React from "react";
import { InstructionTemplatesPanel } from "@/domains/settings/components/debug/InstructionTemplatesPanel";
import { LicensePanel } from "@/domains/settings/components/debug/LicensePanel";
import { PromptPacksPanel } from "@/domains/settings/components/debug/PromptPacksPanel";

export type DebugTabValue = "instructions" | "prompt-packs" | "license";

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
		label: "提示词包",
		description: "安装并管理技能与提示词",
		icon: PackageOpen,
	},
	{
		value: "license",
		label: "授权激活",
		description: "激活码与商业授权状态",
		icon: KeyRound,
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
		case "license":
			return (
				<div className="h-full min-h-0 overflow-hidden">
					<LicensePanel />
				</div>
			);
	}
};
