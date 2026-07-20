package textcompletion

import (
	"context"
	"fmt"
)

// BackendFunc adapts a function to Backend.
type BackendFunc func(context.Context, Request) (Result, error)

// Complete executes the adapted backend function.
func (fn BackendFunc) Complete(ctx context.Context, request Request) (Result, error) {
	return fn(ctx, request)
}

// AvailabilityFunc reports whether a backend is configured before a request starts.
type AvailabilityFunc func(context.Context, Request) bool

// Service selects between generation-route and Codex text backends.
type Service struct {
	route          Backend
	codex          Backend
	routeAvailable AvailabilityFunc
	codexAvailable AvailabilityFunc
}

// NewService creates a route-first text completion coordinator.
func NewService(route Backend, codex Backend, routeAvailable AvailabilityFunc, codexAvailable AvailabilityFunc) *Service {
	return &Service{
		route:          route,
		codex:          codex,
		routeAvailable: routeAvailable,
		codexAvailable: codexAvailable,
	}
}

// Complete executes the explicitly selected backend or performs availability-only fallback.
func (service *Service) Complete(ctx context.Context, request Request) (Result, error) {
	if service == nil {
		return Result{}, fmt.Errorf("%w: text completion service is nil", ErrUnavailable)
	}
	switch request.Executor {
	case "", ExecutorAuto:
		if service.available(ctx, service.route, service.routeAvailable, request) {
			request.Executor = ExecutorRoute
			return service.route.Complete(ctx, request)
		}
		if service.available(ctx, service.codex, service.codexAvailable, request) {
			request.Executor = ExecutorCodex
			return service.codex.Complete(ctx, request)
		}
		return Result{}, fmt.Errorf("%w: configure a text model or sign in to Codex", ErrUnavailable)
	case ExecutorRoute:
		if service.route == nil {
			return Result{}, fmt.Errorf("%w: generation text backend is not configured", ErrUnavailable)
		}
		return service.route.Complete(ctx, request)
	case ExecutorCodex:
		if service.codex == nil {
			return Result{}, fmt.Errorf("%w: Codex text backend is not configured", ErrUnavailable)
		}
		return service.codex.Complete(ctx, request)
	default:
		return Result{}, fmt.Errorf("unknown text executor %q", request.Executor)
	}
}

func (service *Service) available(ctx context.Context, backend Backend, check AvailabilityFunc, request Request) bool {
	if backend == nil {
		return false
	}
	if check == nil {
		return true
	}
	return check(ctx, request)
}
