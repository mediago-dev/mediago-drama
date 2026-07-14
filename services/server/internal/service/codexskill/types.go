// Package codexskill inventories filesystem-backed Codex skills without executing them.
package codexskill

import (
	"context"
	"errors"
	"time"
)

// ErrNotFound indicates that a skill ID is not present in the current discovery result.
var ErrNotFound = errors.New("codex skill not found")

// Source identifies the filesystem discovery source for a skill.
type Source string

const (
	// SourceUserShared is the cross-Codex user directory at ~/.agents/skills.
	SourceUserShared Source = "user_shared"
	// SourceCodexHome is the compatibility directory below the host Codex home.
	SourceCodexHome Source = "codex_home"
	// SourceAdmin is an administrator-managed Codex skills directory.
	SourceAdmin Source = "admin"
	// SourceSystem is the visible .system container below the host Codex home.
	SourceSystem Source = "system"
)

// SyntaxValidity describes whether required SKILL.md frontmatter is valid.
type SyntaxValidity string

const (
	// SyntaxValid indicates valid required frontmatter.
	SyntaxValid SyntaxValidity = "valid"
	// SyntaxInvalid indicates missing or invalid required frontmatter.
	SyntaxInvalid SyntaxValidity = "invalid"
)

// AvailabilityState describes expected availability on a Codex surface.
type AvailabilityState string

const (
	// AvailabilityAvailable means current discovery rules predict the skill is available.
	AvailabilityAvailable AvailabilityState = "available"
	// AvailabilityDisabled means config explicitly disables the skill.
	AvailabilityDisabled AvailabilityState = "disabled"
	// AvailabilityNotShared means an isolated MediaGo Codex home cannot discover the entry.
	AvailabilityNotShared AvailabilityState = "not_shared"
	// AvailabilityInvalid means SKILL.md is invalid.
	AvailabilityInvalid AvailabilityState = "invalid"
	// AvailabilityUnknown means static inspection cannot safely determine availability.
	AvailabilityUnknown AvailabilityState = "unknown"
)

// ReasonCode is a stable machine-readable reason for an availability result.
type ReasonCode string

const (
	// ReasonUserShared identifies a shared user skill.
	ReasonUserShared ReasonCode = "user_shared"
	// ReasonCodexHome identifies a host Codex home skill.
	ReasonCodexHome ReasonCode = "codex_home"
	// ReasonAdmin identifies an administrator-managed skill.
	ReasonAdmin ReasonCode = "admin"
	// ReasonSystem identifies a visible system skill.
	ReasonSystem ReasonCode = "system"
	// ReasonDisabledByConfig identifies an explicit skills.config disable rule.
	ReasonDisabledByConfig ReasonCode = "disabled_by_config"
	// ReasonRuntimeHomeIsolated identifies a host Codex home hidden by MediaGo isolation.
	ReasonRuntimeHomeIsolated ReasonCode = "runtime_home_isolated"
	// ReasonSharedPhysicalSkill means another runtime-visible entry resolves to the same skill.
	ReasonSharedPhysicalSkill ReasonCode = "shared_physical_skill"
	// ReasonInvalidSkill identifies invalid required SKILL.md metadata.
	ReasonInvalidSkill ReasonCode = "invalid_skill"
	// ReasonConfigUnreadable means a surface config could not be read.
	ReasonConfigUnreadable ReasonCode = "config_unreadable"
	// ReasonConfigInvalid means a surface config could not be parsed.
	ReasonConfigInvalid ReasonCode = "config_invalid"
	// ReasonRuntimeHomeUnknown means MediaGo runtime home inspection failed.
	ReasonRuntimeHomeUnknown ReasonCode = "runtime_home_unknown"
	// ReasonSystemRuntimeUnconfirmed means an isolated runtime's bundled system skills are unknown.
	ReasonSystemRuntimeUnconfirmed ReasonCode = "system_runtime_unconfirmed"
	// ReasonProductRestricted means metadata does not declare Codex as an allowed product.
	ReasonProductRestricted ReasonCode = "product_restricted"
	// ReasonBundledDisabled means bundled system skills are disabled in config.
	ReasonBundledDisabled ReasonCode = "bundled_disabled"
)

