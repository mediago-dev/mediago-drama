package mcp

import coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"

// GenerationListModelsInput is the input for list_generation_models.
type GenerationListModelsInput struct {
	Kind string `json:"kind,omitempty" jsonschema:"可选：只返回该类型的目录（image、video、audio 或 text）。生图流程传 image 可大幅缩小输出；省略时返回全部。"`
}

// GenerationModelsOutput returns the generation catalog.
type GenerationModelsOutput struct {
	Families      []coregeneration.ModelFamily  `json:"families"`
	Versions      []coregeneration.ModelVersion `json:"versions"`
	Routes        []coregeneration.ModelRoute   `json:"routes"`
	Models        []coregeneration.ModelSpec    `json:"models"`
	Providers     []coregeneration.ProviderInfo `json:"providers"`
	VoicePreviews []GenerationVoicePreviewAsset `json:"voicePreviews,omitempty"`
	StylePresets  []GenerationStylePreset       `json:"stylePresets,omitempty"`
	Preferences   *GenerationPreferences        `json:"preferences,omitempty"`
}

// GenerationVoicePreviewAsset is one built-in local voice preview.
type GenerationVoicePreviewAsset struct {
	RouteID  string `json:"routeId"`
	VoiceID  string `json:"voiceId"`
	URL      string `json:"url"`
	MIMEType string `json:"mimeType"`
}

// GenerationStylePreset is one built-in visual style recommendation: append
// PromptSuffix to the user prompt and merge Params into the generate request.
// PreviewURL serves the bundled preview image, e.g. for ask_user_selection
// option imageUrl values.
type GenerationStylePreset struct {
	ID           string         `json:"id"`
	Title        string         `json:"title"`
	Description  string         `json:"description,omitempty"`
	Kinds        []string       `json:"kinds"`
	RouteID      string         `json:"routeId,omitempty"`
	PromptSuffix string         `json:"promptSuffix"`
	Params       map[string]any `json:"params,omitempty"`
	PreviewURL   string         `json:"previewUrl,omitempty"`
	MIMEType     string         `json:"mimeType,omitempty"`
}

// GenerationPreferences mirrors the user's generation workbench defaults so
// agents can propose the user's usual setup as the default plan.
type GenerationPreferences struct {
	RouteIDs      map[string]string         `json:"routeIds,omitempty"`
	RouteParams   map[string]map[string]any `json:"routeParams,omitempty"`
	StylePresetID string                    `json:"stylePresetId,omitempty"`
}

// GenerationSelectAssetInput marks one generated asset slot as the picked result.
type GenerationSelectAssetInput struct {
	TaskID       string `json:"taskId" jsonschema:"生成任务 ID。"`
	SlotIndex    int    `json:"slotIndex" jsonschema:"资产槽位序号，取 get_generation_task 返回资产的 slotIndex。"`
	Title        string `json:"title,omitempty" jsonschema:"可选：同时更新资产标题。"`
	ResourceType string `json:"resourceType,omitempty" jsonschema:"资源类型：character、scene、prop 或 storyboard；任务带 documentContext 生成时服务端已自动归属可省略，否则为项目资源定稿时必传。"`
}

