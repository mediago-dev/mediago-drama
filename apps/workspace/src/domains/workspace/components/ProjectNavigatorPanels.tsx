import {
	ChevronLeft,
	Bot,
	Ellipsis,
	FileText,
	Film,
	Image as ImageIcon,
	KeyRound,
	Loader2,
	Plus,
	ReceiptText,
	Settings,
	SlidersHorizontal,
	SquarePen,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
	capabilitiesKey,
	getCapabilities,
	type CapabilityRecord,
} from "@/domains/capabilities/api/capabilities";
import { iconByName } from "@/domains/capabilities/components/iconByName";
import {
	createGenerationConversation,
	deleteGenerationConversation,
	generationConversationsQueryKey,
	getGenerationConversations,
	type GenerationConversation,
} from "@/domains/generation/api/generation";
import type { GenerationSuccessNotification } from "@/domains/generation/stores/generation-notifications";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { useToast } from "@/hooks/useToast";
import type { SettingsTabValue } from "@/lib/stores/settings";
import type { WorkMode } from "@/lib/stores/work-mode";
import { cn } from "@/shared/lib/utils";
import { debugTabs, type DebugTabValue } from "@/pages/Debug";
import { GenerationNotificationButton } from "./GenerationNotificationButton";
import type { ActiveStudioTab, StudioTab } from "./ProjectNavigatorTypes";

const workModeOptions: {
	label: string;
	mode: WorkMode;
}[] = [
	{ mode: "agent", label: "智能体" },
	{ mode: "studio", label: "工具箱" },
];

interface StudioToolItem {
	category: CapabilityRecord["category"];
	generationTab?: StudioTab;
	icon: React.ReactNode;
	label: string;
	sourceIndex: number;
	available?: boolean;
	statusLabel?: string;
	value: string;
}

const fallbackStudioToolItems: StudioToolItem[] = [
	{
		category: "generation",
		generationTab: "video",
		icon: <Film />,
		label: "视频生成",
		sourceIndex: 0,
		value: "video.generate",
	},
	{
		category: "generation",
		generationTab: "image",
		icon: <ImageIcon />,
		label: "图片生成",
		sourceIndex: 1,
		value: "image.generate",
	},
	{
		category: "generation",
		generationTab: "text",
		icon: <FileText />,
		label: "文本生成",
		sourceIndex: 2,
		value: "text.generate",
	},
];

export const WorkModeSwitcher: React.FC<{
	activeMode: WorkMode;
	onSelectMode: (mode: WorkMode) => void;
}> = ({ activeMode, onSelectMode }) => (
	<div className="-mx-2 -mt-3 mb-3 shrink-0 border-b border-border px-2 py-2">
		<div
			className="grid grid-cols-3 gap-1 rounded-sm border border-border bg-ide-toolbar p-0.5"
			aria-label="工作模式"
		>
			{workModeOptions.map((option) => {
				const active = activeMode === option.mode;
				return (
					<button
						key={option.mode}
						type="button"
						aria-label={option.label}
						aria-pressed={active}
						title={option.label}
						onClick={() => onSelectMode(option.mode)}
						className={cn(
							"flex h-8 min-w-0 items-center justify-center rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
							active && "bg-ide-list-active text-ide-list-active-foreground shadow-sm",
						)}
					>
						<span className="min-w-0 truncate">{option.label}</span>
					</button>
				);
			})}
		</div>
	</div>
);

export const SettingsButton: React.FC<{
	isActive: boolean;
	onClick: () => void;
}> = ({ isActive, onClick }) => (
	<button
		type="button"
		onClick={onClick}
		className={cn(
			"flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm transition-colors hover:bg-ide-list-hover hover:text-foreground",
			isActive
				? "bg-ide-list-active text-ide-list-active-foreground"
				: "text-ide-sidebar-foreground",
		)}
	>
		<Settings className="size-4 shrink-0" />
		<span className="min-w-0 flex-1 truncate">设置</span>
	</button>
);

export const StudioConversationsScreen: React.FC<{
	activeConversationId: string;
	activeTab: ActiveStudioTab;
	onReturnToTypes: () => void;
	onSelectConversation: (conversationId: string) => void;
}> = ({ activeConversationId, activeTab, onReturnToTypes, onSelectConversation }) => {
	const selectedTab = activeTab ?? "image";

	return (
		<div className="flex h-full min-h-0 flex-col">
			<button
				type="button"
				onClick={onReturnToTypes}
				className="flex h-9 w-full shrink-0 items-center gap-2 rounded-sm px-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-ide-list-hover"
			>
				<ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">返回</span>
			</button>

			<StudioConversationList
				activeConversationId={activeConversationId}
				kind={selectedTab}
				onSelectConversation={onSelectConversation}
			/>
		</div>
	);
};

