package generation

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/runtime"
	configassets "github.com/mediago-dev/mediago-drama/services/server/configs"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

const generationRequestTimeout = 1000 * time.Second

// GenerationService owns generation request orchestration and task persistence.
type GenerationService struct {
	settings                      *settings.Settings
	generationPreferences         *GenerationPreferenceService
	generationNotifications       *GenerationNotificationService
	generationTasks               *GenerationTaskService
	mediaAssets                   *media.MediaAssets
	generationProviderFactory     func(coregeneration.ModelRoute) (coregeneration.Provider, error)
	multimodalTextProviderFactory runtime.MultimodalTextProviderFactory
	voicePreviews                 *VoicePreviewStore
	jimengBinPath                 string
	jimengBinDir                  string
}

type generationModelsResponse = GenerationModelsResponse
type generationMessageRequest = GenerationMessageRequest
type generationMessageResponse = GenerationMessageResponse
type generationTaskRecord = GenerationTaskRecord
type generationTasksResponse = GenerationTasksResponse

// NewGenerationService creates a generation workflow service.
func NewGenerationService(settings *settings.Settings, generationTasks *GenerationTaskService, mediaAssets *media.MediaAssets, generationPreferences ...*GenerationPreferenceService) *GenerationService {
	var preferences *GenerationPreferenceService
	if len(generationPreferences) > 0 {
		preferences = generationPreferences[0]
	}
	return &GenerationService{
		settings:                      settings,
		generationPreferences:         preferences,
		generationTasks:               generationTasks,
		mediaAssets:                   mediaAssets,
		multimodalTextProviderFactory: defaultMultimodalTextProviderFactory,
		voicePreviews:                 NewVoicePreviewStore(configassets.VoicePreviews),
	}
}

// SetJimengCLIPaths configures the local Jimeng CLI lookup paths.
func (workflow *GenerationService) SetJimengCLIPaths(binPath string, binDir string) {
	workflow.jimengBinPath = strings.TrimSpace(binPath)
	workflow.jimengBinDir = strings.TrimSpace(binDir)
}

// SetGenerationNotifications sets the notification service used by generation workflows.
func (workflow *GenerationService) SetGenerationNotifications(notifications *GenerationNotificationService) {
	workflow.generationNotifications = notifications
}

// ListGenerationModels returns the generation model catalog for HTTP handlers.
func (workflow *GenerationService) ListGenerationModels() generationModelsResponse {
	catalog := coregeneration.Catalog()
	for index := range catalog.Routes {
		catalog.Routes[index].Configured = workflow.generationRouteConfigured(catalog.Routes[index])
	}

	return generationModelsResponse{
		Families:      catalog.Families,
		Versions:      catalog.Versions,
		Routes:        catalog.Routes,
		Models:        catalog.Models,
		Providers:     catalog.Providers,
		VoicePreviews: workflow.listVoicePreviewAssets(),
	}
}

