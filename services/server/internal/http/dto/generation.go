package dto

import coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"

// GenerationModelsResponse returns the generation catalog.
type GenerationModelsResponse struct {
	Families      []coregeneration.ModelFamily  `json:"families"`
	Versions      []coregeneration.ModelVersion `json:"versions"`
	Routes        []coregeneration.ModelRoute   `json:"routes"`
	Models        []coregeneration.ModelSpec    `json:"models"`
	Providers     []coregeneration.ProviderInfo `json:"providers"`
	VoicePreviews []GenerationVoicePreviewAsset `json:"voicePreviews,omitempty"`
}

// GenerationVoicePreviewAsset is one built-in local voice preview.
type GenerationVoicePreviewAsset struct {
	RouteID  string `json:"routeId"`
	VoiceID  string `json:"voiceId"`
	URL      string `json:"url"`
	MIMEType string `json:"mimeType"`
}

// GenerationMessageRequest creates or retries a generation request.
type GenerationMessageRequest struct {
	Kind               string                               `json:"kind" ts:"Kind"`
	ConversationID     string                               `json:"sessionId,omitempty"`
	ScopeID            string                               `json:"-"`
	ProjectID          string                               `json:"projectId,omitempty"`
	DocumentID         string                               `json:"documentId,omitempty"`
	SectionID          string                               `json:"sectionId,omitempty"`
	DocumentContext    *GenerationDocumentContext           `json:"documentContext,omitempty"`
	CapabilityID       string                               `json:"capabilityId,omitempty"`
	NotificationTarget *GenerationNotificationTarget        `json:"notificationTarget,omitempty"`
	RouteID            string                               `json:"routeId"`
	FamilyID           string                               `json:"familyId,omitempty"`
	VersionID          string                               `json:"versionId,omitempty"`
	Provider           string                               `json:"provider,omitempty"`
	ModelID            string                               `json:"modelId"`
	Model              string                               `json:"model"`
	Prompt             string                               `json:"prompt"`
	AssetTitle         string                               `json:"assetTitle,omitempty"`
	ReferenceURLs      []string                             `json:"referenceUrls"`
	ReferenceAssetIDs  []string                             `json:"referenceAssetIds"`
	ReferenceBindings  []GenerationReferenceBinding         `json:"referenceBindings,omitempty"`
	Params             map[string]any                       `json:"params"`
	PromptOptimization *GenerationPromptOptimizationRequest `json:"promptOptimization,omitempty"`
}

// GenerationReferenceBinding maps a document mention to a concrete reference.
type GenerationReferenceBinding struct {
	Kind       string `json:"kind,omitempty"`
	DocumentID string `json:"documentId,omitempty"`
	BlockID    string `json:"blockId,omitempty"`
	AssetID    string `json:"assetId,omitempty"`
	URL        string `json:"url,omitempty"`
}

// GenerationPromptOptimizationRequest configures server-side prompt optimization before generation.
type GenerationPromptOptimizationRequest struct {
	ConversationID    string         `json:"sessionId,omitempty"`
	ScopeID           string         `json:"scopeId,omitempty"`
	ConversationTitle string         `json:"conversationTitle,omitempty"`
	ProjectID         string         `json:"projectId,omitempty"`
	CapabilityID      string         `json:"capabilityId,omitempty"`
	RouteID           string         `json:"routeId"`
	Model             string         `json:"model,omitempty"`
	ReferenceName     string         `json:"referenceName,omitempty"`
	ReferencePrompt   string         `json:"referencePrompt"`
	Params            map[string]any `json:"params,omitempty"`
}

// GenerationOptimizeAndGenerateResponse returns both persisted steps of an optimized generation.
type GenerationOptimizeAndGenerateResponse struct {
	Optimization    GenerationMessageResponse `json:"optimization"`
	Generation      GenerationMessageResponse `json:"generation"`
	OptimizedPrompt string                    `json:"optimizedPrompt,omitempty"`
}

// GenerationDocumentContext identifies the source document section for generation.
type GenerationDocumentContext struct {
	ProjectID  string `json:"projectId,omitempty"`
	DocumentID string `json:"documentId,omitempty"`
	SectionID  string `json:"sectionId,omitempty"`
}

