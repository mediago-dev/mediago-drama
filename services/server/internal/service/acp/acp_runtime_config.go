package acp

import (
	"sort"
	"strings"

	acp "github.com/coder/acp-go-sdk"
)

const (
	// AgentRuntimeConfigSourceMode identifies ACP's session mode state source.
	AgentRuntimeConfigSourceMode = "mode"
	// AgentRuntimeConfigSourceOption identifies ACP's config option source.
	AgentRuntimeConfigSourceOption = "configOption"
	// AgentRuntimeConfigSourceOpenCodeThinkingFallback identifies the OpenCode MiniMax effort fallback.
	AgentRuntimeConfigSourceOpenCodeThinkingFallback = "opencodeThinkingFallback"
)

type agentRuntimeModelFilter struct {
	Restrict         bool
	AllowedValues    []string
	AllowedProviders []string
	DiscoveredValues []string
}

// AgentRuntimeConfigFromACPSession maps ACP session metadata to UI runtime config.
func AgentRuntimeConfigFromACPSession(session acp.NewSessionResponse) AgentRuntimeConfigResponse {
	return agentRuntimeConfigFromACPSession(session, agentRuntimeModelFilter{})
}

func agentRuntimeConfigFromACPSession(session acp.NewSessionResponse, filter agentRuntimeModelFilter) AgentRuntimeConfigResponse {
	config := AgentRuntimeConfigResponse{}
	if session.Modes != nil {
		config.Permission = AgentRuntimeModeConfig(*session.Modes)
	}

	for _, option := range session.ConfigOptions {
		if option.Select == nil {
			continue
		}
		if IsACPModelConfig(*option.Select) {
			selectConfig := agentRuntimeModelSelectConfigFromACP(*option.Select, filter)
			if selectConfig == nil {
				continue
			}
			if config.Model == nil {
				config.Model = selectConfig
			}
			continue
		}
		selectConfig := AgentRuntimeSelectConfigFromACP(*option.Select)
		if selectConfig == nil {
			continue
		}
		if IsACPReasoningConfig(*option.Select) {
			if config.Reasoning == nil {
				config.Reasoning = selectConfig
			}
			continue
		}
		if IsACPPermissionConfig(*option.Select) {
			if config.Permission == nil {
				config.Permission = selectConfig
			}
		}
	}
	if config.Reasoning == nil && config.Model != nil && agentRuntimeModelOptionsIncludeOpenCodeThinking(config.Model.Options) {
		config.Reasoning = openCodeThinkingRuntimeConfig()
	}

	return config
}

// AgentRuntimeModeConfig maps ACP session mode state to a permission select config.
func AgentRuntimeModeConfig(modes acp.SessionModeState) *AgentRuntimeSelectConfig {
	options := make([]AgentRuntimeSelectOption, 0, len(modes.AvailableModes))
	for _, mode := range modes.AvailableModes {
		value := strings.TrimSpace(string(mode.Id))
		if value == "" {
			continue
		}
		name := strings.TrimSpace(mode.Name)
		if name == "" {
			name = value
		}
		options = append(options, AgentRuntimeSelectOption{
			Value:       value,
			Name:        name,
			Description: OptionalACPString(mode.Description),
		})
	}
	if len(options) == 0 {
		return nil
	}
	return &AgentRuntimeSelectConfig{
		Name:         "权限",
		Source:       AgentRuntimeConfigSourceMode,
		CurrentValue: strings.TrimSpace(string(modes.CurrentModeId)),
		Options:      options,
	}
}

// AgentRuntimeSelectConfigFromACP maps one ACP select option.
func AgentRuntimeSelectConfigFromACP(option acp.SessionConfigOptionSelect) *AgentRuntimeSelectConfig {
	options := AgentRuntimeSelectOptionsFromACP(option.Options)
	if len(options) == 0 {
		return nil
	}
	return &AgentRuntimeSelectConfig{
		ConfigID:     strings.TrimSpace(string(option.Id)),
		Name:         strings.TrimSpace(option.Name),
		Source:       AgentRuntimeConfigSourceOption,
		CurrentValue: strings.TrimSpace(string(option.CurrentValue)),
		Options:      options,
	}
}

