package domain

// GenerationTaskModel is the GORM model for generation tasks.
type GenerationTaskModel struct {
	ID                    string `gorm:"column:id;primaryKey"`
	ProviderTaskID        string `gorm:"column:provider_task_id;not null;default:'';index:generation_tasks_provider_task_id_idx"`
	ConversationID        string `gorm:"column:conversation_id;not null;default:'';index:generation_tasks_conversation_idx,priority:1"`
	ProjectID             string `gorm:"column:project_id;not null;default:'';index:generation_tasks_project_id_idx"`
	SectionID             string `gorm:"column:section_id;not null;default:'';index:generation_tasks_section_id_idx"`
	CapabilityID          string `gorm:"column:capability_id;not null;default:'';index:generation_tasks_capability_idx"`
	Kind                  string `gorm:"column:kind;not null;index:generation_tasks_kind_status_updated_idx,priority:1"`
	RouteID               string `gorm:"column:route_id;not null"`
	FamilyID              string `gorm:"column:family_id;not null"`
	VersionID             string `gorm:"column:version_id;not null"`
	Provider              string `gorm:"column:provider;not null"`
	ModelID               string `gorm:"column:model_id;not null"`
	Model                 string `gorm:"column:model;not null"`
	Prompt                string `gorm:"column:prompt;not null"`
	ReferenceURLsJSON     string `gorm:"column:reference_urls_json;not null"`
	ReferenceAssetIDsJSON string `gorm:"column:reference_asset_ids_json;not null;default:'[]'"`
	ParamsJSON            string `gorm:"column:params_json;not null"`
	Status                string `gorm:"column:status;not null;index:generation_tasks_kind_status_updated_idx,priority:2"`
	Message               string `gorm:"column:message;not null"`
	Text                  string `gorm:"column:text;not null;default:''"`
	AssetsJSON            string `gorm:"column:assets_json;not null"`
	DeletedAssetSlotsJSON string `gorm:"column:deleted_asset_slots_json;not null;default:'[]'"`
	UsageJSON             string `gorm:"column:usage_json;not null"`
	Error                 string `gorm:"column:error;not null;default:''"`
	ErrorCode             string `gorm:"column:error_code;not null;default:''"`
	ErrorType             string `gorm:"column:error_type;not null;default:''"`
	Retryable             bool   `gorm:"column:retryable;not null;default:false"`
	CreatedAt             string `gorm:"column:created_at;not null"`
	UpdatedAt             string `gorm:"column:updated_at;not null;index:generation_tasks_kind_status_updated_idx,priority:3,sort:asc"`
}

// TableName returns the backing table name.
func (GenerationTaskModel) TableName() string {
	return "generation_tasks"
}

// GenerationTaskAttemptModel is the GORM model for generation task attempts.
type GenerationTaskAttemptModel struct {
	ID        string `gorm:"column:id;primaryKey"`
	TaskID    string `gorm:"column:task_id;not null;index:generation_task_attempts_task_idx,priority:1"`
	Action    string `gorm:"column:action;not null"`
	Status    string `gorm:"column:status;not null"`
	Message   string `gorm:"column:message;not null;default:''"`
	Error     string `gorm:"column:error;not null;default:''"`
	CreatedAt string `gorm:"column:created_at;not null;index:generation_task_attempts_task_idx,priority:2,sort:desc"`
}

// TableName returns the backing table name.
func (GenerationTaskAttemptModel) TableName() string {
	return "generation_task_attempts"
}

// GenerationTaskAssetModel indexes generated assets outside the task JSON payload.
type GenerationTaskAssetModel struct {
	TaskID         string `gorm:"column:task_id;primaryKey;index:generation_task_assets_task_idx,priority:1"`
	AssetIndex     int    `gorm:"column:asset_index;primaryKey;index:generation_task_assets_task_idx,priority:2"`
	LibraryAssetID string `gorm:"column:library_asset_id;not null;default:'';index:generation_task_assets_library_asset_idx"`
	Kind           string `gorm:"column:kind;not null;default:''"`
	Title          string `gorm:"column:title;not null;default:''"`
	URL            string `gorm:"column:url;not null;default:''"`
	Base64         string `gorm:"column:base64;not null;default:'';type:text"`
	MIMEType       string `gorm:"column:mime_type;not null;default:''"`
	Selected       bool   `gorm:"column:selected;not null;default:false;index:generation_task_assets_selected_idx"`
	CreatedAt      string `gorm:"column:created_at;not null"`
	UpdatedAt      string `gorm:"column:updated_at;not null"`
}