// CreateGenerationMessage creates a generation request for HTTP handlers.
func (workflow *GenerationService) CreateGenerationMessage(ctx context.Context, payload generationMessageRequest) (generationMessageResponse, int, error) {
	payload.Kind = strings.TrimSpace(payload.Kind)
	payload.ConversationID = strings.TrimSpace(payload.ConversationID)
	hasScopeFilter := strings.TrimSpace(payload.ScopeID) != ""
	payload.ScopeID = NormalizeGenerationConversationScopeID(payload.ScopeID)
	payload.ProjectID = GenerationProjectIDForRequest(payload.ProjectID, "")
	if payload.ProjectID == "" && payload.NotificationTarget != nil {
		payload.ProjectID = GenerationProjectIDForRequest(payload.NotificationTarget.ProjectID, "")
	}
	payload.Prompt = strings.TrimSpace(payload.Prompt)
	payload.RouteID = strings.TrimSpace(payload.RouteID)
	payload.FamilyID = strings.TrimSpace(payload.FamilyID)
	payload.VersionID = strings.TrimSpace(payload.VersionID)
	payload.Provider = strings.TrimSpace(payload.Provider)
	payload.ModelID = strings.TrimSpace(payload.ModelID)
	payload.Model = strings.TrimSpace(payload.Model)
	payload.ReferenceURLs = CompactStrings(payload.ReferenceURLs)
	payload.ReferenceAssetIDs = CompactStrings(payload.ReferenceAssetIDs)
	if payload.Kind == "" && payload.RouteID == "" && payload.ModelID == "" {
		payload.Kind = string(coregeneration.KindImage)
	}
	payload.Params = NormalizeGenerationParams(payload.Params)
	if payload.Prompt == "" {
		return generationMessageResponse{}, http.StatusBadRequest, fmt.Errorf("缺少 prompt")
	}
	route, err := ResolveGenerationRoute(payload)
	if err != nil {
		return generationMessageResponse{}, http.StatusBadRequest, err
	}
	payload.Kind = string(route.Kind)
	payload.RouteID = route.ID
	payload.FamilyID = route.FamilyID
	payload.VersionID = route.VersionID
	payload.Provider = route.Provider
	if payload.Model == "" {
		payload.Model = route.Model
	}
	if payload.ModelID == "" {
		payload.ModelID = route.LegacyModelID
	}
	if err := workflow.requireGenerationRouteConfigured(route); err != nil {
		return generationMessageResponse{}, http.StatusServiceUnavailable, err
	}
	conversation, status, err := workflow.resolveGenerationConversationWithScopeFilter(payload.ConversationID, payload.ScopeID, payload.Kind, hasScopeFilter)
	if err != nil {
		return generationMessageResponse{}, status, err
	}
	payload.ConversationID = conversation.ID
	if payload.ProjectID == "" {
		payload.ProjectID = GenerationProjectIDFromScopeID(conversation.ScopeID)
	}
	projectID := payload.ProjectID
	workflow.appendStudioUserTranscript(conversation, payload)

	provider, err := workflow.newGenerationProvider(route)
	if err != nil {
		return generationMessageResponse{}, http.StatusServiceUnavailable, err
	}
	referenceURLs, err := workflow.resolveGenerationReferences(route, payload)
	if err != nil {
		return generationMessageResponse{}, http.StatusBadRequest, err
	}

	generationRequest := GenerationRequestFromMessage(payload, route, referenceURLs)
	if ShouldSubmitGenerationInBackground(route) {
		messageResponse := SubmittingGenerationResponse("", coregeneration.Kind(payload.Kind))
		task := GenerationTaskFromMessage(payload, route, messageResponse)
		if err := workflow.generationTasks.Upsert(task); err != nil {
			return generationMessageResponse{}, http.StatusInternalServerError, err
		}
		workflow.trackGenerationNotificationTarget(task, payload.NotificationTarget)
		workflow.syncGenerationNotificationTask(task)
		_ = workflow.generationTasks.RecordAttempt(task.ID, "create", messageResponse.Status, messageResponse.Message, nil)
		go workflow.submitPendingGeneration(context.Background(), task, provider, generationRequest, "create", projectID, payload.ConversationID)
		return messageResponse, http.StatusOK, nil
	}
	if ShouldRunGenerationInBackground(route) {
		messageResponse := SubmittedGenerationResponse("", coregeneration.Kind(payload.Kind))
		task := GenerationTaskFromMessage(payload, route, messageResponse)
		if err := workflow.generationTasks.Upsert(task); err != nil {
			return generationMessageResponse{}, http.StatusInternalServerError, err
		}
		workflow.trackGenerationNotificationTarget(task, payload.NotificationTarget)
		workflow.syncGenerationNotificationTask(task)
		_ = workflow.generationTasks.RecordAttempt(task.ID, "create", messageResponse.Status, messageResponse.Message, nil)
		go workflow.completeSubmittedGeneration(context.Background(), task, provider, generationRequest, "create", projectID, payload.ConversationID)
		return messageResponse, http.StatusOK, nil
	}

	runCtx, cancel := context.WithTimeout(ctx, generationRequestTimeout)
	defer cancel()

	response, err := workflow.generateWithProvider(
		runCtx,
		provider,
		generationRequest,
		generationProviderLogContext{Action: "create"},
	)
	if err != nil {
		messageResponse := FailedGenerationResponse("", err)
		workflow.appendStudioAssistantTranscript(conversation, messageResponse)
		if ShouldPersistGenerationTask(route) {
			task := GenerationTaskFromMessage(payload, route, messageResponse)
			if saveErr := workflow.generationTasks.Upsert(task); saveErr != nil {
				messageResponse.Message = AppendStorageWarning(messageResponse.Message, saveErr)
			} else {
				workflow.trackGenerationNotificationTarget(task, payload.NotificationTarget)
				workflow.syncGenerationNotificationTask(task)
				_ = workflow.generationTasks.RecordAttempt(task.ID, "create", messageResponse.Status, messageResponse.Message, err)
			}
		}
		return messageResponse, http.StatusOK, nil
	}
	response = workflow.cacheGenerationResponseAssetsWithOptions(ctx, response, generationMediaSaveOptions(projectID, payload.ConversationID, payload.SectionID))

	messageResponse := GenerationResponseFromCore(response, payload.Kind)
	if ShouldPersistGenerationTask(route) {
		task := GenerationTaskFromMessage(payload, route, messageResponse)
		if err := workflow.generationTasks.Upsert(task); err != nil {
			messageResponse.Message = AppendStorageWarning(messageResponse.Message, err)
		} else {
			messageResponse.Assets = generationAssetsWithTaskSlots(task.ID, task.Assets)
			workflow.trackGenerationNotificationTarget(task, payload.NotificationTarget)
			workflow.syncGenerationNotificationTask(task)
			_ = workflow.generationTasks.RecordAttempt(task.ID, "create", messageResponse.Status, messageResponse.Message, nil)
		}
	}
	workflow.appendStudioAssistantTranscript(conversation, messageResponse)

	return messageResponse, http.StatusOK, nil
}

func (workflow *GenerationService) trackGenerationNotificationTarget(task GenerationTaskRecord, target *GenerationNotificationTarget) {
	if workflow.generationNotifications == nil || target == nil {
		return
	}
	// Notification persistence must not make generation fail.
	// The task itself remains the source of truth for generated media.
	_ = workflow.generationNotifications.TrackTaskTarget(task, target)
}

func (workflow *GenerationService) syncGenerationNotificationTask(task GenerationTaskRecord) {
	if workflow.generationNotifications == nil {
		return
	}
	workflow.generationNotifications.SyncTask(task)
}