// AgentRuntimeModelSelectConfigFromACP maps one ACP model select and removes non-chat models.
func AgentRuntimeModelSelectConfigFromACP(option acp.SessionConfigOptionSelect) *AgentRuntimeSelectConfig {
	return agentRuntimeModelSelectConfigFromACP(option, agentRuntimeModelFilter{})
}

func agentRuntimeModelSelectConfigFromACP(option acp.SessionConfigOptionSelect, filter agentRuntimeModelFilter) *AgentRuntimeSelectConfig {
	config := AgentRuntimeSelectConfigFromACP(option)
	if config == nil {
		return nil
	}
	config.Options = AgentRuntimeModelOptions(config.Options)
	config.Options = agentRuntimeModelOptionsWithDiscovered(config.Options, filter.DiscoveredValues)
	if filter.Restrict {
		config.Options = agentRuntimeModelOptionsMatching(config.Options, filter.AllowedValues, filter.AllowedProviders)
	}
	config.Options = agentRuntimeModelOptionsOrderedByValues(config.Options, filter.DiscoveredValues)
	if len(config.Options) == 0 {
		return nil
	}
	if !agentRuntimeOptionValueExists(config.Options, config.CurrentValue) {
		config.CurrentValue = config.Options[0].Value
	}
	return config
}

func agentRuntimeModelOptionsOrderedByValues(options []AgentRuntimeSelectOption, values []string) []AgentRuntimeSelectOption {
	if len(options) < 2 || len(values) == 0 {
		return options
	}
	order := make(map[string]int, len(values))
	for index, value := range values {
		key := normalizedAgentRuntimeModelValue(value)
		if key == "" {
			continue
		}
		if _, exists := order[key]; !exists {
			order[key] = index
		}
	}
	result := append([]AgentRuntimeSelectOption(nil), options...)
	sort.SliceStable(result, func(left int, right int) bool {
		leftOrder, leftExists := order[normalizedAgentRuntimeModelValue(result[left].Value)]
		rightOrder, rightExists := order[normalizedAgentRuntimeModelValue(result[right].Value)]
		if leftExists != rightExists {
			return leftExists
		}
		if !leftExists {
			return false
		}
		return leftOrder < rightOrder
	})
	return result
}

func agentRuntimeModelOptionsWithDiscovered(options []AgentRuntimeSelectOption, values []string) []AgentRuntimeSelectOption {
	result := append([]AgentRuntimeSelectOption(nil), options...)
	seen := make(map[string]struct{}, len(result)+len(values))
	for _, option := range result {
		seen[normalizedAgentRuntimeModelValue(option.Value)] = struct{}{}
	}
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := normalizedAgentRuntimeModelValue(value)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		option := AgentRuntimeSelectOption{Value: value, Name: value}
		if len(AgentRuntimeModelOptions([]AgentRuntimeSelectOption{option})) == 0 {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, option)
	}
	return result
}

// AgentRuntimeSelectOptionsFromACP maps ACP select choices.
func AgentRuntimeSelectOptionsFromACP(options acp.SessionConfigSelectOptions) []AgentRuntimeSelectOption {
	values := map[string]struct{}{}
	result := []AgentRuntimeSelectOption{}
	appendOption := func(option acp.SessionConfigSelectOption) {
		value := strings.TrimSpace(string(option.Value))
		if value == "" {
			return
		}
		if _, ok := values[value]; ok {
			return
		}
		values[value] = struct{}{}
		name := strings.TrimSpace(option.Name)
		if name == "" {
			name = value
		}
		result = append(result, AgentRuntimeSelectOption{
			Value:       value,
			Name:        name,
			Description: OptionalACPString(option.Description),
		})
	}

	if options.Ungrouped != nil {
		for _, option := range *options.Ungrouped {
			appendOption(option)
		}
	}
	if options.Grouped != nil {
		for _, group := range *options.Grouped {
			for _, option := range group.Options {
				appendOption(option)
			}
		}
	}

	return result
}

// AgentRuntimeModelOptions filters ACP model choices down to chat-capable model options.
func AgentRuntimeModelOptions(options []AgentRuntimeSelectOption) []AgentRuntimeSelectOption {
	result := make([]AgentRuntimeSelectOption, 0, len(options))
	for _, option := range options {
		if agentRuntimeModelOptionLooksTaskOnly(option) {
			continue
		}
		if agentRuntimeModelOptionLooksMediago(option) && !agentRuntimeModelOptionLooksAgentTextCapable(option) {
			continue
		}
		result = append(result, option)
	}
	return result
}

