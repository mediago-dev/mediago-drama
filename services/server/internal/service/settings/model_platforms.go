package settings

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	// ModelPlatformMediago is the first-party unified aggregation platform.
	ModelPlatformMediago = generation.ProviderMediago
	// ModelPlatformOpenRouter is the OpenRouter aggregation platform.
	ModelPlatformOpenRouter = generation.ProviderOpenRouter
	// ModelPlatformDMXAPI is the DMXAPI aggregation platform.
	ModelPlatformDMXAPI = "dmxapi"
)

// ModelPlatform describes one aggregation platform exposed by this build.
type ModelPlatform struct {
	ID               string `json:"id"`
	Label            string `json:"label"`
	Kind             string `json:"kind"`
	Description      string `json:"description"`
	APIKeyProviderID string `json:"apiKeyProviderId"`
}

// ModelPlatformList is the API payload for enabled aggregation platforms.
type ModelPlatformList struct {
	Platforms []ModelPlatform `json:"platforms"`
}

type modelPlatformSpec struct {
	ID               string
	Label            string
	Kind             string
	Description      string
	APIKeyProviderID string
}

func defaultModelPlatformIDs() []string {
	return []string{ModelPlatformMediago}
}

func modelPlatformSpecs() []modelPlatformSpec {
	return []modelPlatformSpec{
		{
			ID:               ModelPlatformMediago,
			Label:            "MediaGo",
			Kind:             "unified",
			Description:      "MediaGo 统一接口",
			APIKeyProviderID: generation.ProviderMediago,
		},
		{
			ID:               ModelPlatformOpenRouter,
			Label:            "OpenRouter",
			Kind:             "custom",
			Description:      "OpenRouter 自定义聚合接口",
			APIKeyProviderID: generation.ProviderOpenRouter,
		},
		{
			ID:               ModelPlatformDMXAPI,
			Label:            "DMXAPI",
			Kind:             "custom",
			Description:      "DMXAPI 自定义聚合接口",
			APIKeyProviderID: generation.ProviderDMX,
		},
	}
}

func modelPlatformSpecByID(id string) (modelPlatformSpec, bool) {
	id = strings.ToLower(strings.TrimSpace(id))
	for _, spec := range modelPlatformSpecs() {
		if spec.ID == id {
			return spec, true
		}
	}
	return modelPlatformSpec{}, false
}

// SetMediagoBaseURL configures the first-party OpenAI-compatible endpoint.
func (service *Settings) SetMediagoBaseURL(baseURL string) {
	if service == nil {
		return
	}
	service.mediagoBaseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
}

// MediagoBaseURL returns the configured first-party OpenAI-compatible endpoint.
func (service *Settings) MediagoBaseURL() string {
	if service == nil {
		return ""
	}
	return strings.TrimRight(strings.TrimSpace(service.mediagoBaseURL), "/")
}

// ParseModelPlatformIDs parses a comma-separated model platform list.
func ParseModelPlatformIDs(value string) ([]string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if strings.EqualFold(value, "none") {
		return []string{}, nil
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, part := range strings.Split(value, ",") {
		id := strings.ToLower(strings.TrimSpace(part))
		if id == "" {
			continue
		}
		if _, ok := modelPlatformSpecByID(id); !ok {
			return nil, fmt.Errorf("unsupported model platform %q", id)
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids, nil
}

// SetModelPlatforms configures which aggregation platforms this build exposes.
func (service *Settings) SetModelPlatforms(ids []string) {
	if service == nil {
		return
	}
	service.modelPlatformIDs = normalizeModelPlatformIDs(ids)
}

// ModelPlatformIDs returns the configured aggregation platform ids.
func (service *Settings) ModelPlatformIDs() []string {
	if service == nil || service.modelPlatformIDs == nil {
		return defaultModelPlatformIDs()
	}
	result := make([]string, len(service.modelPlatformIDs))
	copy(result, service.modelPlatformIDs)
	return result
}

// ListModelPlatforms returns enabled aggregation platforms for this build.
func (service *Settings) ListModelPlatforms() ModelPlatformList {
	ids := service.ModelPlatformIDs()
	platforms := make([]ModelPlatform, 0, len(ids))
	for _, id := range ids {
		spec, ok := modelPlatformSpecByID(id)
		if !ok {
			continue
		}
		platforms = append(platforms, ModelPlatform{
			ID:               spec.ID,
			Label:            spec.Label,
			Kind:             spec.Kind,
			Description:      spec.Description,
			APIKeyProviderID: spec.APIKeyProviderID,
		})
	}
	return ModelPlatformList{Platforms: platforms}
}

func (service *Settings) modelPlatformEnabled(id string) bool {
	id = strings.ToLower(strings.TrimSpace(id))
	if id == "" {
		return false
	}
	for _, enabledID := range service.ModelPlatformIDs() {
		if enabledID == id {
			return true
		}
	}
	return false
}

func normalizeModelPlatformIDs(ids []string) []string {
	if ids == nil {
		return defaultModelPlatformIDs()
	}
	seen := map[string]bool{}
	result := []string{}
	for _, id := range ids {
		id = strings.ToLower(strings.TrimSpace(id))
		if id == "" || seen[id] {
			continue
		}
		if _, ok := modelPlatformSpecByID(id); !ok {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}