// GenerationVoicePreviewRequest creates a short audio sample for a voice.
type GenerationVoicePreviewRequest struct {
	RouteID string         `json:"routeId"`
	VoiceID string         `json:"voiceId"`
	Params  map[string]any `json:"params,omitempty"`
}

// GenerationVoicePreviewResponse returns a playable audio asset for a voice preview.
type GenerationVoicePreviewResponse struct {
	Asset GenerationAsset `json:"asset"`
}

// ImportGenerationMediaAssetsRequest creates completed generation history
// records that reference existing media library assets.
type ImportGenerationMediaAssetsRequest struct {
	Kind              string   `json:"kind,omitempty" ts:"Kind"`
	ConversationID    string   `json:"sessionId,omitempty"`
	ScopeID           string   `json:"scopeId,omitempty"`
	ConversationTitle string   `json:"conversationTitle,omitempty"`
	ProjectID         string   `json:"projectId,omitempty"`
	DocumentID        string   `json:"documentId,omitempty"`
	SectionID         string   `json:"sectionId,omitempty"`
	CapabilityID      string   `json:"capabilityId,omitempty"`
	AssetIDs          []string `json:"assetIds"`
	AssetTitle        string   `json:"assetTitle,omitempty"`
	Prompt            string   `json:"prompt,omitempty"`
}

// GenerationMessageResponse is returned by generation create/poll/retry calls.
type GenerationMessageResponse struct {
	ID        string            `json:"id"`
	Role      string            `json:"role"`
	Status    string            `json:"status"`
	Message   string            `json:"message"`
	Text      string            `json:"text,omitempty"`
	Assets    []GenerationAsset `json:"assets"`
	Usage     GenerationUsage   `json:"usage"`
	Error     string            `json:"error,omitempty"`
	ErrorCode string            `json:"errorCode,omitempty"`
	ErrorType string            `json:"errorType,omitempty"`
	Retryable bool              `json:"retryable,omitempty"`
}

// GenerationTextStreamEvent is one server-sent event for text generation.
type GenerationTextStreamEvent struct {
	Type           string                     `json:"type"`
	TaskID         string                     `json:"taskId,omitempty"`
	ConversationID string                     `json:"sessionId,omitempty"`
	Delta          string                     `json:"delta,omitempty"`
	Message        *GenerationMessageResponse `json:"message,omitempty"`
	Status         string                     `json:"status,omitempty"`
	Error          string                     `json:"error,omitempty"`
	Usage          *GenerationUsage           `json:"usage,omitempty"`
}

// GenerationNotificationSectionTarget identifies a document section.
type GenerationNotificationSectionTarget struct {
	BlockID           string `json:"blockId"`
	DocumentID        string `json:"documentId"`
	HeadingLevel      int    `json:"headingLevel"`
	HeadingOccurrence int    `json:"headingOccurrence"`
	HeadingText       string `json:"headingText"`
	Markdown          string `json:"markdown"`
	PlainText         string `json:"plainText"`
	Prompt            string `json:"prompt"`
}

// GenerationNotificationTarget identifies where a generation notification opens.
type GenerationNotificationTarget struct {
	Kind          string                              `json:"kind"`
	ProjectID     string                              `json:"projectId,omitempty"`
	DocumentID    string                              `json:"documentId,omitempty"`
	DocumentTitle string                              `json:"documentTitle,omitempty"`
	Section       GenerationNotificationSectionTarget `json:"section"`
}

// GenerationNotificationRecord is a persisted user-facing generation notification.
type GenerationNotificationRecord struct {
	ID          string                       `json:"id"`
	TaskID      string                       `json:"taskId"`
	TaskKind    string                       `json:"taskKind" ts:"Kind"`
	TaskStatus  string                       `json:"taskStatus"`
	ProjectID   string                       `json:"projectId,omitempty"`
	Title       string                       `json:"title"`
	Description string                       `json:"description"`
	AssetCount  int                          `json:"assetCount"`
	ReadAt      string                       `json:"readAt,omitempty"`
	Target      GenerationNotificationTarget `json:"target"`
	CreatedAt   string                       `json:"createdAt"`
	UpdatedAt   string                       `json:"updatedAt"`
}

