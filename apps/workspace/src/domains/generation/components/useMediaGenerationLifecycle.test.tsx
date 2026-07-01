import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { useMediaGenerationLifecycle } from "./useMediaGenerationLifecycle";

const entry = (overrides: Partial<GenerationEntry>): GenerationEntry => ({
	id: "entry-1",
	kind: "image",
	content: "",
	prompt: "a cat",
	status: "failed",
	assets: [],
	...overrides,
});

describe("useMediaGenerationLifecycle", () => {
	it("ignores a pre-existing (untracked) historical failure in the section", () => {
		const onGenerationError = vi.fn();
		const { result } = renderHook(() =>
			useMediaGenerationLifecycle({ kind: "image", onGenerationError }),
		);

		// A failed record that was never started in this session must not re-mark the
		// resource as failed just because the dialog loaded it.
		result.current.syncGenerationEntries([entry({ id: "history-failed", status: "failed" })]);

		expect(onGenerationError).not.toHaveBeenCalled();
	});

	it("reports a failure for a generation started in this session", () => {
		const onGenerationError = vi.fn();
		const onGenerationStart = vi.fn();
		const { result } = renderHook(() =>
			useMediaGenerationLifecycle({ kind: "image", onGenerationError, onGenerationStart }),
		);

		// The generation first appears as in-progress (gets tracked), then fails.
		result.current.syncGenerationEntries([entry({ id: "gen-1", status: "running" })]);
		expect(onGenerationStart).toHaveBeenCalledWith("gen-1", "a cat");

		result.current.syncGenerationEntries([entry({ id: "gen-1", status: "failed" })]);
		expect(onGenerationError).toHaveBeenCalledWith("gen-1");
	});
});
