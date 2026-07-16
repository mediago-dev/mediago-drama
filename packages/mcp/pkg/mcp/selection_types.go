package mcp

// FieldTypeGenerationSettings is the complete image/video generation settings
// field used by generation_plan forms. Its value contains the selected route,
// route params, reference assets, prompt supplements, and prompt optimization
// in one user-confirmed snapshot.
const FieldTypeGenerationSettings = "generation_settings"

// GenerationPlanIntentInput binds a user confirmation to one immutable image
// or video create request. Version 1 preserves Items order for batches.
type GenerationPlanIntentInput struct {
	Version           int                             `json:"version" jsonschema:"意图协议版本；首版必须为 1。"`
	Operation         string                          `json:"operation" jsonschema:"创建操作类型：create_single 或 create_batch。"`
	ConversationTitle string                          `json:"conversationTitle,omitempty" jsonschema:"可选：创建生成会话时展示的标题。"`
	Items             []GenerationPlanIntentItemInput `json:"items" jsonschema:"被确认的有序生成项；create_single 恰好一项，create_batch 最多 50 项。"`
}

// GenerationPlanIntentItemInput is one immutable item in a generation intent.
type GenerationPlanIntentItemInput struct {
	ID                 string                        `json:"id" jsonschema:"批次内稳定且唯一的生成项 ID。"`
	Kind               string                        `json:"kind" jsonschema:"生成类型：image 或 video。"`
	Prompt             string                        `json:"prompt" jsonschema:"用户本次确认的基础生成提示词。"`
	AssetTitle         string                        `json:"assetTitle,omitempty" jsonschema:"可选：生成资产标题。"`
	CapabilityID       string                        `json:"capabilityId,omitempty" jsonschema:"可选：能力 ID。"`
	ConversationID     string                        `json:"sessionId,omitempty" jsonschema:"可选：生成会话 ID，与实际生成请求的 sessionId 对齐。"`
	ScopeID            string                        `json:"scopeId,omitempty" jsonschema:"可选：生成会话作用域。"`
	DocumentID         string                        `json:"documentId,omitempty" jsonschema:"可选：来源或目标文档 ID。"`
	SectionID          string                        `json:"sectionId,omitempty" jsonschema:"可选：来源或目标章节 ID。"`
	DocumentContext    *GenerationDocumentContext    `json:"documentContext,omitempty" jsonschema:"可选：任务归属的文档上下文。"`
	ResourceType       string                        `json:"resourceType,omitempty" jsonschema:"可选：目标资源类型。"`
	ReferenceAssetIDs  []string                      `json:"referenceAssetIds,omitempty" jsonschema:"本项固定绑定的参考媒体资产 ID。"`
	NotificationTarget *GenerationNotificationTarget `json:"notificationTarget,omitempty" jsonschema:"可选：生成完成后的通知目标。"`
}

// SelectionOptionInput is one choice presented to the user.
type SelectionOptionInput struct {
	ID          string `json:"id" jsonschema:"选项 ID，用户选中后原样返回。"`
	Label       string `json:"label" jsonschema:"选项标题。"`
	ImageURL    string `json:"imageUrl,omitempty" jsonschema:"选项预览图 URL；用于目标资源或生成结果等可视化选择。"`
	Description string `json:"description,omitempty" jsonschema:"选项补充说明。"`
}

// AskUserSelectionInput asks the user to pick one of several options.
type AskUserSelectionInput struct {
	Title          string                     `json:"title" jsonschema:"选择卡片标题，例如“选择一个目标资源”。"`
	Prompt         string                     `json:"prompt,omitempty" jsonschema:"给用户的补充说明。"`
	Kind           string                     `json:"kind,omitempty" jsonschema:"选择类型标记，例如 resource_target、result_pick。"`
	Intent         *GenerationPlanIntentInput `json:"intent,omitempty" jsonschema:"可选：与选择关联的不可变生成创建意图；仅支持 create_single 或 create_batch，普通选择可省略。"`
	Options        []SelectionOptionInput     `json:"options" jsonschema:"可选项列表，至少一项，建议 4-8 项。"`
	AllowCustom    bool                       `json:"allowCustom,omitempty" jsonschema:"是否允许用户自定义回复。"`
	TimeoutSeconds int                        `json:"timeoutSeconds,omitempty" jsonschema:"本轮阻塞等待秒数，clamp 到 [30,600]，默认 90。timeout 仅表示本轮传输等待结束，必须对同一 selectionId 继续 await，不代表用户决定。"`
}

