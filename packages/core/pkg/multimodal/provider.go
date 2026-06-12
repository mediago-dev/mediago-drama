package multimodal

import "context"

// Provider is implemented by model, video, image, audio, and future adapters.
type Provider interface {
	Name() string
	Generate(ctx context.Context, request GenerateRequest) (GenerateResponse, error)
}

// StreamProvider is implemented by adapters that can emit incremental events.
type StreamProvider interface {
	Provider
	Stream(ctx context.Context, request GenerateRequest) (*StreamReader, error)
}
