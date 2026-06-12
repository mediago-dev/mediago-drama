package dto

import coregeneration "github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"

// GenerationModelsResponse returns the generation catalog.
type GenerationModelsResponse struct {
	Families  []coregeneration.ModelFamily  `json:"families"`
	Versions  []coregeneration.ModelVersion `json:"versions"`
	Routes    []coregeneration.ModelRoute   `json:"routes"`
	Models    []coregeneration.ModelSpec    `json:"models"`
	Providers []coregeneration.ProviderInfo `json:"providers"`
}

// GenerationMessageRequest creates or retries a generation request.
type GenerationMessageRequest struct {
	Kind               string                        `json:"kind" ts:"Kind"`
	ConversationID     string                        `json:"sessionId,omitempty"`
	ScopeID            string                        `json:"-"`
	ProjectID          string                        `json:"projectId,omitempty"`
	SectionID          string                        `json:"sectionId,omitempty"`
	CapabilityID       string                        `json:"capabilityId,omitempty"`
	NotificationTarget *GenerationNotificationTarget `json:"notificationTarget,omitempty"`
	RouteID            string                        `json:"routeId"`
	FamilyID           string                        `json:"familyId,omitempty"`
	VersionID          string                        `json:"versionId,omitempty"`
	Provider           string                        `json:"provider,omitempty"`
	ModelID            string                        `json:"modelId"`
	Model              string                        `json:"model"`
	Prompt             string                        `json:"prompt"`
	Size               string                        `json:"size,omitempty"`
	ReferenceURLs      []string                      `json:"referenceUrls"`
	ReferenceAssetIDs  []string                      `json:"referenceAssetIds"`
	Params             map[string]any                `json:"params"`
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
	Kind     string `json:"kind" ts:"Kind"`
	URL      string `json:"url,omitempty"`
	Base64   string `json:"base64,omitempty"`
	MIMEType string `json:"mimeType,omitempty"`
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
	ScopeID      string `json:"-"`
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
	ScopeID string `json:"-"`
	Kind    string `json:"kind" ts:"Kind"`
	Title   string `json:"title"`
}
