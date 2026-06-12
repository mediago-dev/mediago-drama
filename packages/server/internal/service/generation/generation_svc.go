package generation

import "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/dto"

// GenerationModelsResponse returns the generation catalog.
type GenerationModelsResponse = dto.GenerationModelsResponse

// GenerationMessageRequest creates or retries a generation request.
type GenerationMessageRequest = dto.GenerationMessageRequest

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
