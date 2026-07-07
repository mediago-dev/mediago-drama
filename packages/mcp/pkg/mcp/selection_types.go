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

// AskUserSelectionOutput is the resolved outcome of a selection prompt.
type AskUserSelectionOutput struct {
	SelectionID string `json:"selectionId"`
	Status      string `json:"status" jsonschema:"selected、custom、cancelled 或 timeout。"`
	OptionID    string `json:"optionId,omitempty"`
	CustomText  string `json:"customText,omitempty"`
}
