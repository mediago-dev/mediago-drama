import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAgentChatState,
	getAgentSessionStatus,
	listAgentSessions,
} from "@/domains/agent/api/agent";
import httpClient from "@/shared/lib/http";
import type { ApiResponse } from "@/types/api";

vi.mock("@/shared/lib/http", () => ({
	default: {
		get: vi.fn(),
	},
}));

describe("agent api", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(Date, "now").mockReturnValue(123456789);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("cache-busts session chat reads for Safari reloads", async () => {
		vi.mocked(httpClient.get).mockResolvedValueOnce(
			apiResponse({
				activity: [],
				messages: [],
				projectId: "project-1",
				sessionId: "session-1",
			}),
		);

		await getAgentChatState("project-1", "session-1");

		expect(httpClient.get).toHaveBeenCalledWith(
			"/projects/project-1/agent/sessions/session-1/chat",
			{ params: { _: "123456789" } },
		);
	});

	it("cache-busts session list and status reads", async () => {
		vi.mocked(httpClient.get)
			.mockResolvedValueOnce(apiResponse({ sessions: [] }))
			.mockResolvedValueOnce(apiResponse({ sessionId: "session-1", running: false }));

		await listAgentSessions("project-1");
		await getAgentSessionStatus("session-1", "project-1");

		expect(httpClient.get).toHaveBeenNthCalledWith(1, "/projects/project-1/agent/sessions", {
			params: { _: "123456789" },
		});
		expect(httpClient.get).toHaveBeenNthCalledWith(
			2,
			"/projects/project-1/agent/sessions/session-1/status",
			{ params: { _: "123456789" } },
		);
	});
});

const apiResponse = <T>(data: T): ApiResponse<T> => ({
	code: 0,
	data,
	message: "ok",
	success: true,
});
