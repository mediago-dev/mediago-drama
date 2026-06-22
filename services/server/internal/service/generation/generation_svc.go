package generation

import "github.com/mediago-dev/mediago-drama/services/server/internal/http/dto"

// GenerationModelsResponse returns the generation catalog.
type GenerationModelsResponse = dto.GenerationModelsResponse

// GenerationMessageRequest creates or retries a generation request.
type GenerationMessageRequest = dto.GenerationMessageRequest

// GenerationDocumentContext identifies the source document section for generation.
type GenerationDocumentContext = dto.GenerationDocumentContext

// GenerationVoicePreviewRequest creates a short audio sample for a voice.
type GenerationVoicePreviewRequest = dto.GenerationVoicePreviewRequest

// GenerationVoicePreviewResponse returns a playable audio asset for a voice preview.
type GenerationVoicePreviewResponse = dto.GenerationVoicePreviewResponse

// GenerationVoicePreviewAsset is one built-in local voice preview.
type GenerationVoicePreviewAsset = dto.GenerationVoicePreviewAsset

// ImportGenerationMediaAssetsRequest imports media library assets into generation history.
type ImportGenerationMediaAssetsRequest = dto.ImportGenerationMediaAssetsRequest

// GenerationMessageResponse is returned by generation create/poll/retry calls.
type GenerationMessageResponse = dto.GenerationMessageResponse

// GenerationTextStreamEvent is one server-sent event for text generation.
type GenerationTextStreamEvent = dto.GenerationTextStreamEvent

// GenerationNotificationTarget identifies where a generation notification opens.
type GenerationNotificationTarget = dto.GenerationNotificationTarget

// GenerationNotificationSectionTarget identifies a document section notification target.
type GenerationNotificationSectionTarget = dto.GenerationNotificationSectionTarget

// GenerationNotificationRecord is a persisted generation notification.
type GenerationNotificationRecord = dto.GenerationNotificationRecord

// GenerationNotificationsResponse lists generation notifications.
type GenerationNotificationsResponse = dto.GenerationNotificationsResponse

// GenerationNotificationEvent is one generation notification SSE event.
type GenerationNotificationEvent = dto.GenerationNotificationEvent

// GenerationAsset is a generated asset reference or inline payload.
type GenerationAsset = dto.GenerationAsset

// GenerationUsage contains token usage for generation providers.
type GenerationUsage = dto.GenerationUsage

// GenerationTaskRecord is a persisted generation task.
type GenerationTaskRecord = dto.GenerationTaskRecord

// GenerationTaskAttemptRecord is a stored task attempt.
type GenerationTaskAttemptRecord = dto.GenerationTaskAttemptRecord

// GenerationTasksResponse lists generation tasks.
type GenerationTasksResponse = dto.GenerationTasksResponse

// UpdateGenerationTaskAssetRequest updates user-facing generated asset metadata.
type UpdateGenerationTaskAssetRequest = dto.UpdateGenerationTaskAssetRequest

// UpdateSelectedGenerationAssetRequest selects or unselects one project asset.
type UpdateSelectedGenerationAssetRequest = dto.UpdateSelectedGenerationAssetRequest

// UpdateSelectedGenerationAssetResponse returns the selected asset mutation result.
type UpdateSelectedGenerationAssetResponse = dto.UpdateSelectedGenerationAssetResponse

// SelectedGenerationAssetRecord is one project-selected creative resource.
type SelectedGenerationAssetRecord = dto.SelectedGenerationAssetRecord

// SelectedGenerationAssetsResponse lists project-selected creative resources.
type SelectedGenerationAssetsResponse = dto.SelectedGenerationAssetsResponse

// GenerationPreferenceRecord is a persisted generation preference set.
type GenerationPreferenceRecord = dto.GenerationPreferenceRecord

// UpdateGenerationPreferenceRequest updates generation preferences for a scope.
type UpdateGenerationPreferenceRequest = dto.UpdateGenerationPreferenceRequest

// GenerationConversationRecord is a persisted generation conversation.
type GenerationConversationRecord = dto.GenerationConversationRecord

// GenerationConversationsResponse lists generation conversations.
type GenerationConversationsResponse = dto.GenerationConversationsResponse

// CreateGenerationConversationRequest creates a generation conversation.
type CreateGenerationConversationRequest = dto.CreateGenerationConversationRequest

// GenerationTaskListQuery filters generation tasks.
type GenerationTaskListQuery struct {
	ConversationID string
	Kind           string
	ProjectID      string
	ScopeID        string
	Limit          int
	Offset         int
}
