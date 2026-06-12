import type { GenerationKind, GenerationPreference } from "@/domains/generation/api/generation";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { generationRequestDetailsParamKey } from "./generationFormatters";
import type { ChatMessage, ChatMessageDetail } from "./generationTypes";

export type GenerationExtraValue<T> = T | ((prompt: string) => T);

export const userMessageID = (taskID: string) => `${taskID}:prompt`;

const generationEntryBaseId = (entryId: string) =>
	entryId.replace(/:(assistant|error|prompt)$/, "");

export const taskIdFromGenerationEntryId = (entryId: string) => {
	const baseId = generationEntryBaseId(entryId);
	if (!baseId || baseId.startsWith("local-") || baseId.includes(":")) return null;

	return baseId;
};

export const removeGenerationEntryMessages = (messages: ChatMessage[], entryId: string) => {
	const baseId = generationEntryBaseId(entryId);
	const messageIds = new Set([
		entryId,
		baseId,
		`${baseId}:prompt`,
		`${baseId}:assistant`,
		`${baseId}:error`,
	]);

	return messages.filter((message) => !messageIds.has(message.id));
};

export const resolveGenerationExtraValue = <T>(value: GenerationExtraValue<T>, prompt: string) =>
	typeof value === "function" ? (value as (prompt: string) => T)(prompt) : value;

export const promptWithExtraContext = (prompt: string, extraPrompt: string) => {
	const trimmedExtra = extraPrompt.trim();
	if (!trimmedExtra) return prompt;

	return `${prompt}\n\n${trimmedExtra}`;
};

export const uniqueStrings = (values: string[]) => {
	const seen = new Set<string>();
	const unique: string[] = [];

	for (const value of values) {
		if (!value || seen.has(value)) continue;

		seen.add(value);
		unique.push(value);
	}

	return unique;
};

export const generationPreferenceDebounceMs = 500;
const generationStylePresetStorageKey = "generation.stylePresetId";
const generationModelSelectionStorageKey = "generation.modelSelection.v1";

export interface StoredGenerationModelSelection {
	familyIds: Partial<Record<GenerationKind, string>>;
	routeIds: Record<string, string>;
	routeParams: Record<string, Record<string, unknown>>;
	versionIds: Record<string, string>;
}

export const emptyGenerationModelSelection = (): StoredGenerationModelSelection => ({
	familyIds: {},
	routeIds: {},
	routeParams: {},
	versionIds: {},
});

interface GenerationWorkspacePreferenceStoreState {
	modelSelection: StoredGenerationModelSelection;
	setModelSelection: (selection: StoredGenerationModelSelection) => void;
	setStylePresetId: (presetId: string) => void;
	stylePresetId: string;
}

const generationWorkspacePreferenceStoreKey = "generation.workspace-preferences.v1";

export const useGenerationWorkspacePreferenceStore =
	create<GenerationWorkspacePreferenceStoreState>()(
		persist(
			immer((set) => ({
				modelSelection: readLegacyGenerationModelSelection(),
				stylePresetId: readLegacyGenerationStylePresetId(),
				setModelSelection: (selection) =>
					set((state) => {
						state.modelSelection = normalizeStoredGenerationModelSelection(selection);
					}),
				setStylePresetId: (presetId) =>
					set((state) => {
						state.stylePresetId = presetId;
					}),
			})),
			{
				name: generationWorkspacePreferenceStoreKey,
				storage: createJSONStorage(() => localStorage),
				version: 1,
				partialize: (state) => ({
					modelSelection: state.modelSelection,
					stylePresetId: state.stylePresetId,
				}),
				merge: (persisted, current) => {
					const state =
						(persisted as
							| Partial<
									Pick<GenerationWorkspacePreferenceStoreState, "modelSelection" | "stylePresetId">
							  >
							| undefined) ?? {};
					return {
						...current,
						modelSelection: normalizeStoredGenerationModelSelection(state.modelSelection),
						stylePresetId: typeof state.stylePresetId === "string" ? state.stylePresetId : "",
					};
				},
			},
		),
	);

export const normalizeGenerationPreference = (
	value: Partial<GenerationPreference> & { scopeId: string },
): GenerationPreference => ({
	scopeId: value.scopeId,
	familyIds: normalizeGenerationFamilyIds(value.familyIds),
	routeIds: normalizeStringRecord(value.routeIds),
	versionIds: normalizeStringRecord(value.versionIds),
	routeParams: normalizeRouteParams(value.routeParams),
	stylePresetId: typeof value.stylePresetId === "string" ? value.stylePresetId : "",
	createdAt: value.createdAt,
	updatedAt: value.updatedAt,
});

export const generationPreferencePayload = (preference: GenerationPreference) => ({
	familyIds: preference.familyIds,
	routeIds: preference.routeIds,
	versionIds: preference.versionIds,
	routeParams: preference.routeParams,
	stylePresetId: preference.stylePresetId,
});

export const generationPreferenceSignature = (preference: GenerationPreference) =>
	JSON.stringify(generationPreferencePayload(preference));

export const isEmptyGenerationPreference = (preference: GenerationPreference) => {
	const normalized = normalizeGenerationPreference(preference);
	return (
		Object.keys(normalized.familyIds).length === 0 &&
		Object.keys(normalized.routeIds).length === 0 &&
		Object.keys(normalized.versionIds).length === 0 &&
		Object.keys(normalized.routeParams).length === 0 &&
		!normalized.stylePresetId
	);
};

