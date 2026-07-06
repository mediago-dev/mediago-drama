package generation

// RouteStatus describes whether a model route can be executed by this build.
type RouteStatus string

const (
	RouteStatusAvailable RouteStatus = "available"
	RouteStatusPlanned   RouteStatus = "planned"
	RouteStatusGated     RouteStatus = "gated"
)

// ParamMenu describes the deprecated primary/secondary UI placement.
type ParamMenu string

const (
	ParamMenuPrimary   ParamMenu = "primary"
	ParamMenuSecondary ParamMenu = "secondary"
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
	ID                    string            `json:"id"`
	FamilyID              string            `json:"familyId"`
	VersionID             string            `json:"versionId"`
	Label                 string            `json:"label"`
	Kind                  Kind              `json:"kind"`
	Provider              string            `json:"provider"`
	Model                 string            `json:"model"`
	Adapter               string            `json:"adapter"`
	DocURL                string            `json:"docUrl"`
	Async                 bool              `json:"async"`
	SupportsReferenceURLs bool              `json:"supportsReferenceUrls"`
	MaxReferenceURLs      int               `json:"maxReferenceUrls,omitempty"`
	Status                RouteStatus       `json:"status"`
	StatusReason          string            `json:"statusReason,omitempty"`
	AuthKeys              []string          `json:"-"`
	Params                []ParamSpec       `json:"params"`
	ParamGroups           []RouteParamGroup `json:"paramGroups,omitempty"`
	Combos                []ParamCombo      `json:"paramCombos,omitempty"`
	CanonicalParams       []RouteParam      `json:"-"`
	Translation           ParamTranslation  `json:"-"`
	LegacyModelID         string            `json:"legacyModelId,omitempty"`
	Configured            bool              `json:"configured,omitempty"`
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
	Group    string        `json:"group,omitempty"`
	Menu     string        `json:"menu,omitempty"`
	Default  any           `json:"default,omitempty"`
	Options  []ParamOption `json:"options,omitempty"`
	Required bool          `json:"required,omitempty"`
	Min      *float64      `json:"min,omitempty"`
	Max      *float64      `json:"max,omitempty"`
	Help     string        `json:"help,omitempty"`
}

type RouteParamGroup struct {
	ID     string   `json:"id"`
	Label  string   `json:"label"`
	Params []string `json:"params"`
}

// ParamOption is one option for a select-like model parameter.
type ParamOption struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// ParamCombo lists the allowed value combinations of linked route params.
type ParamCombo struct {
	Params  []string          `json:"params"`
	Allowed [][]string        `json:"allowed"`
	Outputs map[string]string `json:"outputs,omitempty"`
}

// CanonicalParamSpec describes the widest allowed shape for one canonical parameter.
type CanonicalParamSpec struct {
	ID      ParamID
	Label   string
	Type    string
	Group   ParamGroupID
	Options []ParamOption
	Min     *float64
	Max     *float64
	Help    string
}

// RouteParam narrows a canonical parameter for one route.
type RouteParam struct {
	ID      ParamID
	Default any
	Options []ParamOption
	Min     *float64
	Max     *float64
	Help    string
}

// RouteParamConfig groups route-facing canonical declarations with vendor translation data.
type RouteParamConfig struct {
	CanonicalParams []RouteParam
	Translation     ParamTranslation
	Combos          []ParamCombo
}

// ParamTranslation translates canonical route params into provider-native params.
type ParamTranslation struct {
	Moves  []ParamMove
	Joins  []ParamJoin
	Consts []VendorConst
}

// ParamMove translates one canonical parameter to one provider parameter.
type ParamMove struct {
	From   ParamID
	To     string
	Values map[string]string
}

// ParamJoin combines multiple canonical parameters into one provider parameter.
type ParamJoin struct {
	From  []ParamID
	To    string
	Table map[string]string
}

// VendorConst injects a provider parameter value for a route.
type VendorConst struct {
	To    string
	Value any
}