export const StudioTypesScreen: React.FC<{
	activeCapabilityId: string | null;
	activeMode: WorkMode;
	activeTab: ActiveStudioTab;
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onOpenSettings: () => void;
	onSelectMode: (mode: WorkMode) => void;
	onSelectTab: (tab: StudioTab | null) => void;
	showModeSwitcher?: boolean;
}> = ({
	activeCapabilityId,
	activeMode,
	activeTab,
	onOpenGenerationNotification,
	onOpenSettings,
	onSelectMode,
	onSelectTab,
	showModeSwitcher = true,
}) => {
	const { data } = useSWR(capabilitiesKey, getCapabilities);
	const manifestStudioToolItems = useMemo(
		() => studioToolItemsFromCapabilities(data?.capabilities ?? []),
		[data?.capabilities],
	);
	const studioToolItems = useMemo(
		() => mergeStudioToolItems(manifestStudioToolItems, fallbackStudioToolItems),
		[manifestStudioToolItems],
	);
	const groupedStudioToolItems = useMemo(
		() => groupStudioToolItems(studioToolItems),
		[studioToolItems],
	);
	const activeItemId = activeTab
		? studioToolItems.find((item) => item.generationTab === activeTab)?.value
		: activeCapabilityId;

	return (
		<div className="flex h-full min-h-0 flex-col">
			{showModeSwitcher ? (
				<WorkModeSwitcher activeMode={activeMode} onSelectMode={onSelectMode} />
			) : null}

			<div className="min-h-0 flex-1 overflow-y-auto pr-1">
				<div className="space-y-4">
					{categoryOrder.map((category) => {
						const items = groupedStudioToolItems[category] ?? [];
						if (items.length === 0) return null;

						return (
							<section key={category} className="space-y-1">
								{items.map((item) => (
									<SettingsPanelButton
										key={item.value}
										active={activeItemId === item.value}
										disabled={!item.generationTab}
										icon={item.icon}
										label={item.label}
										statusLabel={item.statusLabel}
										onClick={
											item.generationTab ? () => onSelectTab(item.generationTab ?? null) : undefined
										}
									/>
								))}
							</section>
						);
					})}
				</div>
			</div>

			<div className="mt-auto pt-2">
				<div className="flex items-center gap-1">
					<div className="min-w-0 flex-1">
						<SettingsButton isActive={false} onClick={onOpenSettings} />
					</div>
					{onOpenGenerationNotification ? (
						<GenerationNotificationButton onOpenNotification={onOpenGenerationNotification} />
					) : null}
				</div>
			</div>
		</div>
	);
};

const categoryOrder: CapabilityRecord["category"][] = ["generation", "processing"];

const studioTabOrder: Record<StudioTab, number> = {
	video: 0,
	image: 1,
	text: 2,
};

const studioToolItemsFromCapabilities = (capabilities: CapabilityRecord[]): StudioToolItem[] =>
	capabilities
		.flatMap((record, sourceIndex): StudioToolItem[] => {
			if (record.status === "hidden") {
				return [];
			}
			const Icon = iconByName(record.icon);
			const generationTab =
				record.surface === "generation" && isStudioTabKind(record.kind) ? record.kind : undefined;
			if (!generationTab) return [];
			return [
				{
					available: record.available,
					category: record.category,
					generationTab,
					icon: <Icon />,
					label: record.name,
					sourceIndex,
					statusLabel: record.status === "planned" ? "Coming soon" : undefined,
					value: record.id,
				},
			];
		})
		.sort(compareStudioToolItems);

const groupStudioToolItems = (items: StudioToolItem[]) =>
	items.reduce<Partial<Record<CapabilityRecord["category"], StudioToolItem[]>>>((groups, item) => {
		const current = groups[item.category] ?? [];
		groups[item.category] = [...current, item];
		return groups;
	}, {});

const mergeStudioToolItems = (primary: StudioToolItem[], fallback: StudioToolItem[]) => {
	if (primary.length === 0) return fallback;

	const seen = new Set(primary.map((item) => item.value));
	return [...primary, ...fallback.filter((item) => !seen.has(item.value))].sort(
		compareStudioToolItems,
	);
};

