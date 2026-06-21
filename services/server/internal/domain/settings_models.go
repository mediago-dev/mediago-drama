package domain

import "time"

// APIKeyModel is the GORM model for stored API keys.
type APIKeyModel struct {
	KeyName   string `gorm:"column:key_name;primaryKey"`
	APIKey    string `gorm:"column:api_key;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
}

// TableName returns the backing table name.
func (APIKeyModel) TableName() string {
	return "api_keys"
}

// AgentModelProfileModel is the GORM model for global ACP model profiles.
type AgentModelProfileModel struct {
	ID               string   `gorm:"column:id;primaryKey"`
	Name             string   `gorm:"column:name;not null"`
	ProviderID       string   `gorm:"column:provider_id;not null;uniqueIndex:agent_model_profiles_provider_id_idx"`
	ProviderLabel    string   `gorm:"column:provider_label;not null"`
	BaseURL          string   `gorm:"column:base_url;not null"`
	Model            string   `gorm:"column:model;not null"`
	ModelDisplayName string   `gorm:"column:model_display_name;not null"`
	Enabled          bool     `gorm:"column:enabled;not null;default:true"`
	IsDefault        bool     `gorm:"column:is_default;not null;default:false;index"`
	SupportsImages   bool     `gorm:"column:supports_images;not null;default:false"`
	SupportsTools    bool     `gorm:"column:supports_tools;not null;default:true"`
	ContextWindow    int      `gorm:"column:context_window;not null;default:0"`
	MaxOutputTokens  int      `gorm:"column:max_output_tokens;not null;default:0"`
	Temperature      *float64 `gorm:"column:temperature"`
	APIKeyName       string   `gorm:"column:api_key_name;not null"`
	CreatedAt        time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt        time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
}

// TableName returns the backing table name.
func (AgentModelProfileModel) TableName() string {
	return "agent_model_profiles"
}
