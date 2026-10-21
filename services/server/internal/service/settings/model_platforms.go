package settings

import (
	"context"
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
	// ModelPlatformJimeng is the local Dreamina/Jimeng CLI platform.
	ModelPlatformJimeng = generation.ProviderJimeng
	// ModelPlatformLibTV is the local LibTV CLI platform.
	ModelPlatformLibTV = generation.ProviderLibTV
	// ModelPlatformXiaoyunque is the local Pippit / Xiaoyunque CLI platform.
	ModelPlatformXiaoyunque = generation.ProviderXiaoyunque
)

// ModelPlatform describes one aggregation platform exposed by this build.
type ModelPlatform struct {
	ID               string                    `json:"id"`
	Label            string                    `json:"label"`
	Kind             string                    `json:"kind"`
	Description      string                    `json:"description"`
	APIKeyProviderID string                    `json:"apiKeyProviderId"`
	ModelGroups      []ModelPlatformModelGroup `json:"modelGroups,omitempty"`
}

// ModelPlatformModelGroup describes models under one upstream vendor.
type ModelPlatformModelGroup struct {
	Label  string   `json:"label"`
	Models []string `json:"models"`
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
	return []string{ModelPlatformOpenRouter}
}

func modelPlatformSpecs() []modelPlatformSpec {
	return []modelPlatformSpec{

		{
			ID:               ModelPlatformOpenRouter,
			Label:            "OpenRouter",
			Kind:             "custom",
			Description:      "OpenRouter 自定义聚合接口",
			APIKeyProviderID: generation.ProviderOpenRouter,
		},

		{
			ID:               ModelPlatformJimeng,
			Label:            "即梦",
			Kind:             "cli",
			Description:      "即梦 CLI 接入",
			APIKeyProviderID: generation.ProviderJimeng,
		},
		{
			ID:               ModelPlatformLibTV,
			Label:            "LibTV",
			Kind:             "cli",
			Description:      "LibTV CLI 接入",
			APIKeyProviderID: generation.ProviderLibTV,
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

// ParseGenerationCLIProviderIDs parses the packaged generation CLI list.
func ParseGenerationCLIProviderIDs(value string) ([]string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if strings.EqualFold(value, "none") {
		return []string{}, nil
	}

	ids, err := normalizeGenerationCLIProviderIDs(strings.Split(value, ","), true)
	if err != nil {
		return nil, err
	}
	return ids, nil
}

// SetModelPlatforms configures which aggregation platforms this build exposes.
func (service *Settings) SetModelPlatforms(ids []string) {
	if service == nil {
		return
	}
	service.modelPlatformIDs = normalizeModelPlatformIDs(ids)
	service.modelPlatformsConfigured = true
}

// SetGenerationCLIs configures which local generation CLIs this build exposes.
func (service *Settings) SetGenerationCLIs(values []string) {
	if service == nil {
		return
	}
	ids, _ := normalizeGenerationCLIProviderIDs(values, false)
	service.generationCLIProviderIDs = ids
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

// GenerationCLIProviderIDs returns the configured local generation CLI provider ids.
func (service *Settings) GenerationCLIProviderIDs() []string {
	if service == nil || service.generationCLIProviderIDs == nil {
		return defaultGenerationCLIProviderIDs()
	}
	result := make([]string, len(service.generationCLIProviderIDs))
	copy(result, service.generationCLIProviderIDs)
	return result
}

// ListModelPlatforms returns enabled aggregation platforms for this build.
func (service *Settings) ListModelPlatforms(_ context.Context) ModelPlatformList {

	ids := append(service.ModelPlatformIDs(), service.GenerationCLIProviderIDs()...)
	platforms := make([]ModelPlatform, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
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

func defaultGenerationCLIProviderIDs() []string {
	return []string{generation.ProviderJimeng}
}

func enabledGenerationCLIProviderSet(ids []string) map[string]bool {
	set := map[string]bool{}
	for _, id := range ids {
		if isGenerationCLIProvider(id) {
			set[id] = true
		}
	}
	return set
}

func isGenerationCLIProvider(id string) bool {
	switch strings.ToLower(strings.TrimSpace(id)) {
	case generation.ProviderJimeng, generation.ProviderLibTV:
		return true
	default:
		return false
	}
}

func normalizeGenerationCLIProviderIDs(values []string, strict bool) ([]string, error) {
	if values == nil {
		return nil, nil
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			id, ok := generationCLIProviderID(part)
			if !ok {
				if strict {
					return nil, fmt.Errorf("unsupported generation CLI %q", part)
				}
				continue
			}
			if id == "" {
				return []string{}, nil
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func generationCLIProviderID(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "none":
		return "", true
	case "dreamina", "jimeng":
		return generation.ProviderJimeng, true
	case "libtv":
		return generation.ProviderLibTV, true
	default:
		return "", false
	}
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

// GenerationProviderEnabled reports whether an aggregation provider is exposed
// by this build's model platform allowlist. Official and local providers are
// unaffected by MODEL_PLATFORM.
func (service *Settings) GenerationProviderEnabled(providerID string) bool {
	if generation.ProviderTypeOf(providerID) == "" {
		return false
	}
	if service == nil || !service.modelPlatformsConfigured {
		return true
	}
	platformID, gated := modelPlatformIDForGenerationProvider(providerID)
	if !gated {
		return true
	}
	return service.modelPlatformEnabled(platformID)
}

func modelPlatformIDForGenerationProvider(providerID string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(providerID)) {
	case generation.ProviderOpenRouter:
		return ModelPlatformOpenRouter, true
	default:
		return "", false
	}
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
