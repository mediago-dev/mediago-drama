package media

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

const assetMigrationTimestampLayout = "20060102-150405"

var migrationMediaAssetURLPattern = regexp.MustCompile(`/api(?:/v1)?/(?:projects/[^/]+/)?(?:media/assets|media-assets)/([^/?#]+)/content`)

// AssetMigrationOptions controls the one-time local asset library migration.
type AssetMigrationOptions struct {
	Apply        bool
	ManifestPath string
	WorkspaceDir string
}

// AssetMigrationReport is written as JSON and returned to callers.
type AssetMigrationReport struct {
	Apply                bool                  `json:"apply"`
	BackupPath           string                `json:"backupPath,omitempty"`
	CreatedAt            string                `json:"createdAt"`
	DatabasePath         string                `json:"databasePath"`
	Entries              []AssetMigrationEntry `json:"entries"`
	ManifestPath         string                `json:"manifestPath"`
	Updated              int                   `json:"updated"`
	Moved                int                   `json:"moved"`
	Missing              int                   `json:"missing"`
	Registered           int                   `json:"registered"`
	Skipped              int                   `json:"skipped"`
	Errors               int                   `json:"errors"`
	TaskProjectIDUpdates int                   `json:"taskProjectIdUpdates"`
	WorkspaceDir         string                `json:"workspaceDir"`
}

