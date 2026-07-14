package agent

import "testing"

func TestNormalizeAgentEventSemantics(t *testing.T) {
	tests := []struct {
		name      string
		event     AgentEvent
		wantTurn  string
		wantItem  string
		wantPhase AgentMessagePhase
	}{
		{
			name: "legacy tool uses run and tool call identity",
			event: AgentEvent{
				ID:    "event-tool",
				RunID: "run-1",
				Type:  "agent.acp",
				ACP:   &AgentACPEvent{Kind: "toolCall", ToolCallID: "call-1"},
			},
			wantTurn:  "run-1",
			wantItem:  "call-1",
			wantPhase: AgentMessagePhaseCommentary,
		},
		{
			name: "legacy plan is stable within its turn",
			event: AgentEvent{
				ID:    "event-plan-update",
				RunID: "run-2",
				Type:  "agent.acp",
				ACP:   &AgentACPEvent{Kind: "plan"},
			},
			wantTurn:  "run-2",
			wantItem:  "run-2:plan",
			wantPhase: AgentMessagePhaseCommentary,
		},
		{
			name: "streaming assistant message is commentary",
			event: AgentEvent{
				ID:    "event-delta",
				RunID: "run-3",
				Type:  "agent.message.delta",
			},
			wantTurn:  "run-3",
			wantItem:  "event-delta",
			wantPhase: AgentMessagePhaseCommentary,
		},
		{
			name: "completed assistant message is final answer",
			event: AgentEvent{
				ID:    "event-final",
				RunID: "run-3",
				Type:  "agent.message.completed",
			},
			wantTurn:  "run-3",
			wantItem:  "event-final",
			wantPhase: AgentMessagePhaseFinalAnswer,
		},
		{
			name: "acp message-shaped update remains commentary",
			event: AgentEvent{
				ID:    "event-acp-message",
				RunID: "run-4",
				Type:  "agent.acp",
				ACP:   &AgentACPEvent{Kind: "message"},
			},
			wantTurn:  "run-4",
			wantItem:  "event-acp-message",
			wantPhase: AgentMessagePhaseCommentary,
		},
		{
			name: "explicit semantic fields win over legacy inference",
			event: AgentEvent{
				ID:     "event-explicit",
				RunID:  "legacy-run",
				TurnID: "turn-explicit",
				ItemID: "item-explicit",
				Phase:  AgentMessagePhaseFinalAnswer,
				Type:   "agent.acp",
				ACP:    &AgentACPEvent{Kind: "toolCall", ToolCallID: "call-ignored"},
			},
			wantTurn:  "turn-explicit",
			wantItem:  "item-explicit",
			wantPhase: AgentMessagePhaseFinalAnswer,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := NormalizeAgentEventSemantics(test.event)
			if got.TurnID != test.wantTurn || got.ItemID != test.wantItem || got.Phase != test.wantPhase {
				t.Fatalf("NormalizeAgentEventSemantics() = %#v, want turn=%q item=%q phase=%q", got, test.wantTurn, test.wantItem, test.wantPhase)
			}
		})
	}
}

func TestNormalizeAgentEventForPersistenceAddsSemantics(t *testing.T) {
	event := NormalizeAgentEventForPersistence(AgentEvent{
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.activity",
	})

	if event.ID == "" || event.TurnID != "run-1" || event.ItemID != event.ID {
		t.Fatalf("normalized event = %#v, want persisted semantic identity", event)
	}
	if event.Phase != AgentMessagePhaseCommentary {
		t.Fatalf("phase = %q, want commentary", event.Phase)
	}
}
