import { cleanup, render, waitFor } from "@testing-library/react";
import { mutate as mutateSWR } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationNotification } from "@/domains/generation/api/generation";
import { getGenerationNotifications } from "@/domains/generation/api/generation";
import { showGenerationSuccessSystemNotification } from "@/domains/generation/lib/generation-notifications";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { GenerationNotificationSync } from "./GenerationNotificationSync";

vi.mock("@/domains/generation/api/generation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/generation/api/generation")>();
	return {
		...actual,
		getGenerationNotifications: vi.fn(),
	};
});

vi.mock("@/domains/generation/lib/generation-notifications", () => ({
	showGenerationSuccessSystemNotification: vi.fn(),
}));

vi.mock("swr", async (importOriginal) => {
	const actual = await importOriginal<typeof import("swr")>();
	return {
		...actual,
		mutate: vi.fn(),
	};
});

describe("GenerationNotificationSync", () => {
	beforeEach(() => {
		FakeEventSource.instances = [];
		vi.stubGlobal("EventSource", FakeEventSource);
		vi.mocked(getGenerationNotifications).mockResolvedValue({ notifications: [] });
	});

	afterEach(() => {
		cleanup();
		useGenerationNotificationStore.getState().clearNotifications();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("loads existing notifications once on mount", async () => {
		vi.mocked(getGenerationNotifications).mockResolvedValue({
			notifications: [generationNotification()],
		});

		render(<GenerationNotificationSync />);

		await waitFor(() => {
			expect(useGenerationNotificationStore.getState().notifications).toHaveLength(1);
		});
		expect(useGenerationNotificationStore.getState().notifications[0]).toMatchObject({
			id: "notification-1",
			sourceTaskId: "task-1",
			readAt: null,
		});
		expect(FakeEventSource.instances[0]?.url).toBe("/api/v1/generation/notifications/events");
		expect(showGenerationSuccessSystemNotification).not.toHaveBeenCalled();
	});

	it("adds a completed SSE notification and shows a desktop notification", async () => {
		render(<GenerationNotificationSync />);

		await waitFor(() => {
			expect(FakeEventSource.instances).toHaveLength(1);
		});
		FakeEventSource.instances[0]?.emit("generation.notification.completed", {
			id: "event-1",
			type: "generation.notification.completed",
			projectId: "project-a",
			notification: generationNotification(),
			createdAt: "2026-06-09T00:01:00.000Z",
		});

		await waitFor(() => {
			expect(useGenerationNotificationStore.getState().notifications).toHaveLength(1);
		});
		expect(showGenerationSuccessSystemNotification).toHaveBeenCalledWith(
			expect.objectContaining({ id: "notification-1", sourceTaskId: "task-1" }),
		);
		expect(mutateSWR).toHaveBeenCalledTimes(3);
		expect(cachePredicateAt(0)(["/generation/tasks", "studio", "", "", ""])).toBe(true);
		expect(cachePredicateAt(1)(["/generation/sessions", "studio", "image"])).toBe(true);
		expect(cachePredicateAt(2)(["/media-assets", "project-a"])).toBe(true);
	});
});

const cachePredicateAt = (index: number) => {
	const predicate = vi.mocked(mutateSWR).mock.calls[index]?.[0];
	if (typeof predicate !== "function") throw new Error("missing cache predicate");
	return predicate as (key: unknown) => boolean;
};

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	static readonly closed = 2;

	readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
	readonly url: string;
	readyState = 1;
	onopen: ((event: Event) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(url: string) {
		this.url = url;
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

const generationNotification = (): GenerationNotification => ({
	id: "notification-1",
	taskId: "task-1",
	taskKind: "image",
	taskStatus: "completed",
	projectId: "project-a",
	title: "生成完成",
	description: "第一集 · 画面 已生成图片。",
	assetCount: 1,
	readAt: "",
	target: {
		kind: "document-section",
		projectId: "project-a",
		documentId: "doc-a",
		documentTitle: "第一集",
		section: {
			blockId: "section_visual",
			documentId: "doc-a",
			headingLevel: 2,
			headingOccurrence: 1,
			headingText: "画面",
			markdown: "## 画面",
			plainText: "画面",
			prompt: "生成画面",
		},
	},
	createdAt: "2026-06-09T00:00:00.000Z",
	updatedAt: "2026-06-09T00:00:00.000Z",
});
