package handlers

import (
	"testing"

	service "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"
)

func TestAgentEventMatchesSubscriptionAllowsExternalProjectEvents(t *testing.T) {
	if !agentEventMatchesSubscription(service.AgentEvent{ProjectID: "project-a"}, "session-1", "project-a") {
		t.Fatal("external project event should match a subscriber for the same project")
	}
	if agentEventMatchesSubscription(service.AgentEvent{ProjectID: "project-a"}, "session-1", "project-b") {
		t.Fatal("external project event should not match another project")
	}
	if agentEventMatchesSubscription(service.AgentEvent{SessionID: "session-2", ProjectID: "project-a"}, "session-1", "project-a") {
		t.Fatal("session-scoped event should not match another session")
	}
	if !agentEventMatchesSubscription(service.AgentEvent{Type: service.ProjectBriefUpdatedEventType, SessionID: "session-2", ProjectID: "project-a"}, "session-1", "project-a") {
		t.Fatal("project brief update should match another session in the same project")
	}
	if agentEventMatchesSubscription(service.AgentEvent{Type: service.ProjectBriefUpdatedEventType, SessionID: "session-2", ProjectID: "project-a"}, "session-1", "project-b") {
		t.Fatal("project brief update should not match another project")
	}
}

func TestMaxAgentEventSequenceUsesNewestCursor(t *testing.T) {
	if got := maxAgentEventSequence(parseAgentEventSequence("12"), parseAgentEventSequence("15")); got != 15 {
		t.Fatalf("maxAgentEventSequence = %d, want 15", got)
	}
	if got := maxAgentEventSequence(parseAgentEventSequence("bad"), parseAgentEventSequence("7")); got != 7 {
		t.Fatalf("maxAgentEventSequence with invalid query = %d, want 7", got)
	}
}
