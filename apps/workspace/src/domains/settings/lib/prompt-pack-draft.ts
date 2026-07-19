import type {
	PromptPackCategory,
	PromptPackContents,
	PromptPackEntry,
	PromptPackEntryKind,
	SavePromptPackDraftInput,
} from "@/domains/settings/api/packs";

export interface PromptPackDraftContents extends Omit<PromptPackContents, "categories"> {
	categories: PromptPackCategory[];
}

export interface PersistedPromptPackDraft {
	packId: string;
	baseRevision: string;
	base?: PromptPackDraftContents;
	updatedAt: string;
	working: PromptPackDraftContents;
}

export interface PromptPackDraftValidationIssue {
	entryId?: string;
	message: string;
}

const clone = <T>(value: T): T => structuredClone(value);

export const normalizePromptPackContents = (
	contents: PromptPackContents,
): PromptPackDraftContents => ({
	...clone(contents),
	categories: clone(contents.categories ?? []),
	entries: clone(contents.entries),
});

export const createPromptPackDraft = (contents: PromptPackContents): PersistedPromptPackDraft => ({
	packId: contents.pack.id,
	baseRevision: contents.revision ?? "",
	base: normalizePromptPackContents(contents),
	updatedAt: new Date().toISOString(),
	working: normalizePromptPackContents(contents),
});

export const promptPackEntryId = (packId: string, kind: PromptPackEntryKind, slug: string) =>
	`${packId}/${kind}/${slug}`;

export const createDraftEntry = (
	working: PromptPackDraftContents,
	kind: PromptPackEntryKind,
	slug: string,
	categoryId?: string,
): PromptPackDraftContents => {
	const normalizedSlug = slug.trim();
	const id = promptPackEntryId(working.pack.id, kind, normalizedSlug);
	if (working.entries.some((entry) => entry.id === id)) return working;
	const entry: PromptPackEntry = {
		body: "",
		id,
		kind,
		metadata: kind === "prompt" && categoryId ? { category: categoryId } : undefined,
		name: kind === "prompt" ? "未命名提示词" : normalizedSlug,
		packId: working.pack.id,
		slug: normalizedSlug,
		source: "user",
		title: kind === "skill" ? "未命名 Skill" : "未命名提示词",
	};
	return { ...working, entries: [...working.entries, entry] };
};

export const updateDraftEntry = (
	working: PromptPackDraftContents,
	entryId: string,
	update: Partial<Pick<PromptPackEntry, "name" | "title" | "description" | "body" | "metadata">>,
): PromptPackDraftContents => ({
	...working,
	entries: working.entries.map((entry) =>
		entry.id === entryId
			? {
					...entry,
					...update,
					metadata: update.metadata ? clone(update.metadata) : entry.metadata,
				}
			: entry,
	),
});

export const removeDraftEntry = (
	working: PromptPackDraftContents,
	entryId: string,
): PromptPackDraftContents => ({
	...working,
	entries: working.entries.filter((entry) => entry.id !== entryId),
});

export const upsertDraftCategory = (
	working: PromptPackDraftContents,
	category: Pick<PromptPackCategory, "id" | "label"> & Partial<Pick<PromptPackCategory, "order">>,
): PromptPackDraftContents => {
	const existing = working.categories.find((item) => item.id === category.id);
	const next: PromptPackCategory = {
		builtin: existing?.builtin,
		id: category.id.trim(),
		label: category.label.trim(),
		order: category.order ?? existing?.order ?? working.categories.length,
		packId: working.pack.id,
		source: existing?.source ?? "user",
	};
	return {
		...working,
		categories: existing
			? working.categories.map((item) => (item.id === next.id ? next : item))
			: [...working.categories, next],
	};
};

export const reorderDraftCategories = (
	working: PromptPackDraftContents,
	orderedIds: string[],
): PromptPackDraftContents => {
	const rank = new Map(orderedIds.map((id, index) => [id, index]));
	return {
		...working,
		categories: working.categories
			.map((category) => ({ ...category, order: rank.get(category.id) ?? orderedIds.length }))
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
	};
};