const compareStudioToolItems = (left: StudioToolItem, right: StudioToolItem) => {
	const categoryDelta =
		categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category);
	if (categoryDelta !== 0) return categoryDelta;

	if (left.generationTab && right.generationTab) {
		return studioTabOrder[left.generationTab] - studioTabOrder[right.generationTab];
	}

	if (left.generationTab) return -1;
	if (right.generationTab) return 1;

	return left.sourceIndex - right.sourceIndex;
};

const isStudioTabKind = (kind: string): kind is StudioTab =>
	kind === "image" || kind === "video" || kind === "text";

const StudioConversationList: React.FC<{
	activeConversationId: string;
	kind: StudioTab;
	onSelectConversation: (conversationId: string) => void;
	scopeId?: string;
}> = ({ activeConversationId, kind, onSelectConversation, scopeId = "studio" }) => {
	const toast = useToast();
	const [isCreatingConversation, setIsCreatingConversation] = useState(false);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newConversationTitle, setNewConversationTitle] = useState("");
	const conversationsKey = generationConversationsQueryKey(kind, scopeId, { allScopes: true });
	const {
		data,
		error,
		isLoading,
		mutate: mutateConversations,
	} = useSWR(conversationsKey, () =>
		getGenerationConversations(kind, scopeId, { allScopes: true }),
	);
	const conversations = data?.conversations ?? [];
	const selectedConversationId = activeConversationId || "";

	const createConversation = useCallback(async () => {
		if (isCreatingConversation) return;
		const title = newConversationTitle.trim();
		if (!title) return;

		setIsCreatingConversation(true);
		try {
			const conversation = await createGenerationConversation({
				kind,
				scopeId,
				title,
			});
			await mutateConversations();
			onSelectConversation(conversation.id);
			setIsCreateOpen(false);
			setNewConversationTitle("");
		} catch (err) {
			const message = err instanceof Error ? err.message : "创建会话失败。";
			toast.error("创建会话失败", { description: message });
		} finally {
			setIsCreatingConversation(false);
		}
	}, [
		isCreatingConversation,
		kind,
		mutateConversations,
		newConversationTitle,
		onSelectConversation,
		scopeId,
		toast,
	]);

	const deleteConversation = useCallback(
		async (conversation: GenerationConversation) => {
			try {
				await deleteGenerationConversation(conversation.id);
				await mutateConversations();
				if (conversation.id === selectedConversationId) onSelectConversation("");
				toast.success("Session 已删除", { description: conversation.title });
			} catch (err) {
				const message = err instanceof Error ? err.message : "删除失败。";
				toast.error("删除 session 失败", { description: message });
			}
		},
		[mutateConversations, onSelectConversation, selectedConversationId, toast],
	);

	return (
		<>
			<div className="mt-3 flex min-h-0 flex-1 flex-col">
				<div className="mb-2 px-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-8 w-full justify-start px-2"
						disabled={isCreatingConversation}
						onClick={() => setIsCreateOpen(true)}
					>
						{isCreatingConversation ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<SquarePen className="size-3.5" />
						)}
						<span>新建</span>
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{isLoading ? (
						<div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" />
							<span>加载中</span>
						</div>
					) : error ? (
						<p className="px-2 py-1.5 text-xs text-error-foreground">加载失败</p>
					) : conversations.length ? (
						<div className="space-y-1">
							{conversations.map((conversation) => (
								<StudioConversationItem
									key={conversation.id}
									conversation={conversation}
									selected={conversation.id === selectedConversationId}
									onDelete={() => void deleteConversation(conversation)}
									onSelect={() => onSelectConversation(conversation.id)}
								/>
							))}
						</div>
					) : (
						<p className="px-2 py-1.5 text-xs leading-5 text-muted-foreground">暂无 session。</p>
					)}
				</div>
			</div>
			<GenerationSessionCreateDialog
				isCreating={isCreatingConversation}
				kind={kind}
				onCreate={() => void createConversation()}
				onOpenChange={(open) => {
					if (isCreatingConversation) return;
					setIsCreateOpen(open);
					if (!open) setNewConversationTitle("");
				}}
				onTitleChange={setNewConversationTitle}
				open={isCreateOpen}
				title={newConversationTitle}
			/>
		</>
	);
};

