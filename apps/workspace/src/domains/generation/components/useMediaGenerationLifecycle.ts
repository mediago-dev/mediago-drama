import { useCallback, useRef } from "react";
import type {
	GenerationAsset,
	GenerationKind,
	GenerationMessageResponse,
} from "@/domains/generation/api/generation";
import {
	type GenerationSubmitFailureEvent,
	type GenerationSubmitResponseEvent,
	type GenerationSubmitStartEvent,
} from "@/domains/generation/hooks/useGenerationWorkspace";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import {
	entryGeneratedAssets,
	isFailedGenerationStatus,
	isPendingGenerationStatus,
} from "./mediaGenerationHelpers";

export const useMediaGenerationLifecycle = ({
	kind,
	onGenerationComplete,
	onGenerationError,
	onGenerationResponse,
	onGenerationStart,
}: {
	kind: GenerationKind;
	onGenerationComplete?: (
		pendingId: string,
		assets: GenerationAsset[],
		sourceEntryId: string,
	) => void;
	onGenerationError?: (pendingId: string) => void;
	onGenerationResponse?: (pendingId: string, response: GenerationMessageResponse) => void;
	onGenerationStart?: (pendingId: string, prompt: string) => void;
}) => {
	const pendingEntryIdsRef = useRef<Record<string, string>>({});
	const materializedPendingIdsRef = useRef<Set<string>>(new Set());
	const resolvedPendingIdsRef = useRef<Set<string>>(new Set());
	const failedPendingIdsRef = useRef<Set<string>>(new Set());

	const trackGenerationStart = useCallback(
		(event: GenerationSubmitStartEvent) => {
			if (event.kind !== kind) return;

			pendingEntryIdsRef.current[event.localMessageId] = event.localMessageId;
			materializedPendingIdsRef.current.add(event.localMessageId);
			onGenerationStart?.(event.localMessageId, event.prompt);
		},
		[kind, onGenerationStart],
	);

	const trackGenerationResponse = useCallback(
		(event: GenerationSubmitResponseEvent) => {
			if (event.kind !== kind) return;

			const pendingId = pendingEntryIdsRef.current[event.localMessageId] ?? event.localMessageId;
			delete pendingEntryIdsRef.current[event.localMessageId];
			pendingEntryIdsRef.current[event.response.id] = pendingId;
			onGenerationResponse?.(pendingId, event.response);
		},
		[kind, onGenerationResponse],
	);

	const trackGenerationFailure = useCallback(
		(event: GenerationSubmitFailureEvent) => {
			if (event.kind !== kind) return;

			const pendingId = pendingEntryIdsRef.current[event.localMessageId] ?? event.localMessageId;
			delete pendingEntryIdsRef.current[event.localMessageId];
			if (failedPendingIdsRef.current.has(pendingId)) return;

			failedPendingIdsRef.current.add(pendingId);
			onGenerationError?.(pendingId);
		},
		[kind, onGenerationError],
	);

	const syncGenerationEntries = useCallback(
		(generationEntries: GenerationEntry[]) => {
			for (const entry of generationEntries) {
				const pendingId = pendingEntryIdsRef.current[entry.id] ?? entry.id;
				if (resolvedPendingIdsRef.current.has(pendingId)) continue;
				const generatedAssets = entryGeneratedAssets(entry, kind);

				if (generatedAssets.length > 0) {
					if (!pendingEntryIdsRef.current[entry.id]) continue;

					resolvedPendingIdsRef.current.add(pendingId);
					delete pendingEntryIdsRef.current[entry.id];
					onGenerationComplete?.(pendingId, generatedAssets, entry.id);
					continue;
				}

				if (isFailedGenerationStatus(entry.status)) {
					// Mirror the completed branch: only react to failures for generations that
					// were started in this session. A pre-existing historical failure in the
					// section must not re-mark the resource as failed just because the dialog
					// (re)loaded its entries.
					if (!pendingEntryIdsRef.current[entry.id]) continue;
					if (failedPendingIdsRef.current.has(pendingId)) continue;

					failedPendingIdsRef.current.add(pendingId);
					materializedPendingIdsRef.current.delete(pendingId);
					delete pendingEntryIdsRef.current[entry.id];
					onGenerationError?.(pendingId);
					continue;
				}

				if (
					isPendingGenerationStatus(entry.status) &&
					!materializedPendingIdsRef.current.has(pendingId)
				) {
					pendingEntryIdsRef.current[entry.id] = pendingId;
					materializedPendingIdsRef.current.add(pendingId);
					onGenerationStart?.(pendingId, entry.prompt || entry.content);
				}
			}
		},
		[kind, onGenerationComplete, onGenerationError, onGenerationStart],
	);

	const clearDeletedEntry = useCallback(
		(entry: GenerationEntry) => {
			const pendingId = pendingEntryIdsRef.current[entry.id] ?? entry.id;
			const shouldRemovePendingPlaceholder =
				entryGeneratedAssets(entry, kind).length === 0 &&
				(isPendingGenerationStatus(entry.status) || isFailedGenerationStatus(entry.status));

			delete pendingEntryIdsRef.current[entry.id];
			materializedPendingIdsRef.current.delete(pendingId);
			resolvedPendingIdsRef.current.delete(pendingId);
			failedPendingIdsRef.current.delete(pendingId);
			if (shouldRemovePendingPlaceholder) onGenerationError?.(pendingId);
		},
		[kind, onGenerationError],
	);

	return {
		clearDeletedEntry,
		syncGenerationEntries,
		trackGenerationFailure,
		trackGenerationResponse,
		trackGenerationStart,
	};
};