export const moveDraftPromptToCategory = (
	working: PromptPackDraftContents,
	entryId: string,
	categoryId: string,
): PromptPackDraftContents => ({
	...working,
	entries: working.entries.map((entry) =>
		entry.id === entryId && entry.kind === "prompt"
			? { ...entry, metadata: { ...entry.metadata, category: categoryId } }
			: entry,
	),
});

export const removeDraftCategory = (
	working: PromptPackDraftContents,
	categoryId: string,
	replacementCategoryId?: string,
): PromptPackDraftContents => {
	const withoutCategory = {
		...working,
		categories: working.categories.filter((category) => category.id !== categoryId),
	};
	if (!replacementCategoryId) return withoutCategory;
	return {
		...withoutCategory,
		entries: withoutCategory.entries.map((entry) =>
			entry.kind === "prompt" && entry.metadata?.category === categoryId
				? { ...entry, metadata: { ...entry.metadata, category: replacementCategoryId } }
				: entry,
		),
	};
};

const canonical = (working: PromptPackDraftContents) => ({
	categories: [...working.categories]
		.map(({ id, label, order }) => ({ id, label: label.trim(), order: order ?? 0 }))
		.sort((a, b) => a.id.localeCompare(b.id)),
	entries: [...working.entries]
		.map(({ id, kind, slug, name, title, description, body, metadata }) => ({
			body: body.replaceAll("\r\n", "\n").trim(),
			description: description?.trim() ?? "",
			id,
			kind,
			metadata: metadata ?? {},
			name: name.trim(),
			slug: slug.trim(),
			title: title?.trim() ?? "",
		}))
		.sort((a, b) => a.id.localeCompare(b.id)),
});

export const isPromptPackDraftDirty = (
	base: PromptPackContents,
	working: PromptPackDraftContents,
) =>
	JSON.stringify(canonical(normalizePromptPackContents(base))) !==
	JSON.stringify(canonical(working));

export const isPersistedPromptPackDraftDirty = (draft: PersistedPromptPackDraft) =>
	!draft.base || isPromptPackDraftDirty(draft.base, draft.working);

export const validatePromptPackDraft = (
	working: PromptPackDraftContents,
): PromptPackDraftValidationIssue | undefined => {
	const categoryIds = new Set<string>();
	for (const category of working.categories) {
		if (!category.id.trim() || !category.label.trim()) return { message: "分组名称不能为空" };
		if (categoryIds.has(category.id)) return { message: `分组 ${category.label} 重复` };
		categoryIds.add(category.id);
	}
	const entryIds = new Set<string>();
	for (const entry of working.entries) {
		const displayName = entry.kind === "skill" ? entry.title || entry.name : entry.name;
		if (!displayName?.trim()) return { entryId: entry.id, message: "内容名称不能为空" };
		if (entryIds.has(entry.id)) return { entryId: entry.id, message: "存在重复内容" };
		entryIds.add(entry.id);
		const categoryId = entry.kind === "prompt" ? String(entry.metadata?.category ?? "") : "";
		if (categoryId && !categoryIds.has(categoryId)) {
			return { entryId: entry.id, message: "提示词所属分组不存在" };
		}
	}
	return undefined;
};

export const serializePromptPackDraft = (
	draft: PersistedPromptPackDraft,
): SavePromptPackDraftInput => ({
	baseRevision: draft.baseRevision,
	categories: draft.working.categories,
	entries: draft.working.entries,
});

export const isPersistedPromptPackDraft = (value: unknown): value is PersistedPromptPackDraft => {
	if (!value || typeof value !== "object") return false;
	const draft = value as Partial<PersistedPromptPackDraft>;
	return (
		typeof draft.packId === "string" &&
		draft.packId.length > 0 &&
		typeof draft.baseRevision === "string" &&
		draft.baseRevision.length > 0 &&
		typeof draft.updatedAt === "string" &&
		!!draft.working &&
		draft.working.pack?.id === draft.packId &&
		Array.isArray(draft.working.entries) &&
		Array.isArray(draft.working.categories) &&
		(!draft.base ||
			(draft.base.pack?.id === draft.packId &&
				Array.isArray(draft.base.entries) &&
				Array.isArray(draft.base.categories)))
	);
};