func agentRuntimeModelOptionsMatching(options []AgentRuntimeSelectOption, allowedValues []string, allowedProviders []string) []AgentRuntimeSelectOption {
	allowedModels := map[string]struct{}{}
	for _, value := range allowedValues {
		key := normalizedAgentRuntimeModelValue(value)
		if key != "" {
			allowedModels[key] = struct{}{}
		}
	}

	if len(allowedModels) > 0 {
		result := make([]AgentRuntimeSelectOption, 0, len(options))
		for _, option := range options {
			if _, ok := allowedModels[normalizedAgentRuntimeModelValue(option.Value)]; ok {
				result = append(result, option)
			}
		}
		if len(result) > 0 {
			return result
		}
	}

	allowedProviderKeys := allowedAgentRuntimeProviderKeys(allowedProviders, allowedValues)
	if len(allowedProviderKeys) == 0 {
		return nil
	}

	result := make([]AgentRuntimeSelectOption, 0, len(options))
	for _, option := range options {
		if agentRuntimeProviderAllowed(agentRuntimeModelProvider(option.Value), allowedProviderKeys) {
			result = append(result, option)
		}
	}
	return result
}

func normalizedAgentRuntimeModelValue(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	provider, model, ok := strings.Cut(value, "/")
	if !ok {
		return strings.ToLower(value)
	}
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	if provider == "" || model == "" {
		return ""
	}
	return strings.ToLower(provider) + "/" + strings.ToLower(model)
}

func allowedAgentRuntimeProviderKeys(allowedProviders []string, allowedValues []string) map[string]struct{} {
	allowed := map[string]struct{}{}
	for _, provider := range allowedProviders {
		addAgentRuntimeProviderAliases(allowed, provider)
	}
	for _, value := range allowedValues {
		provider := agentRuntimeModelProvider(value)
		addAgentRuntimeProviderAliases(allowed, provider)
	}
	return allowed
}

func agentRuntimeProviderAllowed(provider string, allowed map[string]struct{}) bool {
	for _, alias := range agentRuntimeProviderAliases(provider) {
		if _, ok := allowed[normalizedAgentRuntimeProviderKey(alias)]; ok {
			return true
		}
	}
	return false
}

func addAgentRuntimeProviderAliases(allowed map[string]struct{}, provider string) {
	for _, alias := range agentRuntimeProviderAliases(provider) {
		key := normalizedAgentRuntimeProviderKey(alias)
		if key != "" {
			allowed[key] = struct{}{}
		}
	}
}

func agentRuntimeProviderAliases(provider string) []string {
	provider = strings.TrimSpace(provider)
	if provider == "" {
		return nil
	}
	switch normalizedAgentRuntimeProviderKey(provider) {
	case "minimax", "minimaxcn":
		return []string{provider, "minimax", "minimax-cn"}
	case "dmx", "dmxapi":
		return []string{provider, "dmx", "dmxapi"}
	default:
		return []string{provider}
	}
}

func agentRuntimeModelProvider(value string) string {
	provider, _, ok := strings.Cut(strings.TrimSpace(value), "/")
	if !ok {
		return ""
	}
	return strings.TrimSpace(provider)
}

func normalizedAgentRuntimeProviderKey(provider string) string {
	provider = strings.TrimSpace(strings.ToLower(provider))
	if provider == "" {
		return ""
	}
	replacer := strings.NewReplacer("-", "", "_", "", ".", "", " ", "")
	return replacer.Replace(provider)
}

func agentRuntimeModelOptionsIncludeOpenCodeThinking(options []AgentRuntimeSelectOption) bool {
	for _, option := range options {
		if agentRuntimeModelSupportsOpenCodeThinking(option.Value) {
			return true
		}
	}
	return false
}

