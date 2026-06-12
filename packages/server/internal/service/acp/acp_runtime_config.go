package acp

import (
	"strings"

	acp "github.com/coder/acp-go-sdk"
)

const (
	// AgentRuntimeConfigSourceMode identifies ACP's session mode state source.
	AgentRuntimeConfigSourceMode = "mode"
	// AgentRuntimeConfigSourceOption identifies ACP's config option source.
	AgentRuntimeConfigSourceOption = "configOption"
)

// AgentRuntimeConfigFromACPSession maps ACP session metadata to UI runtime config.
func AgentRuntimeConfigFromACPSession(session acp.NewSessionResponse) AgentRuntimeConfigResponse {
	config := AgentRuntimeConfigResponse{}
	if session.Modes != nil {
		config.Permission = AgentRuntimeModeConfig(*session.Modes)
	}

	for _, option := range session.ConfigOptions {
		if option.Select == nil {
			continue
		}
		selectConfig := AgentRuntimeSelectConfigFromACP(*option.Select)
		if selectConfig == nil {
			continue
		}
		if IsACPModelConfig(*option.Select) {
			if config.Model == nil {
				config.Model = selectConfig
			}
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