// AskUserSelectionOutput is the resolved outcome of a selection or form prompt.
type AskUserSelectionOutput struct {
	SelectionID string         `json:"selectionId"`
	Status      string         `json:"status" jsonschema:"selected、submitted、custom、cancelled、expired 或 timeout；timeout 是传输心跳，不是用户决定。"`
	OptionID    string         `json:"optionId,omitempty"`
	CustomText  string         `json:"customText,omitempty"`
	Values      map[string]any `json:"values,omitempty" jsonschema:"表单提交的字段值（status 为 submitted 时）。"`
}

// FormFieldOptionInput is one choice of a select form field.
type FormFieldOptionInput struct {
	Value       string `json:"value" jsonschema:"选项值，提交时原样返回。"`
	Label       string `json:"label" jsonschema:"选项显示名。"`
	Description string `json:"description,omitempty"`
}

// FormFieldInput is one typed input on a user-facing form card.
type FormFieldInput struct {
	ID          string                 `json:"id" jsonschema:"字段 ID，提交值以它为键。"`
	Label       string                 `json:"label" jsonschema:"字段显示名。"`
	Type        string                 `json:"type" jsonschema:"select、toggle、number、text、generation_settings、generation_params、images 或 prompt_optimization。图片和视频 generation_plan 必须只含一个 generation_settings(kind=image|video)，提交完整 {kind,routeId,label,params,referenceAssetIds,promptSupplements,promptOptimization} 快照；历史视频 generation_plan 兼容 generation_params(kind=video) 与可选 images/prompt_optimization。"`
	Kind        string                 `json:"kind,omitempty" jsonschema:"generation_settings 必须为 image 或 video；generation_params 仅用于历史 video generation_plan 兼容。"`
	Description string                 `json:"description,omitempty"`
	Options     []FormFieldOptionInput `json:"options,omitempty" jsonschema:"select 类型的可选值。"`
	Default     any                    `json:"default,omitempty" jsonschema:"可选默认值。通用字段可按上下文预填；generation_settings 仅在用户本轮明确指定模型、route 参数或参考资产等设置时提供完整 default，否则必须省略，以继承与批量生成表单相同的本地状态和偏好。"`
	Min         *float64               `json:"min,omitempty"`
	Max         *float64               `json:"max,omitempty"`
	Unit        string                 `json:"unit,omitempty"`
	Required    bool                   `json:"required,omitempty"`
}

// AskUserFormInput presents a parameter form and blocks for submission.
type AskUserFormInput struct {
	Title          string                     `json:"title" jsonschema:"表单卡标题，例如「确认生成参数」。"`
	Prompt         string                     `json:"prompt,omitempty" jsonschema:"给用户的补充说明。"`
	Kind           string                     `json:"kind,omitempty" jsonschema:"表单类型标记。生成参数确认必须为 generation_plan；该类型会启用服务端字段白名单。"`
	Intent         *GenerationPlanIntentInput `json:"intent,omitempty" jsonschema:"不可变生成意图；generation_plan 类型的图片或视频创建确认时必填，绑定本次单项或完整有序批次。"`
	Fields         []FormFieldInput           `json:"fields" jsonschema:"表单字段，至少一项。图片和视频 generation_plan 必须只含一个 required generation_settings(kind=image|video)；历史视频 generation_plan 兼容一个 generation_params(kind=video) 与可选 images/prompt_optimization；新旧契约不得混用。"`
	SubmitLabel    string                     `json:"submitLabel,omitempty" jsonschema:"提交按钮文案，默认「确认」。"`
	TimeoutSeconds int                        `json:"timeoutSeconds,omitempty" jsonschema:"本轮阻塞等待秒数，clamp 到 [30,600]，默认 90；timeout 是传输心跳，必须对同一 selectionId 持续 await，期间不得继续业务流程。"`
}

// AwaitUserSelectionInput continues waiting on an existing selection prompt.
type AwaitUserSelectionInput struct {
	SelectionID    string `json:"selectionId" jsonschema:"ask_user_selection 或 ask_user_form 返回的 selectionId；必须复用同一 ID，不要重建卡片。"`
	TimeoutSeconds int    `json:"timeoutSeconds,omitempty" jsonschema:"本轮阻塞等待秒数，clamp 到 [30,600]，默认 90。再次 timeout 时继续 await，无轮数上限；只有用户决定、cancelled 或 expired 才结束等待。"`
}
