import {
	BookOpenCheck,
	ChevronDown,
	FolderOpen,
	Library,
	Loader2,
	PackageOpen,
	Power,
	Save,
	Settings2,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	type PromptPack,
	installPromptPack,
	listPromptPacks,
	promptPacksKey,
	setPromptPackEnabled,
	uninstallPromptPack,
} from "@/domains/settings/api/packs";
import { skillsKey } from "@/domains/settings/api/skills";
import { promptCategoriesKey } from "@/domains/generation/api/prompt-categories";
import { promptPresetsKey } from "@/domains/generation/api/prompt-presets";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { useTauriWindowDrag } from "@/domains/workspace/lib/tauri-window-drag";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";
import { PromptPackActionsSlotProvider } from "./PromptPackActionsSlot";
import { PromptLibraryEditorPanel } from "./PromptLibraryEditorPanel";
import { SkillsEditorPanel } from "./SkillsEditorPanel";

type PromptPackSection = "skills" | "library";

const promptPackSections: Array<{
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: PromptPackSection;
}> = [
	{ value: "skills", label: "技能", icon: BookOpenCheck },
	{ value: "library", label: "提示词库", icon: Library },
];

export const PromptPacksPanel: React.FC = () => {
	const toast = useToast();
	const { mutate } = useSWRConfig();
	const {
		data: packs = [],
		isLoading,
		mutate: mutatePacks,
	} = useSWR(promptPacksKey, listPromptPacks);
	const [activeSection, setActiveSection] = useState<PromptPackSection>("skills");
	const [installPath, setInstallPath] = useState("");
	const [busyPackId, setBusyPackId] = useState<string>();
	const [isInstalling, setIsInstalling] = useState(false);
	const [manageOpen, setManageOpen] = useState(false);
	const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
	const startWindowDrag = useTauriWindowDrag();

	const refreshPromptData = async () => {
		await Promise.all([
			mutatePacks(),
			mutate(skillsKey),
			mutate(
				(key) =>
					typeof key === "string" &&
					(key.startsWith(promptPresetsKey) || key === promptCategoriesKey),
			),
		]);
	};

	const choosePackFile = async () => {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				multiple: false,
				directory: false,
				filters: [{ name: "Prompt Pack", extensions: ["mgpack"] }],
			});
			if (typeof selected === "string") setInstallPath(selected);
		} catch (error) {
			toast.error("无法打开文件选择器", { description: errorMessage(error) });
		}
	};

	const install = async () => {
		const path = installPath.trim();
		if (!path) return;
		setIsInstalling(true);
		try {
			const pack = await installPromptPack(path);
			await refreshPromptData();
			setInstallPath("");
			toast.success("提示词包已安装", { description: pack.name });
		} catch (error) {
			toast.error("安装失败", { description: errorMessage(error) });
		} finally {
			setIsInstalling(false);
		}
	};

	const togglePack = async (pack: PromptPack) => {
		setBusyPackId(pack.id);
		try {
			const updated = await setPromptPackEnabled(pack.id, !pack.enabled);
			await refreshPromptData();
			toast.success(updated.enabled ? "提示词包已启用" : "提示词包已停用", {
				description: updated.name,
			});
		} catch (error) {
			toast.error("更新失败", { description: errorMessage(error) });
		} finally {
			setBusyPackId(undefined);
		}
	};

	const removePack = async (pack: PromptPack) => {
		setBusyPackId(pack.id);
		try {
			await uninstallPromptPack(pack.id);
			await refreshPromptData();
			toast.success("提示词包已卸载", { description: pack.name });
			return true;
		} catch (error) {
			toast.error("卸载失败", { description: errorMessage(error) });
			return false;
		} finally {
			setBusyPackId(undefined);
		}
	};

	const confirmRemovePack = (pack: PromptPack) => {
		void confirmDialog({
			title: "卸载提示词包？",
			description: `确定要卸载“${pack.name}”吗？来自该包的技能和提示词预设将不可用。`,
			confirmLabel: "卸载",
			confirmIcon: <Trash2 className="size-4" />,
			onConfirm: () => removePack(pack),
		});
	};

	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<header
				className="shrink-0 border-b border-border bg-ide-editor px-5 py-4"
				data-tauri-drag-region
				onPointerDown={startWindowDrag}
			>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 flex-1" data-tauri-drag-region>
						<div className="flex items-center gap-2">
							<PackageOpen className="size-4 text-muted-foreground" />
							<h2 className="truncate text-sm font-semibold text-foreground">提示词包</h2>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							安装并管理全局共享的技能和提示词预设。
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2" data-tauri-no-drag>
						<Popover open={manageOpen} onOpenChange={setManageOpen}>
							<PopoverTrigger asChild>
								<Button type="button" variant="outline">
									<Settings2 className="size-4" />
									<span>管理</span>
									<ChevronDown className="size-3.5" />
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="end"
								className="w-[min(32rem,calc(100vw-2rem))] overflow-hidden p-0"
							>
								<div className="border-b border-border p-3">
									<div className="flex flex-wrap items-center gap-2">
										<Input
											value={installPath}
											onChange={(event) => setInstallPath(event.target.value)}
											placeholder="/path/to/pack.mgpack"
											className="h-8 min-w-52 flex-1"
										/>
										<Button type="button" variant="outline" onClick={() => void choosePackFile()}>
											<FolderOpen className="size-4" />
											<span>选择</span>
										</Button>
										<Button
											type="button"
											onClick={() => void install()}
											disabled={!installPath.trim() || isInstalling}
										>
											{isInstalling ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<Save className="size-4" />
											)}
											<span>{isInstalling ? "安装中" : "安装"}</span>
										</Button>
									</div>
								</div>

								<div className="max-h-[22rem] overflow-y-auto p-3">
									<div className="mb-2 flex items-center justify-between gap-2">
										<span className="text-xs font-medium text-foreground">已安装包</span>
										<Badge variant="outline" className="rounded-md">
											{packs.length}
										</Badge>
									</div>
									<div className="space-y-2">
										{isLoading && packs.length === 0 ? (
											<span className="flex items-center gap-2 text-xs text-muted-foreground">
												<Loader2 className="size-4 animate-spin" />
												加载提示词包
											</span>
										) : packs.length === 0 ? (
											<span className="text-xs text-muted-foreground">没有已安装的提示词包。</span>
										) : (
											packs.map((pack) => (
												<PromptPackPill
													key={pack.id}
													busy={busyPackId === pack.id}
													pack={pack}
													onRemove={() => confirmRemovePack(pack)}
													onToggle={() => void togglePack(pack)}
												/>
											))
										)}
									</div>
								</div>
							</PopoverContent>
						</Popover>
					</div>
				</div>
			</header>

			<Tabs
				value={activeSection}
				onValueChange={(value) => setActiveSection(value as PromptPackSection)}
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
			>
				<PromptPackActionsSlotProvider slotEl={actionsSlot}>
					<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2">
						<TabsList className="grid w-full max-w-sm grid-cols-2 sm:w-64">
							{promptPackSections.map((section) => {
								const Icon = section.icon;
								return (
									<TabsTrigger key={section.value} value={section.value}>
										<Icon className="size-3.5" />
										<span>{section.label}</span>
									</TabsTrigger>
								);
							})}
						</TabsList>
						<div
							ref={setActionsSlot}
							className="flex min-h-8 shrink-0 flex-wrap items-center justify-end gap-2"
						/>
					</div>
					<TabsContent value="skills" className="mt-0 min-h-0 flex-1 overflow-hidden">
						<SkillsEditorPanel />
					</TabsContent>
					<TabsContent value="library" className="mt-0 min-h-0 flex-1 overflow-hidden">
						<PromptLibraryEditorPanel />
					</TabsContent>
				</PromptPackActionsSlotProvider>
			</Tabs>
		</section>
	);
};

