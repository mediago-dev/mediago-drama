import { BookOpenCheck, Copy, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	type SkillMeta,
	createSkill,
	deleteSkill,
	getSkill,
	listSkills,
	skillsKey,
	updateSkill,
} from "@/domains/settings/api/skills";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { composeSkillMarkdown, splitSkillMarkdown } from "@/domains/settings/lib/skill-markdown";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";
import { SettingsMarkdownEditor } from "./SettingsMarkdownEditor";

export const SkillsEditorPanel: React.FC = () => {
	const toast = useToast();
	const { data: skills = [], isLoading, mutate: mutateSkills } = useSWR(skillsKey, listSkills);
	const [selectedName, setSelectedName] = useState("");
	const [frontmatterDraft, setFrontmatterDraft] = useState("");
	const [bodyDraft, setBodyDraft] = useState("");
	const selectedMeta = useMemo(
		() => skills.find((skill) => skill.name === selectedName) ?? skills[0],
		[selectedName, skills],
	);
	const skillDetailKey = selectedMeta ? `${skillsKey}/${selectedMeta.name}` : null;
	const {
		data: selectedSkill,
		isLoading: isSkillLoading,
		mutate: mutateSkill,
	} = useSWR(skillDetailKey, () => getSkill(selectedMeta?.name ?? ""));
	const [error, setError] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [newSkillName, setNewSkillName] = useState("");
	const draft = useMemo(
		() => composeSkillMarkdown({ body: bodyDraft, frontmatter: frontmatterDraft }),
		[bodyDraft, frontmatterDraft],
	);
	const frontmatterJSON = useMemo(
		() => (selectedMeta ? JSON.stringify(skillFrontmatterDisplay(selectedMeta), null, 2) : "{}"),
		[selectedMeta],
	);

	useEffect(() => {
		if (!skills.length) return;
		if (!selectedName || !skills.some((skill) => skill.name === selectedName)) {
			setSelectedName(skills[0].name);
		}
	}, [selectedName, skills]);

	useEffect(() => {
		const parts = splitSkillMarkdown(selectedSkill?.content ?? "");
		setFrontmatterDraft(parts.frontmatter);
		setBodyDraft(parts.body);
		setError("");
	}, [selectedSkill]);

	const builtin = selectedSkill?.source === "builtin";

	const save = async () => {
		if (!selectedSkill) return;
		setIsSaving(true);
		setError("");
		try {
			const saved = await updateSkill(selectedSkill.name, draft);
			await mutateSkill(saved, false);
			await mutateSkills();
			const parts = splitSkillMarkdown(saved.content);
			setFrontmatterDraft(parts.frontmatter);
			setBodyDraft(parts.body);
			toast.success("Skill 已保存");
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("Skill 保存失败", { description: message });
		} finally {
			setIsSaving(false);
		}
	};

	const createNewSkill = async () => {
		const name = sanitizeSkillName(newSkillName);
		if (!name) return;
		setIsSaving(true);
		setError("");
		try {
			const created = await createSkill(name, newSkillTemplate(name));
			await mutateSkills();
			setSelectedName(created.name);
			await mutateSkill(created, false);
			const parts = splitSkillMarkdown(created.content);
			setFrontmatterDraft(parts.frontmatter);
			setBodyDraft(parts.body);
			setNewSkillName("");
			setIsCreating(false);
			toast.success("Skill 已创建", { description: created.name });
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("Skill 创建失败", { description: message });
		} finally {
			setIsSaving(false);
		}
	};

	const remove = async () => {
		if (!selectedSkill || builtin) return;
		setIsDeleting(true);
		setError("");
		try {
			await deleteSkill(selectedSkill.name);
			const nextSkills = skills.filter((skill) => skill.name !== selectedSkill.name);
			await mutateSkills(nextSkills, false);
			setSelectedName(nextSkills[0]?.name ?? "");
			toast.success("Skill 已删除");
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("Skill 删除失败", { description: message });
		} finally {
			setIsDeleting(false);
		}
	};

	const duplicate = async () => {
		if (!selectedSkill) return;
		const name = uniqueSkillName(`${selectedSkill.name}-copy`, skills);
		setIsSaving(true);
		setError("");
		try {
			const created = await createSkill(name, renameSkillRaw(selectedSkill.content, name));
			await mutateSkills();
			setSelectedName(created.name);
			await mutateSkill(created, false);
			const parts = splitSkillMarkdown(created.content);
			setFrontmatterDraft(parts.frontmatter);
			setBodyDraft(parts.body);
			toast.success("Skill 副本已创建", { description: created.name });
		} catch (err) {
			const message = errorMessage(err);
			setError(message);
			toast.error("复制失败", { description: message });
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<SettingsPanelLayout
			title="技能"
			icon={<BookOpenCheck className="size-4" />}
			actions={
				<>
					<Button type="button" variant="outline" onClick={() => setIsCreating(true)}>
						<Plus className="size-4" />
						<span>新建</span>
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => void duplicate()}
						disabled={!selectedSkill || isSaving}
					>
						<Copy className="size-4" />
						<span>复制为副本</span>
					</Button>
					<Button type="button" onClick={() => void save()} disabled={!selectedSkill || isSaving}>
						<Save className="size-4" />
						<span>{isSaving ? "保存中" : "保存"}</span>
					</Button>
					<Button
						type="button"
						variant="destructive"
						onClick={() => void remove()}
						disabled={!selectedSkill || builtin || isDeleting}
					>
						<Trash2 className="size-4" />
						<span>{isDeleting ? "删除中" : "删除"}</span>
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				{isCreating ? (
					<div className={settingsFormRowClassName}>
						<Label htmlFor="new-skill-name" className="text-sm font-medium text-foreground">
							文件名
						</Label>
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<Input
								id="new-skill-name"
								value={newSkillName}
								onChange={(event) => setNewSkillName(event.target.value)}
								placeholder="my-custom-guide"
								className="min-w-56 flex-1"
							/>
							<Button
								type="button"
								onClick={() => void createNewSkill()}
								disabled={!sanitizeSkillName(newSkillName) || isSaving}
							>
								<Plus className="size-4" />
								<span>确认</span>
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setIsCreating(false);
									setNewSkillName("");
								}}
							>
								<X className="size-4" />
							</Button>
						</div>
					</div>
				) : null}

				{isLoading && skills.length === 0 ? (
					<p className={skillMessageClassName}>正在加载技能。</p>
				) : !selectedSkill && isSkillLoading ? (
					<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						<span>加载中</span>
					</div>
				) : !selectedMeta ? (
					<p className={skillMessageClassName}>没有可用技能。</p>
				) : (
					<>
						<div className={settingsFormRowClassName}>
							<Label htmlFor="skill-select" className="text-sm font-medium text-foreground">
								当前 Skill
							</Label>
							<Select value={selectedMeta.name} onValueChange={setSelectedName}>
								<SelectTrigger id="skill-select" className="rounded-md text-foreground">
									<SelectValue placeholder="选择 Skill" />
								</SelectTrigger>
								<SelectContent align="start">
									{skills.map((skill) => (
										<SelectItem key={skill.name} value={skill.name}>
											<span className="flex min-w-0 w-full items-center gap-2">
												<span className="min-w-0 flex-1 truncate">{skill.title || skill.name}</span>
												<SkillSourceBadge source={skill.source} />
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className={settingsFormRowClassName}>
							<Label className="text-sm font-medium text-foreground">说明</Label>
							<div className="flex min-w-0 flex-wrap items-center gap-2 text-sm leading-6 text-muted-foreground">
								<span>{selectedMeta.description}</span>
								<SkillSourceBadge source={selectedMeta.source} />
							</div>
						</div>

						<div className={settingsFormRowClassName}>
							<Label className="text-sm font-medium text-foreground">Frontmatter</Label>
							<pre
								aria-label="Skill frontmatter JSON"
								className="max-h-48 overflow-auto rounded-md border border-border bg-ide-panel px-3 py-2 font-mono text-xs leading-5 text-foreground"
							>
								{frontmatterJSON}
							</pre>
						</div>

						<div className={skillBodyRowClassName}>
							<div className="flex items-center justify-between gap-2">
								<Label
									id="skill-body-content-label"
									className="text-sm font-medium text-foreground"
								>
									Skill 内容
								</Label>
								<span className="flex items-center gap-1 text-xs text-muted-foreground">
									<BookOpenCheck className="size-3.5" />
									{countLines(draft)} 行
								</span>
							</div>
							{error ? (
								<Alert variant="destructive" className="rounded-md">
									<AlertDescription>{error}</AlertDescription>
								</Alert>
							) : null}
							<SettingsMarkdownEditor
								ariaLabelledBy="skill-body-content-label"
								placeholder="编写 Skill 正文..."
								value={bodyDraft}
								onChange={setBodyDraft}
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

const skillBodyRowClassName = "grid gap-2 py-2";
const skillMessageClassName = "py-2 text-sm text-muted-foreground";

const SkillSourceBadge: React.FC<{ source: SkillMeta["source"] }> = ({ source }) => (
	<Badge variant={source === "builtin" ? "secondary" : "outline"} className="shrink-0 rounded-md">
		{source}
	</Badge>
);

const skillFrontmatterDisplay = (skill: SkillMeta) => ({
	name: skill.name,
	...(skill.title ? { title: skill.title } : {}),
	description: skill.description,
	...(skill.hint ? { hint: skill.hint } : {}),
});

const sanitizeSkillName = (value: string) =>
	value
		.trim()
		.replace(/\.skill\.md$/i, "")
		.replace(/[^a-zA-Z0-9_-]/g, "-")
		.replace(/^[-_]+/, "");

const newSkillTemplate = (name: string) => `---
name: ${name}
description: 自定义写作指导
---
# ${name}

`;

const uniqueSkillName = (baseName: string, skills: SkillMeta[]) => {
	const existing = new Set(skills.map((skill) => skill.name));
	let name = sanitizeSkillName(baseName);
	let index = 2;
	while (existing.has(name)) {
		name = `${sanitizeSkillName(baseName)}-${index}`;
		index += 1;
	}
	return name;
};

const renameSkillRaw = (content: string, name: string) => {
	if (/^name:\s*.+$/m.test(content)) {
		return content.replace(/^name:\s*.+$/m, `name: ${name}`);
	}
	return newSkillTemplate(name);
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
	return "请检查后端服务是否可写 Skill 文件。";
};
