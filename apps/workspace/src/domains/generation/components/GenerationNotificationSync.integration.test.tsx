import { cleanup, render, screen, waitFor } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createGenerationNotificationEventSource,
	getGenerationNotifications,
} from "@/domains/generation/api/generation";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { GenerationNotificationSync } from "./GenerationNotificationSync";

vi.mock("@/domains/generation/api/generation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/generation/api/generation")>();
	return {
		...actual,
		createGenerationNotificationEventSource: vi.fn(),
		getGenerationNotifications: vi.fn(),
	};
});

describe("GenerationNotificationSync with the app SWR provider", () => {
	beforeEach(() => {
		FakeEventSource.instances = [];
		vi.mocked(createGenerationNotificationEventSource).mockImplementation(
			() =>
				new FakeEventSource() as unknown as ReturnType<
					typeof createGenerationNotificationEventSource
				>,
		);
		vi.mocked(getGenerationNotifications).mockResolvedValue({ notifications: [] });
	});

	afterEach(() => {
		cleanup();
		useGenerationNotificationStore.getState().clearNotifications();
		vi.clearAllMocks();
	});

	it("revalidates the bound cache without clearing its current task data", async () => {
		let resolveRefresh: ((value: string) => void) | undefined;
		const fetcher = vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce("current tasks")
			.mockImplementationOnce(
				() =>
					new Promise<string>((resolve) => {
						resolveRefresh = resolve;
					}),
			);

		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<GenerationNotificationSync />
				<TaskCacheProbe fetcher={fetcher} />
			</SWRConfig>,
		);

		await screen.findByText("current tasks");
		await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

		FakeEventSource.instances[0]?.emit("generation.task.started", {
			id: "task-started-generation-1",
			type: "generation.task.started",
			projectId: "project-a",
			createdAt: "2026-07-16T02:36:31Z",
		});

		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		// A pure revalidation keeps stale task data visible until the request settles.
		expect(screen.getByText("current tasks")).toBeInTheDocument();

		resolveRefresh?.("refreshed tasks");
		await screen.findByText("refreshed tasks");
	});
});

const TaskCacheProbe = ({ fetcher }: { fetcher: () => Promise<string> }) => {
	const { data } = useSWR(
		["/generation/tasks", "agent:project-a", "", "image", "project-a"],
		fetcher,
	);
	return <div>{data ?? "loading"}</div>;
};

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	static readonly closed = 2;

	readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
	readyState = 1;
	onopen: ((event: Event) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor() {
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
		this.listeners.get(type)?.delete(listener);
	}

	close() {
		this.readyState = FakeEventSource.closed;
	}

	emit(type: string, payload: unknown) {
		const event = new MessageEvent<string>(type, { data: JSON.stringify(payload) });
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}