const StudioConversationItem: React.FC<{
	conversation: GenerationConversation;
	onDelete: () => void;
	onSelect: () => void;
	selected: boolean;
}> = ({ conversation, onDelete, onSelect, selected }) => {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const itemRef = useRef<HTMLDivElement>(null);
	const title = conversation.title || "未命名 session";

	useCloseSidebarItemMenu(itemRef, isMenuOpen, setIsMenuOpen);

	const openDeleteDialog = () => {
		setIsMenuOpen(false);
		setIsDeleteDialogOpen(true);
	};

	return (
		<div ref={itemRef} className="relative">
			<div
				className={cn(
					"group/session flex w-full items-center gap-1 rounded-sm border p-1 text-left transition-colors",
					selected
						? "border-border/80 bg-ide-list-active text-ide-list-active-foreground"
						: "border-transparent text-ide-sidebar-foreground hover:bg-ide-list-hover hover:text-foreground focus-within:bg-ide-list-hover focus-within:text-foreground",
				)}
			>
				<button
					type="button"
					onClick={onSelect}
					className="flex min-w-0 flex-1 flex-col gap-1 px-1 py-1 text-left"
				>
					<span className="min-w-0 truncate text-xs font-medium">{title}</span>
				</button>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className={cn(
						"size-6 shrink-0 text-muted-foreground hover:text-foreground",
						isMenuOpen || isDeleteDialogOpen
							? "opacity-100"
							: "opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100",
					)}
					onClick={() => setIsMenuOpen((open) => !open)}
					aria-expanded={isMenuOpen}
					aria-haspopup="menu"
					aria-label={`打开 ${title} 的更多操作`}
				>
					<Ellipsis className="size-3.5" />
				</Button>
			</div>
			{isMenuOpen ? <SidebarDeleteMenu itemTitle={title} onDelete={openDeleteDialog} /> : null}
			<AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>删除 session？</AlertDialogTitle>
						<AlertDialogDescription>
							确定要删除“{title}”吗？该 session 下的生成记录会一并删除，此操作无法撤销。
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>取消</AlertDialogCancel>
						<AlertDialogAction onClick={onDelete}>删除</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
};

const SidebarDeleteMenu: React.FC<{
	itemTitle: string;
	onDelete: () => void;
}> = ({ itemTitle, onDelete }) => (
	<div
		role="menu"
		aria-label={`${itemTitle} 操作`}
		className="absolute right-1 top-[calc(100%-2px)] z-30 min-w-32 rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
	>
		<button
			type="button"
			role="menuitem"
			onClick={onDelete}
			className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-xs text-error-foreground transition-colors hover:bg-error-surface focus-visible:bg-error-surface focus-visible:outline-none"
		>
			<Trash2 className="size-3.5 shrink-0" />
			<span className="min-w-0 flex-1 truncate">删除</span>
		</button>
	</div>
);

const useCloseSidebarItemMenu = (
	itemRef: React.RefObject<HTMLDivElement | null>,
	isMenuOpen: boolean,
	setIsMenuOpen: (open: boolean) => void,
) => {
	useEffect(() => {
		if (!isMenuOpen) return;

		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (itemRef.current?.contains(event.target as Node)) return;
			setIsMenuOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setIsMenuOpen(false);
		};

		window.document.addEventListener("pointerdown", closeOnOutsidePointer);
		window.document.addEventListener("keydown", closeOnEscape);
		return () => {
			window.document.removeEventListener("pointerdown", closeOnOutsidePointer);
			window.document.removeEventListener("keydown", closeOnEscape);
		};
	}, [isMenuOpen, itemRef, setIsMenuOpen]);
};

