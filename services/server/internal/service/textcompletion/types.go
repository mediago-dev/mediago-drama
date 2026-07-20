// Package textcompletion coordinates internal text-only model work.
package textcompletion

import (
	"context"
	"errors"
)

// ExecutorType identifies a text execution backend.
type ExecutorType string

const (
	// ExecutorAuto selects a configured generation route before Codex.
	ExecutorAuto ExecutorType = "auto"
	// ExecutorRoute selects a generation text route.
	ExecutorRoute ExecutorType = "route"
	// ExecutorCodex selects the signed-in Codex runtime.
	ExecutorCodex ExecutorType = "codex"
)

// ErrUnavailable reports that the selected text executor cannot be used.
var ErrUnavailable = errors.New("text executor is unavailable")

// Request describes one internal text completion.
type Request struct {
	Prompt            string
	SystemInstruction string
	Purpose           string
	Executor          ExecutorType
	RouteID           string
	Model             string
	Params            map[string]any
}

// Result contains normalized text execution output.
type Result struct {
	Text     string
	Executor ExecutorType
	Model    string
}

// Backend executes a text-only request.
type Backend interface {
	Complete(context.Context, Request) (Result, error)
}
