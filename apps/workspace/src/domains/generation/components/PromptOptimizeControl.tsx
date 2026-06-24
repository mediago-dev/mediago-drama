import { ChevronDown, Loader2, Wand2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { generationComposerToolbarButtonClassName } from "@/domains/generation/components/GenerationComposerPanel";
import { PromptOptimizePicker } from "@/domains/generation/components/PromptOptimizePicker";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import type { PromptOptimizeModelOption } from "@/domains/generation/hooks/usePromptOptimize";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

export interface PromptOptimizeControlProps {
	canOptimize: boolean;
	disabled?: boolean;
	isOptimizing: boolean;
	items: PromptInsertItem[];
	modelOptions: PromptOptimizeModelOption[];
	onSelect: (item: PromptInsertItem) => void;
	onSelectModel: (routeId: string) => void;
	selectedModelRouteId?: string | null;
}

export const PromptOptimizeControl: React.FC<PromptOptimizeControlProps> = ({
	canOptimize,
	disabled = false,
	isOptimizing,
	items,
	modelOptions,
	onSelect,
	onSelectModel,
	selectedModelRouteId,
}) => {
	const [open, setOpen] = useState(false);
	const unavailable = disabled || isOptimizing;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-label="优化提示词"
					title={canOptimize ? "优化提示词" : "选择提示词包"}
					disabled={unavailable}
					className={cn(
						generationComposerToolbarButtonClassName(),
						open && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					{isOptimizing ? (
						<Loader2 className="size-4 animate-spin text-primary" />
					) : (
						<Wand2 className="size-4 text-primary" />
					)}
					<span>优化提示词</span>
					<ChevronDown className="size-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label="提示词包"
				className="w-[min(26rem,var(--generation-popover-max-inline))] overflow-hidden rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding)] text-popover-foreground shadow-xl"
				style={{
					maxHeight:
						"min(30rem, calc(var(--radix-popover-content-available-height, 30rem) - 0.5rem))",
				}}
			>
				<div className="mb-[var(--generation-popover-gap)] flex min-w-0 items-center gap-2">
					<span className="shrink-0 text-2xs font-semibold text-muted-foreground">优化模型</span>
					<select
						aria-label="优化模型"
						value={selectedModelRouteId ?? ""}
						disabled={modelOptions.length === 0 || isOptimizing}
						className="h-[var(--generation-control-height)] min-w-0 flex-1 rounded-[var(--generation-control-radius)] border border-input bg-background px-2 text-2xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
						onChange={(event) => onSelectModel(event.target.value)}
					>
						{modelOptions.length === 0 ? (
							<option value="">无可用文本模型</option>
						) : (
							modelOptions.map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))
						)}
					</select>
				</div>
				<PromptOptimizePicker
					items={items}
					onSelect={(item) => {
						onSelect(item);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
};
