package mcp

// SelectionOptionInput is one choice presented to the user.
type SelectionOptionInput struct {
	ID          string `json:"id" jsonschema:"选项 ID，用户选中后原样返回。"`
	Label       string `json:"label" jsonschema:"选项标题。"`
	ImageURL    string `json:"imageUrl,omitempty" jsonschema:"选项预览图 URL；用于风格网格等可视化选择。"`
	Description string `json:"description,omitempty" jsonschema:"选项补充说明。"`
}

// AskUserSelectionInput asks the user to pick one of several options.
type AskUserSelectionInput struct {
	Title          string                 `json:"title" jsonschema:"选择卡片标题，例如“选择一种插画风格”。"`
	Prompt         string                 `json:"prompt,omitempty" jsonschema:"给用户的补充说明。"`
	Kind           string                 `json:"kind,omitempty" jsonschema:"选择类型标记，例如 image_style、result_pick。"`
	Options        []SelectionOptionInput `json:"options" jsonschema:"可选项列表，至少一项，建议 4-8 项。"`
	AllowCustom    bool                   `json:"allowCustom,omitempty" jsonschema:"是否允许用户自定义回复。"`
	TimeoutSeconds int                    `json:"timeoutSeconds,omitempty" jsonschema:"阻塞等待秒数，clamp 到 [30,600]，默认 180。"`
}

// AskUserSelectionOutput is the resolved outcome of a selection or form prompt.
type AskUserSelectionOutput struct {
	SelectionID string         `json:"selectionId"`
	Status      string         `json:"status" jsonschema:"selected、submitted、custom、cancelled 或 timeout。"`
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
	Type        string                 `json:"type" jsonschema:"select、toggle、number、text、generation_params、images 或 prompt_optimization；generation_params 是生成模型+参数组合选择器，按同级 kind 字段渲染 image/video/audio 模型目录（默认 image）及所选模型的比例/分辨率/时长/张数（组合联动），无需 options，提交值为 {routeId,label,params}；images 是参考图选择器，用户可上传或移除图片，提交值为媒体资产 id 数组，default 可预填资产 id（如该资源已定稿图），max 限制张数；prompt_optimization 是优化提示词选择器（开关+文本模型+提示词包，与生成工作台同源），无需 options，提交值为 {enabled} 或 {enabled:true, routeId, referenceName, referencePrompt}，default 可预填。"`
	Kind        string                 `json:"kind,omitempty" jsonschema:"仅 generation_params 使用：媒体类型 image、video 或 audio，决定客户端按哪类模型目录渲染；省略时默认 image。视频表单必须传 video。"`
	Description string                 `json:"description,omitempty"`
	Options     []FormFieldOptionInput `json:"options,omitempty" jsonschema:"select 类型的可选值。"`
	Default     any                    `json:"default,omitempty" jsonschema:"默认值；用 preferences 或 schema 默认项预填。"`
	Min         *float64               `json:"min,omitempty"`
	Max         *float64               `json:"max,omitempty"`
	Unit        string                 `json:"unit,omitempty"`
	Required    bool                   `json:"required,omitempty"`
}

// AskUserFormInput presents a parameter form and blocks for submission.
type AskUserFormInput struct {
	Title          string           `json:"title" jsonschema:"表单卡标题，例如「确认生成参数」。"`
	Prompt         string           `json:"prompt,omitempty" jsonschema:"给用户的补充说明。"`
	Kind           string           `json:"kind,omitempty" jsonschema:"表单类型标记，例如 generation_plan。"`
	Fields         []FormFieldInput `json:"fields" jsonschema:"表单字段，至少一项。"`
	SubmitLabel    string           `json:"submitLabel,omitempty" jsonschema:"提交按钮文案，默认「确认」。"`
	TimeoutSeconds int              `json:"timeoutSeconds,omitempty" jsonschema:"阻塞等待秒数，clamp 到 [30,600]，默认 90；超时后用 await_user_selection 续等。"`
}

// AwaitUserSelectionInput continues waiting on an existing selection prompt.
type AwaitUserSelectionInput struct {
	SelectionID    string `json:"selectionId" jsonschema:"ask_user_selection 返回的 selectionId。"`
	TimeoutSeconds int    `json:"timeoutSeconds,omitempty" jsonschema:"本轮阻塞等待秒数，clamp 到 [30,600]，默认 90。"`
}
