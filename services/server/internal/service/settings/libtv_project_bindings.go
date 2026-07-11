package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/libtv"
)

const libTVProjectBindingsSettingKey = "generation.libtv.project_bindings.v1"

type libTVProjectBindings struct {
	Bindings map[string]libtv.ProjectBinding `json:"bindings"`
}

// GetLibTVProjectBinding returns the LibTV project bound to one MediaGo project.
func (service *Settings) GetLibTVProjectBinding(ctx context.Context, internalProjectID string) (libtv.ProjectBinding, bool, error) {
	_ = ctx
	internalProjectID = strings.TrimSpace(internalProjectID)
	if service == nil || service.appSettings == nil || internalProjectID == "" {
		return libtv.ProjectBinding{}, false, nil
	}

	stored, err := service.loadLibTVProjectBindings()
	if err != nil {
		return libtv.ProjectBinding{}, false, err
	}
	binding, ok := stored.Bindings[internalProjectID]
	if !ok || strings.TrimSpace(binding.ProjectID) == "" {
		return libtv.ProjectBinding{}, false, nil
	}
	if binding.InternalProjectID == "" {
		binding.InternalProjectID = internalProjectID
	}
	return binding, true, nil
}

// SaveLibTVProjectBinding stores the LibTV project bound to one MediaGo project.
func (service *Settings) SaveLibTVProjectBinding(ctx context.Context, binding libtv.ProjectBinding) error {
	_ = ctx
	if service == nil || service.appSettings == nil {
		return nil
	}
	binding.InternalProjectID = strings.TrimSpace(binding.InternalProjectID)
	binding.InternalProjectName = strings.TrimSpace(binding.InternalProjectName)
	binding.ProjectID = strings.TrimSpace(binding.ProjectID)
	binding.ProjectName = strings.TrimSpace(binding.ProjectName)
	if binding.InternalProjectID == "" || binding.ProjectID == "" {
		return nil
	}

	stored, err := service.loadLibTVProjectBindings()
	if err != nil {
		return err
	}
	if stored.Bindings == nil {
		stored.Bindings = map[string]libtv.ProjectBinding{}
	}
	previous := stored.Bindings[binding.InternalProjectID]
	now := time.Now().UTC().Format(time.RFC3339)
	if binding.CreatedAt == "" {
		binding.CreatedAt = strings.TrimSpace(previous.CreatedAt)
	}
	if binding.CreatedAt == "" {
		binding.CreatedAt = now
	}
	if binding.UpdatedAt == "" {
		binding.UpdatedAt = now
	}
	stored.Bindings[binding.InternalProjectID] = binding

	raw, err := json.Marshal(stored)
	if err != nil {
		return fmt.Errorf("encoding libtv project bindings: %w", err)
	}
	return service.appSettings.SetAppSetting(libTVProjectBindingsSettingKey, string(raw))
}

func (service *Settings) loadLibTVProjectBindings() (libTVProjectBindings, error) {
	value, ok, err := service.appSettings.GetAppSetting(libTVProjectBindingsSettingKey)
	if err != nil {
		return libTVProjectBindings{}, err
	}
	if !ok || strings.TrimSpace(value) == "" {
		return libTVProjectBindings{Bindings: map[string]libtv.ProjectBinding{}}, nil
	}
	var stored libTVProjectBindings
	if err := json.Unmarshal([]byte(value), &stored); err != nil {
		return libTVProjectBindings{}, fmt.Errorf("decoding libtv project bindings: %w", err)
	}
	if stored.Bindings == nil {
		stored.Bindings = map[string]libtv.ProjectBinding{}
	}
	return stored, nil
}
