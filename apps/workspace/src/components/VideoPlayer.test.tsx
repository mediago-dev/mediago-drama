import { describe, expect, it } from "vitest";
import { shouldSyncPlayerTime } from "./VideoPlayer";

describe("shouldSyncPlayerTime", () => {
	it("skips the value the player just emitted (breaks the timeupdate→seek feedback loop)", () => {
		// 播放器 emit 了 5.0，经 store 绕回来 currentTime≈5.0，不应再写回播放器。
		expect(shouldSyncPlayerTime(5.0, 5.0, 5.0)).toBe(false);
		expect(shouldSyncPlayerTime(5.0, 5.2, 5.1)).toBe(false);
	});

	it("seeks on a genuine external jump away from both the player and the last echo", () => {
		// 用户拖动进度条到 20，播放器仍在 5、上次 emit 也是 5 → 应 seek。
		expect(shouldSyncPlayerTime(5.0, 20.0, 5.0)).toBe(true);
	});

	it("does not seek when the player is already within tolerance of the target", () => {
		expect(shouldSyncPlayerTime(10.1, 10.0, null)).toBe(false);
	});

	it("seeks on first sync (no prior emit) when the player is far from the target", () => {
		expect(shouldSyncPlayerTime(0, 12, null)).toBe(true);
	});

	it("treats the echo guard as higher priority than the player-distance check", () => {
		// 即便播放器当前时间离目标很远，只要目标是刚 emit 的回声值，也跳过——这正是死循环的来源。
		expect(shouldSyncPlayerTime(0, 30, 30)).toBe(false);
	});

	it("honors a custom tolerance", () => {
		expect(shouldSyncPlayerTime(0, 1, null, 2)).toBe(false);
		expect(shouldSyncPlayerTime(0, 3, null, 2)).toBe(true);
	});
});
