package generation

import "context"

// Kind identifies the output media family.
type Kind string

const (
	// KindImage requests generated images.
	KindImage Kind = "image"
	// KindText requests generated text.
	KindText Kind = "text"
	// KindVideo requests generated videos.
	KindVideo Kind = "video"
)

// Asset is one generated media item.
type Asset struct {
	Kind     Kind
	URL      string
	Base64   string
	MIMEType string
	Metadata map[string]any
}

// Request describes a media generation request.
type Request struct {
	Kind           Kind
	RouteID        string
	FamilyID       string
	VersionID      string
	Provider       string
	ModelID        string
	Model          string
	Prompt         string
	ReferenceURLs  []string
	Size           string
	OutputFormat   string
	ResponseFormat string
	Watermark      *bool
	Params         map[string]any
	Options        map[string]any
}

// Response describes generated media or an accepted async task.
type Response struct {
	ID       string
	Status   string
	Model    string
	Text     string
	Assets   []Asset
	Usage    Usage
	Metadata map[string]any
}

// Usage captures provider token accounting.
type Usage struct {
	InputTokens     int
	OutputTokens    int
	TotalTokens     int
	ReasoningTokens int
	CachedTokens    int
}

// Provider can generate media and optionally check async task status.
type Provider interface {
	Name() string
	Generate(ctx context.Context, request Request) (Response, error)
	Get(ctx context.Context, id string) (Response, error)
}
