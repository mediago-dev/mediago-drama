import { isAxiosError } from "axios";
import { useEffect, useMemo } from "react";
import useSWR from "swr";
import type { AgentSelection } from "@/api/types/agent";
import { getAgentSelection } from "@/domains/agent/api/agent";
import { missingSelectionResolution } from "@/domains/agent/lib/resolved-selection";
import {
	useAgentPersistenceStore,
	type ResolvedAgentSelection,
} from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";

type SelectionStatusFetch = { record: AgentSelection } | { missing: true };

// useResolvedAgentSelection reports whether a selection/form card has already
// been decided, so re-materialized cards render frozen instead of interactive.
// The locally persisted decision wins; otherwise the server's selection record
// is the authority — this also freezes cards decided before local persistence
// existed, decided in another window, or whose record no longer exists.
export const useResolvedAgentSelection = (
	selectionId: string | null | undefined,
	projectId: string | null | undefined,
	mapRecord: (record: AgentSelection) => ResolvedAgentSelection | null,
): ResolvedAgentSelection | null => {
	const id = selectionId?.trim() ?? "";
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const resolvedProjectId = projectId?.trim() || activeProjectId?.trim() || "";
	const local = useAgentPersistenceStore((state) =>
		id ? (state.resolvedSelections[id] ?? null) : null,
	);

	const { data } = useSWR<SelectionStatusFetch>(
		id && resolvedProjectId && !local ? ["agent-selection-status", resolvedProjectId, id] : null,
		async () => {
			try {
				return { record: await getAgentSelection(id, resolvedProjectId) };
			} catch (err) {
				if (isAxiosError(err) && err.response?.status === 404) return { missing: true };
				throw err;
			}
		},
	);

	const serverResolved = useMemo(() => {
		if (!data) return null;
		if ("missing" in data && data.missing) return missingSelectionResolution();
		if ("record" in data && data.record) return mapRecord(data.record);
		return null;
	}, [data, mapRecord]);

	// Persist the server-derived resolution so later renders (and offline
	// sessions) freeze without refetching.
	useEffect(() => {
		if (!id || local || !serverResolved) return;
		useAgentPersistenceStore.getState().markSelectionResolved(id, serverResolved);
	}, [id, local, serverResolved]);

	return local ?? serverResolved;
};
