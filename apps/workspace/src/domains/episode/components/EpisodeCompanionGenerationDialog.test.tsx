import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleEpisode } from "@/domains/episode/lib/sample";
import { dialogAnimationDurationMs } from "@/shared/components/ui/dialog-motion";
import { EpisodeCompanionGenerationDialog } from "./EpisodeCompanionGenerationDialog";

const videoClip = sampleEpisode.tracks
	.find((track) => track.type === "video")
	?.clips.find((clip) => clip.id === "clip-cold-open");

describe("EpisodeCompanionGenerationDialog", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("generates and commits a companion draft", async () => {
		vi.useFakeTimers();
		const onCommit = vi.fn();
		const onOpenChange = vi.fn();

		render(
			<EpisodeCompanionGenerationDialog
				episode={sampleEpisode}
				open
				trackType="caption"
				videoClip={videoClip ?? null}
				onCommit={onCommit}
				onOpenChange={onOpenChange}
			/>,
		);

		expect(screen.getByRole("button", { name: "加入时间轴" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "生成" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(520);
		});

		const commitButton = screen.getByRole("button", { name: "加入时间轴" });
		expect(commitButton).toBeEnabled();

		fireEvent.click(commitButton);

		expect(onCommit).toHaveBeenCalledWith(
			videoClip?.id,
			"caption",
			expect.stringContaining("桌面宽幅捕捉写作区"),
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("keeps the dialog mounted for the closing animation", async () => {
		vi.useFakeTimers();
		const onOpenChange = vi.fn();
		const { rerender } = render(
			<EpisodeCompanionGenerationDialog
				episode={sampleEpisode}
				open
				trackType="caption"
				videoClip={videoClip ?? null}
				onCommit={vi.fn()}
				onOpenChange={onOpenChange}
			/>,
		);

		rerender(
			<EpisodeCompanionGenerationDialog
				episode={sampleEpisode}
				open={false}
				trackType={null}
				videoClip={null}
				onCommit={vi.fn()}
				onOpenChange={onOpenChange}
			/>,
		);

		expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "closed");
		expect(screen.getByRole("heading", { name: /生成字幕/ })).toBeTruthy();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(dialogAnimationDurationMs);
		});

		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