// GenerationMessageInput creates a generation request.
type GenerationMessageInput struct {
	Kind               string                             `json:"kind,omitempty" jsonschema:"生成类型：image、video、audio 或 text；默认 image。"`
	ConversationID     string                             `json:"sessionId,omitempty" jsonschema:"生成会话 ID。"`
	ScopeID            string                             `json:"scopeId,omitempty" jsonschema:"生成会话作用域。"`
	ProjectID          string                             `json:"projectId,omitempty" jsonschema:"项目 ID；项目级 MCP 可省略。"`
	DocumentID         string                             `json:"documentId,omitempty" jsonschema:"来源文档 ID。"`
	SectionID          string                             `json:"sectionId,omitempty" jsonschema:"来源章节或块 ID。"`
	DocumentContext    *GenerationDocumentContext         `json:"documentContext,omitempty" jsonschema:"文档上下文。"`
	CapabilityID       string                             `json:"capabilityId,omitempty" jsonschema:"能力 ID。"`
	ResourceType       string                             `json:"resourceType,omitempty" jsonschema:"可选：目标资源类型（character、scene、prop、storyboard）；带 documentContext 时服务端会按目标文档类型自动归属，无需传。"`
	NotificationTarget *GenerationNotificationTarget      `json:"notificationTarget,omitempty" jsonschema:"生成完成后的通知目标。"`
	RouteID            string                             `json:"routeId,omitempty" jsonschema:"模型路由 ID，优先从 list_generation_models 选择。"`
	FamilyID           string                             `json:"familyId,omitempty" jsonschema:"模型家族 ID。"`
	VersionID          string                             `json:"versionId,omitempty" jsonschema:"模型版本 ID。"`
	Provider           string                             `json:"provider,omitempty" jsonschema:"供应商。"`
	ModelID            string                             `json:"modelId,omitempty" jsonschema:"旧版模型 ID。"`
	Model              string                             `json:"model,omitempty" jsonschema:"供应商模型名。"`
	Prompt             string                             `json:"prompt" jsonschema:"生成提示词。"`
	AssetTitle         string                             `json:"assetTitle,omitempty" jsonschema:"生成资产标题。"`
	ReferenceURLs      []string                           `json:"referenceUrls,omitempty" jsonschema:"参考资源 URL。"`
	ReferenceAssetIDs  []string                           `json:"referenceAssetIds,omitempty" jsonschema:"参考媒体资产 ID。"`
	ReferenceBindings  []GenerationReferenceBinding       `json:"referenceBindings,omitempty" jsonschema:"文档 mention 到参考资源的绑定。"`
	Params             map[string]any                     `json:"params,omitempty" jsonschema:"模型参数。"`
	PromptOptimization *GenerationPromptOptimizationInput `json:"promptOptimization,omitempty" jsonschema:"提示词优化配置；传入时先用文本模型优化提示词再生成（对应工作台的优化提示词开关），输出含 optimizedPrompt。"`
}

// GenerationDocumentContext identifies the source document section for generation.
type GenerationDocumentContext struct {
	ProjectID  string `json:"projectId,omitempty"`
	DocumentID string `json:"documentId,omitempty"`
	SectionID  string `json:"sectionId,omitempty"`
}

// GenerationReferenceBinding maps a document mention to a concrete reference.
type GenerationReferenceBinding struct {
	Kind       string `json:"kind,omitempty"`
	DocumentID string `json:"documentId,omitempty"`
	BlockID    string `json:"blockId,omitempty"`
	AssetID    string `json:"assetId,omitempty"`
	URL        string `json:"url,omitempty"`
}

// GenerationPromptOptimizationInput configures server-side prompt optimization.
type GenerationPromptOptimizationInput struct {
	ConversationID    string         `json:"sessionId,omitempty"`
	ScopeID           string         `json:"scopeId,omitempty"`
	ConversationTitle string         `json:"conversationTitle,omitempty"`
	ProjectID         string         `json:"projectId,omitempty"`
	CapabilityID      string         `json:"capabilityId,omitempty"`
	RouteID           string         `json:"routeId,omitempty"`
	Model             string         `json:"model,omitempty"`
	ReferenceName     string         `json:"referenceName,omitempty"`
	ReferencePrompt   string         `json:"referencePrompt,omitempty"`
	Params            map[string]any `json:"params,omitempty"`
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

// GenerationMessageOutput is returned by generation create/poll/retry calls.
type GenerationMessageOutput struct {
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
	// OptimizedPrompt is the prompt actually used when promptOptimization ran.
	OptimizedPrompt string `json:"optimizedPrompt,omitempty"`
}

// GenerationAsset is a generated asset reference or inline payload.
type GenerationAsset struct {
	AssetID      string `json:"assetId,omitempty"`
	Kind         string `json:"kind"`
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

// GenerationTaskInput identifies one generation task.
type GenerationTaskInput struct {
	TaskID string `json:"taskId" jsonschema:"生成任务 ID。"`
}

// GenerationTaskListInput filters generation tasks.
type GenerationTaskListInput struct {
	ConversationID string `json:"sessionId,omitempty" jsonschema:"生成会话 ID。"`
	Kind           string `json:"kind,omitempty" jsonschema:"生成类型。"`
	ProjectID      string `json:"projectId,omitempty" jsonschema:"项目 ID；项目级 MCP 可省略。"`
	ScopeID        string `json:"scopeId,omitempty" jsonschema:"会话作用域。"`
	Limit          int    `json:"limit,omitempty" jsonschema:"分页大小。"`
	Offset         int    `json:"offset,omitempty" jsonschema:"分页偏移。"`
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
	ResourceType      string                        `json:"resourceType,omitempty"`
	Kind              string                        `json:"kind"`
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

// GenerationTasksOutput lists generation tasks.
type GenerationTasksOutput struct {
	Tasks []GenerationTaskRecord `json:"tasks"`
}
