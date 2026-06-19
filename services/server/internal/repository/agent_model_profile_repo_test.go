package repository

import (
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func TestAgentModelProfileRepositoryCRUDAndDefault(t *testing.T) {
	repo, err := NewAgentModelProfileRepository(filepath.Join(t.TempDir(), "settings.sqlite"))
	if err != nil {
		t.Fatalf("NewAgentModelProfileRepository returned error: %v", err)
	}

	first := domain.AgentModelProfileModel{
		ID:               "minimax",
		Name:             "MiniMax",
		ProviderID:       "minimax",
		ProviderLabel:    "MiniMax",
		BaseURL:          "https://api.minimaxi.com/v1",
		Model:            "MiniMax-M3",
		ModelDisplayName: "MiniMax M3",
		Enabled:          true,
		IsDefault:        true,
		SupportsTools:    true,
		APIKeyName:       "agent-model:minimax:api-key",
		CreatedAt:        "2026-06-01T00:00:00Z",
		UpdatedAt:        "2026-06-01T00:00:00Z",
	}
	if err := repo.UpsertAgentModelProfile(first); err != nil {
		t.Fatalf("Upsert first returned error: %v", err)
	}
	second := domain.AgentModelProfileModel{
		ID:               "deepseek",
		Name:             "DeepSeek",
		ProviderID:       "deepseek",
		ProviderLabel:    "DeepSeek",
		BaseURL:          "https://api.deepseek.com/v1",
		Model:            "deepseek-chat",
		ModelDisplayName: "DeepSeek Chat",
		Enabled:          true,
		SupportsTools:    true,
		APIKeyName:       "agent-model:deepseek:api-key",
		CreatedAt:        "2026-06-01T00:00:00Z",
		UpdatedAt:        "2026-06-01T00:00:00Z",
	}
	if err := repo.UpsertAgentModelProfile(second); err != nil {
		t.Fatalf("Upsert second returned error: %v", err)
	}
	if err := repo.SetAgentModelProfileDefault("deepseek"); err != nil {
		t.Fatalf("SetAgentModelProfileDefault returned error: %v", err)
	}

	profiles, err := repo.ListAgentModelProfiles()
	if err != nil {
		t.Fatalf("ListAgentModelProfiles returned error: %v", err)
	}
	if len(profiles) != 2 {
		t.Fatalf("profiles = %d, want 2", len(profiles))
	}
	if profiles[0].ID != "deepseek" || !profiles[0].IsDefault {
		t.Fatalf("first profile = %#v, want deepseek default first", profiles[0])
	}

	loaded, err := repo.GetAgentModelProfile("minimax")
	if err != nil {
		t.Fatalf("GetAgentModelProfile returned error: %v", err)
	}
	if loaded.ProviderID != "minimax" || loaded.IsDefault {
		t.Fatalf("loaded profile = %#v, want minimax non-default", loaded)
	}

	deleted, err := repo.DeleteAgentModelProfile("minimax")
	if err != nil {
		t.Fatalf("DeleteAgentModelProfile returned error: %v", err)
	}
	if !deleted {
		t.Fatal("DeleteAgentModelProfile deleted = false, want true")
	}
	deleted, err = repo.DeleteAgentModelProfile("missing")
	if err != nil {
		t.Fatalf("DeleteAgentModelProfile missing returned error: %v", err)
	}
	if deleted {
		t.Fatal("DeleteAgentModelProfile missing deleted = true, want false")
	}
}
