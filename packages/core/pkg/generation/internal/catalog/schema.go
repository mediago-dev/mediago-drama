package catalog

// ParamID is a provider-neutral route parameter identifier.
type ParamID string

const (
	ParamAspectRatio       ParamID = "aspectRatio"
	ParamResolution        ParamID = "resolution"
	ParamN                 ParamID = "n"
	ParamQuality           ParamID = "quality"
	ParamOutputFormat      ParamID = "outputFormat"
	ParamModeration        ParamID = "moderation"
	ParamOutputCompression ParamID = "outputCompression"
	ParamBackground        ParamID = "background"
	ParamTemperature       ParamID = "temperature"
	ParamMaxTokens         ParamID = "maxTokens"
)

// ParamOption is one option for a select route parameter.
type ParamOption struct {
	Label string
	Value string
}

// RouteParam narrows one canonical parameter for a provider route.
type RouteParam struct {
	ID      ParamID
	Default any
	Options []ParamOption
	Min     *float64
	Max     *float64
	Help    string
}

// ParamCombo lists allowed combinations for linked route params.
type ParamCombo struct {
	Params  []string
	Allowed [][]string
	Outputs map[string]string
}

// ParamConfig groups route-facing params with provider-native translation data.
type ParamConfig struct {
	CanonicalParams []RouteParam
	Translation     ParamTranslation
	Combos          []ParamCombo
}

// ParamTranslation translates canonical params into provider-native params.
type ParamTranslation struct {
	Moves  []ParamMove
	Joins  []ParamJoin
	Consts []VendorConst
}

// ParamMove maps one canonical param to one provider-native param.
type ParamMove struct {
	From   ParamID
	To     string
	Values map[string]string
}

// ParamJoin combines several canonical params into one provider-native param.
type ParamJoin struct {
	From  []ParamID
	To    string
	Table map[string]string
}

// VendorConst injects a fixed provider-native value for one route.
type VendorConst struct {
	To    string
	Value any
}

// RouteSpec is a provider-owned route declaration consumed by the parent catalog.
type RouteSpec struct {
	ID                    string
	FamilyID              string
	VersionID             string
	Kind                  string
	Label                 string
	Model                 string
	Adapter               string
	DocURL                string
	Async                 bool
	SupportsReferenceURLs bool
	Params                ParamConfig
}

// SelectParam creates a select route parameter.
func SelectParam(id ParamID, defaultValue string, options []ParamOption) RouteParam {
	return RouteParam{
		ID:      id,
		Default: defaultValue,
		Options: options,
	}
}

// NumberParam creates a required number route parameter.
func NumberParam(id ParamID, defaultValue float64, minValue float64, maxValue float64) RouteParam {
	return RouteParam{
		ID:      id,
		Default: defaultValue,
		Min:     &minValue,
		Max:     &maxValue,
	}
}

// OptionalNumberParam creates an optional number route parameter.
func OptionalNumberParam(id ParamID, minValue float64, maxValue float64) RouteParam {
	return RouteParam{
		ID:  id,
		Min: &minValue,
		Max: &maxValue,
	}
}

// WithHelp attaches help text to a route parameter.
func WithHelp(param RouteParam, help string) RouteParam {
	param.Help = help
	return param
}

// ParamConfigFor builds a route parameter config.
func ParamConfigFor(params []RouteParam, translation ParamTranslation) ParamConfig {
	if len(translation.Moves) == 0 && len(translation.Joins) == 0 && len(translation.Consts) == 0 {
		translation = identityTranslation(params)
	}
	return ParamConfig{
		CanonicalParams: params,
		Translation:     translation,
	}
}

// IdentityParamConfig builds a route parameter config with identity translation.
func IdentityParamConfig(params []RouteParam) ParamConfig {
	return ParamConfigFor(params, ParamTranslation{})
}

// WithCombos appends explicit param combination metadata.
func WithCombos(config ParamConfig, combos []ParamCombo) ParamConfig {
	config.Combos = append(config.Combos, combos...)
	return config
}

func identityTranslation(params []RouteParam) ParamTranslation {
	moves := make([]ParamMove, 0, len(params))
	for _, param := range params {
		moves = append(moves, ParamMove{From: param.ID})
	}
	return ParamTranslation{Moves: moves}
}
