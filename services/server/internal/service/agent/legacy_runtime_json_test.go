package agent

import (
	"encoding/json"
	"testing"
)

func TestLegacyRuntimeEventsRetainToolsButNotUpstreamSessionIdentity(t *testing.T) {
	var event AgentEvent
	if err := json.Unmarshal([]byte(`{"type":"agent.acp","acpSessionId":"legacy-session","message":"user text mentioning acp","acp":{"kind":"toolCall","toolCallId":"tool-1","title":"document"}}`), &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "agent.runtime" || event.Runtime == nil || event.Runtime.ToolCallID != "tool-1" || event.CodexThreadID != "" || event.Message != "user text mentioning acp" {
		t.Fatalf("legacy event = %#v", event)
	}
}
func TestLegacyChatToolMetadataRemainsVisible(t *testing.T) {
	var message AgentChatMessageRecord
	if err := json.Unmarshal([]byte(`{"content":"old answer","metadata":{"acp":{"kind":"plan"}}}`), &message); err != nil {
		t.Fatal(err)
	}
	if _, ok := message.Metadata["runtime"]; !ok {
		t.Fatalf("lost historical metadata: %#v", message)
	}
}
