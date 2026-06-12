package generation

// CredentialSpec describes one credential slot used by generation routes.
type CredentialSpec struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Description     string `json:"description"`
	CredentialLabel string `json:"credentialLabel,omitempty"`
	Placeholder     string `json:"placeholder,omitempty"`
	Help            string `json:"help,omitempty"`
}

// CredentialSpecs returns the credential slots referenced by the catalog.
func CredentialSpecs() []CredentialSpec {
	specs := []CredentialSpec{
		{
			ID:          ProviderDMX,
			Label:       "DMX",
			Description: "DMX aggregation platform",
		},
		{
			ID:          ProviderOpenRouter,
			Label:       "OpenRouter",
			Description: "OpenRouter multimodal routes",
		},
		{
			ID:          ProviderOpenAI,
			Label:       "OpenAI",
			Description: "OpenAI official image routes",
		},
		{
			ID:          ProviderGoogle,
			Label:       "Google Gemini",
			Description: "Google official image routes",
		},
		{
			ID:          ProviderVolcengine,
			Label:       "Volcengine",
			Description: "Seedream and Seedance official routes",
		},
	}

	result := make([]CredentialSpec, len(specs))
	copy(result, specs)
	return result
}

// FindCredentialSpec returns a credential slot by id.
func FindCredentialSpec(id string) (CredentialSpec, bool) {
	for _, spec := range CredentialSpecs() {
		if spec.ID == id {
			return spec, true
		}
	}

	return CredentialSpec{}, false
}
