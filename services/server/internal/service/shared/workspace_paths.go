package shared

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
)

const (
	userDataDirName = "mediago-drama"
	metadataDirName = ".mediago-drama"
)

// WorkspaceManifestFile is the root workspace manifest shape.
type WorkspaceManifestFile struct {
	SchemaVersion int    `json:"schemaVersion"`
	WorkspaceID   string `json:"workspaceId"`
	Name          string `json:"name"`
	CreatedAt     string `json:"createdAt"`
}

// WorkspaceConfigFile is the local workspace config file shape.
type WorkspaceConfigFile struct {
	SchemaVersion int    `json:"schemaVersion"`
	WorkspaceRoot string `json:"workspaceRoot"`
	DatabasePath  string `json:"databasePath"`
	LibraryDir    string `json:"libraryDir"`
}

// ProviderConfigFile is the provider registry config file shape.
type ProviderConfigFile struct {
	SchemaVersion int      `json:"schemaVersion"`
	Providers     []string `json:"providers"`
}

// AgentConfigFile is the agent runtime config file shape.
type AgentConfigFile struct {
	SchemaVersion int      `json:"schemaVersion"`
	DefaultMode   string   `json:"defaultMode"`
	AllowedRoots  []string `json:"allowedRoots"`
}

// ProjectManifestFile is a project's local manifest shape.
type ProjectManifestFile struct {
	SchemaVersion int                         `json:"schemaVersion"`
	ProjectID     string                      `json:"projectId"`
	Name          string                      `json:"name"`
	Description   string                      `json:"description"`
	Overview      ProjectManifestOverviewFile `json:"overview"`
	CreatedAt     string                      `json:"createdAt"`
}

// ProjectManifestOverviewFile is the overview config stored in project.media.json.
type ProjectManifestOverviewFile struct {
	Style            string            `json:"style"`
	CategoryDefaults map[string]string `json:"categoryDefaults,omitempty"`
}

// UnmarshalJSON accepts project files written with the legacy layerDefaults key.
func (overview *ProjectManifestOverviewFile) UnmarshalJSON(data []byte) error {
	type projectManifestOverviewFileAlias ProjectManifestOverviewFile
	payload := struct {
		projectManifestOverviewFileAlias
		LegacyLayerDefaults map[string]string `json:"layerDefaults,omitempty"`
	}{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	*overview = ProjectManifestOverviewFile(payload.projectManifestOverviewFileAlias)
	if len(overview.CategoryDefaults) == 0 && len(payload.LegacyLayerDefaults) > 0 {
		overview.CategoryDefaults = payload.LegacyLayerDefaults
	}
	return nil
}

// EnsureProjectManifestFile writes the canonical project.media.json shape.
func EnsureProjectManifestFile(path string, project mediamcp.Project) error {
	current, err := ReadProjectManifestFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		current = ProjectManifestFile{}
	}

	next := NormalizeProjectManifestFile(project, current)
	if reflect.DeepEqual(current, next) {
		return nil
	}
	return WriteJSONFile(path, next)
}

// ReadProjectManifestFile reads project.media.json.
func ReadProjectManifestFile(path string) (ProjectManifestFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ProjectManifestFile{}, fmt.Errorf("reading %s: %w", filepath.Base(path), err)
	}
	var manifest ProjectManifestFile
	if err := json.Unmarshal(data, &manifest); err != nil {
		return ProjectManifestFile{}, fmt.Errorf("decoding %s: %w", filepath.Base(path), err)
	}
	return manifest, nil
}

// NormalizeProjectManifestFile returns the canonical v1 project.media.json shape.
func NormalizeProjectManifestFile(project mediamcp.Project, current ProjectManifestFile) ProjectManifestFile {
	project.ID = domain.CleanProjectID(project.ID)
	name := strings.TrimSpace(project.Name)
	if name == "" {
		name = strings.TrimSpace(current.Name)
	}
	description := strings.TrimSpace(project.Description)
	if description == "" && strings.TrimSpace(project.Description) == "" {
		description = strings.TrimSpace(current.Description)
	}
	createdAt := strings.TrimSpace(current.CreatedAt)
	if createdAt == "" {
		createdAt = strings.TrimSpace(project.CreatedAt)
	}
	return ProjectManifestFile{
		SchemaVersion: 1,
		ProjectID:     FirstNonEmpty(project.ID, strings.TrimSpace(current.ProjectID)),
		Name:          name,
		Description:   description,
		Overview: ProjectManifestOverviewFile{
			Style:            strings.TrimSpace(current.Overview.Style),
			CategoryDefaults: current.Overview.CategoryDefaults,
		},
		CreatedAt: createdAt,
	}
}

