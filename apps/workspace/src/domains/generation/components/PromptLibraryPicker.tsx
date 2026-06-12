import { CaseSensitive, Library, Loader2, Palette, Search, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	type StylePreset,
	listStylePresets,
	stylePresetsKey,
} from "@/domains/generation/api/prompt-presets";
import {
	type PromptEntry,
	type PromptEntryKind,
	listPrompts,
	promptsKey,
} from "@/domains/generation/api/prompt-presets";
import type { GenerationKind } from "@/domains/generation/api/generation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

type PickerGenerationKind = Extract<GenerationKind, "image" | "video">;
type PromptLibraryGroup = "extra" | "style";

interface PromptLibraryItem {
	category?: string;
	group: PromptLibraryGroup;
	id: string;
	name: string;
	prompt: string;
	source?: "builtin" | "user";
}

export const PromptLibraryPicker: React.FC<{
	className?: string;
	kind: PickerGenerationKind;
	onPromptChange: (value: string) => void;
	prompt: string;
	triggerVariant?: "icon" | "label" | "toolbar";
}> = ({ className, kind, onPromptChange, prompt, triggerVariant = "label" }) => {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const { data: stylePresets = [], isLoading: stylesLoading } = useSWR(
		stylePresetsKey,
		listStylePresets,
	);
	const promptQueryKey = [promptsKey, "picker", kind] as const;
	const { data: prompts = [], isLoading: promptsLoading } = useSWR(promptQueryKey, () =>
		listPrompts({ kind: kind as PromptEntryKind }),
	);
	const items = useMemo(() => buildLibraryItems(stylePresets, prompts), [prompts, stylePresets]);
	const filteredGroups = useMemo(() => filterGroups(items, query), [items, query]);
	const loading = stylesLoading || promptsLoading;

	useEffect(() => {
		if (!open) return;

		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			setOpen(false);
		};

		window.addEventListener("keydown", closeOnEscape, true);
		return () => window.removeEventListener("keydown", closeOnEscape, true);
	}, [open]);

	const applyPrompt = (item: PromptLibraryItem) => {
		onPromptChange(appendPromptText(prompt, item.prompt));
		setOpen(false);
	};

	return (
		<div className={cn("shrink-0", className)}>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className={cn(
					triggerVariant === "icon"
						? "h-9 w-10 rounded-md border border-border bg-ide-editor px-0 text-foreground shadow-none hover:bg-ide-list-hover [&_svg]:size-4"
						: triggerVariant === "toolbar"
							? "h-9 rounded-md border border-border bg-ide-editor px-3 text-xs font-medium text-foreground shadow-none hover:bg-ide-list-hover"
							: "h-7 rounded-full px-2 text-2xs font-medium text-muted-foreground hover:bg-ide-list-hover hover:text-foreground [&_svg]:size-3.5",
				)}
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label="提示词"
				title="提示词"
				onClick={() => setOpen(true)}
			>
				{triggerVariant === "toolbar" ? null : triggerVariant === "icon" ? (
					<CaseSensitive />
				) : (
					<Library />
				)}
				<span className={triggerVariant === "icon" ? "sr-only" : undefined}>提示词</span>
			</Button>
			{open ? (
				<div
					data-state="open"
					className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setOpen(false);
					}}
				>
					<section
						data-state="open"
						role="dialog"
						aria-modal="true"
						aria-labelledby="prompt-library-picker-title"
						className="flex h-[min(38rem,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
					>
						<header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
							<div className="min-w-0">
								<h3
									id="prompt-library-picker-title"
									className="truncate text-sm font-semibold text-foreground"
								>
									提示词
								</h3>
								<p className="mt-1 truncate text-xs text-muted-foreground">
									{kind === "image" ? "图片生成" : "视频生成"}
								</p>
							</div>
							<Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)}>
								<X className="size-4" />
							</Button>
						</header>
						<div className="shrink-0 border-b border-border bg-card/60 px-4 py-3">
							<div className="relative">
								<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									value={query}
									placeholder="搜索"
									className="rounded-md pl-8"
									onChange={(event) => setQuery(event.target.value)}
								/>
							</div>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto bg-ide-editor p-4">
							{loading && items.length === 0 ? (
								<div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									<span>加载中</span>
								</div>
							) : filteredGroups.every((group) => group.items.length === 0) ? (
								<div className="flex min-h-48 items-center justify-center rounded-sm border border-dashed border-border bg-muted px-4 text-center text-xs text-muted-foreground">
									暂无可用提示词。
								</div>
							) : (
								<div className="grid gap-4">
									{filteredGroups.map((group) => {
										if (group.items.length === 0) return null;

										const Icon = group.icon;
										return (
											<section key={group.key} className="min-w-0">
												<div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
													<Icon className="size-3.5" />
													<span>{group.label}</span>
												</div>
												<div className="grid gap-2 sm:grid-cols-2">
													{group.items.map((item) => (
														<button
															key={item.id}
															type="button"
															className="grid min-h-24 gap-2 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
															onClick={() => applyPrompt(item)}
														>
															<span className="flex min-w-0 items-center justify-between gap-2">
																<span className="truncate text-sm font-medium text-foreground">
																	{item.name}
																</span>
																{item.category ? (
																	<span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">
																		{item.category}
																	</span>
																) : null}
															</span>
															<span className="line-clamp-2 text-xs leading-5 text-muted-foreground">
																{item.prompt}
															</span>
														</button>
													))}
												</div>
											</section>
										);
									})}
								</div>
							)}
						</div>
					</section>
				</div>
			) : null}
		</div>
	);
};

const groups: Array<{
	icon: React.ComponentType<{ className?: string }>;
	key: PromptLibraryGroup;
	label: string;
}> = [
	{ key: "style", label: "风格", icon: Palette },
	{ key: "extra", label: "其他", icon: Library },
];

const buildLibraryItems = (
	stylePresets: StylePreset[],
	prompts: PromptEntry[],
): PromptLibraryItem[] => [
	...stylePresets.map((preset) => ({
		id: `style:${preset.id}`,
		name: preset.name,
		prompt: preset.prompt,
		group: "style" as const,
		source: preset.source,
	})),
	...prompts.map((entry) => ({
		id: `prompt:${entry.id}`,
		name: entry.name,
		prompt: entry.prompt,
		category: entry.category,
		group: "extra" as const,
		source: entry.source,
	})),
];

const filterGroups = (items: PromptLibraryItem[], query: string) => {
	const normalizedQuery = query.trim().toLowerCase();
	const filtered = normalizedQuery
		? items.filter((item) =>
				[item.name, item.category ?? "", item.prompt].some((field) =>
					field.toLowerCase().includes(normalizedQuery),
				),
			)
		: items;

	return groups.map((group) => ({
		...group,
		items: filtered.filter((item) => item.group === group.key),
	}));
};

const appendPromptText = (currentPrompt: string, nextPrompt: string) => {
	const current = currentPrompt.trimEnd();
	const next = nextPrompt.trim();
	if (!next) return currentPrompt;
	if (!current) return next;
	return `${current}\n\n${next}`;
};
