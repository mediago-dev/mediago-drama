package agent

import (
	"context"
	"testing"
	"time"
)

func TestAgentRunContextWithoutTimeoutHasNoDeadline(t *testing.T) {
	ctx, cancel := agentRunContext(0)
	defer cancel()

	if deadline, ok := ctx.Deadline(); ok {
		t.Fatalf("Deadline() = %v, true; want no deadline", deadline)
	}

	cancel()
	if err := ctx.Err(); err != context.Canceled {
		t.Fatalf("Err() = %v, want context.Canceled after cancel", err)
	}
}

func TestAgentRunContextWithTimeoutHasDeadline(t *testing.T) {
	ctx, cancel := agentRunContext(time.Minute)
	defer cancel()

	deadline, ok := ctx.Deadline()
	if !ok {
		t.Fatal("Deadline() missing, want timeout deadline")
	}
	if time.Until(deadline) <= 0 {
		t.Fatalf("deadline = %v, want future deadline", deadline)
	}
}
