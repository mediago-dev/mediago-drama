import {
	AudioLines,
	ChevronLeft,
	CircleQuestionMark,
	Ellipsis,
	FileText,
	Film,
	Download,
	Image as ImageIcon,
	Keyboard,
	KeyRound,
	Loader2,
	Network,
	ReceiptText,
	Settings,
	SlidersHorizontal,
	SquarePen,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate as mutateSWR } from "swr";
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
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { useToast } from "@/hooks/useToast";
import { projectSettingsGeneralTab, type SettingsTabValue } from "@/lib/stores/settings";
import { openExternalUrl } from "@/shared/desktop/actions";
import { cn } from "@/shared/lib/utils";
import { debugTabs, type DebugTabValue } from "@/pages/Debug";
import { GenerationNotificationButton } from "./GenerationNotificationButton";
import { openGenerationConversationCreateDialog } from "./GenerationConversationCreateDialog";
import { GlobalToolboxButton } from "./GlobalToolboxDrawer";
import { AssetLibraryButton } from "./AssetLibraryButton";
import type { ActiveStudioTab, StudioTab } from "./ProjectNavigatorTypes";

const githubRepositoryURL = "https://github.com/mediago-dev/mediago-drama";

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
	{
		category: "generation",
		generationTab: "audio",
		icon: <AudioLines />,
		label: "音频生成",
		sourceIndex: 3,
		value: "audio.generate",
	},
];

