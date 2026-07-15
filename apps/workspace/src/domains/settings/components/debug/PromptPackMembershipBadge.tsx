import type React from "react";
import type { PromptPack } from "@/domains/settings/api/packs";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";

interface PromptPackMembershipBadgeProps {
	className?: string;
	packId?: string;
	packs: PromptPack[];
}

const packToneClassNames = [
	"border-info-border bg-info-surface text-info-foreground",
	"border-success-border bg-success-surface text-success-foreground",
	"border-warning-border bg-warning-surface text-warning-foreground",
] as const;

const neutralPackToneClassName = "border-border/80 bg-ide-toolbar text-foreground";

export const promptPackMembershipToneClassName = (packId: string, isDefault: boolean) => {
	if (isDefault) return neutralPackToneClassName;
	return packToneClassNames[stableStringHash(packId) % packToneClassNames.length];
};

export const PromptPackMembershipBadge: React.FC<PromptPackMembershipBadgeProps> = ({
	className,
	packId,
	packs,
}) => {
	const resolvedPackId = packId?.trim() || "builtin";
	const pack = packs.find((entry) => entry.id === resolvedPackId);
	const packName = pack?.source === "default" ? "默认词包" : (pack?.name ?? resolvedPackId);
	const packTitle = pack?.name ?? packName;
	const toneClassName = promptPackMembershipToneClassName(
		resolvedPackId,
		pack?.source === "default" || resolvedPackId === "builtin",
	);

	return (
		<Badge
			variant="outline"
			className={cn("min-w-0 max-w-full text-2xs", toneClassName, className)}
			aria-label={`所属词包：${packName}`}
			title={`${packTitle} (${resolvedPackId})`}
		>
			<span className="truncate">{packName}</span>
		</Badge>
	);
};

const stableStringHash = (value: string) => {
	let hash = 0;
	for (const character of value) {
		hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
	}
	return hash;
};
