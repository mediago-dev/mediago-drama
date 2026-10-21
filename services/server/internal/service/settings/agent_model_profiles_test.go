package settings

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"gorm.io/gorm"
)

type memoryAgentModelProfileStore struct {
	values map[string]domainAgentModelProfile
}

func (store *memoryAgentModelProfileStore) ListAgentModelProfiles() ([]domainAgentModelProfile, error) {
	result := make([]domainAgentModelProfile, 0, len(store.values))
	for _, value := range store.values {
		result = append(result, value)
	}
	return result, nil
}

func (store *memoryAgentModelProfileStore) GetAgentModelProfile(id string) (domainAgentModelProfile, error) {
	value, ok := store.values[strings.TrimSpace(id)]
	if !ok {
		return domainAgentModelProfile{}, gorm.ErrRecordNotFound
	}
	return value, nil
}

func (store *memoryAgentModelProfileStore) UpsertAgentModelProfile(model domainAgentModelProfile) error {
	store.values[model.ID] = model
	return nil
}

func (store *memoryAgentModelProfileStore) DeleteAgentModelProfile(id string) (bool, error) {
	id = strings.TrimSpace(id)
	if _, ok := store.values[id]; !ok {
		return false, nil
	}
	delete(store.values, id)
	return true, nil
}

func (store *memoryAgentModelProfileStore) ClearAgentModelProfileDefaults() error {
	for id, value := range store.values {
		value.IsDefault = false
		store.values[id] = value
	}
	return nil
}

func (store *memoryAgentModelProfileStore) SetAgentModelProfileDefault(id string) error {
	id = strings.TrimSpace(id)
	if _, ok := store.values[id]; !ok {
		return gorm.ErrRecordNotFound
	}
	for profileID, value := range store.values {
		value.IsDefault = profileID == id
		store.values[profileID] = value
	}
	return nil
}

func TestAgentModelProfilesCRUDDefaultAndKeyRedaction(t *testing.T) {
	settings := NewSettingsWithAgentModelProfiles(
		&memoryAPIKeyStore{values: map[string]string{}},
		&memoryAgentModelProfileStore{values: map[string]domainAgentModelProfile{}},
	)
	settings.SetModelPlatforms([]string{ModelPlatformOpenRouter})
	ctx := context.Background()

	templateID := "minimax"
	list, err := settings.CreateAgentModelProfile(ctx, AgentModelProfileMutation{TemplateID: &templateID})
	if err != nil {
		t.Fatalf("CreateAgentModelProfile minimax returned error: %v", err)
	}
	if list.DefaultProfileID != "minimax-cn" {
		t.Fatalf("defaultProfileId = %q, want minimax-cn", list.DefaultProfileID)
	}
	minimax := agentProfileByID(t, list, "minimax-cn")
	if !minimax.IsDefault || !minimax.Enabled || minimax.APIKey.Configured {
		t.Fatalf("minimax profile = %#v, want enabled default without configured key", minimax)
	}
	if minimax.BaseURL != "https://api.minimaxi.com/v1" {
		t.Fatalf("minimax baseURL = %q, want domestic endpoint", minimax.BaseURL)
	}
	if minimax.ProviderID != "minimax-cn" || minimax.ProviderLabel != "MiniMax 国内" {
		t.Fatalf("minimax provider = (%q, %q), want domestic provider", minimax.ProviderID, minimax.ProviderLabel)
	}

	list, err = settings.SetAgentModelProfileAPIKey(ctx, "minimax-cn", "  sk-minimax-secret  ")
	if err != nil {
		t.Fatalf("SetAgentModelProfileAPIKey returned error: %v", err)
	}
	minimax = agentProfileByID(t, list, "minimax-cn")
	if !minimax.APIKey.Configured || minimax.APIKey.Source != "settings" || minimax.APIKey.Masked == "" {
		t.Fatalf("minimax key status = %#v, want redacted configured key", minimax.APIKey)
	}
	if strings.Contains(minimax.APIKey.Masked, "secret") {
		t.Fatalf("masked key %q should not expose the secret suffix", minimax.APIKey.Masked)
	}

	if _, err := settings.CreateAgentModelProfile(ctx, AgentModelProfileMutation{TemplateID: &templateID}); !errors.Is(err, ErrAgentModelConflict) {
		t.Fatalf("duplicate CreateAgentModelProfile error = %v, want ErrAgentModelConflict", err)
	}

	deepseekTemplateID := "deepseek"
	makeDefault := true
	list, err = settings.CreateAgentModelProfile(ctx, AgentModelProfileMutation{TemplateID: &deepseekTemplateID, IsDefault: &makeDefault})
	if err != nil {
		t.Fatalf("CreateAgentModelProfile deepseek returned error: %v", err)
	}
	if list.DefaultProfileID != "deepseek" {
		t.Fatalf("defaultProfileId = %q, want deepseek", list.DefaultProfileID)
	}
	if agentProfileByID(t, list, "minimax-cn").IsDefault {
		t.Fatal("minimax should no longer be default")
	}

	list, err = settings.ClearAgentModelProfileAPIKey(ctx, "minimax-cn")
	if err != nil {
		t.Fatalf("ClearAgentModelProfileAPIKey returned error: %v", err)
	}
	if agentProfileByID(t, list, "minimax-cn").APIKey.Configured {
		t.Fatal("minimax key should be unconfigured after clear")
	}

	list, err = settings.DeleteAgentModelProfile(ctx, "deepseek")
	if err != nil {
		t.Fatalf("DeleteAgentModelProfile default returned error: %v", err)
	}
	if list.DefaultProfileID != "minimax-cn" || !agentProfileByID(t, list, "minimax-cn").IsDefault {
		t.Fatalf("after deleting default response = %#v, want minimax promoted", list)
	}

	list, err = settings.DeleteAgentModelProfile(ctx, "minimax-cn")
	if err != nil {
		t.Fatalf("DeleteAgentModelProfile last returned error: %v", err)
	}
	if list.DefaultProfileID != "" || len(list.Profiles) != 0 {
		t.Fatalf("after deleting last response = %#v, want no default and no profiles", list)
	}
}

func agentProfileByID(t *testing.T, list AgentModelProfilesResponse, id string) AgentModelProfile {
	t.Helper()
	for _, profile := range list.Profiles {
		if profile.ID == id {
			return profile
		}
	}
	t.Fatalf("profile %q not found in %#v", id, list.Profiles)
	return AgentModelProfile{}
}

func assertPrivateDirectory(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat directory %q: %v", path, err)
	}
	if !info.IsDir() {
		t.Fatalf("path %q is not a directory", path)
	}
	if runtime.GOOS == "windows" {
		return
	}
	if got := info.Mode().Perm(); got != 0o700 {
		t.Fatalf("directory %q permissions = %#o, want 0700", path, got)
	}
}

func assertPrivateFile(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat file %q: %v", path, err)
	}
	if !info.Mode().IsRegular() {
		t.Fatalf("path %q is not a regular file", path)
	}
	if runtime.GOOS == "windows" {
		return
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("file %q permissions = %#o, want 0600", path, got)
	}
}

func assertPathWithinDirectory(t *testing.T, directory string, path string) {
	t.Helper()
	relative, err := filepath.Rel(directory, path)
	if err != nil {
		t.Fatalf("resolving %q relative to %q: %v", path, directory, err)
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		t.Fatalf("path %q escapes managed directory %q", path, directory)
	}
}
