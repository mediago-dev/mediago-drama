import type { GenerationKind } from "@/domains/generation/api/generation";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export type BatchGenerationDialogKind = Extract<GenerationKind, "image" | "video">;

export interface BatchGenerationStoredSettings {
	familyId?: string;
	params?: Record<string, unknown>;
	promptOptimizeItemId?: string;
	promptOptimizeRouteId?: string;
	routeId?: string;
	usePromptOptimization?: boolean;
	versionId?: string;
}

export type BatchGenerationStoredSettingsMap = Partial<
	Record<BatchGenerationDialogKind, BatchGenerationStoredSettings>
>;

interface BatchGenerationSettingsPreferenceState {
	settingsByKind: BatchGenerationStoredSettingsMap;
	setSettings: (kind: BatchGenerationDialogKind, settings: BatchGenerationStoredSettings) => void;
}

export const batchGenerationSettingsStorageKey = "generation.batch-settings.v1";

export const batchGenerationPromptOptimizationDefaultEnabled = false;

export const batchGenerationPromptOptimizationEnabled = (
	settings: BatchGenerationStoredSettings | null | undefined,
) =>
	typeof settings?.usePromptOptimization === "boolean"
		? settings.usePromptOptimization
		: batchGenerationPromptOptimizationDefaultEnabled;

export const useBatchGenerationSettingsPreferenceStore =
	create<BatchGenerationSettingsPreferenceState>()(
		persist(
			immer((set) => ({
				settingsByKind: readLegacyBatchGenerationSettings(),
				setSettings: (kind, settings) =>
					set((state) => {
						state.settingsByKind[kind] = compactBatchGenerationStoredSettings(settings);
					}),
			})),
			{
				name: batchGenerationSettingsStorageKey,
				storage: createJSONStorage(() => localStorage),
				version: 1,
				partialize: (state) => ({ settingsByKind: state.settingsByKind }),
				merge: (persisted, current) => {
					const state =
						(persisted as
							| Partial<Pick<BatchGenerationSettingsPreferenceState, "settingsByKind">>
							| undefined) ?? {};
					const settingsByKind = normalizeBatchGenerationStoredSettingsMap(state.settingsByKind);
					return {
						...current,
						settingsByKind: hasBatchGenerationStoredSettings(settingsByKind)
							? settingsByKind
							: current.settingsByKind,
					};
				},
			},
		),
	);

function readLegacyBatchGenerationSettings(): BatchGenerationStoredSettingsMap {
	if (typeof localStorage === "undefined") return {};
	try {
		const rawValue = localStorage.getItem(batchGenerationSettingsStorageKey);
		if (!rawValue) return {};
		const parsed = JSON.parse(rawValue) as unknown;
		if (!isRecord(parsed) || "state" in parsed) return {};
		return normalizeBatchGenerationStoredSettingsMap(parsed);
	} catch {
		return {};
	}
}

function normalizeBatchGenerationStoredSettingsMap(
	value: unknown,
): BatchGenerationStoredSettingsMap {
	if (!isRecord(value)) return {};
	return {
		image: normalizeBatchGenerationStoredSettings(value.image) ?? undefined,
		video: normalizeBatchGenerationStoredSettings(value.video) ?? undefined,
	};
}

function hasBatchGenerationStoredSettings(settings: BatchGenerationStoredSettingsMap) {
	return Boolean(settings.image || settings.video);
}

function normalizeBatchGenerationStoredSettings(
	value: unknown,
): BatchGenerationStoredSettings | null {
	if (!isRecord(value)) return null;

	return compactBatchGenerationStoredSettings({
		familyId: stringValue(value.familyId),
		params: isRecord(value.params) ? { ...value.params } : undefined,
		promptOptimizeItemId: stringValue(value.promptOptimizeItemId),
		promptOptimizeRouteId: stringValue(value.promptOptimizeRouteId),
		routeId: stringValue(value.routeId),
		usePromptOptimization:
			typeof value.usePromptOptimization === "boolean" ? value.usePromptOptimization : undefined,
		versionId: stringValue(value.versionId),
	});
}

function compactBatchGenerationStoredSettings(
	settings: BatchGenerationStoredSettings,
): BatchGenerationStoredSettings {
	const next: BatchGenerationStoredSettings = {};
	if (settings.familyId) next.familyId = settings.familyId;
	if (settings.params && Object.keys(settings.params).length > 0)
		next.params = { ...settings.params };
	if (settings.promptOptimizeItemId) next.promptOptimizeItemId = settings.promptOptimizeItemId;
	if (settings.promptOptimizeRouteId) next.promptOptimizeRouteId = settings.promptOptimizeRouteId;
	if (settings.routeId) next.routeId = settings.routeId;
	if (typeof settings.usePromptOptimization === "boolean") {
		next.usePromptOptimization = settings.usePromptOptimization;
	}
	if (settings.versionId) next.versionId = settings.versionId;
	return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
	return typeof value === "string" ? value.trim() : undefined;
}
