import { BookOpenCheck, Library, MessageSquareText } from "lucide-react";
import type React from "react";
import { PromptTemplateEditorPanel } from "@/domains/settings/components/debug/PromptTemplateEditorPanel";
import { PromptLibraryEditorPanel } from "@/domains/settings/components/debug/PromptLibraryEditorPanel";
import { SkillsEditorPanel } from "@/domains/settings/components/debug/SkillsEditorPanel";

export type DebugTabValue = "prompt-library" | "prompts" | "skills";

export const debugTabs: {
	description: string;
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: DebugTabValue;
}[] = [
	{
		value: "prompts",
		label: "系统指令",
		description: "编辑系统指令片段",
		icon: MessageSquareText,
	},
	{
		value: "skills",
		label: "技能",
		description: "编辑按需指导",
		icon: BookOpenCheck,
	},
	{
		value: "prompt-library",
		label: "提示词库",
		description: "管理生成提示词",
		icon: Library,
	},
];

export const DebugTabPanel: React.FC<{
	value: DebugTabValue;
}> = ({ value }) => {
	switch (value) {
		case "prompts":
			return (
				<div className="h-full min-h-0 overflow-hidden">
					<PromptTemplateEditorPanel />
				</div>
			);
		case "skills":
			return (
				<div className="h-full min-h-0 overflow-hidden">
					<SkillsEditorPanel />
				</div>
			);
		case "prompt-library":
			return (
				<div className="h-full min-h-0 overflow-hidden">
					<PromptLibraryEditorPanel />
				</div>
			);
	}
};
