package textcompletion

import (
	"context"
	"errors"
	"testing"
)

type recordingBackend struct {
	result Result
	err    error
	calls  int
}

func (backend *recordingBackend) Complete(context.Context, Request) (Result, error) {
	backend.calls++
	return backend.result, backend.err
}

func TestServiceSelectsAvailableExecutor(t *testing.T) {
	tests := []struct {
		name           string
		executor       ExecutorType
		routeAvailable bool
		codexAvailable bool
		wantText       string
		wantRouteCalls int
		wantCodexCalls int
		wantError      bool
	}{
		{name: "auto prefers route", executor: ExecutorAuto, routeAvailable: true, codexAvailable: true, wantText: "route", wantRouteCalls: 1},
		{name: "auto falls back to codex", executor: ExecutorAuto, codexAvailable: true, wantText: "codex", wantCodexCalls: 1},
		{name: "explicit route", executor: ExecutorRoute, codexAvailable: true, wantText: "route", wantRouteCalls: 1},
		{name: "explicit codex", executor: ExecutorCodex, routeAvailable: true, wantText: "codex", wantCodexCalls: 1},
		{name: "none available", executor: ExecutorAuto, wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			route := &recordingBackend{result: Result{Text: "route", Executor: ExecutorRoute}}
			codex := &recordingBackend{result: Result{Text: "codex", Executor: ExecutorCodex}}
			service := NewService(
				route,
				codex,
				func(context.Context, Request) bool { return test.routeAvailable },
				func(context.Context, Request) bool { return test.codexAvailable },
			)
			result, err := service.Complete(context.Background(), Request{Prompt: "prompt", Executor: test.executor})
			if test.wantError {
				if !errors.Is(err, ErrUnavailable) {
					t.Fatalf("Complete() error = %v, want ErrUnavailable", err)
				}
			} else if err != nil || result.Text != test.wantText {
				t.Fatalf("Complete() = %#v, %v", result, err)
			}
			if route.calls != test.wantRouteCalls || codex.calls != test.wantCodexCalls {
				t.Fatalf("calls = route:%d codex:%d", route.calls, codex.calls)
			}
		})
	}
}

func TestServiceDoesNotRetryFailedRouteThroughCodex(t *testing.T) {
	route := &recordingBackend{err: errors.New("route failed")}
	codex := &recordingBackend{result: Result{Text: "codex"}}
	service := NewService(
		route,
		codex,
		func(context.Context, Request) bool { return true },
		func(context.Context, Request) bool { return true },
	)
	_, err := service.Complete(context.Background(), Request{Prompt: "prompt"})
	if err == nil || route.calls != 1 || codex.calls != 0 {
		t.Fatalf("Complete() error = %v, calls = route:%d codex:%d", err, route.calls, codex.calls)
	}
}