// GenerationNotificationsResponse lists generation notifications.
type GenerationNotificationsResponse struct {
	Notifications []GenerationNotificationRecord `json:"notifications"`
}

// GenerationNotificationEvent is one SSE payload for generation notifications.
type GenerationNotificationEvent struct {
	ID           string                       `json:"id"`
	Type         string                       `json:"type"`
	ProjectID    string                       `json:"projectId,omitempty"`
	Notification GenerationNotificationRecord `json:"notification"`
	CreatedAt    string                       `json:"createdAt"`
}

// GenerationAsset is a generated asset reference or inline payload.
type GenerationAsset struct {
	AssetID      string `json:"assetId,omitempty"`
	Kind         string `json:"kind" ts:"Kind"`
	TaskID       string `json:"taskId,omitempty"`
	Title        string `json:"title,omitempty"`
	URL          string `json:"url,omitempty"`
	PosterURL    string `json:"posterUrl,omitempty"`
	Base64       string `json:"base64,omitempty"`
	MIMEType     string `json:"mimeType,omitempty"`
	DownloadPath string `json:"downloadPath,omitempty"`
	SlotIndex    int    `json:"slotIndex"`
	Selected     bool   `json:"selected,omitempty"`
}

// GenerationUsage contains token usage for generation providers.
type GenerationUsage struct {
	InputTokens     int `json:"inputTokens"`
	OutputTokens    int `json:"outputTokens"`
	TotalTokens     int `json:"totalTokens"`
	ReasoningTokens int `json:"reasoningTokens"`
	CachedTokens    int `json:"cachedTokens"`
}

// GenerationTaskRecord is a persisted generation task.
type GenerationTaskRecord struct {
	ID                string                        `json:"id"`
	ProviderTaskID    string                        `json:"providerTaskId,omitempty"`
	ConversationID    string                        `json:"sessionId,omitempty"`
	ProjectID         string                        `json:"projectId,omitempty"`
	DocumentID        string                        `json:"documentId,omitempty"`
	SectionID         string                        `json:"sectionId,omitempty"`
	CapabilityID      string                        `json:"capabilityId,omitempty"`
	Kind              string                        `json:"kind" ts:"Kind"`
	RouteID           string                        `json:"routeId"`
	FamilyID          string                        `json:"familyId"`
	VersionID         string                        `json:"versionId"`
	Provider          string                        `json:"provider"`
	ModelID           string                        `json:"modelId"`
	Model             string                        `json:"model"`
	Prompt            string                        `json:"prompt"`
	ReferenceURLs     []string                      `json:"referenceUrls"`
	ReferenceAssetIDs []string                      `json:"referenceAssetIds"`
	Params            map[string]any                `json:"params"`
	Status            string                        `json:"status"`
	Message           string                        `json:"message"`
	Text              string                        `json:"text,omitempty"`
	Assets            []GenerationAsset             `json:"assets"`
	DeletedAssetSlots []int                         `json:"deletedAssetSlots,omitempty"`
	Usage             GenerationUsage               `json:"usage"`
	Error             string                        `json:"error,omitempty"`
	ErrorCode         string                        `json:"errorCode,omitempty"`
	ErrorType         string                        `json:"errorType,omitempty"`
	Retryable         bool                          `json:"retryable,omitempty"`
	CreatedAt         string                        `json:"createdAt"`
	UpdatedAt         string                        `json:"updatedAt"`
	DurationMS        int64                         `json:"durationMs,omitempty"`
	Attempts          []GenerationTaskAttemptRecord `json:"attempts,omitempty"`
	RetryCount        int                           `json:"retryCount"`
	LastAttemptAt     string                        `json:"lastAttemptAt,omitempty"`
}