// TableName returns the backing table name.
func (GenerationTaskAssetModel) TableName() string {
	return "generation_task_assets"
}

// ProjectResourceAssetModel indexes project-level selected generation assets.
type ProjectResourceAssetModel struct {
	ID             string `gorm:"column:id;primaryKey"`
	ProjectID      string `gorm:"column:project_id;not null;index:project_resource_assets_project_resource_idx,priority:1"`
	ResourceType   string `gorm:"column:resource_type;not null;index:project_resource_assets_project_resource_idx,priority:2"`
	TaskID         string `gorm:"column:task_id;not null;index:project_resource_assets_task_idx"`
	AssetIndex     int    `gorm:"column:asset_index;not null"`
	LibraryAssetID string `gorm:"column:library_asset_id;not null;default:'';index:project_resource_assets_library_asset_idx"`
	Kind           string `gorm:"column:kind;not null;default:''"`
	Title          string `gorm:"column:title;not null;default:''"`
	URL            string `gorm:"column:url;not null;default:''"`
	Base64         string `gorm:"column:base64;not null;default:'';type:text"`
	MIMEType       string `gorm:"column:mime_type;not null;default:''"`
	CreatedAt      string `gorm:"column:created_at;not null"`
	UpdatedAt      string `gorm:"column:updated_at;not null;index:project_resource_assets_project_resource_idx,priority:3,sort:desc"`
}

// TableName returns the backing table name.
func (ProjectResourceAssetModel) TableName() string {
	return "project_resource_assets"
}

// ProjectSelectedAssetModel stores project-level selected creative assets.
type ProjectSelectedAssetModel struct {
	ID               string `gorm:"column:id;primaryKey"`
	ProjectID        string `gorm:"column:project_id;not null;index:project_selected_assets_project_resource_idx,priority:1"`
	ResourceType     string `gorm:"column:resource_type;not null;index:project_selected_assets_project_resource_idx,priority:2"`
	ResourceID       string `gorm:"column:resource_id;not null;default:'';index:project_selected_assets_resource_id_idx"`
	ResourceTitle    string `gorm:"column:resource_title;not null;default:''"`
	MediaAssetID     string `gorm:"column:media_asset_id;not null;default:'';index:project_selected_assets_media_asset_idx"`
	Kind             string `gorm:"column:kind;not null;default:''"`
	Title            string `gorm:"column:title;not null;default:''"`
	URL              string `gorm:"column:url;not null;default:''"`
	Base64           string `gorm:"column:base64;not null;default:'';type:text"`
	MIMEType         string `gorm:"column:mime_type;not null;default:''"`
	SourceType       string `gorm:"column:source_type;not null;default:'';index:project_selected_assets_source_idx,priority:1"`
	SourceTaskID     string `gorm:"column:source_task_id;not null;default:'';index:project_selected_assets_source_task_idx"`
	SourceAssetIndex int    `gorm:"column:source_asset_index;not null"`
	SourceDocumentID string `gorm:"column:source_document_id;not null;default:'';index:project_selected_assets_source_document_idx"`
	SourceKey        string `gorm:"column:source_key;not null;default:'';index:project_selected_assets_source_idx,priority:2"`
	SortOrder        int    `gorm:"column:sort_order;not null;default:0"`
	DeletedAt        string `gorm:"column:deleted_at;not null;default:'';index:project_selected_assets_deleted_idx"`
	CreatedAt        string `gorm:"column:created_at;not null"`
	UpdatedAt        string `gorm:"column:updated_at;not null;index:project_selected_assets_project_resource_idx,priority:3,sort:desc"`
}

// TableName returns the backing table name.
func (ProjectSelectedAssetModel) TableName() string {
	return "project_selected_assets"
}

