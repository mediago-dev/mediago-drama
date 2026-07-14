package mcp

// FieldTypeGenerationSettings is the complete image-generation settings
// field used by generation_plan forms. Its value contains the selected route,
// route params, reference assets, prompt supplements, and prompt optimization
// in one user-confirmed snapshot.
const FieldTypeGenerationSettings = "generation_settings"

// SelectionOptionInput is one choice presented to the user.
type SelectionOptionInput struct {
	ID          string `json:"id" jsonschema:"选项 ID，用户选中后原样返回。"`
	Label       string `json:"label" jsonschema:"选项标题。"`
	ImageURL    string `json:"imageUrl,omitempty" jsonschema:"选项预览图 URL；用于目标资源或生成结果等可视化选择。"`
	Description string `json:"description,omitempty" jsonschema:"选项补充说明。"`
}

// AskUserSelectionInput asks the user to pick one of several options.
type AskUserSelectionInput struct {
	Title          string                 `json:"title" jsonschema:"选择卡片标题，例如“选择一个目标资源”。"`
	Prompt         string                 `json:"prompt,omitempty" jsonschema:"给用户的补充说明。"`
	Kind           string                 `json:"kind,omitempty" jsonschema:"选择类型标记，例如 resource_target、result_pick。"`
	Options        []SelectionOptionInput `json:"options" jsonschema:"可选项列表，至少一项，建议 4-8 项。"`
	AllowCustom    bool                   `json:"allowCustom,omitempty" jsonschema:"是否允许用户自定义回复。"`
	TimeoutSeconds int                    `json:"timeoutSeconds,omitempty" jsonschema:"本轮阻塞等待秒数，clamp 到 [30,600]，默认 90。timeout 仅表示本轮传输等待结束，必须对同一 selectionId 继续 await，不代表用户决定。"`
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
	Type        string                 `json:"type" jsonschema:"select、toggle、number、text、generation_settings、generation_params、images 或 prompt_optimization。图片 generation_plan 必须只含一个 generation_settings(kind=image)，提交完整 {kind,routeId,label,params,referenceAssetIds,promptSupplements,promptOptimization} 快照；本轮兼容的视频 generation_plan 使用 generation_params(kind=video)，可另带至多一个 images 和 prompt_optimization。"`
	Kind        string                 `json:"kind,omitempty" jsonschema:"generation_settings 当前必须为 image；generation_params 在 generation_plan 兼容分支必须为 video。"`
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
	Title          string           `json:"title" jsonschema:"表单卡标题，例如「确认生成参数」。"`
	Prompt         string           `json:"prompt,omitempty" jsonschema:"给用户的补充说明。"`
	Kind           string           `json:"kind,omitempty" jsonschema:"表单类型标记。生成参数确认必须为 generation_plan；该类型会启用服务端字段白名单。"`
	Fields         []FormFieldInput `json:"fields" jsonschema:"表单字段，至少一项。图片 generation_plan 必须只含一个 required generation_settings(kind=image)；兼容视频 generation_plan 必须恰好一个 generation_params(kind=video)，只允许按需再有至多一个 images 和一个 prompt_optimization；新旧契约不得混用。"`
	SubmitLabel    string           `json:"submitLabel,omitempty" jsonschema:"提交按钮文案，默认「确认」。"`
	TimeoutSeconds int              `json:"timeoutSeconds,omitempty" jsonschema:"本轮阻塞等待秒数，clamp 到 [30,600]，默认 90；timeout 是传输心跳，必须对同一 selectionId 持续 await，期间不得继续业务流程。"`
}

// AwaitUserSelectionInput continues waiting on an existing selection prompt.
type AwaitUserSelectionInput struct {
	SelectionID    string `json:"selectionId" jsonschema:"ask_user_selection 或 ask_user_form 返回的 selectionId；必须复用同一 ID，不要重建卡片。"`
	TimeoutSeconds int    `json:"timeoutSeconds,omitempty" jsonschema:"本轮阻塞等待秒数，clamp 到 [30,600]，默认 90。再次 timeout 时继续 await，无轮数上限；只有用户决定、cancelled 或 expired 才结束等待。"`
}
