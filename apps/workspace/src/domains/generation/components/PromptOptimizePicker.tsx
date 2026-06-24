import { Check, Search, Sparkles, type LucideIcon } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import { cn } from "@/shared/lib/utils";

export interface PromptOptimizePickerProps {
	items: PromptInsertItem[];
	onSelect: (item: PromptInsertItem) => void;
	selectedItemId?: string | null;
}

interface PromptOptimizeGroup {
	icon: LucideIcon;
	id: string;
	items: PromptInsertItem[];
	label: string;
}

const groupIcon: LucideIcon = Sparkles;

export const PromptOptimizePicker: React.FC<PromptOptimizePickerProps> = ({
	items,
	onSelect,
	selectedItemId,
}) => {
	const [query, setQuery] = useState("");

	const filtered = useMemo(() => {
		const trimmed = normalizePromptOptimizeSearchText(query);
		if (!trimmed) return items;
		return items.filter(
			(item) =>
				normalizePromptOptimizeSearchText(item.name).includes(trimmed) ||
				normalizePromptOptimizeSearchText(item.prompt).includes(trimmed) ||
				normalizePromptOptimizeSearchText(item.categoryLabel).includes(trimmed) ||
				normalizePromptOptimizeSearchText(item.sourceLabel ?? "").includes(trimmed),
		);
	}, [items, query]);

	const groups = useMemo(() => groupOptimizeItems(filtered), [filtered]);

	return (
		<div
			className="flex min-h-0 flex-col gap-[var(--generation-popover-gap)]"
			style={{
				maxHeight:
					"min(27.5rem, calc(var(--radix-popover-content-available-height, 30rem) - var(--generation-popover-padding) * 2 - 0.5rem))",
			}}
		>
			<div className="relative shrink-0">
				<Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<input
					type="text"
					value={query}
					aria-label="搜索提示词包"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="搜索提示词包"
					className="h-[var(--generation-control-height)] w-full rounded-[var(--generation-control-radius)] border border-input bg-background pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</div>
			<div
				aria-label="提示词包列表"
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
				role="region"
				tabIndex={0}
				onWheel={(event) => event.stopPropagation()}
			>
				{groups.length === 0 ? (
					<p className="py-6 text-center text-xs text-muted-foreground">暂无可用提示词包</p>
				) : (
					groups.map((group) => {
						const Icon = group.icon;
						return (
							<section key={group.id} className="mb-2 last:mb-0">
								<div className="flex items-center gap-1.5 px-1 py-1 text-2xs font-semibold text-muted-foreground">
									<Icon className="size-3" />
									<span>{group.label}</span>
									<span className="text-muted-foreground/60">({group.items.length})</span>
								</div>
								<div className="grid gap-1">
									{group.items.map((item) => {
										const selected = item.id === selectedItemId;
										return (
											<button
												key={item.id}
												type="button"
												aria-pressed={selected}
												className={cn(
													"grid w-full min-w-0 gap-1 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
													selected
														? "bg-ide-list-active text-ide-list-active-foreground"
														: "hover:bg-ide-list-hover",
												)}
												onClick={() => onSelect(item)}
											>
												<span className="flex min-w-0 items-center gap-2">
													<span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
														{item.name}
													</span>
													{item.sourceLabel ? (
														<span className="shrink-0 text-2xs text-muted-foreground">
															{item.sourceLabel}
														</span>
													) : null}
													{selected ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
												</span>
												<span className="line-clamp-2 text-2xs leading-4 text-muted-foreground">
													{promptPreview(item.prompt)}
												</span>
											</button>
										);
									})}
								</div>
							</section>
						);
					})
				)}
			</div>
		</div>
	);
};

const promptPreview = (text: string) => {
	const trimmed = text.trim();
	if (trimmed.length <= 96) return trimmed;
	return `${trimmed.slice(0, 96)}...`;
};

const normalizePromptOptimizeSearchText = (value: string) =>
	value.trim().toLocaleLowerCase("zh-Hans-CN");

const groupOptimizeItems = (items: PromptInsertItem[]): PromptOptimizeGroup[] => {
	const groups: PromptOptimizeGroup[] = [];
	const groupMap = new Map<string, PromptOptimizeGroup>();

	for (const item of items) {
		const existing = groupMap.get(item.categoryLabel);
		if (existing) {
			existing.items.push(item);
		} else {
			const group: PromptOptimizeGroup = {
				icon: groupIcon,
				id: item.categoryLabel,
				items: [item],
				label: item.categoryLabel,
			};
			groupMap.set(item.categoryLabel, group);
			groups.push(group);
		}
	}

	return groups;
};
