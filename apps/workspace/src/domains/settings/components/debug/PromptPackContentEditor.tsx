import { AlertCircle, Check, Loader2 } from "lucide-react";
import type React from "react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { extraPromptCategory } from "@/domains/generation/lib/prompt-categories";
import {
	type PromptPack,
	type PromptPackEntry,
	type PromptPackEntryKind,
	updatePromptPackEntry,
} from "@/domains/settings/api/packs";
import { useToast } from "@/hooks/useToast";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Textarea } from "@/shared/components/ui/textarea";
import { SettingsMarkdownEditor } from "./SettingsMarkdownEditor";

type SaveState = "dirty" | "error" | "saved" | "saving";

interface EntryDraft {
	body: string;
	category: string;
	description: string;
	name: string;
}

export interface PromptPackEntryEditorHandle {
	flush: () => Promise<boolean>;
}

interface PromptPackEntryEditorProps {
	entry: PromptPackEntry;
	onChanged: () => Promise<void>;
	pack: PromptPack;
}

export const PromptPackEntryEditor = forwardRef<
	PromptPackEntryEditorHandle,
	PromptPackEntryEditorProps
>(function PromptPackEntryEditor({ entry, onChanged, pack }, ref) {
	const toast = useToast();
	const initialDraft = useMemo(() => draftFromEntry(entry), [entry]);
	const [name, setName] = useState(initialDraft.name);
	const [category, setCategory] = useState(initialDraft.category);
	const [description, setDescription] = useState(initialDraft.description);
	const [body, setBody] = useState(initialDraft.body);
	const [saveState, setSaveState] = useState<SaveState>("saved");
	const [error, setError] = useState("");
	const currentDraftRef = useRef<EntryDraft>(initialDraft);
	const dirtyRef = useRef(false);
	const entryIDRef = useRef(entry.id);
	const onChangedRef = useRef(onChanged);
	const savePromiseRef = useRef<Promise<boolean> | null>(null);

	currentDraftRef.current = { body, category, description, name };
	onChangedRef.current = onChanged;

	useEffect(() => {
		if (entryIDRef.current === entry.id && dirtyRef.current) return;
		const next = draftFromEntry(entry);
		entryIDRef.current = entry.id;
		currentDraftRef.current = next;
		setName(next.name);
		setCategory(next.category);
		setDescription(next.description);
		setBody(next.body);
		dirtyRef.current = false;
		setSaveState("saved");
		setError("");
	}, [entry]);

	const persist = useCallback(async (): Promise<boolean> => {
		if (savePromiseRef.current) {
			const completed = await savePromiseRef.current;
			if (!completed || !dirtyRef.current) return completed;
		}
		if (!dirtyRef.current) return true;

		const draft = { ...currentDraftRef.current };
		const validationError = validateDraft(entry.kind, draft);
		if (validationError) {
			setError(validationError);
			setSaveState("error");
			return false;
		}

		const task = (async () => {
			setSaveState("saving");
			setError("");
			try {
				await updatePromptPackEntry(pack.id, entry.id, {
					body: draft.body,
					description: entry.kind === "skill" ? draft.description.trim() : undefined,
					metadata:
						entry.kind === "prompt" ? { ...entry.metadata, category: draft.category } : undefined,
					name: draft.name.trim(),
				});
				const unchanged = equalDraft(currentDraftRef.current, draft);
				dirtyRef.current = !unchanged;
				setSaveState(unchanged ? "saved" : "dirty");
				await onChangedRef.current();
				return true;
			} catch (cause) {
				const message = errorMessage(cause);
				setError(message);
				setSaveState("error");
				toast.error("保存失败", { description: message });
				return false;
			}
		})();

		savePromiseRef.current = task;
		const result = await task;
		savePromiseRef.current = null;
		return result;
	}, [entry.id, entry.kind, entry.metadata, pack.id, toast]);

	useImperativeHandle(ref, () => ({ flush: persist }), [persist]);

	useEffect(() => {
		if (!dirtyRef.current || saveState === "saving") return;
		const timer = window.setTimeout(() => void persist(), 700);
		return () => window.clearTimeout(timer);
	}, [body, category, description, name, persist, saveState]);

	useEffect(() => {
		const handleSaveShortcut = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
			event.preventDefault();
			void persist();
		};
		window.addEventListener("keydown", handleSaveShortcut);
		return () => window.removeEventListener("keydown", handleSaveShortcut);
	}, [persist]);

	const markDirty = () => {
		dirtyRef.current = true;
		setSaveState("dirty");
		setError("");
	};

	return (
		<section className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-4xl px-10 py-8 xl:px-14">
				<div className="flex min-h-7 items-center justify-between gap-4">
					<Badge variant="outline">{entry.kind === "skill" ? "Skill" : "提示词"}</Badge>
					<SaveStateLabel state={saveState} />
				</div>

				<input
					aria-label={entry.kind === "skill" ? "Skill 名称" : "提示词名称"}
					value={name}
					onChange={(event) => {
						setName(event.target.value);
						markDirty();
					}}
					className="mt-4 w-full border-0 bg-transparent p-0 text-3xl font-semibold text-foreground outline-none placeholder:text-muted-foreground"
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
							value={description}
							onChange={(event) => {
								setDescription(event.target.value);
								markDirty();
							}}
							className="mt-2 min-h-16 resize-y border-0 bg-transparent px-0 text-sm leading-6 shadow-none focus-visible:ring-0"
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
					editorClassName="min-h-[28rem] pb-24"
					placeholder={entry.kind === "skill" ? "开始编写 Skill..." : "开始编写提示词..."}
					showToolbar
					variant="document"
					value={body}
					onChange={(value) => {
						setBody(value);
						markDirty();
					}}
				/>
			</div>
		</section>
	);
});

const SaveStateLabel: React.FC<{ state: SaveState }> = ({ state }) => {
	switch (state) {
		case "saving":
			return (
				<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					保存中
				</span>
			);
		case "dirty":
			return <span className="text-xs text-muted-foreground">等待保存</span>;
		case "error":
			return (
				<span className="flex items-center gap-1.5 text-xs text-destructive">
					<AlertCircle className="size-3.5" />
					保存失败
				</span>
			);
		case "saved":
			return (
				<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Check className="size-3.5" />
					已保存
				</span>
			);
	}
};

const draftFromEntry = (entry: PromptPackEntry): EntryDraft => ({
	body: entry.body || "",
	category: metadataText(entry.metadata, "category") || extraPromptCategory,
	description: entry.description || "",
	name: entryDisplayName(entry),
});

const validateDraft = (kind: PromptPackEntryKind, draft: EntryDraft) => {
	if (!draft.name.trim()) return kind === "skill" ? "请输入 Skill 名称" : "请输入提示词名称";
	return "";
};

const equalDraft = (first: EntryDraft, second: EntryDraft) =>
	first.body === second.body &&
	first.category === second.category &&
	first.description === second.description &&
	first.name === second.name;

const entryDisplayName = (entry: PromptPackEntry) => entry.title || entry.name || entry.slug;

const metadataText = (metadata: Record<string, unknown> | undefined, key: string) => {
	const value = metadata?.[key];
	return typeof value === "string" ? value.trim() : "";
};

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请稍后重试。";
};
