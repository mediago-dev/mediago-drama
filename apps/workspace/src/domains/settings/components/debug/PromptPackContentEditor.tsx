import type React from "react";
import { extraPromptCategory } from "@/domains/generation/lib/prompt-categories";
import type {
	PromptPackEntry,
	PromptPackEntryKind,
	UpdatePromptPackEntryInput,
} from "@/domains/settings/api/packs";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Textarea } from "@/shared/components/ui/textarea";
import { SettingsMarkdownEditor } from "./SettingsMarkdownEditor";

export interface PromptPackEntryDraft {
	body: string;
	category: string;
	description: string;
	name: string;
}

interface PromptPackEntryEditorProps {
	draft: PromptPackEntryDraft;
	entry: PromptPackEntry;
	error?: string;
	isEditing: boolean;
	onChange: (draft: PromptPackEntryDraft) => void;
}

export const PromptPackEntryEditor: React.FC<PromptPackEntryEditorProps> = ({
	draft,
	entry,
	error,
	isEditing,
	onChange,
}) => {
	const updateDraft = (update: Partial<PromptPackEntryDraft>) => onChange({ ...draft, ...update });

	return (
		<section className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-4xl px-10 py-8 xl:px-14">
				<div className="flex min-h-9 items-center justify-between gap-4">
					<Badge variant="outline">{entry.kind === "skill" ? "Skill" : "提示词"}</Badge>
					{isEditing ? <span className="text-xs text-muted-foreground">技能包编辑中</span> : null}
				</div>

				<input
					aria-label={entry.kind === "skill" ? "Skill 名称" : "提示词名称"}
					readOnly={!isEditing}
					value={draft.name}
					onChange={(event) => updateDraft({ name: event.target.value })}
					className="mt-4 w-full border-0 bg-transparent p-0 text-3xl font-semibold text-foreground outline-none placeholder:text-muted-foreground read-only:cursor-default"
					placeholder={entry.kind === "skill" ? "未命名 Skill" : "未命名提示词"}
				/>

				{entry.kind === "skill" ? (
					<div className="mt-5 border-b border-border pb-5">
						<label
							className="block text-xs font-medium text-muted-foreground"
							htmlFor="skill-description"
						>
							Skill 描述
						</label>
						<Textarea
							id="skill-description"
							readOnly={!isEditing}
							value={draft.description}
							onChange={(event) => updateDraft({ description: event.target.value })}
							className="mt-2 min-h-16 resize-y border-0 bg-transparent px-0 text-sm leading-6 shadow-none focus-visible:ring-0 read-only:cursor-default read-only:resize-none"
							placeholder="简要说明这个 Skill 的用途"
						/>
					</div>
				) : null}

				{error ? (
					<Alert variant="destructive" className="mt-5">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}

				<SettingsMarkdownEditor
					ariaLabel={entry.kind === "skill" ? "编辑 Skill 内容" : "编辑提示词内容"}
					className="mt-4 min-h-[32rem]"
					editable={isEditing}
					editorClassName="min-h-[28rem] pb-24"
					placeholder={entry.kind === "skill" ? "开始编写 Skill..." : "开始编写提示词..."}
					showToolbar
					variant="document"
					value={draft.body}
					onChange={(body) => updateDraft({ body })}
				/>
			</div>
		</section>
	);
};

export const promptPackEntryDraft = (entry: PromptPackEntry): PromptPackEntryDraft => ({
	body: entry.body || "",
	category: metadataText(entry.metadata, "category") || extraPromptCategory,
	description: entry.description || "",
	name: entryDisplayName(entry),
});

export const validatePromptPackEntryDraft = (
	kind: PromptPackEntryKind,
	draft: PromptPackEntryDraft,
) => {
	if (!draft.name.trim()) return kind === "skill" ? "请输入 Skill 名称" : "请输入提示词名称";
	return "";
};

export const promptPackEntryUpdate = (
	entry: PromptPackEntry,
	draft: PromptPackEntryDraft,
): UpdatePromptPackEntryInput => ({
	body: draft.body,
	description: entry.kind === "skill" ? draft.description.trim() : undefined,
	metadata: entry.kind === "prompt" ? { ...entry.metadata, category: draft.category } : undefined,
	name: draft.name.trim(),
});

export const promptPackEntryDraftEquals = (
	first: PromptPackEntryDraft,
	second: PromptPackEntryDraft,
) =>
	first.body === second.body &&
	first.category === second.category &&
	first.description === second.description &&
	first.name === second.name;

const entryDisplayName = (entry: PromptPackEntry) => entry.title || entry.name || entry.slug;

const metadataText = (metadata: Record<string, unknown> | undefined, key: string) => {
	const value = metadata?.[key];
	return typeof value === "string" ? value.trim() : "";
};