// GenerationConversationModel is the GORM model for generation conversations.
type GenerationConversationModel struct {
	ID        string `gorm:"column:id;primaryKey"`
	ScopeID   string `gorm:"column:scope_id;not null;default:'studio';index:generation_conversations_scope_kind_idx,priority:1"`
	Kind      string `gorm:"column:kind;not null;index:generation_conversations_scope_kind_idx,priority:2"`
	Title     string `gorm:"column:title;not null"`
	CreatedAt string `gorm:"column:created_at;not null"`
	UpdatedAt string `gorm:"column:updated_at;not null"`
}

// TableName returns the backing table name.
func (GenerationConversationModel) TableName() string {
	return "generation_conversations"
}

// GenerationPreferenceModel is the GORM model for generation preferences.
type GenerationPreferenceModel struct {
	ScopeID         string `gorm:"column:scope_id;primaryKey"`
	FamilyIDsJSON   string `gorm:"column:family_ids_json;not null;default:'{}'"`
	RouteIDsJSON    string `gorm:"column:route_ids_json;not null;default:'{}'"`
	VersionIDsJSON  string `gorm:"column:version_ids_json;not null;default:'{}'"`
	RouteParamsJSON string `gorm:"column:route_params_json;not null;default:'{}'"`
	StylePresetID   string `gorm:"column:style_preset_id;not null;default:''"`
	CreatedAt       string `gorm:"column:created_at;not null"`
	UpdatedAt       string `gorm:"column:updated_at;not null"`
}

// TableName returns the backing table name.
func (GenerationPreferenceModel) TableName() string {
	return "generation_preferences"
}

// GenerationNotificationModel is the GORM model for generation notifications.
type GenerationNotificationModel struct {
	ID          string `gorm:"column:id;primaryKey"`
	TaskID      string `gorm:"column:task_id;not null;uniqueIndex:generation_notifications_task_id_idx"`
	TaskKind    string `gorm:"column:task_kind;not null;default:''"`
	TaskStatus  string `gorm:"column:task_status;not null;default:'pending';index:generation_notifications_project_status_idx,priority:2"`
	ProjectID   string `gorm:"column:project_id;not null;default:'';index:generation_notifications_project_status_idx,priority:1"`
	Title       string `gorm:"column:title;not null;default:''"`
	Description string `gorm:"column:description;not null;default:''"`
	AssetCount  int    `gorm:"column:asset_count;not null;default:0"`
	TargetJSON  string `gorm:"column:target_json;not null;type:text"`
	ReadAt      string `gorm:"column:read_at;not null;default:''"`
	CreatedAt   string `gorm:"column:created_at;not null"`
	UpdatedAt   string `gorm:"column:updated_at;not null;index:generation_notifications_updated_at_idx"`
}

// TableName returns the backing table name.
func (GenerationNotificationModel) TableName() string {
	return "generation_notifications"
}

// PromptCategoryModel is the GORM model for reusable generation prompt categories.
type PromptCategoryModel struct {
	ID        string `gorm:"column:id;primaryKey"`
	Label     string `gorm:"column:label;not null"`
	Source    string `gorm:"column:source;not null;default:'user';index:prompt_categories_source_idx"`
	Builtin   bool   `gorm:"column:builtin;not null;default:false;index:prompt_categories_builtin_idx"`
	CreatedAt string `gorm:"column:created_at;not null"`
	UpdatedAt string `gorm:"column:updated_at;not null"`
}

// TableName returns the backing table name.
func (PromptCategoryModel) TableName() string {
	return "prompt_categories"
}

// PromptLibraryEntryModel is the GORM model for reusable generation prompts.
type PromptLibraryEntryModel struct {
	ID        string `gorm:"column:id;primaryKey"`
	Name      string `gorm:"column:name;not null"`
	Category  string `gorm:"column:category;not null;default:'';index:prompt_library_entries_category_idx"`
	Type      string `gorm:"column:type;not null;index:prompt_library_entries_type_idx"`
	Prompt    string `gorm:"column:prompt;not null;type:text"`
	Source    string `gorm:"column:source;not null;default:'user'"`
	Builtin   bool   `gorm:"column:builtin;not null;default:false;index:prompt_library_entries_builtin_idx"`
	CreatedAt string `gorm:"column:created_at;not null"`
	UpdatedAt string `gorm:"column:updated_at;not null"`
}

// TableName returns the backing table name.
func (PromptLibraryEntryModel) TableName() string {
	return "prompt_library_entries"
}