// WorkspacePaths contains canonical paths for a local MediaGo Drama workspace.
type WorkspacePaths struct {
	Root string
}

// ResolveWorkspaceDir returns the local MediaGo Drama workspace root used by the server.
func ResolveWorkspaceDir(workspaceDir string) string {
	dir := strings.TrimSpace(workspaceDir)
	if dir == "" {
		return defaultWorkspaceDir()
	}
	if strings.HasPrefix(dir, "~/") || dir == "~" {
		if homeDir, err := os.UserHomeDir(); err == nil && homeDir != "" {
			if dir == "~" {
				dir = homeDir
			} else {
				dir = filepath.Join(homeDir, strings.TrimPrefix(dir, "~/"))
			}
		}
	}
	if absDir, err := filepath.Abs(dir); err == nil {
		dir = absDir
	}
	return filepath.Clean(dir)
}

func defaultWorkspaceDir() string {
	return filepath.Join(DefaultUserDataDir(), "workspace")
}

// DefaultUserDataDir returns the app-owned data directory for global MediaGo Drama files.
func DefaultUserDataDir() string {
	if configDir, err := os.UserConfigDir(); err == nil && strings.TrimSpace(configDir) != "" {
		return filepath.Join(configDir, userDataDirName)
	}
	if cwd, err := os.Getwd(); err == nil && cwd != "" {
		return filepath.Join(cwd, metadataDirName)
	}
	return filepath.Join(".", metadataDirName)
}

// WorkspacePathsFor returns a canonical workspace path helper.
func WorkspacePathsFor(root string) WorkspacePaths {
	return WorkspacePaths{Root: ResolveWorkspaceDir(root)}
}

// GlobalMetadataDir returns the workspace metadata directory.
func (paths WorkspacePaths) GlobalMetadataDir() string {
	return filepath.Join(paths.Root, metadataDirName)
}

// ConfigDir returns the workspace config directory.
func (paths WorkspacePaths) ConfigDir() string {
	return filepath.Join(paths.GlobalMetadataDir(), "config")
}

// DatabaseDir returns the workspace database directory.
func (paths WorkspacePaths) DatabaseDir() string {
	return filepath.Join(paths.GlobalMetadataDir(), "db")
}

// DatabasePath returns the workspace SQLite database path.
func (paths WorkspacePaths) DatabasePath() string {
	return filepath.Join(paths.DatabaseDir(), "app.db")
}

// MediaPosterCacheDir returns the hidden cache for generated video preview posters.
func (paths WorkspacePaths) MediaPosterCacheDir() string {
	return filepath.Join(paths.GlobalMetadataDir(), "cache", "media-posters")
}

// LibraryAssetsDir returns the visible global media library root.
func (paths WorkspacePaths) LibraryAssetsDir() string {
	return filepath.Join(paths.Root, "library")
}

// ProjectLibraryAssetsDir returns a project's visible media library root.
func ProjectLibraryAssetsDir(projectDir string) string {
	return filepath.Join(ResolveWorkspaceDir(projectDir), "library")
}

// AssetKindDirName maps media kinds to legacy filesystem directory names.
func AssetKindDirName(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case AssetKindImage:
		return "images"
	case AssetKindVideo:
		return "video"
	case AssetKindAudio:
		return "audio"
	case AssetKindText:
		return "text"
	default:
		return "text"
	}
}

var assetPathSegmentPattern = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// AssetPathSegment returns a stable, safe path segment for generated asset grouping.
func AssetPathSegment(value string, fallback string) string {
	segment := strings.TrimSpace(value)
	if unescaped, err := url.QueryUnescape(segment); err == nil {
		segment = unescaped
	}
	segment = strings.ReplaceAll(segment, string(filepath.Separator), "-")
	segment = strings.ReplaceAll(segment, "/", "-")
	segment = strings.ReplaceAll(segment, "\\", "-")
	segment = assetPathSegmentPattern.ReplaceAllString(segment, "-")
	segment = strings.Trim(segment, ".- ")
	if segment == "" {
		segment = strings.TrimSpace(fallback)
	}
	if segment == "" {
		segment = "ungrouped"
	}
	return segment
}