// GenerationTaskAttemptRecord is a stored task attempt.
type GenerationTaskAttemptRecord struct {
	ID        string `json:"id"`
	TaskID    string `json:"taskId"`
	Action    string `json:"action"`
	Status    string `json:"status"`
	Message   string `json:"message,omitempty"`
	Error     string `json:"error,omitempty"`
	CreatedAt string `json:"createdAt"`
}

// GenerationTasksResponse lists generation tasks.
type GenerationTasksResponse struct {
	Tasks []GenerationTaskRecord `json:"tasks"`
}

// UpdateGenerationTaskAssetRequest updates user-facing metadata on one generated asset.
type UpdateGenerationTaskAssetRequest struct {
	Selected     *bool   `json:"selected,omitempty"`
	Title        *string `json:"title,omitempty"`
	ResourceType string  `json:"resourceType,omitempty"`
}

// UpdateSelectedGenerationAssetRequest selects or unselects one project asset.
type UpdateSelectedGenerationAssetRequest struct {
	Selected         *bool  `json:"selected,omitempty"`
	ResourceType     string `json:"resourceType,omitempty"`
	ResourceID       string `json:"resourceId,omitempty"`
	ResourceTitle    string `json:"resourceTitle,omitempty"`
	MediaAssetID     string `json:"mediaAssetId,omitempty"`
	Kind             string `json:"kind,omitempty" ts:"Kind"`
	Title            string `json:"title,omitempty"`
	URL              string `json:"url,omitempty"`
	PosterURL        string `json:"posterUrl,omitempty"`
	Base64           string `json:"base64,omitempty"`
	MIMEType         string `json:"mimeType,omitempty"`
	DownloadPath     string `json:"downloadPath,omitempty"`
	SourceType       string `json:"sourceType,omitempty"`
	TaskID           string `json:"taskId,omitempty"`
	AssetIndex       *int   `json:"assetIndex,omitempty"`
	SourceTaskID     string `json:"sourceTaskId,omitempty"`
	SourceAssetIndex *int   `json:"sourceAssetIndex,omitempty"`
	SourceDocumentID string `json:"sourceDocumentId,omitempty"`
	SourceKey        string `json:"sourceKey,omitempty"`
	SortOrder        int    `json:"sortOrder,omitempty"`
}

// UpdateSelectedGenerationAssetResponse returns the selected asset mutation result.
type UpdateSelectedGenerationAssetResponse struct {
	Asset   *SelectedGenerationAssetRecord `json:"asset,omitempty"`
	Deleted bool                           `json:"deleted,omitempty"`
}

// SelectedGenerationAssetRecord is one asset selected into a project's resource overview.
type SelectedGenerationAssetRecord struct {
	ID               string `json:"id"`
	TaskID           string `json:"taskId,omitempty"`
	AssetIndex       int    `json:"assetIndex"`
	ResourceType     string `json:"resourceType"`
	ResourceID       string `json:"resourceId,omitempty"`
	ResourceTitle    string `json:"resourceTitle,omitempty"`
	MediaAssetID     string `json:"mediaAssetId,omitempty"`
	Kind             string `json:"kind" ts:"Kind"`
	Title            string `json:"title,omitempty"`
	URL              string `json:"url,omitempty"`
	PosterURL        string `json:"posterUrl,omitempty"`
	Base64           string `json:"base64,omitempty"`
	MIMEType         string `json:"mimeType,omitempty"`
	DownloadPath     string `json:"downloadPath,omitempty"`
	SourceType       string `json:"sourceType,omitempty"`
	SourceTaskID     string `json:"sourceTaskId,omitempty"`
	SourceAssetIndex int    `json:"sourceAssetIndex,omitempty"`
	SourceDocumentID string `json:"sourceDocumentId,omitempty"`
	SourceKey        string `json:"sourceKey,omitempty"`
	SortOrder        int    `json:"sortOrder,omitempty"`
	CreatedAt        string `json:"createdAt,omitempty"`
	UpdatedAt        string `json:"updatedAt,omitempty"`
}

// SelectedGenerationAssetsResponse lists project-selected creative resources.
type SelectedGenerationAssetsResponse struct {
	Assets []SelectedGenerationAssetRecord `json:"assets"`
}

