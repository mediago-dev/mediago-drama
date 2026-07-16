import {
	BookOpenCheck,
	ChevronDown,
	Download,
	Ellipsis,
	Library,
	Loader2,
	PackageOpen,
	PackagePlus,
	Pencil,
	RotateCcw,
	Settings2,
	Trash2,
	Upload,
} from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	type PromptPack,
	exportPromptPack,
	importPromptPackFile,
	listPromptPacks,
	promptPackExportFileName,
	promptPacksKey,
	resetPromptPack,
	setPromptPackEnabled,
	uninstallPromptPack,
} from "@/domains/settings/api/packs";
import { isPromptPackContentCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Switch } from "@/shared/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";
import { openPromptPackEditor } from "@/shared/desktop/actions";
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
	const [busyPackId, setBusyPackId] = useState<string>();
	const [togglingPackId, setTogglingPackId] = useState<string>();
	const [exportingPackId, setExportingPackId] = useState<string>();
	const [resettingPackId, setResettingPackId] = useState<string>();
	const [isImporting, setIsImporting] = useState(false);
	const [manageOpen, setManageOpen] = useState(false);
	const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
	const importInputRef = useRef<HTMLInputElement | null>(null);
	const startWindowDrag = useDesktopWindowDrag();

	const refreshPromptData = async () => {
		await Promise.all([mutatePacks(), mutate(isPromptPackContentCacheKey)]);
	};

	const refreshPromptDataInBackground = () => {
		void Promise.allSettled([mutatePacks(), mutate(isPromptPackContentCacheKey)]);
	};

	const exportPack = async (pack: PromptPack) => {
		setExportingPackId(pack.id);
		try {
			const exported = await exportPromptPack(pack.id);
			downloadBlob(exported.blob, exported.fileName || promptPackExportFileName(pack));
			toast.success("提示词包已导出", {
				description: "如需发布，请前往 MediaGo 官网上传并设置分发方式。",
			});
		} catch (error) {
			toast.error("导出失败", { description: errorMessage(error) });
		} finally {
			setExportingPackId(undefined);
		}
	};

	const chooseImportFile = () => {
		importInputRef.current?.click();
	};

	const importPackFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = "";
		if (!file) return;
		setIsImporting(true);
		try {
			const pack = await importPromptPackFile(file);
			await mutatePacks(
				(current) => {
					if (!current) return [pack];
					const existingIndex = current.findIndex((candidate) => candidate.id === pack.id);
					if (existingIndex < 0) return [...current, pack];
					return current.map((candidate, index) => (index === existingIndex ? pack : candidate));
				},
				{ revalidate: false },
			);
			toast.success("提示词包已导入", { description: pack.name });
			refreshPromptDataInBackground();
		} catch (error) {
			toast.error("导入失败", { description: errorMessage(error) });
		} finally {
			setIsImporting(false);
		}
	};

	const removePack = async (pack: PromptPack) => {
		setBusyPackId(pack.id);
		try {
			await uninstallPromptPack(pack.id);
			await mutatePacks((current) => current?.filter((candidate) => candidate.id !== pack.id), {
				revalidate: false,
			});
			await Promise.allSettled([mutatePacks(), mutate(isPromptPackContentCacheKey)]);
			toast.success("提示词包已卸载", { description: pack.name });
			return true;
		} catch (error) {
			toast.error("卸载失败", { description: errorMessage(error) });
			return false;
		} finally {
			setBusyPackId(undefined);
		}
	};

	const togglePack = async (pack: PromptPack, enabled: boolean) => {
		setTogglingPackId(pack.id);
		try {
			await mutatePacks(
				(current) =>
					current?.map((candidate) =>
						candidate.id === pack.id ? { ...candidate, enabled } : candidate,
					),
				{ revalidate: false },
			);
			await setPromptPackEnabled(pack.id, enabled);
			await Promise.all([mutatePacks(), mutate(isPromptPackContentCacheKey)]);
			toast.success(enabled ? "提示词包已启用" : "提示词包已停用", {
				description: pack.name,
			});
		} catch (error) {
			await mutatePacks();
			toast.error("更新失败", { description: errorMessage(error) });
		} finally {
			setTogglingPackId(undefined);
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

	const resetPackDefaults = async (pack: PromptPack) => {
		setResettingPackId(pack.id);
		try {
			const reset = await resetPromptPack(pack.id);
			await refreshPromptData();
			toast.success("已恢复默认", { description: reset.name });
			return true;
		} catch (error) {
			toast.error("恢复失败", { description: errorMessage(error) });
			return false;
		} finally {
			setResettingPackId(undefined);
		}
	};

	const confirmResetPack = (pack: PromptPack) => {
		void confirmDialog({
			title: "恢复提示词包默认？",
			description: `将恢复“${pack.name}”内的默认技能和提示词预设，用户新增内容会保留。`,
			confirmLabel: "恢复默认",
			confirmIcon: <RotateCcw className="size-4" />,
			variant: "default",
			onConfirm: () => resetPackDefaults(pack),
		});
	};

	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<header
				className="shrink-0 border-b border-border bg-ide-editor px-5 py-4"
				data-desktop-drag-region
				onPointerDown={startWindowDrag}
			>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 flex-1" data-desktop-drag-region>
						<div className="flex items-center gap-2">
							<PackageOpen className="size-4 text-muted-foreground" />
							<h2 className="truncate text-sm font-semibold text-foreground">提示词包</h2>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							导入并管理全局共享的技能和提示词预设。
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2" data-desktop-no-drag>
						<input
							ref={importInputRef}
							type="file"
							accept=".mgpack"
							className="sr-only"
							aria-label="导入提示词包文件"
							onChange={(event) => void importPackFile(event)}
						/>
						<Button
							type="button"
							variant="outline"
							onClick={chooseImportFile}
							disabled={isImporting}
						>
							{isImporting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Upload className="size-4" />
							)}
							<span>{isImporting ? "导入中" : "导入"}</span>
						</Button>
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
								className="w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-0"
								onInteractOutside={(event) => {
									const target = event.target;
									if (
										target instanceof Element &&
										target.closest("[data-prompt-pack-action-menu]")
									) {
										event.preventDefault();
									}
								}}
							>
								<div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
									<div className="text-xs font-medium text-foreground">提示词包</div>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
										onClick={() => {
											setManageOpen(false);
											void openPromptPackEditor({ mode: "create" });
										}}
									>
										<PackagePlus className="size-3.5" />
										<span>制作</span>
									</Button>
								</div>
								<div className="max-h-[22rem] overflow-y-auto px-3">
									<div className="divide-y divide-border">
										{isLoading && packs.length === 0 ? (
											<span className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
												<Loader2 className="size-4 animate-spin" />
												加载提示词包
											</span>
										) : packs.length === 0 ? (
											<span className="block py-3 text-xs text-muted-foreground">
												暂无提示词包。
											</span>
										) : (
											packs.map((pack) => (
												<PromptPackPill
													key={pack.id}
													busy={busyPackId === pack.id}
													exporting={exportingPackId === pack.id}
													pack={pack}
													resetting={resettingPackId === pack.id}
													toggling={togglingPackId === pack.id}
													onEdit={() => {
														setManageOpen(false);
														void openPromptPackEditor({ packId: pack.id });
													}}
													onExport={() => void exportPack(pack)}
													onRemove={() => confirmRemovePack(pack)}
													onReset={() => confirmResetPack(pack)}
													onToggle={(enabled) => void togglePack(pack, enabled)}
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
						<TabsList className="grid w-full max-w-sm grid-cols-2 sm:w-80">
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
	exporting: boolean;
	onEdit: () => void;
	onExport: () => void;
	onRemove: () => void;
	onReset: () => void;
	onToggle: (enabled: boolean) => void;
	pack: PromptPack;
	resetting: boolean;
	toggling: boolean;
}> = ({
	busy,
	exporting,
	onEdit,
	onExport,
	onRemove,
	onReset,
	onToggle,
	pack,
	resetting,
	toggling,
}) => {
	const isLocal = pack.source === "local";
	const isDefault = pack.source === "default";
	const canUninstall = pack.source === "imported" || isLocal;
	const enabled = pack.enabled;
	return (
		<div
			className={cn(
				"flex w-full min-w-0 items-center justify-between gap-3 py-2",
				!enabled && "opacity-70",
			)}
		>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="max-w-52 truncate text-xs font-medium text-foreground">{pack.name}</span>
					<Badge variant="outline" className="shrink-0">
						{sourceLabel(pack.source)}
					</Badge>
				</div>
				<p className="mt-0.5 truncate text-2xs text-muted-foreground">
					{pack.id} · v{pack.version}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<Switch
					checked={enabled}
					disabled={isDefault || toggling || busy}
					onCheckedChange={isDefault ? undefined : onToggle}
					className={cn(
						isDefault &&
							"data-[state=checked]:bg-muted-foreground/40 disabled:cursor-not-allowed disabled:opacity-70",
					)}
					aria-label={
						isDefault
							? `默认提示词包不可停用 ${pack.name}`
							: `${enabled ? "停用" : "启用"}提示词包 ${pack.name}`
					}
					title={isDefault ? "默认包始终启用" : toggling ? "更新中" : enabled ? "停用" : "启用"}
				/>
				<DropdownMenu modal={false}>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							size="icon"
							variant="ghost"
							className="size-7 text-muted-foreground hover:text-foreground"
							disabled={busy}
							aria-label={`更多操作 ${pack.name}`}
						>
							<Ellipsis className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" data-prompt-pack-action-menu>
						{isLocal ? (
							<DropdownMenuItem disabled={busy} onSelect={onEdit}>
								<Pencil className="size-4" />
								编辑
							</DropdownMenuItem>
						) : null}
						{!isLocal ? (
							<DropdownMenuItem disabled={busy || resetting} onSelect={onReset}>
								{resetting ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<RotateCcw className="size-4" />
								)}
								{resetting ? "恢复中" : "恢复默认"}
							</DropdownMenuItem>
						) : null}
						<DropdownMenuItem disabled={busy || exporting || resetting} onSelect={onExport}>
							{exporting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Download className="size-4" />
							)}
							{exporting ? "导出中" : "导出"}
						</DropdownMenuItem>
						{canUninstall ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive focus:bg-error-surface focus:text-error-foreground"
									disabled={busy || exporting || resetting}
									onSelect={onRemove}
								>
									<Trash2 className="size-4" />
									卸载
								</DropdownMenuItem>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
};

const sourceLabel = (source: PromptPack["source"]) => {
	switch (source) {
		case "default":
			return "默认包";
		case "imported":
			return "已导入";
		case "local":
			return "本地创作";
	}
};

const downloadBlob = (blob: Blob, fileName: string) => {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
};

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请稍后重试。";
};
