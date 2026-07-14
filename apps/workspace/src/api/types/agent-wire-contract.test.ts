import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import type { AgentMessageRequest, AgentReference } from "./agent";

// Wire-contract pin between the hand-written TS mirrors in this file's module
// and the Go DTOs in services/server/internal/service/agent. The fixture is
// the single source of truth for the field sets:
// - this test proves the TS types match the fixture (compile-time keyof
//   exhaustiveness + runtime key comparison);
// - services/server/internal/service/agent/wire_contract_test.go proves the Go
//   structs match the same fixture (DisallowUnknownFields + json-tag
//   reflection).
// Adding or renaming a wire field therefore fails one side's test until the
// fixture and both mirrors are updated together.

// Vitest runs with the app root as cwd; import.meta.url is not a file: URL
// under the jsdom transform, so resolve the fixture from cwd instead.
const fixture = JSON.parse(
	readFileSync(join(process.cwd(), "src/api/types/__fixtures__/agent-wire-contract.json"), "utf8"),
) as {
	messageRequest: Record<string, unknown>;
	reference: Record<string, unknown>;
	chatMessage: Record<string, unknown>;
};

const MESSAGE_REQUEST_KEYS = [
	"sessionId",
	"projectId",
	"prompt",
	"displayPrompt",
	"displayMetadata",
	"anchorText",
	"commentId",
	"comments",
	"document",
	"documents",
	"references",
	"selectionText",
	"model",
	"reasoning",
	"permission",
] as const satisfies readonly (keyof AgentMessageRequest)[];

const REFERENCE_KEYS = [
	"kind",
	"documentId",
	"assetId",
	"assetKind",
	"blockId",
	"mimeType",
	"title",
	"category",
	"url",
] as const satisfies readonly (keyof AgentReference)[];

const CHAT_MESSAGE_KEYS = [
	"id",
	"itemId",
	"turnId",
	"role",
	"content",
	"kind",
	"phase",
	"title",
	"createdAt",
	"status",
	"metadata",
] as const satisfies readonly (keyof AgentMessage)[];

// Compile-time completeness: if a TS type gains a field that is not listed
// above (and therefore not in the fixture), Exclude<> is non-never and these
// calls stop compiling.
const assertNoUnlistedKeys = <T extends never>(..._missing: T[]) => {};
assertNoUnlistedKeys<Exclude<keyof AgentMessageRequest, (typeof MESSAGE_REQUEST_KEYS)[number]>>();
assertNoUnlistedKeys<Exclude<keyof AgentReference, (typeof REFERENCE_KEYS)[number]>>();
assertNoUnlistedKeys<Exclude<keyof AgentMessage, (typeof CHAT_MESSAGE_KEYS)[number]>>();

describe("agent wire contract", () => {
	it("pins AgentMessageRequest fields to the shared fixture", () => {
		expect(Object.keys(fixture.messageRequest).sort()).toEqual([...MESSAGE_REQUEST_KEYS].sort());
	});

	it("pins AgentReference fields to the shared fixture", () => {
		expect(Object.keys(fixture.reference).sort()).toEqual([...REFERENCE_KEYS].sort());
	});

	it("pins the chat message record fields to the shared fixture", () => {
		expect(Object.keys(fixture.chatMessage).sort()).toEqual([...CHAT_MESSAGE_KEYS].sort());
	});
});