// AgentDir returns the default root directory for an agent project.
func (paths WorkspacePaths) AgentDir(projectID string) string {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return filepath.Join(paths.Root, "projects")
	}
	return filepath.Join(paths.Root, "projects", projectID)
}

// StudioSessionDir returns the root directory for a studio session.
func (paths WorkspacePaths) StudioSessionDir(sessionID string) string {
	sessionID = domain.CleanProjectID(sessionID)
	if sessionID == "" {
		return filepath.Join(paths.GlobalMetadataDir(), "toolbox")
	}
	return filepath.Join(paths.GlobalMetadataDir(), "toolbox", sessionID)
}

// StudioRunDir returns the root directory for one studio capability run.
func (paths WorkspacePaths) StudioRunDir(capabilityID string, runID string, createdAt string) string {
	runID = domain.CleanProjectID(runID)
	if runID == "" {
		runID = "run"
	}
	return filepath.Join(
		paths.StudioSessionDir(""),
		StudioToolDirName(capabilityID),
		studioRunMonth(createdAt),
		runID,
	)
}

// StudioGenerationSessionDir returns the root directory for one studio generation conversation.
func (paths WorkspacePaths) StudioGenerationSessionDir(kind string, sessionID string, createdAt string) string {
	sessionID = domain.CleanProjectID(sessionID)
	if sessionID == "" {
		sessionID = "conversation"
	}
	return filepath.Join(
		paths.StudioSessionDir(""),
		StudioGenerationDirName(kind),
		studioRunMonth(createdAt),
		sessionID,
	)
}

var studioToolDirNamePattern = regexp.MustCompile(`[^a-z0-9]+`)

// StudioToolDirName returns a stable filesystem segment for a studio capability.
func StudioToolDirName(capabilityID string) string {
	normalized := strings.ToLower(strings.TrimSpace(capabilityID))
	normalized = strings.ReplaceAll(normalized, ".", "-")
	normalized = studioToolDirNamePattern.ReplaceAllString(normalized, "-")
	normalized = strings.Trim(normalized, "-")
	if normalized == "" {
		return "unknown-tool"
	}
	return normalized
}

// StudioGenerationDirName returns the filesystem segment for a studio generation kind.
func StudioGenerationDirName(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "image":
		return "image-generation"
	case "video":
		return "video-generation"
	case "text":
		return "text-generation"
	default:
		normalized := StudioToolDirName(kind)
		if normalized == "unknown-tool" {
			return "generation"
		}
		return normalized + "-generation"
	}
}

func studioRunMonth(createdAt string) string {
	createdAt = strings.TrimSpace(createdAt)
	if createdAt != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, createdAt); err == nil {
			return parsed.Format("2006-01")
		}
	}
	return time.Now().Format("2006-01")
}

// ProjectDir returns the root directory for a project.
func (paths WorkspacePaths) ProjectDir(projectID string) string {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return paths.Root
	}
	return ""
}

// ProjectDirFor returns the root directory for a project record.
func (paths WorkspacePaths) ProjectDirFor(project mediamcp.Project) string {
	projectDir := strings.TrimSpace(project.ProjectDir)
	if projectDir == "" {
		return paths.ProjectDir(project.ID)
	}
	return ResolveWorkspaceDir(projectDir)
}

// DisplayProjectDir returns a stable path label for a project directory.
func DisplayProjectDir(workspaceRoot string, projectDir string) string {
	workspaceRoot = ResolveWorkspaceDir(workspaceRoot)
	projectDir = ResolveWorkspaceDir(projectDir)
	if relative, err := filepath.Rel(workspaceRoot, projectDir); err == nil &&
		relative != "." &&
		!strings.HasPrefix(relative, ".."+string(filepath.Separator)) &&
		relative != ".." &&
		!filepath.IsAbs(relative) {
		return filepath.ToSlash(relative)
	}
	return filepath.ToSlash(projectDir)
}

