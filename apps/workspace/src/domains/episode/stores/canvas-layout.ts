import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { EpisodeCanvasNodePositionOverrides } from "@/domains/episode/lib/canvas-node-position";

interface EpisodeCanvasLayoutState {
	nodePositionsByScope: Record<string, EpisodeCanvasNodePositionOverrides>;
	clearNodePositions: (scopeId: string) => void;
	setNodePositions: (scopeId: string, positions: EpisodeCanvasNodePositionOverrides) => void;
}

const episodeCanvasLayoutStoreKey = "episode-canvas-layout.v1";

export const useEpisodeCanvasLayoutStore = create<EpisodeCanvasLayoutState>()(
	persist(
		immer((set) => ({
			nodePositionsByScope: {},
			clearNodePositions: (scopeId) =>
				set((state) => {
					delete state.nodePositionsByScope[normalizeScopeId(scopeId)];
				}),
			setNodePositions: (scopeId, positions) =>
				set((state) => {
					const normalizedScopeId = normalizeScopeId(scopeId);
					const sanitizedPositions = sanitizeNodePositions(positions);
					const currentPositions = state.nodePositionsByScope[normalizedScopeId];

					if (Object.keys(sanitizedPositions).length === 0) {
						if (!currentPositions) return;
						delete state.nodePositionsByScope[normalizedScopeId];
						return;
					}

					if (areNodePositionOverridesEqual(currentPositions, sanitizedPositions)) return;

					state.nodePositionsByScope[normalizedScopeId] = sanitizedPositions;
				}),
		})),
		{
			name: episodeCanvasLayoutStoreKey,
			storage: createJSONStorage(() => localStorage),
			version: 1,
			partialize: (state) => ({ nodePositionsByScope: state.nodePositionsByScope }),
			merge: (persisted, current) => {
				const state =
					(persisted as Partial<Pick<EpisodeCanvasLayoutState, "nodePositionsByScope">>) ?? {};

				return {
					...current,
					nodePositionsByScope: sanitizeNodePositionsByScope(state.nodePositionsByScope),
				};
			},
		},
	),
);

function normalizeScopeId(scopeId: string) {
	return scopeId.trim() || "default";
}

function sanitizeNodePositionsByScope(value: unknown) {
	if (!isRecord(value)) return {};

	const result: Record<string, EpisodeCanvasNodePositionOverrides> = {};
	for (const [scopeId, positions] of Object.entries(value)) {
		const normalizedScopeId = normalizeScopeId(scopeId);
		const sanitizedPositions = sanitizeNodePositions(positions);
		if (Object.keys(sanitizedPositions).length > 0) {
			result[normalizedScopeId] = sanitizedPositions;
		}
	}

	return result;
}

function sanitizeNodePositions(value: unknown): EpisodeCanvasNodePositionOverrides {
	if (!isRecord(value)) return {};

	const result: EpisodeCanvasNodePositionOverrides = {};
	for (const [nodeId, position] of Object.entries(value)) {
		if (!isRecord(position)) continue;

		const x = position.x;
		const y = position.y;
		if (typeof x !== "number" || typeof y !== "number") continue;
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

		result[nodeId] = { x, y };
	}

	return result;
}

function areNodePositionOverridesEqual(
	left: EpisodeCanvasNodePositionOverrides | undefined,
	right: EpisodeCanvasNodePositionOverrides,
) {
	if (!left) return Object.keys(right).length === 0;

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;

	for (const nodeId of leftKeys) {
		const leftPosition = left[nodeId];
		const rightPosition = right[nodeId];
		if (
			!rightPosition ||
			leftPosition.x !== rightPosition.x ||
			leftPosition.y !== rightPosition.y
		) {
			return false;
		}
	}

	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
