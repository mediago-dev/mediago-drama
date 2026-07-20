package mcp

// GenerationMessageInput creates a generation request.
type GenerationMessageInput struct {
	ConfirmationSelectionID string                             `json:"confirmationSelectionId,omitempty" jsonschema:"本次生成参数表单提交后返回的 selectionId；Agent 发起图片或视频生成时必填，一次确认只授权一次完整单项请求，服务端会核验意图、当前 run 和已确认设置。"`
	Kind                    string                             `json:"kind,omitempty" jsonschema:"生成类型：image、video、audio 或 text；默认 image。"`
	ConversationID          string                             `json:"sessionId,omitempty" jsonschema:"生成会话 ID。"`
	ScopeID                 string                             `json:"scopeId,omitempty" jsonschema:"生成会话作用域。"`
	ProjectID               string                             `json:"projectId,omitempty" jsonschema:"项目 ID；项目级 MCP 可省略。"`
	DocumentID              string                             `json:"documentId,omitempty" jsonschema:"来源文档 ID。"`
	SectionID               string                             `json:"sectionId,omitempty" jsonschema:"来源章节或块 ID。"`
	DocumentContext         *GenerationDocumentContext         `json:"documentContext,omitempty" jsonschema:"文档上下文。"`
	CapabilityID            string                             `json:"capabilityId,omitempty" jsonschema:"能力 ID。"`
	ResourceType            string                             `json:"resourceType,omitempty" jsonschema:"可选：目标资源类型（character、scene、prop、storyboard）；带 documentContext 时服务端会按目标文档类型自动归属，无需传。"`
	NotificationTarget      *GenerationNotificationTarget      `json:"notificationTarget,omitempty" jsonschema:"生成完成后的通知目标。"`
	RouteID                 string                             `json:"routeId,omitempty" jsonschema:"模型路由 ID；Agent 图片或视频生成时必须与已提交 generation_settings 中的 routeId 一致。"`
	FamilyID                string                             `json:"familyId,omitempty" jsonschema:"模型家族 ID。"`
	VersionID               string                             `json:"versionId,omitempty" jsonschema:"模型版本 ID。"`
	Provider                string                             `json:"provider,omitempty" jsonschema:"供应商。"`
	TextExecutor            string                             `json:"textExecutor,omitempty" jsonschema:"内部文本执行器：auto、route 或 codex；媒体生成通常省略。"`
	ModelID                 string                             `json:"modelId,omitempty" jsonschema:"旧版模型 ID。"`
	Model                   string                             `json:"model,omitempty" jsonschema:"供应商模型名。"`
	Prompt                  string                             `json:"prompt" jsonschema:"生成提示词。"`
	PromptSupplements       []GenerationPromptSupplementInput  `json:"promptSupplements,omitempty" jsonschema:"可选：按顺序追加到基础提示词的结构化技能包快照；服务端负责去空、去重和拼接。"`
	AssetTitle              string                             `json:"assetTitle,omitempty" jsonschema:"生成资产标题。"`
	ReferenceURLs           []string                           `json:"referenceUrls,omitempty" jsonschema:"参考资源 URL。"`
	ReferenceAssetIDs       []string                           `json:"referenceAssetIds,omitempty" jsonschema:"参考媒体资产 ID。"`
	ReferenceBindings       []GenerationReferenceBinding       `json:"referenceBindings,omitempty" jsonschema:"文档 mention 到参考资源的绑定。"`
	Params                  map[string]any                     `json:"params,omitempty" jsonschema:"模型参数。"`
	PromptOptimization      *GenerationPromptOptimizationInput `json:"promptOptimization,omitempty" jsonschema:"提示词优化配置；传入时先用文本模型优化提示词再生成（对应工作台的优化提示词开关），输出含 optimizedPrompt。"`
}

// GenerationPromptSupplementInput is one prompt-pack snapshot appended by the server.
type GenerationPromptSupplementInput struct {
	ReferenceID     string `json:"referenceId,omitempty" jsonschema:"可选：技能包 ID，用于去重和追踪选择快照。"`
	ReferenceName   string `json:"referenceName,omitempty" jsonschema:"可选：技能包名称快照。"`
	ReferencePrompt string `json:"referencePrompt" jsonschema:"追加到基础提示词的技能包内容。"`
}

// GenerationBatchInput submits multiple normal media generation requests together.
type GenerationBatchInput struct {
	ConfirmationSelectionID string                     `json:"confirmationSelectionId,omitempty" jsonschema:"批次级确认 ID；Agent 发起图片或视频批次时必填，一次确认授权一个完整有序批次，子项不得各自提供确认 ID。"`
	Kind                    string                     `json:"kind,omitempty" jsonschema:"批次共用生成类型；指定 sessionId 时必填。"`
	ConversationID          string                     `json:"sessionId,omitempty" jsonschema:"批次共用生成会话 ID。"`
	ConversationTitle       string                     `json:"conversationTitle,omitempty" jsonschema:"创建批次共用会话时使用的标题。"`
	ProjectID               string                     `json:"projectId,omitempty" jsonschema:"项目 ID；项目级 MCP 可省略。"`
	ScopeID                 string                     `json:"scopeId,omitempty" jsonschema:"批次内请求缺省使用的会话作用域。"`
	Items                   []GenerationBatchItemInput `json:"items" jsonschema:"批次子请求，按输入顺序返回；最多 50 项。"`
}

// GenerationBatchItemInput is one ordered child request in a generation batch.
type GenerationBatchItemInput struct {
	ID      string                 `json:"id,omitempty" jsonschema:"调用方用于匹配结果的唯一子项 ID；省略时服务端按顺序生成。"`
	Request GenerationMessageInput `json:"request" jsonschema:"与 generate_media 相同的单项生成参数；Agent 图片或视频批次不得在子项设置 confirmationSelectionId，只能使用批次顶层确认 ID。"`
}

// GenerationBatchItemOutput reports one child submission result.
type GenerationBatchItemOutput struct {
	ID              string `json:"id"`
	Index           int    `json:"index"`
	TaskID          string `json:"taskId,omitempty"`
	Status          string `json:"status"`
	Message         string `json:"message,omitempty"`
	OptimizedPrompt string `json:"optimizedPrompt,omitempty"`
	Error           string `json:"error,omitempty"`
}

// GenerationBatchOutput reports an ordered batch submission.
type GenerationBatchOutput struct {
	ID       string                      `json:"id"`
	Status   string                      `json:"status"`
	Total    int                         `json:"total"`
	Accepted int                         `json:"accepted"`
	Failed   int                         `json:"failed"`
	Items    []GenerationBatchItemOutput `json:"items"`
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
	Executor          string         `json:"executor,omitempty" jsonschema:"文本执行器：auto、route 或 codex；默认 auto。"`
	RouteID           string         `json:"routeId,omitempty"`
	Model             string         `json:"model,omitempty"`
	ReferenceID       string         `json:"referenceId,omitempty" jsonschema:"可选：技能包提示词 ID；正文受保护时由服务端在执行前解析。"`
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

// GenerationMessageOutput is returned by generation create calls.
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
