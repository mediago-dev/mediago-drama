package generation

import "context"

// TextStreamEvent is one incremental text generation event.
type TextStreamEvent struct {
	Delta string
	Usage *Usage
	Done  bool
}

// TextStream consumes incremental text generation events.
type TextStream interface {
	Recv() (TextStreamEvent, error)
	Close() error
}

// TextStreamProvider is implemented by generation providers that support
// streaming text output.
type TextStreamProvider interface {
	GenerateTextStream(ctx context.Context, request Request) (TextStream, error)
}