const GenerationSessionCreateDialog: React.FC<{
	isCreating: boolean;
	kind: StudioTab;
	onCreate: () => void;
	onOpenChange: (open: boolean) => void;
	onTitleChange: (title: string) => void;
	open: boolean;
	title: string;
}> = ({ isCreating, kind, onCreate, onOpenChange, onTitleChange, open, title }) => {
	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onCreate();
	};
	const kindLabel = studioTabLabel(kind);

	return (
		<AlertDialog open={open} onOpenChange={(nextOpen) => !isCreating && onOpenChange(nextOpen)}>
			<AlertDialogContent className="max-w-md">
				<form onSubmit={submit}>
					<AlertDialogHeader>
						<AlertDialogTitle>新建{kindLabel} session</AlertDialogTitle>
						<AlertDialogDescription>填写左侧 session 列表中显示的名称。</AlertDialogDescription>
					</AlertDialogHeader>
					<label className="my-4 block">
						<span className="mb-1 block text-xs font-medium text-muted-foreground">
							Session 名称
						</span>
						<Input
							value={title}
							onChange={(event) => onTitleChange(event.target.value)}
							placeholder={`${kindLabel}探索`}
							disabled={isCreating}
							autoFocus
						/>
					</label>
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

const studioTabLabel = (kind: StudioTab) => {
	switch (kind) {
		case "text":
			return "文本生成";
		case "video":
			return "视频生成";
		default:
			return "图片生成";
	}
};

type SettingsNavItem = {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: SettingsTabValue;
};

type SettingsNavGroup = {
	items: SettingsNavItem[];
	label: string;
};

const debugNavItem = (value: DebugTabValue): SettingsNavItem => {
	const tab = debugTabs.find((entry) => entry.value === value);
	if (!tab) throw new Error(`Unknown settings tab: ${value}`);
	return { value: tab.value, label: tab.label, icon: tab.icon };
};

const settingsNavGroups: SettingsNavGroup[] = [
	{
		label: "工作区",
		items: [
			{ value: "appearance", label: "基础设置", icon: SlidersHorizontal },
			{ value: "billing", label: "用量与账单", icon: ReceiptText },
		],
	},
	{
		label: "生成配置",
		items: [
			{ value: "api-keys", label: "API 密钥", icon: KeyRound },
			debugNavItem("prompt-library"),
		],
	},
	{
		label: "智能体",
		items: [
			{ value: "agent-model-profiles", label: "模型接入", icon: Bot },
			debugNavItem("prompts"),
			debugNavItem("skills"),
		],
	},
];

export const SettingsSidebarPanel: React.FC<{
	activeTab: SettingsTabValue;
	isProjectSettings: boolean;
	onBack: () => void;
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onSelectTab: (tab: SettingsTabValue) => void;
	projectName: string;
}> = ({
	activeTab,
	isProjectSettings,
	onBack,
	onOpenGenerationNotification,
	onSelectTab,
	projectName,
}) => (
	<div className="flex h-full flex-col">
		<button
			type="button"
			onClick={onBack}
			className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-ide-list-hover"
		>
			<ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate">返回</span>
		</button>

		{isProjectSettings ? (
			<>
				<div className="mt-3 px-2">
					<p className="truncate text-xs font-medium text-muted-foreground">{projectName}</p>
				</div>
				<div className="mt-2">
					<SettingsPanelButton active icon={<SlidersHorizontal />} label="常规" />
				</div>
			</>
		) : (
			<div className="mt-2 space-y-4">
				{settingsNavGroups.map((group) => (
					<section key={group.label} className="space-y-1">
						<p className="px-2 text-2xs font-semibold text-muted-foreground">{group.label}</p>
						{group.items.map((item) => {
							const Icon = item.icon;
							return (
								<SettingsPanelButton
									key={item.value}
									active={activeTab === item.value}
									icon={<Icon />}
									label={item.label}
									onClick={() => onSelectTab(item.value)}
								/>
							);
						})}
					</section>
				))}
			</div>
		)}
		{onOpenGenerationNotification ? (
			<div className="mt-auto flex justify-end pt-2">
				<GenerationNotificationButton onOpenNotification={onOpenGenerationNotification} />
			</div>
		) : null}
	</div>
);

const SettingsPanelButton: React.FC<{
	active: boolean;
	disabled?: boolean;
	icon: React.ReactNode;
	label: string;
	onClick?: () => void;
	statusLabel?: string;
}> = ({ active, disabled = false, icon, label, onClick, statusLabel }) => (
	<button
		type="button"
		disabled={disabled}
		onClick={onClick}
		className={cn(
			"flex h-8 w-full items-center gap-1.5 rounded-sm border border-transparent px-2 text-left text-ide-sidebar-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ide-sidebar-foreground",
			active && "border-border/80 bg-ide-list-active text-ide-list-active-foreground",
		)}
	>
		<span className="flex size-6 shrink-0 items-center justify-center rounded-sm [&_svg]:size-4">
			{icon}
		</span>
		<span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
		{statusLabel ? (
			<span className="shrink-0 text-2xs font-medium text-muted-foreground">{statusLabel}</span>
		) : null}
	</button>
);
