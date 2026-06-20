import {
	AudioLines,
	ChevronDown,
	FileText,
	Film,
	History,
	Image as ImageIcon,
	Loader2,
	Plus,
	WandSparkles,
	X,
} from "lucide-react";
import type React from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	createGenerationConversation,
	generationConversationsQueryKey,
	getGenerationConversations,
	type GenerationConversation,
	type GenerationConversationsResponse,
} from "@/domains/generation/api/generation";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/shared/components/ui/sheet";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";
import { openGenerationConversationCreateDialog } from "./GenerationConversationCreateDialog";
import type { StudioTab } from "./ProjectNavigatorTypes";

const GenerationWorkspace = lazy(() =>
	import("@/domains/generation/components/GenerationWorkspace").then((module) => ({
		default: module.GenerationWorkspace,
	})),
);

const globalToolboxScopeId = "studio";
const defaultToolboxKind: StudioTab = "video";

const toolboxConversationGroups: Array<{
	icon: React.ReactNode;
	kind: StudioTab;
	label: string;
}> = [
	{ icon: <Film />, kind: "video", label: "视频生成" },
	{ icon: <ImageIcon />, kind: "image", label: "图片生成" },
	{ icon: <FileText />, kind: "text", label: "文本生成" },
	{ icon: <AudioLines />, kind: "audio", label: "音频生成" },
];

export const GlobalToolboxButton: React.FC = () => {
	const [open, setOpen] = useState(false);

	return (
		<div className="relative shrink-0">
			<TooltipProvider delayDuration={180}>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={open ? "关闭工具箱" : "打开工具箱"}
							aria-expanded={open}
							className={cn(
								"flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
								open && "bg-ide-list-active text-ide-list-active-foreground",
							)}
							onClick={() => setOpen((current) => !current)}
						>
							<WandSparkles className="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="top">工具箱</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<GlobalToolboxDrawer open={open} onOpenChange={setOpen} />
		</div>
	);
};

