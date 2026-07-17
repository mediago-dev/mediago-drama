import { BookOpenCheck, Library, Loader2, PackageOpen, Settings2, Upload } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
	importPromptPackFile,
	listPromptPacks,
	promptPacksKey,
} from "@/domains/settings/api/packs";
import { isPromptPackContentCacheKey } from "@/domains/settings/lib/prompt-pack-cache";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { openPromptPackEditor } from "@/shared/desktop/actions";
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
	const { mutate: mutatePacks } = useSWR(promptPacksKey, listPromptPacks);
	const [activeSection, setActiveSection] = useState<PromptPackSection>("skills");
	const [isImporting, setIsImporting] = useState(false);
	const importInputRef = useRef<HTMLInputElement | null>(null);
	const startWindowDrag = useDesktopWindowDrag();

	const importPackFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = "";
		if (!file) return;
		setIsImporting(true);
		try {
			const pack = await importPromptPackFile(file);
			await mutatePacks();
			void mutate(isPromptPackContentCacheKey);
			toast.success("技能包已导入", { description: pack.name });
		} catch (error) {
			toast.error("导入失败", { description: errorMessage(error) });
		} finally {
			setIsImporting(false);
		}
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
							<h2 className="truncate text-sm font-semibold text-foreground">技能包</h2>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							浏览全局共享的技能和提示词；具体变更请在技能包管理窗口中完成。
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2" data-desktop-no-drag>
						<input
							ref={importInputRef}
							type="file"
							accept=".mgpack"
							className="sr-only"
							aria-label="导入技能包文件"
							onChange={(event) => void importPackFile(event)}
						/>
						<Button
							type="button"
							variant="outline"
							onClick={() => importInputRef.current?.click()}
							disabled={isImporting}
						>
							{isImporting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Upload className="size-4" />
							)}
							<span>{isImporting ? "导入中" : "导入"}</span>
						</Button>
						<Button type="button" variant="outline" onClick={() => void openPromptPackEditor()}>
							<Settings2 className="size-4" />
							<span>技能包管理</span>
						</Button>
					</div>
				</div>
			</header>

			<Tabs
				value={activeSection}
				onValueChange={(value) => setActiveSection(value as PromptPackSection)}
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
			>
				<div className="flex shrink-0 items-center border-b border-border px-5 py-2">
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
				</div>
				<TabsContent value="skills" className="mt-0 min-h-0 flex-1 overflow-hidden">
					<SkillsEditorPanel showActions={false} />
				</TabsContent>
				<TabsContent value="library" className="mt-0 min-h-0 flex-1 overflow-hidden">
					<PromptLibraryEditorPanel showActions={false} />
				</TabsContent>
			</Tabs>
		</section>
	);
};

const errorMessage = (error: unknown) =>
	error instanceof Error && error.message.trim() ? error.message : "请稍后重试。";