const PromptPackPill: React.FC<{
	busy: boolean;
	onRemove: () => void;
	onToggle: () => void;
	pack: PromptPack;
}> = ({ busy, onRemove, onToggle, pack }) => (
	<div
		className={cn(
			"flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-ide-toolbar px-2 py-1.5",
			!pack.enabled && "opacity-70",
		)}
	>
		<div className="min-w-0">
			<div className="flex min-w-0 items-center gap-1.5">
				<span className="max-w-44 truncate text-xs font-medium text-foreground">{pack.name}</span>
				<Badge variant={pack.enabled ? "secondary" : "outline"} className="shrink-0">
					{pack.enabled ? "启用" : "停用"}
				</Badge>
				<Badge variant="outline" className="shrink-0">
					{sourceLabel(pack.source)}
				</Badge>
			</div>
			<p className="mt-0.5 truncate text-2xs text-muted-foreground">
				{pack.id} · v{pack.version}
			</p>
		</div>
		<Button
			type="button"
			size="icon"
			variant="ghost"
			onClick={onToggle}
			disabled={busy}
			aria-label={pack.enabled ? "停用提示词包" : "启用提示词包"}
		>
			{busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
		</Button>
		{pack.source === "imported" ? (
			<Button
				type="button"
				size="icon"
				variant="ghost"
				onClick={onRemove}
				disabled={busy}
				aria-label="卸载提示词包"
			>
				<Trash2 className="size-4" />
			</Button>
		) : null}
	</div>
);

const sourceLabel = (source: PromptPack["source"]) => {
	switch (source) {
		case "default":
			return "默认包";
		case "imported":
			return "已安装";
	}
};

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请稍后重试。";
};