const GlobalToolboxDrawer: React.FC<{
	onOpenChange: (open: boolean) => void;
	open: boolean;
}> = ({ onOpenChange, open }) => {
	const [activeConversation, setActiveConversation] = useState<GenerationConversation | null>(null);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [isCreatingConversation, setIsCreatingConversation] = useState(false);
	const sheetContentRef = useRef<HTMLDivElement>(null);
	const toast = useToast();
	const { mutate } = useSWRConfig();

	const videoConversations = useToolboxConversations("video", open);
	const imageConversations = useToolboxConversations("image", open);
	const textConversations = useToolboxConversations("text", open);
	const audioConversations = useToolboxConversations("audio", open);
	const conversationStateByKind = useMemo(
		() => ({
			video: videoConversations,
			image: imageConversations,
			text: textConversations,
			audio: audioConversations,
		}),
		[audioConversations, imageConversations, textConversations, videoConversations],
	);
	const allConversations = useMemo(
		() =>
			[
				...videoConversations.conversations,
				...imageConversations.conversations,
				...textConversations.conversations,
				...audioConversations.conversations,
			].sort(compareGenerationConversationsByUpdatedAt),
		[
			audioConversations.conversations,
			imageConversations.conversations,
			textConversations.conversations,
			videoConversations.conversations,
		],
	);
	const selectedConversation = useMemo(() => {
		if (!activeConversation) return null;
		return (
			allConversations.find(
				(conversation) =>
					conversation.kind === activeConversation.kind &&
					conversation.id === activeConversation.id,
			) ?? activeConversation
		);
	}, [activeConversation, allConversations]);
	const isLoadingConversations =
		videoConversations.isLoading ||
		imageConversations.isLoading ||
		textConversations.isLoading ||
		audioConversations.isLoading;

	useEffect(() => {
		if (!open) return;
		if (activeConversation) {
			if (
				allConversations.some(
					(conversation) =>
						conversation.kind === activeConversation.kind &&
						conversation.id === activeConversation.id,
				)
			) {
				return;
			}
			if (isLoadingConversations) return;
			return;
		}
		if (allConversations[0]) {
			setActiveConversation(allConversations[0]);
		} else if (!isLoadingConversations) {
			setActiveConversation(null);
		}
	}, [activeConversation, allConversations, isLoadingConversations, open]);

	const openCreateDialog = async () => {
		const result = await openGenerationConversationCreateDialog({
			groups: toolboxConversationGroups,
			initialKind: isToolboxKind(selectedConversation?.kind)
				? selectedConversation.kind
				: defaultToolboxKind,
		});
		if (!result) return;
		await createConversation(result.kind, result.title);
	};

	const createConversation = useCallback(
		async (kind: StudioTab, title: string) => {
			if (isCreatingConversation) return;
			const trimmedTitle = title.trim();
			if (!trimmedTitle) return;

			setIsCreatingConversation(true);
			try {
				const conversation = await createGenerationConversation({
					kind,
					scopeId: globalToolboxScopeId,
					title: trimmedTitle,
				});
				const conversationsKey = generationConversationsQueryKey(kind, globalToolboxScopeId, {
					allScopes: true,
				});
				await mutate(
					conversationsKey,
					(current?: GenerationConversationsResponse) =>
						upsertGenerationConversation(current, conversation),
					{ revalidate: false },
				);
				setActiveConversation(conversation);
			} catch (err) {
				const message = err instanceof Error ? err.message : "创建会话失败。";
				toast.error("创建会话失败", { description: message });
			} finally {
				setIsCreatingConversation(false);
			}
		},
		[isCreatingConversation, mutate, toast],
	);

	return (
		<>
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					ref={sheetContentRef}
					side="right"
					className="flex w-[min(1120px,calc(100vw-0.75rem))] max-w-none flex-col overflow-hidden bg-ide-editor p-0 text-ide-editor-foreground"
				>
					<header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-ide-panel px-3">
						<SheetHeader className="min-w-0">
							<SheetTitle className="truncate">工具箱</SheetTitle>
							<SheetDescription className="mt-0.5 truncate text-2xs">
								{selectedConversation
									? selectedConversation.title || "未命名会话"
									: "从历史会话选择或新建会话。"}
							</SheetDescription>
						</SheetHeader>
						<div className="flex shrink-0 items-center gap-2">
							<Popover open={historyOpen} onOpenChange={setHistoryOpen}>
								<PopoverTrigger asChild>
									<Button
										type="button"
										variant="secondary"
										className={cn(
											"h-8 rounded-sm px-2.5 text-xs font-semibold",
											historyOpen &&
												"border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
										)}
										aria-expanded={historyOpen}
									>
										<History className="size-3.5" />
										<span>历史会话</span>
										<ChevronDown
											className={cn("size-3.5 transition-transform", historyOpen && "rotate-180")}
										/>
									</Button>
								</PopoverTrigger>
								<PopoverContent
									align="end"
									portalContainer={sheetContentRef.current}
									className="flex max-h-[min(68vh,32rem)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
								>
									<div className="shrink-0 border-b border-border px-3 py-2">
										<p className="text-xs font-semibold text-foreground">历史会话</p>
										<p className="mt-0.5 text-2xs text-muted-foreground">
											选择任一会话恢复当前生成上下文。
										</p>
									</div>
									<div
										data-toolbox-history-scroll
										className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
										onWheelCapture={(event) => event.stopPropagation()}
										onTouchMoveCapture={(event) => event.stopPropagation()}
									>
										<div className="space-y-2">
											{toolboxConversationGroups.map((group) => (
												<ToolboxConversationGroup
													key={group.kind}
													group={group}
													selectedConversation={selectedConversation}
													state={conversationStateByKind[group.kind]}
													onSelectConversation={(conversation) => {
														setActiveConversation(conversation);
														setHistoryOpen(false);
													}}
												/>
											))}
										</div>
									</div>
								</PopoverContent>
							</Popover>
							<Button
								type="button"
								variant="ghost"
								className="h-8 rounded-sm px-2.5 text-xs font-semibold"
								disabled={isCreatingConversation}
								onClick={() => void openCreateDialog()}
							>
								{isCreatingConversation ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<Plus className="size-3.5" />
								)}
								<span>新建会话</span>
							</Button>
							<SheetClose asChild>
								<button
									type="button"
									className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									title="关闭"
									aria-label="关闭工具箱"
								>
									<X className="size-4" />
								</button>
							</SheetClose>
						</div>
					</header>

					<div className="min-h-0 flex-1 bg-ide-editor">
						{selectedConversation ? (
							<Suspense
								fallback={
									<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
										<Loader2 className="mr-2 size-3.5 animate-spin" />
										<span>加载工具箱</span>
									</div>
								}
							>
								<GenerationWorkspace
									conversationId={selectedConversation.id}
									conversationScopeId={selectedConversation.scopeId ?? globalToolboxScopeId}
									conversationTitle={selectedConversation.title}
									initialKind={selectedConversation.kind}
									lockKind
									onOpenSettings={() => onOpenChange(false)}
									projectHistory={false}
									requireConversation
									uploadIdPrefix={`global-toolbox-${selectedConversation.kind}`}
								/>
							</Suspense>
						) : (
							<div className="flex h-full items-center justify-center px-6 text-center">
								<div className="max-w-xs">
									<p className="text-sm font-medium text-foreground">
										{isLoadingConversations ? "加载会话" : "选择或新建会话"}
									</p>
									<p className="mt-2 text-xs leading-5 text-muted-foreground">
										{isLoadingConversations
											? "正在同步生成会话。"
											: "使用顶部新建会话开始生成，或从历史会话中恢复上下文。"}
									</p>
									{isLoadingConversations ? (
										<Loader2 className="mx-auto mt-3 size-4 animate-spin text-muted-foreground" />
									) : null}
								</div>
							</div>
						)}
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
};