// AssetMigrationEntry describes one media asset move/update decision.
type AssetMigrationEntry struct {
	AssetID        string `json:"assetId"`
	Kind           string `json:"kind"`
	OldPath        string `json:"oldPath"`
	NewPath        string `json:"newPath"`
	OldPosterPath  string `json:"oldPosterPath,omitempty"`
	NewPosterPath  string `json:"newPosterPath,omitempty"`
	PosterStatus   string `json:"posterStatus,omitempty"`
	PosterError    string `json:"posterError,omitempty"`
	Source         string `json:"source"`
	ProjectID      string `json:"projectId,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
	SectionID      string `json:"sectionId,omitempty"`
	RelativePath   string `json:"relativePath"`
	Status         string `json:"status"`
	Error          string `json:"error,omitempty"`
	CreatedAt      string `json:"createdAt,omitempty"`
}

type migrationTaskContext struct {
	ConversationID string
	ProjectID      string
	SectionID      string
	TaskID         string
	UpdatedAt      string
}

// RunAssetMigration executes or previews the legacy asset library migration.
func RunAssetMigration(ctx context.Context, options AssetMigrationOptions) (AssetMigrationReport, error) {
	_ = ctx
	workspaceDir := shared.ResolveWorkspaceDir(options.WorkspaceDir)
	paths := shared.WorkspacePathsFor(workspaceDir)
	databasePath := paths.DatabasePath()
	createdAt := timestamp.NowRFC3339Nano()
	backupPath := ""
	if options.Apply {
		var err error
		backupPath, err = backupAssetMigrationDatabase(databasePath, createdAt)
		if err != nil {
			return AssetMigrationReport{}, err
		}
	}
	settingsRepos, err := repository.OpenSettingsRepositories(databasePath)
	if err != nil {
		return AssetMigrationReport{}, err
	}
	workspaceRepos, err := repository.OpenWorkspaceRepositories(databasePath)
	if err != nil {
		return AssetMigrationReport{}, err
	}

	report := AssetMigrationReport{
		Apply:        options.Apply,
		BackupPath:   backupPath,
		CreatedAt:    createdAt,
		DatabasePath: databasePath,
		ManifestPath: assetMigrationManifestPath(paths, options.ManifestPath),
		WorkspaceDir: workspaceDir,
		Entries:      []AssetMigrationEntry{},
	}

	assets, err := settingsRepos.MediaAssets.ListAllMediaAssets()
	if err != nil {
		return AssetMigrationReport{}, err
	}
	tasks, err := settingsRepos.GenerationTasks.ListAllGenerationTasks()
	if err != nil {
		return AssetMigrationReport{}, err
	}
	projects, err := workspaceRepos.Workspace.ListProjectsByStatus(repository.ProjectStatusAll)
	if err != nil {
		return AssetMigrationReport{}, err
	}

	taskContexts := migrationTaskContextsByAssetID(tasks)
	projectDirs := migrationProjectDirs(projects)
	projectAliases := migrationProjectAliases(projectDirs)
	report.Entries = planAssetMigrationEntries(workspaceDir, assets, taskContexts, projectDirs)
	report.Entries = append(report.Entries, planTextToolboxAssetRegistrationEntries(workspaceDir, assets)...)
	tallyAssetMigrationReport(&report)

	if err := writeAssetMigrationManifest(report.ManifestPath, report); err != nil {
		return AssetMigrationReport{}, err
	}
	if !options.Apply {
		return report, nil
	}

	for oldProjectID, newProjectID := range projectAliases {
		updated, err := settingsRepos.GenerationTasks.UpdateGenerationTaskProjectID(oldProjectID, newProjectID)
		if err != nil {
			return AssetMigrationReport{}, err
		}
		report.TaskProjectIDUpdates += int(updated)
	}

	for index := range report.Entries {
		entry := &report.Entries[index]
		if entry.Status == "missing" {
			if err := markMissingAssetMigrationEntry(entry, settingsRepos.MediaAssets, timestamp.NowRFC3339Nano()); err != nil {
				entry.Status = "error"
				entry.Error = err.Error()
			}
			continue
		}
		if entry.Status == "register" {
			if err := registerTextToolboxAssetMigrationEntry(entry, settingsRepos.MediaAssets); err != nil {
				entry.Status = "error"
				entry.Error = err.Error()
				continue
			}
			entry.Status = "registered"
			continue
		}
		if entry.Status == "error" {
			continue
		}
		if err := applyAssetMigrationEntry(entry, settingsRepos.MediaAssets); err != nil {
			entry.Status = "error"
			entry.Error = err.Error()
			continue
		}
		if entry.Status == "planned" {
			entry.Status = "updated"
		}
	}
	tallyAssetMigrationReport(&report)
	if err := writeAssetMigrationManifest(report.ManifestPath, report); err != nil {
		return AssetMigrationReport{}, err
	}
	return report, nil
}

func planAssetMigrationEntries(
	workspaceDir string,
	assets []domain.MediaAssetModel,
	taskContexts map[string]migrationTaskContext,
	projectDirs map[string]string,
) []AssetMigrationEntry {
	entries := make([]AssetMigrationEntry, 0, len(assets))
	for _, asset := range assets {
		entries = append(entries, planAssetMigrationEntry(workspaceDir, asset, taskContexts[asset.ID], projectDirs))
	}
	return entries
}

func planTextToolboxAssetRegistrationEntries(workspaceDir string, assets []domain.MediaAssetModel) []AssetMigrationEntry {
	toolboxDir := filepath.Join(
		workspaceDir,
		"library",
		"assets",
		shared.AssetKindDirName(MediaKindText),
		"toolbox",
	)
	if info, err := os.Stat(toolboxDir); err != nil || !info.IsDir() {
		return []AssetMigrationEntry{}
	}

	knownPaths := migrationKnownAssetPaths(workspaceDir, assets)
	entries := []AssetMigrationEntry{}
	_ = filepath.WalkDir(toolboxDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		extension := strings.ToLower(filepath.Ext(path))
		if extension != ".txt" && extension != ".md" && extension != ".json" {
			return nil
		}
		absolutePath := filepath.Clean(path)
		if knownPaths[absolutePath] {
			return nil
		}
		relativePath, err := filepath.Rel(workspaceDir, absolutePath)
		if err != nil {
			return nil
		}
		conversationID := textToolboxConversationIDForPath(toolboxDir, absolutePath)
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		assetID := textToolboxAssetID(filepath.ToSlash(relativePath))
		entries = append(entries, AssetMigrationEntry{
			AssetID:        assetID,
			Kind:           MediaKindText,
			NewPath:        absolutePath,
			Source:         MediaSourceToolbox,
			ConversationID: conversationID,
			RelativePath:   filepath.ToSlash(relativePath),
			Status:         "register",
			CreatedAt:      info.ModTime().UTC().Format(time.RFC3339Nano),
		})
		return nil
	})
	return entries
}

func migrationKnownAssetPaths(workspaceDir string, assets []domain.MediaAssetModel) map[string]bool {
	known := make(map[string]bool, len(assets)*2)
	for _, asset := range assets {
		for _, path := range []string{asset.Path, asset.RelativePath} {
			absolutePath := absoluteMigrationPath(workspaceDir, path)
			if absolutePath == "" {
				continue
			}
			known[filepath.Clean(absolutePath)] = true
		}
	}
	return known
}

func textToolboxConversationIDForPath(toolboxDir string, path string) string {
	relative, err := filepath.Rel(toolboxDir, path)
	if err != nil {
		return ""
	}
	segments := strings.Split(filepath.ToSlash(relative), "/")
	if len(segments) <= 1 {
		return ""
	}
	return shared.AssetPathSegment(segments[0], "conversation")
}

func textToolboxAssetID(relativePath string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(relativePath)))
	return fmt.Sprintf("asset-text-%x", sum[:8])
}

func planAssetMigrationEntry(
	workspaceDir string,
	asset domain.MediaAssetModel,
	task migrationTaskContext,
	projectDirs map[string]string,
) AssetMigrationEntry {
	oldPath := absoluteMigrationPath(workspaceDir, asset.Path)
	kind := normalizeMigrationKind(asset.Kind, asset.MIMEType)
	projectID := migrationCanonicalProjectID(
		domain.CleanProjectID(shared.FirstNonEmpty(asset.ProjectID, task.ProjectID)),
		projectDirs,
	)
	conversationID := shared.AssetPathSegment(shared.FirstNonEmpty(asset.ConversationID, task.ConversationID), "")
	if strings.EqualFold(conversationID, "ungrouped") {
		conversationID = ""
	}
	sectionID := strings.TrimSpace(shared.FirstNonEmpty(asset.SectionID, task.SectionID))
	source := migrationSourceForAsset(asset, task, projectID, conversationID)

	entry := AssetMigrationEntry{
		AssetID:        strings.TrimSpace(asset.ID),
		Kind:           kind,
		OldPath:        oldPath,
		OldPosterPath:  absoluteMigrationPath(workspaceDir, asset.PosterPath),
		Source:         source,
		ProjectID:      projectID,
		ConversationID: conversationID,
		SectionID:      sectionID,
		Status:         "planned",
	}
	if _, err := os.Stat(oldPath); err != nil {
		entry.Status = "missing"
		entry.Error = err.Error()
		return entry
	}

	extension := filepath.Ext(oldPath)
	if extension == "" {
		extension = filepath.Ext(shared.SafeFilename(asset.Filename))
	}
	if extension == "" {
		extension = shared.ExtensionForMIMEType(asset.MIMEType)
	}
	if extension == "" {
		extension = ".bin"
	}

	relativeDir, rootDir, err := migrationTargetDir(workspaceDir, projectID, mediaAssetDateDirFromTimestamp(asset.CreatedAt), projectDirs)
	if err != nil {
		entry.Status = "error"
		entry.Error = err.Error()
		return entry
	}
	entry.RelativePath = filepath.ToSlash(filepath.Join(relativeDir, entry.AssetID+extension))
	entry.NewPath = filepath.Join(rootDir, entry.RelativePath)

	if entry.OldPosterPath != "" {
		if _, err := os.Stat(entry.OldPosterPath); err == nil {
			entry.NewPosterPath, err = migrationPosterTargetPath(workspaceDir, projectID, entry.AssetID, projectDirs)
			if err != nil {
				entry.Status = "error"
				entry.Error = err.Error()
				return entry
			}
			entry.PosterStatus = "planned"
		} else {
			entry.PosterStatus = "missing"
			entry.PosterError = err.Error()
		}
	}
	if sameMigrationPath(entry.OldPath, entry.NewPath) && sameMigrationPath(entry.OldPosterPath, entry.NewPosterPath) {
		entry.Status = "updated"
	}
	return entry
}

func migrationSourceForAsset(asset domain.MediaAssetModel, task migrationTaskContext, projectID string, conversationID string) string {
	if source := normalizeMediaAssetSource(asset.Source); source != MediaSourceGeneration || strings.TrimSpace(asset.Source) != "" {
		return source
	}
	if projectID != "" {
		if task.TaskID != "" {
			return MediaSourceGeneration
		}
		return MediaSourceUpload
	}
	if task.TaskID != "" && conversationID != "" {
		return MediaSourceToolbox
	}
	return MediaSourceUpload
}

func migrationTargetDir(
	workspaceDir string,
	projectID string,
	dateDir string,
	projectDirs map[string]string,
) (string, string, error) {
	dateDir = strings.TrimSpace(dateDir)
	if dateDir == "" {
		dateDir = mediaAssetDateDirForTime(time.Now())
	}
	relativeDir := filepath.Join("library", dateDir)
	if projectID != "" {
		projectDir := strings.TrimSpace(projectDirs[projectID])
		if projectDir == "" {
			return "", "", fmt.Errorf("project %s was not found", projectID)
		}
		return filepath.ToSlash(relativeDir), projectDir, nil
	}
	return filepath.ToSlash(relativeDir), workspaceDir, nil
}

func migrationPosterTargetPath(
	workspaceDir string,
	projectID string,
	assetID string,
	projectDirs map[string]string,
) (string, error) {
	if projectID != "" {
		projectDir := strings.TrimSpace(projectDirs[projectID])
		if projectDir == "" {
			return "", fmt.Errorf("project %s was not found", projectID)
		}
		return posterPathForVideo(shared.ProjectMediaPosterCacheDir(projectDir), assetID), nil
	}
	return posterPathForVideo(shared.WorkspacePathsFor(workspaceDir).MediaPosterCacheDir(), assetID), nil
}

func applyAssetMigrationEntry(entry *AssetMigrationEntry, repo *repository.MediaAssetRepository) error {
	if strings.TrimSpace(entry.NewPath) == "" {
		return fmt.Errorf("new path is empty")
	}
	if !sameMigrationPath(entry.OldPath, entry.NewPath) {
		if err := moveMigrationFile(entry.OldPath, entry.NewPath); err != nil {
			return err
		}
		entry.Status = "moved"
	}
	if entry.OldPosterPath != "" && entry.NewPosterPath != "" && !sameMigrationPath(entry.OldPosterPath, entry.NewPosterPath) {
		if err := moveMigrationFile(entry.OldPosterPath, entry.NewPosterPath); err != nil {
			return err
		}
	}
	updates := map[string]any{
		"path":            entry.NewPath,
		"project_id":      entry.ProjectID,
		"source":          entry.Source,
		"conversation_id": entry.ConversationID,
		"section_id":      entry.SectionID,
		"relative_path":   entry.RelativePath,
		"storage_status":  StorageStatusReady,
		"storage_error":   "",
	}
	if entry.NewPosterPath != "" {
		updates["poster_path"] = entry.NewPosterPath
	}
	if err := repo.UpdateMediaAssetStorage(entry.AssetID, updates); err != nil {
		return err
	}
	return nil
}

func markMissingAssetMigrationEntry(entry *AssetMigrationEntry, repo *repository.MediaAssetRepository, updatedAt string) error {
	return repo.UpdateMediaAssetStorage(entry.AssetID, map[string]any{
		"storage_status": StorageStatusMissing,
		"storage_error":  entry.Error,
		"updated_at":     updatedAt,
	})
}

func registerTextToolboxAssetMigrationEntry(entry *AssetMigrationEntry, repo *repository.MediaAssetRepository) error {
	info, err := os.Stat(entry.NewPath)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("text toolbox asset path is a directory: %s", entry.NewPath)
	}
	createdAt := strings.TrimSpace(entry.CreatedAt)
	if createdAt == "" {
		createdAt = info.ModTime().UTC().Format(time.RFC3339Nano)
	}
	if createdAt == "" {
		createdAt = timestamp.NowRFC3339Nano()
	}
	filename := shared.SafeFilename(filepath.Base(entry.NewPath))
	return repo.CreateMediaAsset(domain.MediaAssetModel{
		ID:             entry.AssetID,
		Kind:           MediaKindText,
		Filename:       filename,
		MIMEType:       textAssetMIMETypeForFilename(filename),
		SizeBytes:      info.Size(),
		Path:           entry.NewPath,
		URL:            "/api/v1/media-assets/" + url.PathEscape(entry.AssetID) + "/content",
		ProjectID:      "",
		Source:         MediaSourceToolbox,
		ConversationID: entry.ConversationID,
		RelativePath:   entry.RelativePath,
		StorageStatus:  StorageStatusReady,
		CreatedAt:      createdAt,
		UpdatedAt:      createdAt,
	})
}

func textAssetMIMETypeForFilename(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".md":
		return "text/markdown"
	case ".json":
		return "application/json"
	default:
		return "text/plain"
	}
}

func moveMigrationFile(oldPath string, newPath string) error {
	if _, err := os.Stat(oldPath); err != nil {
		return err
	}
	if _, err := os.Stat(newPath); err == nil {
		return fmt.Errorf("target already exists: %s", newPath)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
		return err
	}
	return os.Rename(oldPath, newPath)
}

func migrationTaskContextsByAssetID(tasks []domain.GenerationTaskModel) map[string]migrationTaskContext {
	contexts := map[string]migrationTaskContext{}
	for _, task := range tasks {
		for _, assetID := range migrationAssetIDsFromAssetsJSON(task.AssetsJSON) {
			current, exists := contexts[assetID]
			next := migrationTaskContext{
				ConversationID: task.ConversationID,
				ProjectID:      task.ProjectID,
				SectionID:      task.SectionID,
				TaskID:         task.ID,
				UpdatedAt:      task.UpdatedAt,
			}
			if !exists || migrationTaskContextBetter(next, current) {
				contexts[assetID] = next
			}
		}
	}
	return contexts
}

func migrationTaskContextBetter(next migrationTaskContext, current migrationTaskContext) bool {
	if strings.TrimSpace(next.SectionID) != "" && strings.TrimSpace(current.SectionID) == "" {
		return true
	}
	if strings.TrimSpace(next.ProjectID) != "" && strings.TrimSpace(current.ProjectID) == "" {
		return true
	}
	return next.UpdatedAt > current.UpdatedAt
}

func migrationAssetIDsFromAssetsJSON(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	var rawAssets []map[string]any
	if err := json.Unmarshal([]byte(value), &rawAssets); err != nil {
		return nil
	}
	ids := []string{}
	seen := map[string]struct{}{}
	for _, raw := range rawAssets {
		for _, key := range []string{"url", "URL"} {
			if id := migrationAssetIDFromURL(stringFromAny(raw[key])); id != "" {
				if _, ok := seen[id]; !ok {
					ids = append(ids, id)
					seen[id] = struct{}{}
				}
			}
		}
	}
	return ids
}

func migrationAssetIDFromURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	path := value
	if err == nil && parsed.Path != "" {
		path = parsed.Path
	}
	match := migrationMediaAssetURLPattern.FindStringSubmatch(path)
	if len(match) < 2 {
		return ""
	}
	id, err := url.PathUnescape(match[1])
	if err != nil {
		return match[1]
	}
	return id
}

func migrationProjectDirs(projects []domain.WorkspaceProjectModel) map[string]string {
	projectDirs := map[string]string{}
	for _, project := range projects {
		projectID := domain.CleanProjectID(project.ID)
		projectDir := strings.TrimSpace(project.ProjectDir)
		if projectID == "" || projectDir == "" {
			continue
		}
		projectDirs[projectID] = shared.ResolveWorkspaceDir(projectDir)
	}
	return projectDirs
}

func migrationProjectAliases(projectDirs map[string]string) map[string]string {
	aliases := map[string]string{}
	for projectID := range projectDirs {
		for _, suffix := range []string{"-image", "-video", "-audio"} {
			aliases[projectID+suffix] = projectID
		}
	}
	return aliases
}

func migrationCanonicalProjectID(projectID string, projectDirs map[string]string) string {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return ""
	}
	if strings.TrimSpace(projectDirs[projectID]) != "" {
		return projectID
	}
	for _, suffix := range []string{"-image", "-video", "-audio"} {
		if strings.HasSuffix(projectID, suffix) {
			baseProjectID := strings.TrimSuffix(projectID, suffix)
			if strings.TrimSpace(projectDirs[baseProjectID]) != "" {
				return baseProjectID
			}
		}
	}
	return projectID
}

func normalizeMigrationKind(kind string, mimeType string) string {
	kind = strings.TrimSpace(kind)
	if kind == MediaKindImage || kind == MediaKindVideo || kind == MediaKindAudio || kind == MediaKindText {
		return kind
	}
	if detected := shared.KindFromMIMEType(mimeType); detected == MediaKindImage || detected == MediaKindVideo || detected == MediaKindAudio || detected == MediaKindText {
		return detected
	}
	return MediaKindImage
}

func absoluteMigrationPath(workspaceDir string, path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(workspaceDir, path)
}

func sameMigrationPath(left string, right string) bool {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" || right == "" {
		return left == right
	}
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr == nil && rightErr == nil {
		return leftAbs == rightAbs
	}
	return filepath.Clean(left) == filepath.Clean(right)
}

func backupAssetMigrationDatabase(databasePath string, createdAt string) (string, error) {
	if createdAt == "" {
		createdAt = time.Now().Format(time.RFC3339)
	}
	parsed, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		parsed = time.Now()
	}
	backupPath := databasePath + ".pre-asset-migration-" + parsed.Format(assetMigrationTimestampLayout)
	if err := copyMigrationFile(databasePath, backupPath); err != nil {
		return "", err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if _, err := os.Stat(databasePath + suffix); err == nil {
			_ = copyMigrationFile(databasePath+suffix, backupPath+suffix)
		}
	}
	return backupPath, nil
}

func copyMigrationFile(sourcePath string, destinationPath string) error {
	input, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer input.Close()
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o755); err != nil {
		return err
	}
	output, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer output.Close()
	_, err = io.Copy(output, input)
	return err
}

func assetMigrationManifestPath(paths shared.WorkspacePaths, requested string) string {
	requested = strings.TrimSpace(requested)
	if requested != "" {
		if filepath.IsAbs(requested) {
			return filepath.Clean(requested)
		}
		return filepath.Join(paths.Root, requested)
	}
	return filepath.Join(
		paths.GlobalMetadataDir(),
		"logs",
		"asset-migration-"+time.Now().Format(assetMigrationTimestampLayout)+".json",
	)
}

func writeAssetMigrationManifest(path string, report AssetMigrationReport) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func tallyAssetMigrationReport(report *AssetMigrationReport) {
	report.Updated = 0
	report.Moved = 0
	report.Missing = 0
	report.Registered = 0
	report.Skipped = 0
	report.Errors = 0
	for _, entry := range report.Entries {
		switch entry.Status {
		case "moved":
			report.Moved++
			report.Updated++
		case "updated":
			report.Updated++
		case "registered":
			report.Registered++
			report.Updated++
		case "missing":
			report.Missing++
		case "error":
			report.Errors++
		default:
			report.Skipped++
		}
	}
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}
