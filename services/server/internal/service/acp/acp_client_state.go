package acp

import (
	"context"
	"fmt"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

func (client *acpClient) appendMessage(text string) {
	client.mu.Lock()
	defer client.mu.Unlock()
	client.message.WriteString(text)
	client.streamedMessage = true
}

func (client *acpClient) acceptingSessionUpdates() bool {
	client.mu.Lock()
	defer client.mu.Unlock()
	return client.acceptUpdate
}

func (client *acpClient) setAcceptingSessionUpdates(accept bool) {
	client.mu.Lock()
	defer client.mu.Unlock()
	client.acceptUpdate = accept
}

func (client *acpClient) messageText() string {
	client.mu.Lock()
	defer client.mu.Unlock()
	return client.message.String()
}

func (client *acpClient) hasStreamedMessage() bool {
	client.mu.Lock()
	defer client.mu.Unlock()
	return client.streamedMessage
}

func (client *acpClient) resetMessage() {
	client.mu.Lock()
	defer client.mu.Unlock()
	client.message.Reset()
	client.streamedMessage = false
}

// beginPromptMetrics resets the per-prompt counters and timing baselines
// right before a prompt RPC is issued.
func (client *acpClient) beginPromptMetrics() {
	client.mu.Lock()
	defer client.mu.Unlock()
	client.promptStartedAt = time.Now()
	client.firstUpdateLogged = false
	client.updateCount = 0
	client.messageChunkCount = 0
	client.thoughtChunkCount = 0
	client.toolCallCount = 0
	client.toolCallStarts = map[string]time.Time{}
}

// recordUpdateMetrics counts one session update; the returned delay is only
// meaningful when this is the first update since the prompt started.
func (client *acpClient) recordUpdateMetrics(kind string) (firstUpdateDelay time.Duration, isFirst bool) {
	client.mu.Lock()
	defer client.mu.Unlock()
	now := time.Now()
	client.updateCount++
	switch kind {
	case "agent_message_chunk":
		client.messageChunkCount++
	case "agent_thought_chunk":
		client.thoughtChunkCount++
	case "tool_call":
		client.toolCallCount++
	}
	if client.firstUpdateLogged || client.promptStartedAt.IsZero() {
		return 0, false
	}
	client.firstUpdateLogged = true
	return now.Sub(client.promptStartedAt), true
}

func (client *acpClient) markToolCallStarted(toolCallID string) {
	if toolCallID == "" {
		return
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.toolCallStarts == nil {
		client.toolCallStarts = map[string]time.Time{}
	}
	client.toolCallStarts[toolCallID] = time.Now()
}

// takeToolCallDuration returns the elapsed time since the tool call started
// and forgets the start, so each terminal update is timed once.
func (client *acpClient) takeToolCallDuration(toolCallID string) (time.Duration, bool) {
	if toolCallID == "" {
		return 0, false
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	startedAt, ok := client.toolCallStarts[toolCallID]
	if !ok {
		return 0, false
	}
	delete(client.toolCallStarts, toolCallID)
	return time.Since(startedAt), true
}

// promptMetrics returns log attributes summarizing the prompt that just ran.
func (client *acpClient) promptMetrics() []any {
	client.mu.Lock()
	defer client.mu.Unlock()
	return []any{
		"update_count", client.updateCount,
		"message_chunks", client.messageChunkCount,
		"thought_chunks", client.thoughtChunkCount,
		"tool_calls", client.toolCallCount,
	}
}

func (client *acpClient) logAttrs(extra ...any) []any {
	attrs := []any{"session_id", client.sessionID, "run_id", client.runID}
	if client.acpSessionID != "" {
		attrs = append(attrs, "acp_session_id", client.acpSessionID)
	}
	return append(attrs, extra...)
}

func (client *acpClient) CreateTerminal(context.Context, acp.CreateTerminalRequest) (acp.CreateTerminalResponse, error) {
	return acp.CreateTerminalResponse{}, fmt.Errorf("terminal execution is disabled")
}

func (client *acpClient) KillTerminal(context.Context, acp.KillTerminalRequest) (acp.KillTerminalResponse, error) {
	return acp.KillTerminalResponse{}, nil
}

func (client *acpClient) TerminalOutput(context.Context, acp.TerminalOutputRequest) (acp.TerminalOutputResponse, error) {
	return acp.TerminalOutputResponse{Output: "", Truncated: false}, nil
}

func (client *acpClient) ReleaseTerminal(context.Context, acp.ReleaseTerminalRequest) (acp.ReleaseTerminalResponse, error) {
	return acp.ReleaseTerminalResponse{}, nil
}

func (client *acpClient) WaitForTerminalExit(context.Context, acp.WaitForTerminalExitRequest) (acp.WaitForTerminalExitResponse, error) {
	return acp.WaitForTerminalExitResponse{}, nil
}

var _ acp.Client = (*acpClient)(nil)
