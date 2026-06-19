package capability

// Category groups atomic capabilities for the studio toolbox and billing rollups.
type Category string

const (
	// CategoryGeneration contains media and text generation capabilities.
	CategoryGeneration Category = "generation"
	// CategoryUnderstanding contains analysis and semantic extraction capabilities.
	CategoryUnderstanding Category = "understanding"
	// CategoryProcessing contains deterministic media and text processing capabilities.
	CategoryProcessing Category = "processing"
)

// Status reports whether a capability is exposed or usable in this build.
type Status string

const (
	// StatusAvailable marks a capability that can be shown to users now.
	StatusAvailable Status = "available"
	// StatusPlanned marks a capability that is visible but not yet implemented.
	StatusPlanned Status = "planned"
	// StatusHidden marks a capability that should not be rendered by default.
	StatusHidden Status = "hidden"
)

// IOKind names the media or data shape a capability consumes or produces.
type IOKind string

const (
	// IOKindText is plain text.
	IOKindText IOKind = "text"
	// IOKindImage is still imagery.
	IOKindImage IOKind = "image"
	// IOKindAudio is audio media.
	IOKindAudio IOKind = "audio"
	// IOKindVideo is video media.
	IOKindVideo IOKind = "video"
	// IOKindFile is a generic file.
	IOKindFile IOKind = "file"
	// IOKindNovel is long-form narrative text.
	IOKindNovel IOKind = "novel"
	// IOKindIndex is a structured semantic index.
	IOKindIndex IOKind = "index"
)

// AtomicCapability is one user-facing atomic capability rendered as a studio card.
type AtomicCapability struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	Kind          string   `json:"kind,omitempty"`
	Category      Category `json:"category"`
	Inputs        []IOKind `json:"inputs"`
	Outputs       []IOKind `json:"outputs"`
	RelatedRoutes []string `json:"relatedRoutes"`
	Status        Status   `json:"status"`
	Icon          string   `json:"icon"`
	Surface       string   `json:"surface"`
}

// Registry is the read contract over atomic capabilities.
type Registry interface {
	List() []AtomicCapability
	Get(id string) (AtomicCapability, bool)
	Filter(f Filter) []AtomicCapability
}

// Filter narrows List by optional fields. The zero value does not constrain results.
type Filter struct {
	Category Category
	Status   Status
	Kind     string
}
