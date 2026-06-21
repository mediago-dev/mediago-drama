import { MessageSquareText, RotateCcw, Save } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	type PromptTemplate,
	listPromptTemplates,
	promptTemplatesKey,
	resetPromptTemplate,
	updatePromptTemplate,
} from "@/domains/settings/api/prompt-templates";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";
import { SettingsMarkdownEditor } from "./SettingsMarkdownEditor";

export const PromptTemplateEditorPanel: React.FC = () => {
	const toast = useToast();
	const {
		data: templates = [],
		isLoading,
		mutate,
	} = useSWR(promptTemplatesKey, listPromptTemplates);
	const templateList = useMemo(() => templates, [templates]);
	const [selectedId, setSelectedId] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const selectedTemplate = useMemo(
		() =>
			cloneTemplate(templateList.find((template) => template.id === selectedId) ?? templateList[0]),
		[selectedId, templateList],
	);
	const [draft, setDraft] = useState<PromptTemplate | null>(selectedTemplate);
	const [isResetting, setIsResetting] = useState(false);

	useEffect(() => {
		if (!templateList.length) return;
		if (!selectedId || !templateList.some((template) => template.id === selectedId)) {
			setSelectedId(templateList[0].id);
		}
	}, [selectedId, templateList]);

	useEffect(() => {
		setDraft(selectedTemplate);
	}, [selectedTemplate]);

	const save = async () => {
		if (!draft) return;
		const nextTemplate = sanitizeTemplate(draft);
		setIsSaving(true);
		try {
			const savedTemplate = await updatePromptTemplate(nextTemplate.id, nextTemplate);
			await mutate(
				templateList.map((template) =>
					template.id === savedTemplate.id ? savedTemplate : template,
				),
				false,
			);
			setDraft(cloneTemplate(savedTemplate));
			toast.success("系统指令已保存");
		} catch (error) {
			toast.error("系统指令保存失败", { description: errorMessage(error) });
		} finally {
			setIsSaving(false);
		}
	};

	const reset = async () => {
		if (!selectedTemplate?.overridden) return;
		setIsResetting(true);
		try {
			const resetTemplate = await resetPromptTemplate(selectedTemplate.id);
			await mutate(
				templateList.map((template) =>
					template.id === resetTemplate.id ? resetTemplate : template,
				),
				false,
			);
			setDraft(cloneTemplate(resetTemplate));
			toast.success("系统指令已恢复默认");
		} catch (error) {
			toast.error("恢复默认失败", { description: errorMessage(error) });
		} finally {
			setIsResetting(false);
		}
	};

	return (
		<SettingsPanelLayout
			title="系统指令"
			icon={<MessageSquareText className="size-4" />}
			actions={
				draft ? (
					<>
						{selectedTemplate?.overridden ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => void reset()}
								disabled={isResetting}
							>
								<RotateCcw className="size-4" />
								<span>{isResetting ? "恢复中" : "恢复默认"}</span>
							</Button>
						) : null}
						<Button type="button" onClick={() => void save()} disabled={isSaving}>
							<Save className="size-4" />
							<span>{isSaving ? "保存中" : "保存"}</span>
						</Button>
					</>
				) : null
			}
		>
			<div className="space-y-3">
				{isLoading && templateList.length === 0 ? (
					<p className={templateMessageClassName}>正在加载系统指令。</p>
				) : !draft ? (
					<p className={templateMessageClassName}>没有可编辑的系统指令。</p>
				) : (
					<>
						<div className={settingsFormRowClassName}>
							<div className="min-w-0">
								<Label
									htmlFor="prompt-template-select"
									className="text-sm font-medium text-foreground"
								>
									当前指令
								</Label>
								<p className="mt-1 text-xs text-muted-foreground">选择要编辑的系统指令片段。</p>
							</div>
							<Select value={selectedId} onValueChange={setSelectedId}>
								<SelectTrigger id="prompt-template-select" className="rounded-md text-foreground">
									<SelectValue placeholder="选择提示词" />
								</SelectTrigger>
								<SelectContent align="start">
									{templateList.map((template) => (
										<SelectItem key={template.id} value={template.id}>
											<span className="flex min-w-0 w-full items-center gap-2">
												<span className="min-w-0 flex-1 truncate">{template.name}</span>
												<EntrySourceBadge
													source={template.source}
													overridden={template.overridden}
												/>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className={settingsFormRowClassName}>
							<Label className="text-sm font-medium text-foreground">来源</Label>
							<div>
								<EntrySourceBadge source={draft.source} overridden={draft.overridden} />
							</div>
						</div>

						{draft.description ? (
							<div className={settingsFormRowClassName}>
								<Label className="text-sm font-medium text-foreground">说明</Label>
								<p className="text-sm leading-6 text-muted-foreground">{draft.description}</p>
							</div>
						) : null}

						<div className={promptBodyRowClassName}>
							<div className="flex items-center justify-between gap-2">
								<Label
									id="prompt-template-content-label"
									className="text-sm font-medium text-foreground"
								>
									提示词内容
								</Label>
								<span className="flex items-center gap-1 text-xs text-muted-foreground">
									<MessageSquareText className="size-3.5" />
									{countLines(draft.content)} 行
								</span>
							</div>
							<SettingsMarkdownEditor
								ariaLabelledBy="prompt-template-content-label"
								placeholder="编写系统指令..."
								value={draft.content}
								onChange={(content) => setDraft({ ...draft, content })}
							/>
						</div>
					</>
				)}
			</div>
		</SettingsPanelLayout>
	);
};

const settingsFormRowClassName = cn(
	"py-2",
	"grid gap-3 md:grid-cols-[minmax(var(--settings-label-column-min),var(--settings-label-column-max))_minmax(0,1fr)] md:items-start",
);

const promptBodyRowClassName = "grid gap-2 py-2";

const templateMessageClassName = "py-2 text-sm text-muted-foreground";

const EntrySourceBadge: React.FC<Pick<PromptTemplate, "source" | "overridden">> = ({
	overridden,
	source,
}) => (
	<Badge variant={overridden || source === "pack" ? "secondary" : "outline"} className="rounded-md">
		{entrySourceLabel(source, overridden)}
	</Badge>
);

const entrySourceLabel = (source: PromptTemplate["source"], overridden?: boolean) => {
	if (overridden) return "已覆盖";
	if (source === "pack") return "来自包";
	return "用户新增";
};

const sanitizeTemplate = (template: PromptTemplate): PromptTemplate => ({
	...template,
	content: template.content.replace(/\r\n/g, "\n").trim(),
});

const cloneTemplate = (template: PromptTemplate | undefined): PromptTemplate | null => {
	if (!template) return null;
	return { ...template };
};

const countLines = (content: string) => {
	const normalized = content.replace(/\r\n/g, "\n").trim();
	if (!normalized) return 0;
	return normalized.split("\n").length;
};

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请检查后端服务是否可写提示词模板文件。";
};
