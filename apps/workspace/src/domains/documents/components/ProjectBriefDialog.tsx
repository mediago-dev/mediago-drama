import { Loader2, Save, X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import {
	getProjectBrief,
	type ProjectBrief,
	projectBriefKey,
	updateProjectBrief,
} from "@/domains/projects/api/projects";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { useToast } from "@/hooks/useToast";

interface ProjectBriefDialogProps {
	onOpenChange: (open: boolean) => void;
	onSaved?: (brief: ProjectBrief) => Promise<void> | void;
	open: boolean;
	projectId: string;
}

type ProjectBriefDraft = Omit<ProjectBrief, "updatedAt">;

const emptyDraft: ProjectBriefDraft = {
	medium: "",
	genre: "",
	pacing: "",
	audience: "",
	tone: "",
	style: "",
	references: "",
	notes: "",
};

export const ProjectBriefDialog: React.FC<ProjectBriefDialogProps> = ({
	onOpenChange,
	onSaved,
	open,
	projectId,
}) => {
	const toast = useToast();
	const [draft, setDraft] = useState<ProjectBriefDraft>(emptyDraft);
	const [isSaving, setIsSaving] = useState(false);
	const {
		data: brief,
		isLoading,
		mutate,
	} = useSWR(open && projectId ? projectBriefKey(projectId) : null, () =>
		getProjectBrief(projectId),
	);

	useEffect(() => {
		if (!open) return;
		setDraft(brief ? draftFromBrief(brief) : emptyDraft);
	}, [brief, open, projectId]);

	useEffect(() => {
		if (!open) return;

		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onOpenChange(false);
		};

		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [onOpenChange, open]);

	if (!open) return null;

	const updateField = (field: keyof ProjectBriefDraft, value: string) => {
		setDraft((current) => ({ ...current, [field]: value }));
	};

	const saveBrief = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!projectId || isSaving) return;

		setIsSaving(true);
		try {
			const saved = await updateProjectBrief(projectId, trimDraft(draft));
			await mutate(saved, false);
			try {
				await onSaved?.(saved);
			} catch {
				toast.warning("项目设定已保存，概览同步稍后刷新");
			}
			toast.success("项目设定已保存");
			onOpenChange(false);
		} catch (err) {
			const message = err instanceof Error ? err.message : "项目设定保存失败。";
			toast.error(message);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div
			data-state="open"
			className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onOpenChange(false);
			}}
		>
			<form
				data-state="open"
				aria-labelledby="project-brief-dialog-title"
				className="flex max-h-[min(42rem,calc(100vh_-_2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-sm border border-border bg-background text-foreground shadow-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200"
				onSubmit={saveBrief}
				role="dialog"
				aria-modal="true"
			>
				<header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
					<h2 id="project-brief-dialog-title" className="truncate text-sm font-semibold">
						Project Brief
					</h2>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="关闭"
						onClick={() => onOpenChange(false)}
					>
						<X />
					</Button>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
					{isLoading ? (
						<div className="grid min-h-32 place-items-center text-sm text-muted-foreground">
							<div className="flex items-center gap-2">
								<Loader2 className="size-4 animate-spin" />
								<span>正在加载 Project Brief</span>
							</div>
						</div>
					) : (
						<div className="grid gap-4 md:grid-cols-2">
							<BriefInput
								id="project-brief-genre"
								label="定位"
								value={draft.genre}
								placeholder="例如 都市奇幻短剧"
								onChange={(value) => updateField("genre", value)}
							/>
							<BriefInput
								id="project-brief-medium"
								label="媒介"
								value={draft.medium}
								placeholder="例如 竖屏短视频"
								onChange={(value) => updateField("medium", value)}
							/>
							<BriefInput
								id="project-brief-pacing"
								label="节奏"
								value={draft.pacing}
								placeholder="例如 每集 60 秒，强钩子"
								onChange={(value) => updateField("pacing", value)}
							/>
							<BriefInput
								id="project-brief-audience"
								label="受众"
								value={draft.audience}
								placeholder="例如 18-30 岁女性"
								onChange={(value) => updateField("audience", value)}
							/>
							<BriefInput
								id="project-brief-tone"
								label="基调"
								value={draft.tone}
								placeholder="例如 轻悬疑、克制幽默"
								onChange={(value) => updateField("tone", value)}
							/>
							<BriefTextarea
								id="project-brief-references"
								label="参考"
								value={draft.references}
								placeholder="例如 参考作品、视觉板、角色灵感"
								onChange={(value) => updateField("references", value)}
							/>
							<BriefTextarea
								id="project-brief-notes"
								label="约束"
								value={draft.notes}
								placeholder="例如 成本、平台、题材边界"
								onChange={(value) => updateField("notes", value)}
							/>
						</div>
					)}
				</div>
				<footer className="flex shrink-0 justify-end gap-2 border-t border-border bg-card px-4 py-3">
					<Button
						type="button"
						variant="outline"
						disabled={isSaving}
						onClick={() => onOpenChange(false)}
					>
						取消
					</Button>
					<Button type="submit" disabled={isSaving || isLoading}>
						{isSaving ? <Loader2 className="animate-spin" /> : <Save />}
						<span>保存</span>
					</Button>
				</footer>
			</form>
		</div>
	);
};

interface BriefInputProps {
	id: string;
	label: string;
	onChange: (value: string) => void;
	placeholder: string;
	value: string;
}

const BriefInput: React.FC<BriefInputProps> = ({ id, label, onChange, placeholder, value }) => (
	<div className="grid gap-1.5">
		<Label htmlFor={id} className="text-xs">
			{label}
		</Label>
		<Input
			id={id}
			value={value}
			placeholder={placeholder}
			onChange={(event) => onChange(event.target.value)}
		/>
	</div>
);

const BriefTextarea: React.FC<BriefInputProps> = ({ id, label, onChange, placeholder, value }) => (
	<div className="grid gap-1.5 md:col-span-2">
		<Label htmlFor={id} className="text-xs">
			{label}
		</Label>
		<Textarea
			id={id}
			value={value}
			placeholder={placeholder}
			className="min-h-24 resize-y"
			onChange={(event) => onChange(event.target.value)}
		/>
	</div>
);

const draftFromBrief = (brief: ProjectBrief): ProjectBriefDraft => ({
	medium: brief.medium,
	genre: brief.genre,
	pacing: brief.pacing,
	audience: brief.audience,
	tone: brief.tone,
	style: brief.style,
	references: brief.references,
	notes: brief.notes,
});

const trimDraft = (draft: ProjectBriefDraft): ProjectBriefDraft => ({
	medium: draft.medium.trim(),
	genre: draft.genre.trim(),
	pacing: draft.pacing.trim(),
	audience: draft.audience.trim(),
	tone: draft.tone.trim(),
	style: draft.style.trim(),
	references: draft.references.trim(),
	notes: draft.notes.trim(),
});