// IssueCode is a stable machine-readable inventory diagnostic code.
type IssueCode string

const (
	// IssueSkillFileMissing indicates a candidate directory has no SKILL.md.
	IssueSkillFileMissing IssueCode = "skill_file_missing"
	// IssuePreviewUnavailable indicates raw SKILL.md content exceeds the preview limit.
	IssuePreviewUnavailable IssueCode = "preview_unavailable"
	// IssueSkillFileUnreadable indicates SKILL.md could not be read.
	IssueSkillFileUnreadable IssueCode = "skill_file_unreadable"
	// IssueFrontmatterMissing indicates SKILL.md has no complete YAML frontmatter block.
	IssueFrontmatterMissing IssueCode = "frontmatter_missing"
	// IssueFrontmatterInvalid indicates SKILL.md frontmatter is invalid YAML.
	IssueFrontmatterInvalid IssueCode = "frontmatter_invalid"
	// IssueNameRequired indicates required frontmatter name is empty.
	IssueNameRequired IssueCode = "name_required"
	// IssueNameInvalid indicates the normalized skill name exceeds loader limits.
	IssueNameInvalid IssueCode = "name_invalid"
	// IssueDescriptionRequired indicates required frontmatter description is empty.
	IssueDescriptionRequired IssueCode = "description_required"
	// IssueMetadataFileTooLarge indicates agents/openai.yaml exceeds the bounded read size.
	IssueMetadataFileTooLarge IssueCode = "metadata_file_too_large"
	// IssueMetadataUnreadable indicates agents/openai.yaml could not be read.
	IssueMetadataUnreadable IssueCode = "metadata_unreadable"
	// IssueMetadataInvalid indicates agents/openai.yaml contains invalid YAML.
	IssueMetadataInvalid IssueCode = "metadata_invalid"
	// IssueRootUnreadable indicates a discovery root could not be enumerated.
	IssueRootUnreadable IssueCode = "root_unreadable"
	// IssueConfigUnreadable indicates a Codex config file could not be read.
	IssueConfigUnreadable IssueCode = "config_unreadable"
	// IssueConfigInvalid indicates a Codex config file contains invalid TOML.
	IssueConfigInvalid IssueCode = "config_invalid"
	// IssueRuntimeHomeUnavailable indicates runtime-home inspection failed.
	IssueRuntimeHomeUnavailable IssueCode = "runtime_home_unavailable"
	// IssueRootScanLimit indicates a root reached a bounded traversal limit.
	IssueRootScanLimit IssueCode = "root_scan_limit"
	// IssueBrokenSymlink indicates a discovery symlink target cannot be inspected.
	IssueBrokenSymlink IssueCode = "broken_symlink"
)

// SurfaceDiagnostic describes expected skill availability on one Codex surface.
type SurfaceDiagnostic struct {
	State      AvailabilityState `json:"state"`
	ReasonCode ReasonCode        `json:"reasonCode"`
	Message    string            `json:"message"`
}

// ToolDependency describes one optional tool dependency declared by a skill.
type ToolDependency struct {
	Type        string `json:"type" yaml:"type"`
	Value       string `json:"value" yaml:"value"`
	Description string `json:"description,omitempty" yaml:"description"`
	Transport   string `json:"transport,omitempty" yaml:"transport"`
	URL         string `json:"url,omitempty" yaml:"url"`
}

// Issue describes a non-fatal source or skill diagnostic.
type Issue struct {
	Code        IssueCode `json:"code"`
	Message     string    `json:"message"`
	Source      Source    `json:"source,omitempty"`
	DisplayPath string    `json:"displayPath,omitempty"`
}

