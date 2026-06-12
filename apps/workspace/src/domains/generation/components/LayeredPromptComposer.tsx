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
}> = ({ layers, onSelect }) => {
	if (layers.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
			{layers.map(({ layer, presets, selectedId }) => (
				<div key={layer} className="flex min-w-0 items-center gap-1.5">
					<span className="shrink-0 text-2xs text-muted-foreground">
						{promptLayerLabels[layer]}
					</span>
					<Select
						value={selectedId || NONE_VALUE}
						onValueChange={(value) => onSelect(layer, value === NONE_VALUE ? "" : value)}
					>
						<SelectTrigger className="h-7 w-32 rounded-md text-xs text-foreground">
							<SelectValue placeholder="不使用" />
						</SelectTrigger>
						<SelectContent align="start">
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