func agentRuntimeModelSupportsOpenCodeThinking(value string) bool {
	provider, model, ok := strings.Cut(strings.TrimSpace(value), "/")
	if !ok {
		return false
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	model = strings.ToLower(strings.TrimSpace(model))
	switch provider {
	case "minimax", "minimax-cn":
		return strings.Contains(model, "minimax-m3")
	case "mediago":
		return strings.Contains(model, "minimax-m3") || strings.Contains(model, "minimax m3")
	default:
		return false
	}
}

func openCodeThinkingRuntimeConfig() *AgentRuntimeSelectConfig {
	return &AgentRuntimeSelectConfig{
		ConfigID:     "effort",
		Name:         "Effort",
		Source:       AgentRuntimeConfigSourceOpenCodeThinkingFallback,
		CurrentValue: "none",
		Options: []AgentRuntimeSelectOption{
			{Value: "none", Name: "None"},
			{Value: "thinking", Name: "Thinking"},
		},
	}
}

func agentRuntimeModelOptionLooksTaskOnly(option AgentRuntimeSelectOption) bool {
	text := normalizedACPModelOptionText(option.Value, option.Name, option.Description)
	for _, token := range []string{
		"audio",
		"speech",
		"voice",
		"tts",
		"stt",
		"asr",
		"transcribe",
		"transcription",
		"image",
		"video",
		"embedding",
		"rerank",
		"moderation",
		"translate",
		"translation",
		"machine translation",
		"qwen mt",
		"mt plus",
	} {
		if strings.Contains(text, token) {
			return true
		}
	}
	return false
}

func agentRuntimeModelOptionLooksMediago(option AgentRuntimeSelectOption) bool {
	text := normalizedACPModelOptionText(option.Value, option.Name, option.Description)
	return strings.Contains(text, "mediago")
}

func agentRuntimeModelOptionLooksAgentTextCapable(option AgentRuntimeSelectOption) bool {
	text := normalizedACPModelOptionText(option.Value, option.Name, option.Description)
	for _, token := range []string{
		"chat",
		"agent",
		"planner",
		"reasoning",
		"coding",
		"writing",
		"long context",
		"documents",
		"fast",
		"chinese",
		"gpt",
		"glm",
		"gemini",
		"deepseek",
		"kimi",
		"moonshot",
		"minimax",
		"qwen3",
		"claude",
	} {
		if strings.Contains(text, token) {
			return true
		}
	}
	return false
}

func normalizedACPModelOptionText(values ...string) string {
	replacer := strings.NewReplacer(
		"/", " ",
		"-", " ",
		"_", " ",
		".", " ",
		":", " ",
	)
	parts := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(strings.ToLower(replacer.Replace(value)))
		if value != "" {
			parts = append(parts, strings.Join(strings.Fields(value), " "))
		}
	}
	return strings.Join(parts, " ")
}

func agentRuntimeOptionValueExists(options []AgentRuntimeSelectOption, value string) bool {
	value = strings.TrimSpace(value)
	for _, option := range options {
		if strings.TrimSpace(option.Value) == value {
			return true
		}
	}
	return false
}

// IsACPModelConfig reports whether an ACP option selects a model.
func IsACPModelConfig(option acp.SessionConfigOptionSelect) bool {
	return HasACPConfigCategory(option, acp.SessionConfigOptionCategoryModel) ||
		ACPConfigNameContains(option, "model", "模型")
}

// IsACPReasoningConfig reports whether an ACP option selects reasoning effort.
func IsACPReasoningConfig(option acp.SessionConfigOptionSelect) bool {
	return HasACPConfigCategory(option, acp.SessionConfigOptionCategoryThoughtLevel) ||
		ACPConfigNameContains(option, "reasoning", "thought", "thinking", "effort", "推理", "思考")
}

// IsACPPermissionConfig reports whether an ACP option selects permission mode.
func IsACPPermissionConfig(option acp.SessionConfigOptionSelect) bool {
	return HasACPConfigCategory(option, acp.SessionConfigOptionCategoryMode) ||
		ACPConfigNameContains(option, "permission", "permissions", "approval", "approvals", "mode", "sandbox", "access", "权限", "批准")
}

// HasACPConfigCategory reports whether an ACP option has a category.
func HasACPConfigCategory(option acp.SessionConfigOptionSelect, category acp.SessionConfigOptionCategory) bool {
	return option.Category != nil && *option.Category == category
}

// ACPConfigNameContains reports whether an ACP option id/name contains any token.
func ACPConfigNameContains(option acp.SessionConfigOptionSelect, tokens ...string) bool {
	text := strings.ToLower(strings.TrimSpace(string(option.Id) + " " + option.Name))
	for _, token := range tokens {
		if strings.Contains(text, strings.ToLower(token)) {
			return true
		}
	}
	return false
}

// OptionalACPString dereferences and trims an optional ACP string.
func OptionalACPString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
