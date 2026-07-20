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
		{
			ID:               ModelPlatformXiaoyunque,
			Label:            "小云雀",
			Kind:             "cli",
			Description:      "小云雀 / Pippit CLI 接入",
			APIKeyProviderID: generation.ProviderXiaoyunque,
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
func (service *Settings) ListModelPlatforms(ctx context.Context) ModelPlatformList {
	if ctx == nil {
		ctx = context.Background()
	}
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
			ModelGroups:      service.modelPlatformModelGroups(ctx, spec.ID),
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
	case generation.ProviderJimeng, generation.ProviderLibTV, generation.ProviderXiaoyunque:
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
	case "pippit", "pippit-tool-cli", "xiaoyunque":
		return generation.ProviderXiaoyunque, true
	default:
		return "", false
	}
}

func (service *Settings) modelPlatformModelGroups(ctx context.Context, platformID string) []ModelPlatformModelGroup {
	if platformID != ModelPlatformMediago {
		return nil
	}
	if service != nil && service.apiKeys != nil {
		apiKey, _, err := service.apiKeys.Get(generation.ProviderMediago)
		if err == nil {
			apiKey = strings.TrimSpace(apiKey)
		}
		if apiKey != "" && service.MediagoBaseURL() != "" {
			models, err := fetchMediagoGatewayModels(ctx, service.MediagoBaseURL(), apiKey)
			if err == nil {
				if groups := modelPlatformGroupsFromGatewayModels(models); len(groups) > 0 {
					return groups
				}
			}
		}
	}
	return catalogModelPlatformGroups(generation.ProviderMediago)
}

func catalogModelPlatformGroups(provider string) []ModelPlatformModelGroup {
	catalog := generation.Catalog()
	versionLabels := map[string]string{}
	for _, version := range catalog.Versions {
		versionLabels[version.ID] = modelPlatformCleanModelLabel(version.Label)
	}

	builder := newModelPlatformGroupBuilder()
	for _, route := range catalog.Routes {
		if route.Provider != provider || route.Status != generation.RouteStatusAvailable {
			continue
		}
		model := firstNonEmpty(versionLabels[route.VersionID], route.Model)
		builder.add(modelPlatformVendorLabel(route.FamilyID, route.Model, route.Label), model)
	}
	return builder.groups()
}

func modelPlatformGroupsFromGatewayModels(models []mediagoGatewayModel) []ModelPlatformModelGroup {
	builder := newModelPlatformGroupBuilder()
	for _, model := range models {
		if !mediagoGatewayModelAvailable(model) {
			continue
		}
		displayName := strings.TrimSpace(firstNonEmpty(model.Name, model.ID, model.CanonicalSlug))
		if displayName == "" {
			continue
		}
		builder.add(modelPlatformGatewayVendorLabel(model), displayName)
	}
	return builder.groups()
}

type modelPlatformGroupBuilder struct {
	groupOrder    []string
	groupsByLabel map[string][]string
	seen          map[string]map[string]bool
}

func newModelPlatformGroupBuilder() *modelPlatformGroupBuilder {
	return &modelPlatformGroupBuilder{
		groupOrder:    []string{},
		groupsByLabel: map[string][]string{},
		seen:          map[string]map[string]bool{},
	}
}

func (builder *modelPlatformGroupBuilder) add(label string, model string) {
	label = strings.TrimSpace(label)
	model = strings.TrimSpace(model)
	if label == "" {
		label = "其他"
	}
	if model == "" {
		return
	}
	if _, ok := builder.groupsByLabel[label]; !ok {
		builder.groupOrder = append(builder.groupOrder, label)
		builder.groupsByLabel[label] = []string{}
		builder.seen[label] = map[string]bool{}
	}
	seenKey := strings.ToLower(model)
	if builder.seen[label][seenKey] {
		return
	}
	builder.seen[label][seenKey] = true
	builder.groupsByLabel[label] = append(builder.groupsByLabel[label], model)
}

func (builder *modelPlatformGroupBuilder) groups() []ModelPlatformModelGroup {
	result := make([]ModelPlatformModelGroup, 0, len(builder.groupOrder))
	for _, label := range builder.groupOrder {
		models := builder.groupsByLabel[label]
		if len(models) == 0 {
			continue
		}
		result = append(result, ModelPlatformModelGroup{
			Label:  label,
			Models: models,
		})
	}
	return result
}

func modelPlatformVendorLabel(familyID string, model string, routeLabel string) string {
	switch strings.ToLower(strings.TrimSpace(familyID)) {
	case "gpt-text", "gpt-image":
		return "OpenAI"
	case "gemini-text", "nano-banana":
		return "Google Gemini"
	case "minimax-text", "minimax-speech":
		return "MiniMax"
	case "deepseek-text":
		return "DeepSeek"
	case "seedream", "seedance":
		return "字节"
	}
	return modelPlatformVendorLabelFromText(model + " " + routeLabel)
}

func modelPlatformGatewayVendorLabel(model mediagoGatewayModel) string {
	return modelPlatformVendorLabelFromText(
		model.ID + " " +
			model.Name + " " +
			model.CanonicalSlug + " " +
			model.Kind + " " +
			strings.Join(model.Tags, " ") + " " +
			strings.Join(model.Categories, " "),
	)
}

func modelPlatformVendorLabelFromText(value string) string {
	text := normalizedModelSearchText(value)
	for _, item := range []struct {
		token string
		label string
	}{
		{token: "minimax", label: "MiniMax"},
		{token: "deepseek", label: "DeepSeek"},
		{token: "gemini", label: "Google Gemini"},
		{token: "google", label: "Google Gemini"},
		{token: "seedream", label: "字节"},
		{token: "seedance", label: "字节"},
		{token: "doubao", label: "字节"},
		{token: "bytedance", label: "字节"},
		{token: "gpt", label: "OpenAI"},
		{token: "openai", label: "OpenAI"},
		{token: "glm", label: "智谱 GLM"},
		{token: "zhipu", label: "智谱 GLM"},
		{token: "qwen", label: "通义千问"},
		{token: "claude", label: "Anthropic"},
		{token: "anthropic", label: "Anthropic"},
		{token: "kimi", label: "Moonshot"},
		{token: "moonshot", label: "Moonshot"},
	} {
		if strings.Contains(text, item.token) {
			return item.label
		}
	}
	return "其他"
}

func modelPlatformCleanModelLabel(label string) string {
	label = strings.TrimSpace(label)
	label = strings.TrimSuffix(label, " Text")
	return strings.TrimSpace(label)
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
	case generation.ProviderMediago:
		return ModelPlatformMediago, true
	case generation.ProviderOpenRouter:
		return ModelPlatformOpenRouter, true
	case generation.ProviderDMX:
		return ModelPlatformDMXAPI, true
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
