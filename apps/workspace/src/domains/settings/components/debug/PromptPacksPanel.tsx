import {
	BookOpenCheck,
	CheckCircle2,
	ChevronDown,
	Download,
	Library,
	Loader2,
	PackageOpen,
	Power,
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
	promptPacksKey,
	resetPromptPack,
	setPromptPackEnabled,
	uninstallPromptPack,
} from "@/domains/settings/api/packs";
import { isPromptPackContentCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
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
	const [busyPackId, setBusyPackId] = useState<string>();
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

	const exportPack = async (pack: PromptPack) => {
		setExportingPackId(pack.id);
		try {
			const exported = await exportPromptPack(pack.id);
			downloadBlob(exported.blob, exported.fileName || `${pack.id}.mgpack`);
			toast.success("提示词包已导出", { description: pack.name });
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
			await refreshPromptData();
			toast.success("提示词包已导入", { description: pack.name });
		} catch (error) {
			toast.error("导入失败", { description: errorMessage(error) });
		} finally {
			setIsImporting(false);
		}
	};

	const togglePack = async (pack: PromptPack) => {
		if (pack.source === "default") return; // default pack is always enabled
		setBusyPackId(pack.id);
		try {
			const updated = await setPromptPackEnabled(pack.id, !pack.enabled);
			await refreshPromptData();
			toast.success(updated.enabled ? "已启用提示词包" : "已停用提示词包", {
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
							accept=".mgpack,.mgpackpro"
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
							>
								<div className="max-h-[22rem] overflow-y-auto p-3">
									<div className="mb-2 flex items-center gap-2">
										<span className="text-xs font-medium text-foreground">提示词包</span>
									</div>
									<div className="space-y-2">
										{isLoading && packs.length === 0 ? (
											<span className="flex items-center gap-2 text-xs text-muted-foreground">
												<Loader2 className="size-4 animate-spin" />
												加载提示词包
											</span>
										) : packs.length === 0 ? (
											<span className="text-xs text-muted-foreground">暂无提示词包。</span>
										) : (
											packs.map((pack) => (
												<PromptPackPill
													key={pack.id}
													busy={busyPackId === pack.id}
													exporting={exportingPackId === pack.id}
													pack={pack}
													resetting={resettingPackId === pack.id}
													onExport={() => void exportPack(pack)}
													onRemove={() => confirmRemovePack(pack)}
													onReset={() => confirmResetPack(pack)}
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
	exporting: boolean;
	onExport: () => void;
	onRemove: () => void;
	onReset: () => void;
	onToggle: () => void;
	pack: PromptPack;
	resetting: boolean;
}> = ({ busy, exporting, onExport, onRemove, onReset, onToggle, pack, resetting }) => {
	const isDefault = pack.source === "default";
	const enabled = pack.enabled;
	return (
		<div
			className={cn(
				"grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border bg-ide-toolbar px-2 py-1.5",
				!enabled && "opacity-70",
			)}
		>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="max-w-44 truncate text-xs font-medium text-foreground">{pack.name}</span>
					<Badge variant={enabled ? "secondary" : "outline"} className="shrink-0">
						{enabled ? "已启用" : "已停用"}
					</Badge>
					<Badge variant="outline" className="shrink-0">
						{sourceLabel(pack.source)}
					</Badge>
				</div>
				<p className="mt-0.5 truncate text-2xs text-muted-foreground">
					{pack.id} · v{pack.version}
				</p>
			</div>
			<TooltipProvider delayDuration={180}>
				<div className="flex shrink-0 items-center gap-1 rounded-md bg-background/50 p-0.5">
					<PromptPackActionButton
						ariaLabel="恢复提示词包默认"
						disabled={busy || resetting}
						onClick={onReset}
						tooltip={resetting ? "恢复中" : "恢复默认"}
					>
						{resetting ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<RotateCcw className="size-4" />
						)}
					</PromptPackActionButton>
					<PromptPackActionButton
						ariaLabel={enabled ? "停用提示词包" : "启用提示词包"}
						disabled={busy || resetting || isDefault}
						onClick={onToggle}
						tooltip={isDefault ? "默认包始终启用" : enabled ? "停用" : "启用"}
					>
						{busy ? (
							<Loader2 className="size-4 animate-spin" />
						) : enabled ? (
							<CheckCircle2 className="size-4" />
						) : (
							<Power className="size-4" />
						)}
					</PromptPackActionButton>
					{pack.source !== "pro" ? (
						<PromptPackActionButton
							ariaLabel="导出提示词包"
							disabled={exporting || resetting}
							onClick={onExport}
							tooltip={exporting ? "导出中" : "导出"}
						>
							{exporting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Download className="size-4" />
							)}
						</PromptPackActionButton>
					) : null}
					{pack.source === "imported" || pack.source === "pro" ? (
						<PromptPackActionButton
							ariaLabel="卸载提示词包"
							className="hover:bg-error-surface hover:text-error-foreground"
							disabled={busy || resetting}
							onClick={onRemove}
							tooltip="卸载"
						>
							<Trash2 className="size-4" />
						</PromptPackActionButton>
					) : null}
				</div>
			</TooltipProvider>
		</div>
	);
};

const PromptPackActionButton: React.FC<{
	ariaLabel: string;
	children: React.ReactNode;
	className?: string;
	disabled?: boolean;
	onClick: () => void;
	tooltip: string;
}> = ({ ariaLabel, children, className, disabled, onClick, tooltip }) => (
	<Tooltip>
		<TooltipTrigger asChild>
			<Button
				type="button"
				size="icon"
				variant="ghost"
				className={cn("size-7 rounded-md text-muted-foreground hover:text-foreground", className)}
				onClick={onClick}
				disabled={disabled}
				aria-label={ariaLabel}
				title={tooltip}
			>
				{children}
			</Button>
		</TooltipTrigger>
		<TooltipContent side="top">{tooltip}</TooltipContent>
	</Tooltip>
);

const sourceLabel = (source: PromptPack["source"]) => {
	switch (source) {
		case "default":
			return "默认包";
		case "imported":
			return "已导入";
		case "pro":
			return "Pro 已授权";
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
