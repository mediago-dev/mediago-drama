import type React from "react";
import type { PromptLayer, PromptPreset } from "@/domains/generation/api/prompt-presets";
import { promptLayerLabels } from "@/domains/generation/lib/prompt-layers";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

export interface ComposerLayer {
	layer: PromptLayer;
	presets: PromptPreset[];
	selectedId: string;
}

const NONE_VALUE = "__none__";

// 分层组合器:按任务类型展示库内文字层的选择器(主体词=输入框,不在此列)。
export const LayeredPromptComposer: React.FC<{
	layers: ComposerLayer[];
	onSelect: (layer: PromptLayer, presetId: string) => void;
	variant?: "default" | "composer";
}> = ({ layers, onSelect, variant = "default" }) => {
	if (layers.length === 0) return null;

	return (
		<div
			className={cn(
				"flex flex-wrap items-center",
				variant === "composer" ? "gap-2" : "gap-x-3 gap-y-1.5",
			)}
		>
			{layers.map(({ layer, presets, selectedId }) => (
				<div
					key={layer}
					className={cn("flex min-w-0 items-center", variant === "composer" ? "gap-0" : "gap-1.5")}
				>
					{variant === "composer" ? null : (
						<span className="shrink-0 text-2xs text-muted-foreground">
							{promptLayerLabels[layer]}
						</span>
					)}
					<Select
						value={selectedId || NONE_VALUE}
						onValueChange={(value) => onSelect(layer, value === NONE_VALUE ? "" : value)}
					>
						<SelectTrigger
							className={cn(
								variant === "composer"
									? "h-[var(--generation-control-height)] w-auto min-w-[var(--generation-composer-layer-min-width)] rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover"
									: "h-7 w-32 rounded-md text-xs text-foreground",
							)}
						>
							{variant === "composer" ? (
								<em className="shrink-0 not-italic text-muted-foreground">
									{promptLayerLabels[layer]}
								</em>
							) : null}
							<SelectValue placeholder="不使用" />
						</SelectTrigger>
						<SelectContent
							align="start"
							className={
								variant === "composer"
									? "rounded-xl border-border bg-popover p-2 shadow-2xl"
									: undefined
							}
						>
							<SelectItem value={NONE_VALUE}>不使用</SelectItem>
							{presets.map((preset) => (
								<SelectItem key={preset.id} value={preset.id}>
									{preset.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			))}
		</div>
	);
};
