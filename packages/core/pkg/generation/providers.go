package generation

// ProviderType identifies how a generation provider is integrated.
type ProviderType string

const (
	// ProviderTypeOfficial marks direct first-party provider integrations.
	ProviderTypeOfficial ProviderType = "official"
	// ProviderTypeAggregator marks third-party aggregation providers.
	ProviderTypeAggregator ProviderType = "aggregator"
	// ProviderTypeLocal marks locally bundled command-line providers.
	ProviderTypeLocal ProviderType = "local"
)

// ProviderInfo describes one generation provider exposed by the catalog.
type ProviderInfo struct {
	ID           string       `json:"id"`
	Label        string       `json:"label"`
	ProviderType ProviderType `json:"providerType"`
}

// Providers returns the generation providers known to the catalog.
func Providers() []ProviderInfo {
	labels := credentialLabels()
	providers := []ProviderInfo{
		{ID: ProviderOpenAI, Label: labels[ProviderOpenAI], ProviderType: ProviderTypeOfficial},
		{ID: ProviderGoogle, Label: labels[ProviderGoogle], ProviderType: ProviderTypeOfficial},
		{ID: ProviderVolcengine, Label: labels[ProviderVolcengine], ProviderType: ProviderTypeOfficial},
		{ID: ProviderDMX, Label: labels[ProviderDMX], ProviderType: ProviderTypeAggregator},
		{ID: ProviderOpenRouter, Label: labels[ProviderOpenRouter], ProviderType: ProviderTypeAggregator},
		{ID: ProviderJimeng, Label: labels[ProviderJimeng], ProviderType: ProviderTypeLocal},
	}

	result := make([]ProviderInfo, len(providers))
	copy(result, providers)
	return result
}

// ProviderTypeOf returns the registered provider type for id.
func ProviderTypeOf(id string) ProviderType {
	for _, provider := range Providers() {
		if provider.ID == id {
			return provider.ProviderType
		}
	}
	return ""
}

func credentialLabels() map[string]string {
	labels := map[string]string{}
	for _, spec := range CredentialSpecs() {
		labels[spec.ID] = spec.Label
	}
	return labels
}