const useToolboxConversations = (kind: StudioTab, enabled: boolean) => {
	const queryKey = enabled
		? generationConversationsQueryKey(kind, globalToolboxScopeId, { allScopes: true })
		: null;
	const { data, error, isLoading } = useSWR(queryKey, () =>
		getGenerationConversations(kind, globalToolboxScopeId, { allScopes: true }),
	);
	const conversations = useMemo(
		() => (data?.conversations ?? []).filter((conversation) => isToolboxKind(conversation.kind)),
		[data?.conversations],
	);

	return useMemo(
		() => ({
			conversations,
			error,
			isLoading,
		}),
		[conversations, error, isLoading],
	);
};

const ToolboxConversationGroup: React.FC<{
	group: (typeof toolboxConversationGroups)[number];
	onSelectConversation: (conversation: GenerationConversation) => void;
	selectedConversation: GenerationConversation | null;
	state: ReturnType<typeof useToolboxConversations>;
}> = ({ group, onSelectConversation, selectedConversation, state }) => (
	<section className="space-y-0.5">
		<div className="flex h-5 items-center gap-1.5 px-1.5 text-2xs font-semibold text-muted-foreground">
			<span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm [&_svg]:size-3">
				{group.icon}
			</span>
			<span className="min-w-0 flex-1 truncate">{group.label}</span>
			{!state.isLoading && !state.error ? (
				<span className="rounded-sm bg-ide-toolbar px-1 py-0 text-2xs font-medium tabular-nums text-muted-foreground">
					{state.conversations.length}
				</span>
			) : null}
		</div>
		{state.isLoading ? (
			<div className="flex h-6 items-center gap-2 px-2 text-2xs text-muted-foreground">
				<Loader2 className="size-3.5 animate-spin" />
				<span>加载中</span>
			</div>
		) : state.error ? (
			<p className="flex h-6 items-center px-2 text-2xs text-error-foreground">加载失败</p>
		) : state.conversations.length ? (
			<div className="space-y-0.5">
				{state.conversations.map((conversation) => (
					<ToolboxConversationItem
						key={conversation.id}
						conversation={conversation}
						selected={
							selectedConversation?.kind === conversation.kind &&
							selectedConversation.id === conversation.id
						}
						onSelect={() => onSelectConversation(conversation)}
					/>
				))}
			</div>
		) : (
			<p className="flex h-6 items-center px-2 text-2xs text-muted-foreground">暂无会话</p>
		)}
	</section>
);

const upsertGenerationConversation = (
	current: GenerationConversationsResponse | undefined,
	conversation: GenerationConversation,
): GenerationConversationsResponse => {
	const conversations = [
		conversation,
		...(current?.conversations ?? []).filter(
			(item) => !(item.kind === conversation.kind && item.id === conversation.id),
		),
	].sort(compareGenerationConversationsByUpdatedAt);
	return {
		...(current ?? { conversations: [] }),
		conversations,
		sessions: conversations,
	};
};

const ToolboxConversationItem: React.FC<{
	conversation: GenerationConversation;
	onSelect: () => void;
	selected: boolean;
}> = ({ conversation, onSelect, selected }) => {
	const title = conversation.title || "未命名会话";
	const updatedAt = toolboxConversationTime(conversation.updatedAt);
	const sourceLabel =
		conversation.scopeId && conversation.scopeId !== globalToolboxScopeId ? "项目" : "工具箱";

	return (
		<button
			type="button"
			aria-label={title}
			onClick={onSelect}
			className={cn(
				"flex h-7 w-full items-center gap-2 rounded-sm border border-transparent px-2 text-left transition-colors",
				selected
					? "border-border/80 bg-ide-list-active text-ide-list-active-foreground"
					: "text-popover-foreground hover:bg-ide-list-hover hover:text-foreground",
			)}
		>
			{updatedAt ? (
				<span className="shrink-0 text-2xs text-muted-foreground">{updatedAt}</span>
			) : null}
			<span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
			<span className="shrink-0 rounded-sm border border-border bg-ide-toolbar px-1.5 py-0 text-2xs font-medium leading-4 text-muted-foreground">
				{selected ? "当前" : sourceLabel}
			</span>
		</button>
	);
};

const isToolboxKind = (kind: string | undefined): kind is StudioTab =>
	kind === "video" || kind === "image" || kind === "text" || kind === "audio";

const toolboxConversationTime = (value: string) => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";

	return date.toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const compareGenerationConversationsByUpdatedAt = (
	left: GenerationConversation,
	right: GenerationConversation,
) => {
	const rightTime = new Date(right.updatedAt).getTime();
	const leftTime = new Date(left.updatedAt).getTime();
	return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
};
