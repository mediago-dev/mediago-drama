package app

import (
	"context"
	"errors"
	"testing"
)

func TestAgentRuntimeConfigInspectorFailsClosedForUnsupportedRunner(t *testing.T) {
	inspect := newAgentRuntimeConfigInspector(&apiHandler{agentRunner: fakeAgentRunner{}})

	_, err := inspect(context.Background(), "project-1")
	if !errors.Is(err, errAgentRuntimeConfigInspectionUnsupported) {
		t.Fatalf("inspect() error = %v, want %v", err, errAgentRuntimeConfigInspectionUnsupported)
	}
}
