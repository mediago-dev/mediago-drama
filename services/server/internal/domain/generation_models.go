package domain

import (
	"time"

	"gorm.io/gorm"
)

// GenerationTaskModel is the GORM model for generation tasks.
type GenerationTaskModel struct {
	ID              string    `gorm:"column:id;primaryKey"`
	BatchID         string    `gorm:"column:batch_id;not null;default:'';index:generation_tasks_batch_idx,priority:1"`
	BatchItemID     string    `gorm:"column:batch_item_id;not null;default:''"`
	BatchIndex      int       `gorm:"column:batch_index;not null;default:0;index:generation_tasks_batch_idx,priority:2"`
	ProviderTaskID  string    `gorm:"column:provider_task_id;not null;default:'';index:generation_tasks_provider_task_id_idx"`
	ConversationID  *string   `gorm:"column:conversation_id;index:generation_tasks_conversation_idx,priority:1"`
	ProjectID       *string   `gorm:"column:project_id;index:generation_tasks_project_id_idx"`
	DocumentID      *string   `gorm:"column:document_id;index:generation_tasks_document_id_idx"`
	SectionID       *string   `gorm:"column:section_id;index:generation_tasks_section_id_idx"`
	CapabilityID    *string   `gorm:"column:capability_id;index:generation_tasks_capability_idx"`
	ResourceType    *string   `gorm:"column:resource_type;index:generation_tasks_resource_type_idx"`
	Kind            string    `gorm:"column:kind;not null;index:generation_tasks_kind_status_updated_idx,priority:1"`
	RouteID         string    `gorm:"column:route_id;not null"`
	FamilyID        string    `gorm:"column:family_id;not null"`
	VersionID       string    `gorm:"column:version_id;not null"`
	Provider        string    `gorm:"column:provider;not null"`
	ModelID         string    `gorm:"column:model_id;not null"`
	Model           string    `gorm:"column:model;not null"`
	Prompt          string    `gorm:"column:prompt;not null"`
	SourceRefsJSON  string    `gorm:"column:source_refs_json;not null;default:'[]'"`
	ParamsJSON      string    `gorm:"column:params_json;not null"`
	Status          string    `gorm:"column:status;not null;index:generation_tasks_kind_status_updated_idx,priority:2"`
	Message         string    `gorm:"column:message;not null"`
	Text            string    `gorm:"column:text;not null;default:''"`
	InputTokens     int       `gorm:"column:input_tokens;not null;default:0"`
	OutputTokens    int       `gorm:"column:output_tokens;not null;default:0"`
	TotalTokens     int       `gorm:"column:total_tokens;not null;default:0"`
	ReasoningTokens int       `gorm:"column:reasoning_tokens;not null;default:0"`
	CachedTokens    int       `gorm:"column:cached_tokens;not null;default:0"`
	Error           string    `gorm:"column:error;not null;default:''"`
	ErrorCode       string    `gorm:"column:error_code;not null;default:''"`
	ErrorType       string    `gorm:"column:error_type;not null;default:''"`
	Retryable       bool      `gorm:"column:retryable;not null;default:false"`
	CreatedAt       time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt       time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano;index:generation_tasks_kind_status_updated_idx,priority:3,sort:asc"`

	Conversation *GenerationConversationModel   `gorm:"foreignKey:ConversationID;references:ID;constraint:OnDelete:CASCADE"`
	Project      *WorkspaceProjectModel         `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
	References   []GenerationTaskReferenceModel `gorm:"foreignKey:TaskID;references:ID;constraint:OnDelete:CASCADE"`
	Assets       []GenerationTaskAssetModel     `gorm:"foreignKey:TaskID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (GenerationTaskModel) TableName() string {
	return "generation_tasks"
}