// MetadataDir returns the project or global metadata directory.
func (paths WorkspacePaths) MetadataDir(projectID string) string {
	if domain.CleanProjectID(projectID) == "" {
		return paths.GlobalMetadataDir()
	}
	projectDir := paths.ProjectDir(projectID)
	if projectDir == "" {
		return ""
	}
	return filepath.Join(projectDir, metadataDirName)
}

// ProjectMetadataDir returns the hidden metadata directory for a concrete project directory.
func ProjectMetadataDir(projectDir string) string {
	return filepath.Join(ResolveWorkspaceDir(projectDir), metadataDirName)
}

// ProjectMediaPosterCacheDir returns the hidden project cache for generated video preview posters.
func ProjectMediaPosterCacheDir(projectDir string) string {
	return filepath.Join(ProjectMetadataDir(projectDir), "cache", "media-posters")
}

// DocumentsDir returns the project documents directory.
func (paths WorkspacePaths) DocumentsDir(projectID string) string {
	projectDir := paths.ProjectDir(projectID)
	if projectDir == "" {
		return ""
	}
	return filepath.Join(projectDir, "work")
}

// AgentHistoryPath returns the legacy agent history JSONL path.
func (paths WorkspacePaths) AgentHistoryPath(projectID string) string {
	projectDir := paths.ProjectDir(projectID)
	if projectDir == "" {
		return ""
	}
	return filepath.Join(projectDir, "agent-history.jsonl")
}

// EnsureWorkspaceLayout creates the standard workspace directory tree and config files.
func EnsureWorkspaceLayout(root string) error {
	paths := WorkspacePathsFor(root)
	if err := migrateDeprecatedWorkspaceToolboxDir(paths); err != nil {
		return err
	}
	dirs := []string{
		paths.Root,
		paths.ConfigDir(),
		paths.DatabaseDir(),
		filepath.Join(paths.GlobalMetadataDir(), "logs"),
		filepath.Join(paths.GlobalMetadataDir(), "cache"),
		paths.MediaPosterCacheDir(),
		filepath.Join(paths.GlobalMetadataDir(), "temp"),
		filepath.Join(paths.GlobalMetadataDir(), "locks"),
		filepath.Join(paths.GlobalMetadataDir(), "trash"),
		paths.LibraryAssetsDir(),
		paths.AgentDir(""),
		paths.StudioSessionDir(""),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("creating workspace directory %s: %w", dir, err)
		}
	}

	now := timestamp.NowRFC3339Nano()
	if err := WriteJSONFileIfMissing(filepath.Join(paths.Root, "media.workspace.json"), WorkspaceManifestFile{
		SchemaVersion: 1,
		WorkspaceID:   FallbackWorkspaceID(paths.Root),
		Name:          filepath.Base(paths.Root),
		CreatedAt:     now,
	}); err != nil {
		return err
	}
	if err := WriteJSONFileIfMissing(filepath.Join(paths.ConfigDir(), "workspace.json"), WorkspaceConfigFile{
		SchemaVersion: 1,
		WorkspaceRoot: paths.Root,
		DatabasePath:  paths.DatabasePath(),
		LibraryDir:    "library",
	}); err != nil {
		return err
	}
	if err := WriteJSONFileIfMissing(filepath.Join(paths.ConfigDir(), "providers.json"), ProviderConfigFile{
		SchemaVersion: 1,
		Providers:     []string{},
	}); err != nil {
		return err
	}
	if err := WriteJSONFileIfMissing(filepath.Join(paths.ConfigDir(), "agents.json"), AgentConfigFile{
		SchemaVersion: 1,
		DefaultMode:   "project",
		AllowedRoots:  []string{"library"},
	}); err != nil {
		return err
	}
	return nil
}

