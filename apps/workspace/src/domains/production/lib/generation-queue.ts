/** A queue owns the complete run, including the gap between two requests. */
export class GenerationQueue {
	busy = false;
	cancelled = false;
	cancel() {
		this.cancelled = true;
	}
	async run<T>(items: readonly T[], generate: (item: T) => Promise<boolean>) {
		if (this.busy) return false;
		this.busy = true;
		this.cancelled = false;
		try {
			for (const item of items) {
				if (this.cancelled) return false;
				if (!(await generate(item))) return false;
			}
			return !this.cancelled;
		} finally {
			this.busy = false;
		}
	}
}
