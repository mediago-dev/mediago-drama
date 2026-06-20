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
// All select config options are preserved (in server-returned order); session
// modes are synthesized into one mode-sourced config appended last.
func AgentRuntimeConfigFromACPSession(session acp.NewSessionResponse) AgentRuntimeConfigResponse {
	config := AgentRuntimeConfigResponse{}
	for _, option := range session.ConfigOptions {
		if option.Select == nil {
			continue
		}
		selectConfig := AgentRuntimeSelectConfigFromACP(*option.Select)
		if selectConfig == nil {
			continue
		}
		config.Options = append(config.Options, *selectConfig)
	}
	if session.Modes != nil {
		if modeConfig := AgentRuntimeModeConfig(*session.Modes); modeConfig != nil {
			config.Options = append(config.Options, *modeConfig)
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
		Category:     string(acp.SessionConfigOptionCategoryMode),
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
		Category:     acpCategoryString(option.Category),
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

// acpCategoryString dereferences an optional ACP config option category.
func acpCategoryString(category *acp.SessionConfigOptionCategory) string {
	if category == nil {
		return ""
	}
	return strings.TrimSpace(string(*category))
}

// OptionalACPString dereferences and trims an optional ACP string.
func OptionalACPString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
