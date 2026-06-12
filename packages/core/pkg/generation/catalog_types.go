package generation

// RouteStatus describes whether a model route can be executed by this build.
type RouteStatus string

const (
	RouteStatusAvailable RouteStatus = "available"
	RouteStatusPlanned   RouteStatus = "planned"
	RouteStatusGated     RouteStatus = "gated"
)

// ModelCatalog is the full UI-facing model catalog.
type ModelCatalog struct {
	Families  []ModelFamily  `json:"families"`
	Versions  []ModelVersion `json:"versions"`
	Routes    []ModelRoute   `json:"routes"`
	Models    []ModelSpec    `json:"models"`
	Providers []ProviderInfo `json:"providers"`
}

// ModelFamilyGroup groups catalog definitions by model family across providers.
type ModelFamilyGroup struct {
	Family   ModelFamily
	Versions []ModelVersion
	Routes   []ModelRoute
}

// ModelFamily is the high-level product family selected by users first.
type ModelFamily struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Kind        Kind   `json:"kind"`
	Description string `json:"description,omitempty"`
}

// ModelVersion is a concrete model/version inside a family.
type ModelVersion struct {
	ID             string       `json:"id"`
	FamilyID       string       `json:"familyId"`
	Label          string       `json:"label"`
	Kind           Kind         `json:"kind"`
	CanonicalModel string       `json:"canonicalModel"`
	Capabilities   Capabilities `json:"capabilities"`
}

// Capabilities describes model behavior independent of a vendor route.
type Capabilities struct {
	Async                 bool `json:"async"`
	SupportsReferenceURLs bool `json:"supportsReferenceUrls"`
}

// ModelRoute is one concrete provider implementation for a version.
type ModelRoute struct {
	ID                    string      `json:"id"`
	FamilyID              string      `json:"familyId"`
	VersionID             string      `json:"versionId"`
	Label                 string      `json:"label"`
	Kind                  Kind        `json:"kind"`
	Provider              string      `json:"provider"`
	Model                 string      `json:"model"`
	Adapter               string      `json:"adapter"`
	DocURL                string      `json:"docUrl"`
	Async                 bool        `json:"async"`
	SupportsReferenceURLs bool        `json:"supportsReferenceUrls"`
	Status                RouteStatus `json:"status"`
	StatusReason          string      `json:"statusReason,omitempty"`
	AuthKeys              []string    `json:"-"`
	Params                []ParamSpec `json:"params"`
	LegacyModelID         string      `json:"legacyModelId,omitempty"`
	Configured            bool        `json:"configured,omitempty"`
}

// ModelSpec describes one legacy generation model exposed by the core package.
type ModelSpec struct {
	ID                    string      `json:"id"`
	Label                 string      `json:"label"`
	Kind                  Kind        `json:"kind"`
	Provider              string      `json:"provider"`
	Model                 string      `json:"model"`
	Adapter               string      `json:"adapter"`
	DocURL                string      `json:"docUrl"`
	Async                 bool        `json:"async"`
	SupportsReferenceURLs bool        `json:"supportsReferenceUrls"`
	Params                []ParamSpec `json:"params"`
}

// ParamSpec is a UI-friendly schema for model parameters.
type ParamSpec struct {
	Name     string        `json:"name"`
	Label    string        `json:"label"`
	Type     string        `json:"type"`
	Default  any           `json:"default,omitempty"`
	Options  []ParamOption `json:"options,omitempty"`
	Required bool          `json:"required,omitempty"`
	Min      *float64      `json:"min,omitempty"`
	Max      *float64      `json:"max,omitempty"`
	Help     string        `json:"help,omitempty"`
}

// ParamOption is one option for a select-like model parameter.
type ParamOption struct {
	Label string `json:"label"`
	Value string `json:"value"`
}