// StoryboardVideoResourcesResponse groups project video assets by storyboard document and reel.
type StoryboardVideoResourcesResponse struct {
	ProjectID string                         `json:"projectId,omitempty"`
	Groups    []StoryboardVideoDocumentGroup `json:"groups"`
}

// StoryboardVideoDocumentGroup contains all storyboard reels for one storyboard document.
type StoryboardVideoDocumentGroup struct {
	DocumentID    string                `json:"documentId"`
	DocumentTitle string                `json:"documentTitle"`
	Reels         []StoryboardVideoReel `json:"reels"`
}

// StoryboardVideoReel is one storyboard group section with generated video assets.
type StoryboardVideoReel struct {
	ID                string `json:"id"`
	BlockID           string `json:"blockId"`
	SectionID         string `json:"sectionId"`
	Title             string `json:"title"`
	HeadingLevel      int    `json:"headingLevel"`
	HeadingOccurrence int    `json:"headingOccurrence"`
	Markdown          string `json:"markdown"`
	PlainText         string `json:"plainText,omitempty"`
	Prompt            string `json:"prompt,omitempty"`
	CanGenerate       bool   `json:"canGenerate"`
	// GeneratedVideoCount is the number of video files produced by successful generation tasks for
	// this section (historical count, independent of which video is the selected 成片).
	GeneratedVideoCount int                    `json:"generatedVideoCount"`
	Videos              []StoryboardVideoAsset `json:"videos"`
}

// StoryboardVideoAsset is one playable video associated with a storyboard reel.
type StoryboardVideoAsset struct {
	ID           string `json:"id"`
	MIMEType     string `json:"mimeType,omitempty"`
	SectionTitle string `json:"sectionTitle"`
	SourceLabel  string `json:"sourceLabel"`
	Src          string `json:"src"`
	PosterURL    string `json:"posterUrl,omitempty"`
	Title        string `json:"title"`
}

// GenerationPreferenceRecord is a persisted generation preference set.
type GenerationPreferenceRecord struct {
	SessionID     string                    `json:"sessionId"`
	ScopeID       string                    `json:"-"`
	FamilyIDs     map[string]string         `json:"familyIds" ts:"Partial<Record<Kind, string>>"`
	RouteIDs      map[string]string         `json:"routeIds"`
	VersionIDs    map[string]string         `json:"versionIds"`
	RouteParams   map[string]map[string]any `json:"routeParams"`
	StylePresetID string                    `json:"stylePresetId"`
	CreatedAt     string                    `json:"createdAt,omitempty"`
	UpdatedAt     string                    `json:"updatedAt,omitempty"`
}

// UpdateGenerationPreferenceRequest updates generation preferences for a scope.
type UpdateGenerationPreferenceRequest struct {
	ScopeID       string                    `json:"sessionId,omitempty"`
	FamilyIDs     map[string]string         `json:"familyIds" ts:"Partial<Record<Kind, string>>"`
	RouteIDs      map[string]string         `json:"routeIds"`
	VersionIDs    map[string]string         `json:"versionIds"`
	RouteParams   map[string]map[string]any `json:"routeParams"`
	StylePresetID string                    `json:"stylePresetId"`
}

// GenerationConversationRecord is a persisted generation conversation.
type GenerationConversationRecord struct {
	ID           string `json:"sessionId"`
	ScopeID      string `json:"scopeId"`
	Kind         string `json:"kind" ts:"Kind"`
	Title        string `json:"title"`
	Default      bool   `json:"-"`
	TaskCount    int64  `json:"taskCount"`
	LatestPrompt string `json:"latestPrompt,omitempty"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

// GenerationConversationsResponse lists generation conversations.
type GenerationConversationsResponse struct {
	Conversations []GenerationConversationRecord `json:"sessions"`
}

// CreateGenerationConversationRequest creates a generation conversation.
type CreateGenerationConversationRequest struct {
	ID      string `json:"sessionId,omitempty"`
	ScopeID string `json:"scopeId,omitempty"`
	Kind    string `json:"kind" ts:"Kind"`
	Title   string `json:"title"`
}