// Root describes one predefined filesystem discovery root.
type Root struct {
	Source         Source `json:"source"`
	DisplayPath    string `json:"displayPath"`
	Exists         bool   `json:"exists"`
	Readable       bool   `json:"readable"`
	MediaGoVisible bool   `json:"mediaGoVisible"`
	Deprecated     bool   `json:"deprecated"`
	Error          string `json:"error,omitempty"`
}

// SkillOrigin records one discovery entry retained after physical deduplication.
type SkillOrigin struct {
	Source      Source `json:"source"`
	DisplayPath string `json:"displayPath"`
	Linked      bool   `json:"linked"`
	Deprecated  bool   `json:"deprecated"`
}

// Summary provides compact list counts for the settings UI.
type Summary struct {
	Total            int `json:"total"`
	MediaGoAvailable int `json:"mediaGoAvailable"`
	NeedsAttention   int `json:"needsAttention"`
	Unknown          int `json:"unknown"`
}

// SkillSummary is the bounded metadata returned by the inventory list.
type SkillSummary struct {
	ID                      string            `json:"id"`
	Name                    string            `json:"name"`
	DisplayName             string            `json:"displayName,omitempty"`
	Description             string            `json:"description"`
	ShortDescription        string            `json:"shortDescription,omitempty"`
	Source                  Source            `json:"source"`
	DisplayPath             string            `json:"displayPath"`
	Linked                  bool              `json:"linked"`
	Deprecated              bool              `json:"deprecated"`
	Origins                 []SkillOrigin     `json:"origins"`
	AliasCount              int               `json:"aliasCount"`
	Valid                   bool              `json:"valid"`
	SyntaxValidity          SyntaxValidity    `json:"syntaxValidity"`
	SameNameCount           int               `json:"sameNameCount"`
	SamePhysicalCount       int               `json:"samePhysicalCount"`
	AppCLI                  SurfaceDiagnostic `json:"appCli"`
	MediaGo                 SurfaceDiagnostic `json:"mediaGo"`
	AllowImplicitInvocation *bool             `json:"allowImplicitInvocation,omitempty"`
	DefaultPrompt           string            `json:"defaultPrompt,omitempty"`
	Products                []string          `json:"products,omitempty"`
	HasScripts              bool              `json:"hasScripts"`
	HasReferences           bool              `json:"hasReferences"`
	HasAssets               bool              `json:"hasAssets"`
	DependencyCount         int               `json:"dependencyCount"`
}

// ListResponse is the complete read-only Codex skill inventory.
type ListResponse struct {
	GeneratedAt string         `json:"generatedAt"`
	Summary     Summary        `json:"summary"`
	Roots       []Root         `json:"roots"`
	Issues      []Issue        `json:"issues"`
	Skills      []SkillSummary `json:"skills"`
}

// Detail contains one summary plus bounded raw and optional metadata diagnostics.
type Detail struct {
	SkillSummary
	AbsolutePath     string           `json:"absolutePath"`
	ResolvedPath     string           `json:"resolvedPath,omitempty"`
	RawContent       string           `json:"rawContent"`
	PreviewAvailable bool             `json:"previewAvailable"`
	Dependencies     []ToolDependency `json:"dependencies"`
	Issues           []Issue          `json:"issues"`
}

// RuntimeHomeDescriptor describes an optional isolated MediaGo Codex home.
type RuntimeHomeDescriptor struct {
	CodexHome string
	Isolated  bool
}

// RuntimeHomeProvider returns the expected MediaGo Codex runtime home without mutating it.
type RuntimeHomeProvider func(context.Context) (RuntimeHomeDescriptor, error)

// ServiceOptions injects deterministic environment and root providers for discovery.
type ServiceOptions struct {
	HomeDir             func() (string, error)
	LookupEnv           func(string) (string, bool)
	RuntimeHome         RuntimeHomeProvider
	AdminRoots          []string
	Now                 func() time.Time
	maxDiscoveryDepth   int
	maxDiscoveryDirs    int
	maxDiscoveryEntries int
}
