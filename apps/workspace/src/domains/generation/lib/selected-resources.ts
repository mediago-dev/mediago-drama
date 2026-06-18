import { Clapperboard, Film, Package, UserRound, type LucideIcon } from "lucide-react";
import type { AgentResourceType } from "@/domains/workspace/lib/workbench-route";

export interface SelectedGenerationResourceDescriptor {
	key: AgentResourceType;
	label: string;
	icon: LucideIcon;
}

export const selectedGenerationResourceDescriptors: readonly SelectedGenerationResourceDescriptor[] =
	[
		{ key: "character", label: "角色", icon: UserRound },
		{ key: "scene", label: "场景", icon: Clapperboard },
		{ key: "storyboard", label: "分镜", icon: Film },
		{ key: "prop", label: "道具", icon: Package },
	] as const;

export const selectedGenerationResourceDescriptorMap = Object.fromEntries(
	selectedGenerationResourceDescriptors.map((descriptor) => [descriptor.key, descriptor]),
) as Record<AgentResourceType, SelectedGenerationResourceDescriptor>;