// EnsureProjectLayout creates the standard project directory tree and starter files.
func EnsureProjectLayout(root string, project mediamcp.Project) error {
	paths := WorkspacePathsFor(root)
	project.ID = domain.CleanProjectID(project.ID)
	if project.ID == "" {
		return nil
	}

	projectDir := paths.ProjectDirFor(project)
	if projectDir == "" {
		return fmt.Errorf("projectDir is required for project %s", project.ID)
	}
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return fmt.Errorf("creating project directory %s: %w", projectDir, err)
	}
	if err := migrateDeprecatedProjectDocsDir(projectDir); err != nil {
		return err
	}
	for _, dir := range []string{
		filepath.Join(projectDir, "work"),
		ProjectLibraryAssetsDir(projectDir),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("creating project directory %s: %w", dir, err)
		}
	}

	if err := EnsureProjectManifestFile(filepath.Join(projectDir, "project.media.json"), project); err != nil {
		return err
	}
	if err := WriteTextFileIfMissing(
		filepath.Join(projectDir, "README.md"),
		"# "+project.Name+"\n\n"+strings.TrimSpace(project.Description)+"\n",
	); err != nil {
		return err
	}
	return nil
}

func migrateDeprecatedWorkspaceToolboxDir(paths WorkspacePaths) error {
	oldDir := filepath.Join(paths.Root, "toolbox")
	newDir := paths.StudioSessionDir("")
	oldInfo, err := os.Stat(oldDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("checking deprecated workspace toolbox directory: %w", err)
	}
	if !oldInfo.IsDir() {
		return nil
	}
	if _, err := os.Stat(newDir); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(newDir), 0o755); err != nil {
			return fmt.Errorf("creating metadata directory for toolbox migration: %w", err)
		}
		if err := os.Rename(oldDir, newDir); err == nil {
			return nil
		}
	}
	if err := os.MkdirAll(newDir, 0o755); err != nil {
		return fmt.Errorf("creating workspace toolbox metadata directory: %w", err)
	}
	if err := moveWorkspaceDirContents(oldDir, newDir); err != nil {
		return err
	}
	_ = os.Remove(oldDir)
	return nil
}

func moveWorkspaceDirContents(oldDir string, newDir string) error {
	entries, err := os.ReadDir(oldDir)
	if err != nil {
		return fmt.Errorf("reading deprecated workspace toolbox directory: %w", err)
	}
	for _, entry := range entries {
		oldPath := filepath.Join(oldDir, entry.Name())
		newPath := filepath.Join(newDir, entry.Name())
		if _, err := os.Stat(newPath); err == nil {
			if entry.IsDir() {
				if err := moveWorkspaceDirContents(oldPath, newPath); err != nil {
					return err
				}
				_ = os.Remove(oldPath)
			}
			continue
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("checking toolbox migration target %s: %w", newPath, err)
		}
		if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
			return fmt.Errorf("creating toolbox migration target directory: %w", err)
		}
		if err := os.Rename(oldPath, newPath); err != nil {
			return fmt.Errorf("moving deprecated toolbox path %s: %w", oldPath, err)
		}
	}
	return nil
}

func migrateDeprecatedProjectDocsDir(projectDir string) error {
	docsDir := filepath.Join(projectDir, "docs")
	workDir := filepath.Join(projectDir, "work")
	docsInfo, err := os.Stat(docsDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("checking deprecated docs directory: %w", err)
	}
	if !docsInfo.IsDir() {
		return nil
	}

	if _, err := os.Stat(workDir); os.IsNotExist(err) {
		if err := os.Rename(docsDir, workDir); err != nil {
			return fmt.Errorf("migrating docs directory to work: %w", err)
		}
		return nil
	} else if err != nil {
		return fmt.Errorf("checking work directory before docs migration: %w", err)
	}

	return filepath.WalkDir(docsDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("walking deprecated docs directory: %w", err)
		}
		if path == docsDir {
			return nil
		}
		relative, err := filepath.Rel(docsDir, path)
		if err != nil {
			return fmt.Errorf("relativizing deprecated docs path: %w", err)
		}
		target := filepath.Join(workDir, relative)
		if entry.IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("creating migrated work directory %s: %w", relative, err)
			}
			return nil
		}
		if _, err := os.Stat(target); err == nil {
			return nil
		} else if err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("checking migrated work file %s: %w", relative, err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("reading deprecated docs file %s: %w", relative, err)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("creating migrated work file directory %s: %w", relative, err)
		}
		if err := os.WriteFile(target, data, 0o644); err != nil {
			return fmt.Errorf("writing migrated work file %s: %w", relative, err)
		}
		return nil
	})
}
