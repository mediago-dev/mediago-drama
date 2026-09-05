import { describe, expect, it, vi } from "vitest";
import { GenerationQueue } from "./generation-queue";

describe("paid generation queue", () => {
	it("submits only one request for one item", async () => {
		const generate = vi.fn(async () => true);
		await new GenerationQueue().run(["asset"], generate);
		expect(generate).toHaveBeenCalledTimes(1);
	});
	it("waits for current image and stops future requests on cancellation", async () => {
		const queue = new GenerationQueue();
		let finish!: (value: boolean) => void;
		const generate = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					finish = resolve;
				}),
		);
		const run = queue.run([1, 2, 3], generate);
		expect(generate).toHaveBeenCalledTimes(1);
		queue.cancel();
		expect(queue.busy).toBe(true);
		finish(true);
		expect(await run).toBe(false);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(queue.busy).toBe(false);
		const retry = vi.fn(async () => true);
		await queue.run([4], retry);
		expect(retry).toHaveBeenCalledTimes(1);
	});
	it("rejects a simultaneous queue and never overlaps requests", async () => {
		const queue = new GenerationQueue();
		let finish!: (value: boolean) => void;
		const generate = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<boolean>((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue(true);
		const run = queue.run([1, 2], generate);
		const duplicate = vi.fn(async () => true);
		expect(await queue.run([3], duplicate)).toBe(false);
		expect(duplicate).not.toHaveBeenCalled();
		expect(generate).toHaveBeenCalledTimes(1);
		finish(true);
		await run;
		expect(generate.mock.calls.map((call) => call[0])).toEqual([1, 2]);
	});
	it("stops after failure and releases the run after an exception", async () => {
		const queue = new GenerationQueue();
		const failure = vi.fn(async () => false);
		await queue.run([1, 2], failure);
		expect(failure).toHaveBeenCalledTimes(1);
		await expect(
			queue.run([1, 2], async () => {
				throw new Error("failed");
			}),
		).rejects.toThrow("failed");
		expect(queue.busy).toBe(false);
	});
});
