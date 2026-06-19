package generation

import (
	"encoding/json"
	"errors"
	"strings"
	"sync"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/config"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

// GenerationPreferenceService persists generation preferences.
type GenerationPreferenceService struct {
	mu      sync.RWMutex
	repo    *repository.GenerationPreferenceRepository
	initErr error
}

type generationPreferenceModel = domain.GenerationPreferenceModel

// NewGenerationPreferenceService returns a preference service backed by settings DB.
func NewGenerationPreferenceService(dbPath string) *GenerationPreferenceService {
	if dbPath == "" {
		dbPath = config.DefaultSettingsDBPath()
	}

	service := &GenerationPreferenceService{}
	repos, err := repository.OpenSettingsRepositories(dbPath)
	if err != nil {
		service.initErr = err
		return service
	}

	service.repo = repos.GenerationPreferences
	return service
}

// NewGenerationPreferenceServiceFromRepository returns a preference service backed
// by an already constructed repository.
func NewGenerationPreferenceServiceFromRepository(repo *repository.GenerationPreferenceRepository, initErr error) *GenerationPreferenceService {
	service := &GenerationPreferenceService{
		repo:    repo,
		initErr: initErr,
	}
	if service.initErr == nil && service.repo == nil {
		service.initErr = errors.New("generation preference repository is nil")
	}
	return service
}

// GetPreference returns preferences for one scope, or an empty record.
func (service *GenerationPreferenceService) GetPreference(scopeID string) (GenerationPreferenceRecord, error) {
	if service.initErr != nil {
		return GenerationPreferenceRecord{}, service.initErr
	}

	scopeID = NormalizeGenerationConversationScopeID(scopeID)
	service.mu.RLock()
	model, err := service.repo.GetGenerationPreference(scopeID)
	service.mu.RUnlock()
	if repository.IsRecordNotFound(err) {
		return emptyGenerationPreferenceRecord(scopeID), nil
	}
	if err != nil {
		return GenerationPreferenceRecord{}, err
	}

	return generationPreferenceRecordFromModel(model)
}

// UpsertPreference creates or updates preferences for one scope.
func (service *GenerationPreferenceService) UpsertPreference(request UpdateGenerationPreferenceRequest) (GenerationPreferenceRecord, error) {
	if service.initErr != nil {
		return GenerationPreferenceRecord{}, service.initErr
	}

	record := GenerationPreferenceRecord{
		SessionID:     GenerationSessionIDFromScopeID(request.ScopeID),
		ScopeID:       NormalizeGenerationConversationScopeID(request.ScopeID),
		FamilyIDs:     compactStringMap(request.FamilyIDs),
		RouteIDs:      compactStringMap(request.RouteIDs),
		VersionIDs:    compactStringMap(request.VersionIDs),
		RouteParams:   compactRouteParams(request.RouteParams),
		StylePresetID: strings.TrimSpace(request.StylePresetID),
	}
	now := timestamp.NowRFC3339Nano()
	existing, err := service.GetPreference(record.ScopeID)
	if err != nil {
		return GenerationPreferenceRecord{}, err
	}
	record.CreatedAt = existing.CreatedAt
	if strings.TrimSpace(record.CreatedAt) == "" {
		record.CreatedAt = now
	}
	record.UpdatedAt = now

	familyIDsJSON, err := json.Marshal(record.FamilyIDs)
	if err != nil {
		return GenerationPreferenceRecord{}, err
	}
	routeIDsJSON, err := json.Marshal(record.RouteIDs)
	if err != nil {
		return GenerationPreferenceRecord{}, err
	}
	versionIDsJSON, err := json.Marshal(record.VersionIDs)
	if err != nil {
		return GenerationPreferenceRecord{}, err
	}
	routeParamsJSON, err := json.Marshal(record.RouteParams)
	if err != nil {
		return GenerationPreferenceRecord{}, err
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	err = service.repo.UpsertGenerationPreference(generationPreferenceModel{
		ScopeID:         record.ScopeID,
		FamilyIDsJSON:   string(familyIDsJSON),
		RouteIDsJSON:    string(routeIDsJSON),
		VersionIDsJSON:  string(versionIDsJSON),
		RouteParamsJSON: string(routeParamsJSON),
		StylePresetID:   record.StylePresetID,
		CreatedAt:       record.CreatedAt,
		UpdatedAt:       record.UpdatedAt,
	})
	if err != nil {
		return GenerationPreferenceRecord{}, err
	}

	return record, nil
}

func generationPreferenceRecordFromModel(model generationPreferenceModel) (GenerationPreferenceRecord, error) {
	record := GenerationPreferenceRecord{
		SessionID:     GenerationSessionIDFromScopeID(model.ScopeID),
		ScopeID:       model.ScopeID,
		StylePresetID: model.StylePresetID,
		CreatedAt:     model.CreatedAt,
		UpdatedAt:     model.UpdatedAt,
	}

	if err := decodeGenerationTaskJSON(model.FamilyIDsJSON, &record.FamilyIDs); err != nil {
		return GenerationPreferenceRecord{}, err
	}
	if err := decodeGenerationTaskJSON(model.RouteIDsJSON, &record.RouteIDs); err != nil {
		return GenerationPreferenceRecord{}, err
	}
	if err := decodeGenerationTaskJSON(model.VersionIDsJSON, &record.VersionIDs); err != nil {
		return GenerationPreferenceRecord{}, err
	}
	if err := decodeGenerationTaskJSON(model.RouteParamsJSON, &record.RouteParams); err != nil {
		return GenerationPreferenceRecord{}, err
	}
	record.FamilyIDs = compactStringMap(record.FamilyIDs)
	record.RouteIDs = compactStringMap(record.RouteIDs)
	record.VersionIDs = compactStringMap(record.VersionIDs)
	record.RouteParams = upgradeLegacyRouteParams(compactRouteParams(record.RouteParams))

	return record, nil
}

func emptyGenerationPreferenceRecord(scopeID string) GenerationPreferenceRecord {
	scopeID = NormalizeGenerationConversationScopeID(scopeID)
	return GenerationPreferenceRecord{
		SessionID:   GenerationSessionIDFromScopeID(scopeID),
		ScopeID:     scopeID,
		FamilyIDs:   map[string]string{},
		RouteIDs:    map[string]string{},
		VersionIDs:  map[string]string{},
		RouteParams: map[string]map[string]any{},
	}
}

func compactStringMap(value map[string]string) map[string]string {
	result := map[string]string{}
	for key, item := range value {
		key = strings.TrimSpace(key)
		item = strings.TrimSpace(item)
		if key == "" || item == "" {
			continue
		}
		result[key] = item
	}
	return result
}

func compactRouteParams(value map[string]map[string]any) map[string]map[string]any {
	result := map[string]map[string]any{}
	for routeID, params := range value {
		routeID = strings.TrimSpace(routeID)
		if routeID == "" || len(params) == 0 {
			continue
		}
		result[routeID] = params
	}
	return result
}

func upgradeLegacyRouteParams(value map[string]map[string]any) map[string]map[string]any {
	result := map[string]map[string]any{}
	for routeID, params := range value {
		route, ok := coregeneration.FindRoute(routeID)
		if !ok {
			route, ok = coregeneration.FindRouteByLegacyModelID(routeID)
		}
		if ok {
			upgraded, err := coregeneration.UpgradeLegacyRouteParams(route, params)
			if err == nil {
				result[routeID] = upgraded
				continue
			}
		}
		result[routeID] = cloneRouteParamMap(params)
	}
	return result
}

func cloneRouteParamMap(value map[string]any) map[string]any {
	result := make(map[string]any, len(value))
	for key, item := range value {
		result[key] = item
	}
	return result
}

// GetGenerationPreference returns preferences for HTTP handlers.
func (workflow *GenerationService) GetGenerationPreference(scopeID string) (GenerationPreferenceRecord, error) {
	if workflow.generationPreferences == nil {
		return GenerationPreferenceRecord{}, errors.New("generation preference service is nil")
	}
	return workflow.generationPreferences.GetPreference(scopeID)
}

// UpdateGenerationPreference updates preferences for HTTP handlers.
func (workflow *GenerationService) UpdateGenerationPreference(request UpdateGenerationPreferenceRequest) (GenerationPreferenceRecord, error) {
	if workflow.generationPreferences == nil {
		return GenerationPreferenceRecord{}, errors.New("generation preference service is nil")
	}
	return workflow.generationPreferences.UpsertPreference(request)
}
