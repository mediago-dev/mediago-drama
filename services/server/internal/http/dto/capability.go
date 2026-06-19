package dto

// CapabilityManifestResponse returns atomic capabilities rendered by the studio.
type CapabilityManifestResponse struct {
	Capabilities []CapabilityRecord `json:"capabilities"`
}

// CapabilityRecord is one user-facing capability in the manifest.
type CapabilityRecord struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	Kind          string   `json:"kind"`
	Category      string   `json:"category"`
	Icon          string   `json:"icon"`
	Surface       string   `json:"surface"`
	Inputs        []string `json:"inputs"`
	Outputs       []string `json:"outputs"`
	RelatedRoutes []string `json:"relatedRoutes"`
	Status        string   `json:"status"`
	Available     bool     `json:"available"`
}