export const SettingsButton: React.FC<{
	isActive: boolean;
	onClick: () => void;
}> = ({ isActive, onClick }) => (
	<TooltipProvider delayDuration={180}>
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label="设置"
					aria-current={isActive ? "page" : undefined}
					onClick={onClick}
					className={cn(
						"flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
						isActive && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<Settings className="size-4" />
				</button>
			</TooltipTrigger>
			<TooltipContent side="top">设置</TooltipContent>
		</Tooltip>
	</TooltipProvider>
);

export const GitHubHelpButton: React.FC = () => {
	const openGitHub = async () => {
		await openExternalUrl(githubRepositoryURL);
	};

	return (
		<TooltipProvider delayDuration={180}>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label="打开 GitHub 页面"
						className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
						onClick={() => void openGitHub()}
					>
						<CircleQuestionMark className="size-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="top">GitHub</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

export const StudioConversationsScreen: React.FC<{
	activeConversationId: string;
	activeTab: ActiveStudioTab;
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onOpenSettings: () => void;
	onSelectConversation: (kind: StudioTab, conversationId: string) => void;
}> = (props) => <StudioSessionsScreen {...props} />;

export const StudioSessionsScreen: React.FC<{
	activeConversationId: string;
	activeTab: ActiveStudioTab;
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onOpenSettings: () => void;
	onSelectConversation: (kind: StudioTab, conversationId: string) => void;
	scopeId?: string;
}> = ({
	activeConversationId,
	activeTab,
	onOpenGenerationNotification,
	onOpenSettings,
	onSelectConversation,
	scopeId = "studio",
}) => {
	const toast = useToast();
	const [isCreatingConversation, setIsCreatingConversation] = useState(false);

	const openCreateDialog = async () => {
		const result = await openGenerationConversationCreateDialog({
			initialKind: activeTab ?? defaultStudioConversationKind,
			groups: studioConversationGroups,
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
					scopeId,
					title: trimmedTitle,
				});
				await mutateSWR(generationConversationsQueryKey(kind, scopeId));
				onSelectConversation(kind, conversation.id);
			} catch (err) {
				const message = err instanceof Error ? err.message : "创建会话失败。";
				toast.error("创建会话失败", { description: message });
			} finally {
				setIsCreatingConversation(false);
			}
		},
		[isCreatingConversation, onSelectConversation, scopeId, toast],
	);

	return (
		<>
			<div className="flex h-full min-h-0 flex-col">
				<div className="mb-2 px-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-8 w-full justify-start rounded-sm border border-border/70 bg-ide-toolbar/40 px-2 text-sm font-semibold shadow-none hover:border-border hover:bg-ide-list-hover"
						disabled={isCreatingConversation}
						onClick={() => void openCreateDialog()}
					>
						{isCreatingConversation ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<SquarePen className="size-3.5" />
						)}
						<span>新建</span>
					</Button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					<div className="space-y-2">
						{studioConversationGroups.map((group) => (
							<StudioConversationGroup
								key={group.kind}
								activeConversationId={activeConversationId}
								activeTab={activeTab}
								group={group}
								onSelectConversation={onSelectConversation}
								scopeId={scopeId}
							/>
						))}
					</div>
				</div>

				<div className="mt-auto pt-2">
					<div className="flex items-center gap-1">
						<SettingsButton isActive={false} onClick={onOpenSettings} />
						<GitHubHelpButton />
						<AssetLibraryButton />
						<GlobalToolboxButton />
						{onOpenGenerationNotification ? (
							<GenerationNotificationButton onOpenNotification={onOpenGenerationNotification} />
						) : null}
					</div>
				</div>
			</div>
		</>
	);
};

export const StudioTypesScreen: React.FC<{
	activeCapabilityId: string | null;
	activeTab: ActiveStudioTab;
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onOpenSettings: () => void;
	onSelectTab: (tab: StudioTab | null) => void;
}> = ({
	activeCapabilityId,
	activeTab,
	onOpenGenerationNotification,
	onOpenSettings,
	onSelectTab,
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
					<SettingsButton isActive={false} onClick={onOpenSettings} />
					<GitHubHelpButton />
					<AssetLibraryButton />
					<GlobalToolboxButton />
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
	audio: 3,
};

const defaultStudioConversationKind: StudioTab = "video";

const studioConversationGroups: Array<{
	icon: React.ReactNode;
	kind: StudioTab;
	label: string;
}> = [
	{ icon: <Film />, kind: "video", label: "视频生成" },
	{ icon: <ImageIcon />, kind: "image", label: "图片生成" },
	{ icon: <FileText />, kind: "text", label: "文本生成" },
	{ icon: <AudioLines />, kind: "audio", label: "音频生成" },
];

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
	kind === "image" || kind === "video" || kind === "text" || kind === "audio";

const StudioConversationGroup: React.FC<{
	activeConversationId: string;
	activeTab: ActiveStudioTab;
	group: (typeof studioConversationGroups)[number];
	onSelectConversation: (kind: StudioTab, conversationId: string) => void;
	scopeId?: string;
}> = ({ activeConversationId, activeTab, group, onSelectConversation, scopeId = "studio" }) => {
	const toast = useToast();
	const { kind } = group;
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

	const deleteConversation = useCallback(
		async (conversation: GenerationConversation) => {
			try {
				await deleteGenerationConversation(conversation.id);
				await mutateConversations();
				if (kind === activeTab && conversation.id === selectedConversationId) {
					onSelectConversation(kind, "");
				}
				toast.success("会话已删除", { description: conversation.title });
			} catch (err) {
				const message = err instanceof Error ? err.message : "删除失败。";
				toast.error("删除会话失败", { description: message });
			}
		},
		[activeTab, kind, mutateConversations, onSelectConversation, selectedConversationId, toast],
	);

	return (
		<section className="space-y-0.5">
			<div className="flex h-6 items-center gap-1.5 px-1.5 text-xs font-semibold text-muted-foreground">
				<span className="flex size-4 shrink-0 items-center justify-center rounded-sm [&_svg]:size-3.5">
					{group.icon}
				</span>
				<span className="min-w-0 flex-1 truncate">{group.label}</span>
				{!isLoading && !error ? (
					<span className="rounded-sm bg-ide-toolbar px-1.5 py-0.5 text-2xs font-medium tabular-nums text-muted-foreground">
						{conversations.length}
					</span>
				) : null}
			</div>
			{isLoading ? (
				<div className="flex h-7 items-center gap-2 px-2 text-xs text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					<span>加载中</span>
				</div>
			) : error ? (
				<p className="flex h-7 items-center px-2 text-xs text-error-foreground">加载失败</p>
			) : conversations.length ? (
				<div className="space-y-0.5">
					{conversations.map((conversation) => (
						<StudioConversationItem
							key={conversation.id}
							conversation={conversation}
							selected={kind === activeTab && conversation.id === selectedConversationId}
							onDelete={() => void deleteConversation(conversation)}
							onSelect={() => onSelectConversation(kind, conversation.id)}
						/>
					))}
				</div>
			) : (
				<p className="flex h-7 items-center px-2 text-xs text-muted-foreground">暂无会话</p>
			)}
		</section>
	);
};

const StudioConversationItem: React.FC<{
	conversation: GenerationConversation;
	onDelete: () => void;
	onSelect: () => void;
	selected: boolean;
}> = ({ conversation, onDelete, onSelect, selected }) => {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const itemRef = useRef<HTMLDivElement>(null);
	const title = conversation.title || "未命名会话";

	useCloseSidebarItemMenu(itemRef, isMenuOpen, setIsMenuOpen);

	const openDeleteDialog = () => {
		setIsMenuOpen(false);
		void confirmDialog({
			title: "删除会话？",
			description: `确定要删除“${title}”吗？该会话下的生成记录会一并删除，此操作无法撤销。`,
			confirmLabel: "删除",
			onConfirm: onDelete,
		});
	};

	return (
		<div ref={itemRef} className="relative">
			<div
				className={cn(
					"group/session flex h-7 w-full items-center gap-1 rounded-sm border border-transparent text-left transition-colors",
					selected
						? "border-border/80 bg-ide-list-active text-ide-list-active-foreground"
						: "border-transparent text-ide-sidebar-foreground hover:bg-ide-list-hover hover:text-foreground focus-within:bg-ide-list-hover focus-within:text-foreground",
				)}
			>
				<button
					type="button"
					onClick={onSelect}
					className="flex h-full min-w-0 flex-1 items-center px-2 text-left"
				>
					<span className="min-w-0 truncate text-xs font-medium">{title}</span>
				</button>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className={cn(
						"mr-0.5 size-6 shrink-0 text-muted-foreground hover:text-foreground",
						isMenuOpen
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

const settingsNavGroups = (activeAgentBackendId = "codex"): SettingsNavGroup[] => {
	const generationItems: SettingsNavItem[] = [
		{ value: "api-keys", label: "API 密钥", icon: KeyRound },
	];
	if (activeAgentBackendId === "codex") {
		generationItems.push({ value: "codex-relay", label: "Codex 中转", icon: Network });
	}
	generationItems.push(debugNavItem("instructions"), debugNavItem("prompt-packs"));

	return [
		{
			label: "工作区",
			items: [
				{ value: "updates", label: "应用更新", icon: Download },
				{ value: "appearance", label: "基础设置", icon: SlidersHorizontal },
				{ value: "shortcuts", label: "快捷键", icon: Keyboard },
				{ value: "billing", label: "用量与账单", icon: ReceiptText },
			],
		},
		{
			label: "生成配置",
			items: generationItems,
		},
	];
};

export const SettingsSidebarPanel: React.FC<{
	activeAgentBackendId?: string;
	activeTab: SettingsTabValue;
	isProjectSettings: boolean;
	onBack: () => void;
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onSelectTab: (tab: SettingsTabValue) => void;
}> = ({
	activeAgentBackendId,
	activeTab,
	isProjectSettings,
	onBack,
	onOpenGenerationNotification,
	onSelectTab,
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
			<section className="mt-3 space-y-1">
				<p className="px-2 text-2xs font-semibold text-muted-foreground">项目设置</p>
				<SettingsPanelButton
					active={activeTab === projectSettingsGeneralTab}
					icon={<SlidersHorizontal />}
					label="常规"
					onClick={() => onSelectTab(projectSettingsGeneralTab)}
				/>
			</section>
		) : null}

		<div className={cn("space-y-4", isProjectSettings ? "mt-4" : "mt-2")}>
			{settingsNavGroups(activeAgentBackendId).map((group) => (
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
		<div className="mt-auto flex justify-end gap-1 pt-2">
			<AssetLibraryButton />
			<GlobalToolboxButton />
			{onOpenGenerationNotification ? (
				<GenerationNotificationButton onOpenNotification={onOpenGenerationNotification} />
			) : null}
		</div>
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
