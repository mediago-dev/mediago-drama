import {
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
import useSWR, { mutate as mutateSWR } from "swr";
import {
	createGenerationConversation,
	generationConversationsQueryKey,
	getGenerationConversations,
	type GenerationConversation,
} from "@/domains/generation/api/generation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
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
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [isCreatingConversation, setIsCreatingConversation] = useState(false);
	const [newConversationKind, setNewConversationKind] = useState<StudioTab>(defaultToolboxKind);
	const [newConversationTitle, setNewConversationTitle] = useState("");
	const sheetContentRef = useRef<HTMLDivElement>(null);
	const toast = useToast();

	const videoConversations = useToolboxConversations("video", open);
	const imageConversations = useToolboxConversations("image", open);
	const textConversations = useToolboxConversations("text", open);
	const conversationStateByKind = useMemo(
		() => ({
			video: videoConversations,
			image: imageConversations,
			text: textConversations,
		}),
		[imageConversations, textConversations, videoConversations],
	);
	const allConversations = useMemo(
		() =>
			[
				...videoConversations.conversations,
				...imageConversations.conversations,
				...textConversations.conversations,
			].sort(compareGenerationConversationsByUpdatedAt),
		[
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
		videoConversations.isLoading || imageConversations.isLoading || textConversations.isLoading;

	useEffect(() => {
		if (!open) return;
		if (
			activeConversation &&
			allConversations.some(
				(conversation) =>
					conversation.kind === activeConversation.kind &&
					conversation.id === activeConversation.id,
			)
		) {
			return;
		}
		if (allConversations[0]) {
			setActiveConversation(allConversations[0]);
		} else if (!isLoadingConversations && allConversations.length > 0 && activeConversation) {
			setActiveConversation(null);
		}
	}, [activeConversation, allConversations, isLoadingConversations, open]);

	const openCreateDialog = () => {
		setNewConversationKind(
			isToolboxKind(selectedConversation?.kind) ? selectedConversation.kind : defaultToolboxKind,
		);
		setIsCreateOpen(true);
	};

	const createConversation = useCallback(async () => {
		if (isCreatingConversation) return;
		const title = newConversationTitle.trim();
		if (!title) return;

		setIsCreatingConversation(true);
		try {
			const conversation = await createGenerationConversation({
				kind: newConversationKind,
				scopeId: globalToolboxScopeId,
				title,
			});
			await mutateSWR(
				generationConversationsQueryKey(newConversationKind, globalToolboxScopeId, {
					allScopes: true,
				}),
			);
			setActiveConversation(conversation);
			setIsCreateOpen(false);
			setNewConversationTitle("");
		} catch (err) {
			const message = err instanceof Error ? err.message : "创建会话失败。";
			toast.error("创建会话失败", { description: message });
		} finally {
			setIsCreatingConversation(false);
		}
	}, [isCreatingConversation, newConversationKind, newConversationTitle, toast]);

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
								onClick={openCreateDialog}
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

			<GlobalToolboxCreateDialog
				isCreating={isCreatingConversation}
				kind={newConversationKind}
				onCreate={() => void createConversation()}
				onKindChange={setNewConversationKind}
				onOpenChange={(nextOpen) => {
					if (isCreatingConversation) return;
					setIsCreateOpen(nextOpen);
					if (!nextOpen) setNewConversationTitle("");
				}}
				onTitleChange={setNewConversationTitle}
				open={isCreateOpen}
				title={newConversationTitle}
			/>
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

const GlobalToolboxCreateDialog: React.FC<{
	isCreating: boolean;
	kind: StudioTab;
	onCreate: () => void;
	onKindChange: (kind: StudioTab) => void;
	onOpenChange: (open: boolean) => void;
	onTitleChange: (title: string) => void;
	open: boolean;
	title: string;
}> = ({ isCreating, kind, onCreate, onKindChange, onOpenChange, onTitleChange, open, title }) => {
	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onCreate();
	};

	return (
		<AlertDialog open={open} onOpenChange={(nextOpen) => !isCreating && onOpenChange(nextOpen)}>
			<AlertDialogContent className="max-w-md">
				<form onSubmit={submit}>
					<AlertDialogHeader>
						<AlertDialogTitle>新建会话</AlertDialogTitle>
						<AlertDialogDescription>选择生成类型并填写会话名称。</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="my-4 grid gap-3">
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">生成类型</span>
							<Select
								value={kind}
								onValueChange={(value) => onKindChange(value as StudioTab)}
								disabled={isCreating}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{toolboxConversationGroups.map((group) => (
										<SelectItem key={group.kind} value={group.kind}>
											{group.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</label>
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">会话名称</span>
							<Input
								value={title}
								onChange={(event) => onTitleChange(event.target.value)}
								placeholder={`${toolboxKindLabel(kind)}探索`}
								disabled={isCreating}
								autoFocus
							/>
						</label>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isCreating}>取消</AlertDialogCancel>
						<Button type="submit" disabled={isCreating || !title.trim()}>
							{isCreating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus />}
							<span>创建</span>
						</Button>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
};

const isToolboxKind = (kind: string | undefined): kind is StudioTab =>
	kind === "video" || kind === "image" || kind === "text";

const toolboxKindLabel = (kind: StudioTab) => {
	switch (kind) {
		case "text":
			return "文本生成";
		case "image":
			return "图片生成";
		default:
			return "视频生成";
	}
};

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