// GenerationTaskAttemptModel is the GORM model for generation task attempts.
type GenerationTaskAttemptModel struct {
	ID        string    `gorm:"column:id;primaryKey"`
	TaskID    string    `gorm:"column:task_id;not null;index:generation_task_attempts_task_idx,priority:1"`
	Action    string    `gorm:"column:action;not null"`
	Status    string    `gorm:"column:status;not null"`
	Message   string    `gorm:"column:message;not null;default:''"`
	Error     string    `gorm:"column:error;not null;default:''"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:nano;index:generation_task_attempts_task_idx,priority:2,sort:desc"`

	Task GenerationTaskModel `gorm:"foreignKey:TaskID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (GenerationTaskAttemptModel) TableName() string {
	return "generation_task_attempts"
}

// GenerationTaskReferenceModel stores normalized generation input references.
type GenerationTaskReferenceModel struct {
	TaskID    string    `gorm:"column:task_id;primaryKey"`
	RefIndex  int       `gorm:"column:ref_index;primaryKey"`
	AssetID   *string   `gorm:"column:asset_id;index:generation_task_references_asset_idx"`
	URL       *string   `gorm:"column:url"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`

	Task  GenerationTaskModel `gorm:"foreignKey:TaskID;references:ID;constraint:OnDelete:CASCADE"`
	Asset *AssetModel         `gorm:"foreignKey:AssetID;references:ID;constraint:OnDelete:SET NULL"`
}

// TableName returns the backing table name.
func (GenerationTaskReferenceModel) TableName() string {
	return "generation_task_references"
}

// GenerationTaskAssetModel indexes generated output slots by asset reference.
type GenerationTaskAssetModel struct {
	TaskID    string    `gorm:"column:task_id;primaryKey;index:generation_task_assets_task_idx,priority:1"`
	SlotIndex int       `gorm:"column:slot_index;primaryKey;index:generation_task_assets_task_idx,priority:2"`
	AssetID   string    `gorm:"column:asset_id;not null;index:generation_task_assets_asset_idx"`
	Selected  bool      `gorm:"column:selected;not null;default:false;index:generation_task_assets_selected_idx"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`

	Task  GenerationTaskModel `gorm:"foreignKey:TaskID;references:ID;constraint:OnDelete:CASCADE"`
	Asset AssetModel          `gorm:"foreignKey:AssetID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (GenerationTaskAssetModel) TableName() string {
	return "generation_task_assets"
}

// ProjectSelectedAssetModel stores project-level selected creative assets.
type ProjectSelectedAssetModel struct {
	ID               string         `gorm:"column:id;primaryKey"`
	ProjectID        string         `gorm:"column:project_id;not null;index:project_selected_assets_project_resource_idx,priority:1"`
	ResourceType     string         `gorm:"column:resource_type;not null;index:project_selected_assets_project_resource_idx,priority:2"`
	ResourceID       *string        `gorm:"column:resource_id;index:project_selected_assets_resource_id_idx"`
	ResourceTitle    *string        `gorm:"column:resource_title"`
	AssetID          string         `gorm:"column:asset_id;not null;index:project_selected_assets_asset_idx"`
	SourceType       *string        `gorm:"column:source_type;index:project_selected_assets_source_idx,priority:1"`
	SourceTaskID     *string        `gorm:"column:source_task_id;index:project_selected_assets_source_task_idx"`
	SourceSlotIndex  int            `gorm:"column:source_slot_index;not null"`
	SourceDocumentID *string        `gorm:"column:source_document_id;index:project_selected_assets_source_document_idx"`
	SortOrder        int            `gorm:"column:sort_order;not null;default:0"`
	DeletedAt        gorm.DeletedAt `gorm:"column:deleted_at;index:project_selected_assets_deleted_idx"`
	CreatedAt        time.Time      `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt        time.Time      `gorm:"column:updated_at;not null;autoUpdateTime:nano;index:project_selected_assets_project_resource_idx,priority:3,sort:desc"`

	Project    WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
	Asset      AssetModel            `gorm:"foreignKey:AssetID;references:ID;constraint:OnDelete:CASCADE"`
	SourceTask *GenerationTaskModel  `gorm:"foreignKey:SourceTaskID;references:ID;constraint:OnDelete:SET NULL"`
}

// TableName returns the backing table name.
func (ProjectSelectedAssetModel) TableName() string {
	return "project_selected_assets"
}

// GenerationConversationModel is the GORM model for generation conversations.
type GenerationConversationModel struct {
	ID        string    `gorm:"column:id;primaryKey"`
	ScopeID   string    `gorm:"column:scope_id;not null;default:'studio';index:generation_conversations_scope_kind_idx,priority:1"`
	Kind      string    `gorm:"column:kind;not null;index:generation_conversations_scope_kind_idx,priority:2"`
	Title     string    `gorm:"column:title;not null"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
}