export const hasStoredGenerationPreference = (
	selection: StoredGenerationModelSelection,
	stylePresetId: string,
) =>
	Object.keys(selection.familyIds).length > 0 ||
	Object.keys(selection.routeIds).length > 0 ||
	Object.keys(selection.routeParams).length > 0 ||
	Object.keys(selection.versionIds).length > 0 ||
	Boolean(stylePresetId);

export const generationPreferenceFromStoredValues = (
	scopeId: string,
	selection: StoredGenerationModelSelection,
	stylePresetId: string,
): GenerationPreference => ({
	scopeId,
	familyIds: selection.familyIds,
	routeIds: selection.routeIds,
	versionIds: selection.versionIds,
	routeParams: selection.routeParams,
	stylePresetId,
});

export const readGenerationModelSelection = (): StoredGenerationModelSelection => {
	return normalizeStoredGenerationModelSelection(
		useGenerationWorkspacePreferenceStore.getState().modelSelection,
	);
};

export const writeGenerationModelSelection = (selection: StoredGenerationModelSelection) => {
	useGenerationWorkspacePreferenceStore.getState().setModelSelection(selection);
};

function normalizeStoredGenerationModelSelection(
	value: Partial<StoredGenerationModelSelection> | undefined,
): StoredGenerationModelSelection {
	return {
		familyIds: normalizeGenerationFamilyIds(value?.familyIds),
		routeIds: normalizeStringRecord(value?.routeIds),
		routeParams: normalizeRouteParams(value?.routeParams),
		versionIds: normalizeStringRecord(value?.versionIds),
	};
}

function readLegacyGenerationModelSelection() {
	if (typeof window === "undefined") return emptyGenerationModelSelection();

	try {
		const rawValue = localStorage.getItem(generationModelSelectionStorageKey);
		return normalizeStoredGenerationModelSelection(
			rawValue ? (JSON.parse(rawValue) as Partial<StoredGenerationModelSelection>) : undefined,
		);
	} catch {
		return emptyGenerationModelSelection();
	}
}

function readLegacyGenerationStylePresetId() {
	if (typeof window === "undefined") return "";
	return localStorage.getItem(generationStylePresetStorageKey) ?? "";
}

export const normalizeGenerationFamilyIds = (
	value: Partial<Record<GenerationKind, string>> | undefined,
): Partial<Record<GenerationKind, string>> => {
	if (!value || typeof value !== "object") return {};

	const familyIds: Partial<Record<GenerationKind, string>> = {};
	for (const key of ["image", "video", "text"] as GenerationKind[]) {
		if (typeof value[key] === "string" && value[key]) familyIds[key] = value[key];
	}

	return familyIds;
};

export const normalizeStringRecord = (
	value: Record<string, string> | undefined,
): Record<string, string> => {
	if (!value || typeof value !== "object") return {};

	const record: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (key && typeof item === "string" && item) record[key] = item;
	}

	return record;
};

export const normalizeRouteParams = (
	value: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> => {
	if (!value || typeof value !== "object") return {};

	const record: Record<string, Record<string, unknown>> = {};
	for (const [routeId, params] of Object.entries(value)) {
		if (!routeId || !params || typeof params !== "object" || Array.isArray(params)) continue;
		record[routeId] = { ...params };
	}

	return record;
};

export const generationParamsWithRequestDetails = (
	params: Record<string, unknown>,
	requestDetails: ChatMessageDetail[] | undefined,
) => {
	const details = (requestDetails ?? []).flatMap((detail) => {
		if (!detail.label.trim() || !detail.value.trim()) return [];
		return [{ label: detail.label, value: detail.value }];
	});
	if (details.length === 0) return params;

	return {
		...params,
		[generationRequestDetailsParamKey]: details,
	};
};

export const readGenerationStylePresetId = () => {
	return useGenerationWorkspacePreferenceStore.getState().stylePresetId;
};

export const writeGenerationStylePresetId = (presetId: string) => {
	useGenerationWorkspacePreferenceStore.getState().setStylePresetId(presetId);
};

export const sameChatMessageList = (left: ChatMessage[], right: ChatMessage[]) =>
	left.length === right.length &&
	left.every((message, index) => JSON.stringify(message) === JSON.stringify(right[index]));

export const removeMessagesBackedByTasks = (
	messages: ChatMessage[],
	tasks: Array<{ id: string }>,
) => {
	const taskIDs = new Set(tasks.map((task) => task.id));
	return messages.filter((message) => {
		const taskID = taskIDFromChatMessage(message);
		return !taskID || !taskIDs.has(taskID);
	});
};

const taskIDFromChatMessage = (message: ChatMessage) => {
	const promptSuffix = ":prompt";
	if (message.role === "user" && message.id.endsWith(promptSuffix)) {
		return message.id.slice(0, -promptSuffix.length);
	}
	if (message.role === "assistant") return message.id;

	return null;
};

export const notifySubmitCallback = <T>(callback: ((event: T) => void) | undefined, event: T) => {
	try {
		callback?.(event);
	} catch {
		// Consumer side effects must not break the generation request lifecycle.
	}
};
