import React from "react";
import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import App from "./App";

vi.mock("swr", () => ({
	default: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

vi.mock("@/api/health", () => ({
	getHealth: vi.fn(() => Promise.resolve({ status: "ok" })),
	healthKey: "/health",
}));

vi.mock("@/api/generation", () => ({
	createGenerationConversation: vi.fn(() => Promise.resolve({ id: "session-1" })),
	defaultGenerationConversationScopeId: "studio",
	generationConversationsKey: "/generation/conversations",
	generationConversationsQueryKey: vi.fn((kind: string) => ["/generation/conversations", kind]),
	generationModelsKey: "/generation/models",
	generationTaskQueryKey: vi.fn((id: string) => ["/generation/tasks", id]),
	getGenerationModels: vi.fn(() => Promise.resolve({ routes: [] })),
	generationTasksKey: "/generation/tasks",
	generationTasksQueryKey: vi.fn((conversationId: string, kind: string) => [
		"/generation/tasks",
		conversationId,
		kind,
	]),
	getGenerationConversations: vi.fn(() => Promise.resolve({ conversations: [] })),
	getGenerationTask: vi.fn(() => Promise.resolve({ assets: [], status: "completed" })),
	getGenerationTasks: vi.fn(() => Promise.resolve({ tasks: [] })),
	sendGenerationMessage: vi.fn(() => Promise.resolve({ assets: [], status: "completed" })),
}));

vi.mock("@/api/settings", () => ({
	apiKeysKey: "/api-keys",
	getAPIKeys: vi.fn(() => Promise.resolve({ providers: [] })),
}));

test("renders without crashing", () => {
	const { baseElement } = render(<App />);
	expect(baseElement).toBeDefined();
});