// TableName returns the backing table name.
func (GenerationConversationModel) TableName() string {
	return "generation_conversations"
}

// GenerationPreferenceModel is the GORM model for generation preferences.
type GenerationPreferenceModel struct {
	ScopeID         string    `gorm:"column:scope_id;primaryKey"`
	FamilyIDsJSON   string    `gorm:"column:family_ids_json;not null;default:'{}'"`
	RouteIDsJSON    string    `gorm:"column:route_ids_json;not null;default:'{}'"`
	VersionIDsJSON  string    `gorm:"column:version_ids_json;not null;default:'{}'"`
	RouteParamsJSON string    `gorm:"column:route_params_json;not null;default:'{}'"`
	StylePresetID   string    `gorm:"column:style_preset_id;not null;default:''"`
	CreatedAt       time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt       time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
}

// TableName returns the backing table name.
func (GenerationPreferenceModel) TableName() string {
	return "generation_preferences"
}

// GenerationNotificationModel is the GORM model for generation notifications.
type GenerationNotificationModel struct {
	ID          string     `gorm:"column:id;primaryKey"`
	TaskID      string     `gorm:"column:task_id;not null;uniqueIndex:generation_notifications_task_id_idx"`
	TaskKind    string     `gorm:"column:task_kind;not null;default:''"`
	TaskStatus  string     `gorm:"column:task_status;not null;default:'pending';index:generation_notifications_project_status_idx,priority:2"`
	ProjectID   *string    `gorm:"column:project_id;index:generation_notifications_project_status_idx,priority:1"`
	Title       string     `gorm:"column:title;not null;default:''"`
	Description string     `gorm:"column:description;not null;default:''"`
	AssetCount  int        `gorm:"column:asset_count;not null;default:0"`
	TargetJSON  string     `gorm:"column:target_json;not null;type:text"`
	ReadAt      *time.Time `gorm:"column:read_at"`
	CreatedAt   time.Time  `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt   time.Time  `gorm:"column:updated_at;not null;autoUpdateTime:nano;index:generation_notifications_updated_at_idx"`

	Task    GenerationTaskModel    `gorm:"foreignKey:TaskID;references:ID;constraint:OnDelete:CASCADE"`
	Project *WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (GenerationNotificationModel) TableName() string {
	return "generation_notifications"
}

// PromptCategoryModel is the GORM model for reusable generation prompt categories.
type PromptCategoryModel struct {
	ID        string    `gorm:"column:id;primaryKey"`
	Label     string    `gorm:"column:label;not null"`
	Source    string    `gorm:"column:source;not null;default:'user';index:prompt_categories_source_idx"`
	Builtin   bool      `gorm:"column:builtin;not null;default:false;index:prompt_categories_builtin_idx"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
}

// TableName returns the backing table name.
func (PromptCategoryModel) TableName() string {
	return "prompt_categories"
}

// PromptLibraryEntryModel is the GORM model for reusable generation prompts.
type PromptLibraryEntryModel struct {
	ID        string    `gorm:"column:id;primaryKey"`
	Name      string    `gorm:"column:name;not null"`
	Category  string    `gorm:"column:category;not null;default:'';index:prompt_library_entries_category_idx"`
	Type      string    `gorm:"column:type;not null;index:prompt_library_entries_type_idx"`
	Prompt    string    `gorm:"column:prompt;not null;type:text"`
	Source    string    `gorm:"column:source;not null;default:'user'"`
	Builtin   bool      `gorm:"column:builtin;not null;default:false;index:prompt_library_entries_builtin_idx"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
}

// TableName returns the backing table name.
func (PromptLibraryEntryModel) TableName() string {
	return "prompt_library_entries"
}
