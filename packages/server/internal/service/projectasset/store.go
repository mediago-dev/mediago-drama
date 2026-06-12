package projectasset

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/model"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/shared"
)

const (
	// MaxProjectAssetUploadSize is the maximum accepted project asset size.
	MaxProjectAssetUploadSize = 200 << 20
)

// ProjectAssets stores project-scoped reference files.
type ProjectAssets struct {
	mu            sync.RWMutex
	repo          *repository.ProjectAssetRepository
	workspaceRepo *repository.WorkspaceRepository
	dir           string
	workspaceRoot string
	initErr       error
}

// ProjectAsset is the API projection for one project asset.
type ProjectAsset = model.ProjectAssetRecord

// ProjectAssetsResponse is the list payload for project assets.
type ProjectAssetsResponse struct {
	Assets []ProjectAsset `json:"assets"`
}

// ProjectAssetUpdateRequest updates project asset metadata.
type ProjectAssetUpdateRequest struct {
	Filename  *string `json:"filename,omitempty"`
	ParentID  *string `json:"parentId,omitempty"`
	FolderID  *string `json:"folderId,omitempty"`
	SortOrder *int    `json:"sortOrder,omitempty"`
}

type projectAssetModel = domain.ProjectAssetModel

// NewProjectAssets returns a project asset service backed by the workspace DB.
func NewProjectAssets(dbPath string, mediaDir string) *ProjectAssets {
	repo, err := repository.NewProjectAssetRepository(dbPath)
	return NewProjectAssetsFromRepository(repo, mediaDir, "", nil, err)
}

// NewProjectAssetsFromRepository returns a project asset service with an existing repository.
func NewProjectAssetsFromRepository(repo *repository.ProjectAssetRepository, mediaDir string, workspaceRoot string, workspaceRepo *repository.WorkspaceRepository, initErr error) *ProjectAssets {
	if mediaDir == "" {
		mediaDir = defaultProjectAssetMediaDir()
	}

	store := &ProjectAssets{
		repo:          repo,
		workspaceRepo: workspaceRepo,
		dir:           mediaDir,
		workspaceRoot: strings.TrimSpace(workspaceRoot),
		initErr:       initErr,
	}
	if store.initErr != nil {
		return store
	}
	if store.repo == nil {
		store.initErr = errors.New("project asset repository is nil")
		return store
	}
	if err := os.MkdirAll(store.projectAssetsRoot(), 0o700); err != nil {
		store.initErr = fmt.Errorf("creating project asset directory: %w", err)
	}
	return store
}

// List returns assets for one project.
func (store *ProjectAssets) List(projectID string) ([]ProjectAsset, error) {
	if store.initErr != nil {
		return nil, store.initErr
	}
	projectID, err := cleanRequiredProjectID(projectID)
	if err != nil {
		return nil, err
	}

	store.mu.Lock()
	if err := store.syncProjectWorkAssetsUnlocked(projectID); err != nil {
		store.mu.Unlock()
		return nil, err
	}
	models, err := store.repo.ListProjectAssets(projectID)
	store.mu.Unlock()
	if err != nil {
		return nil, err
	}
	models, err = store.pruneMissingProjectAssetModels(projectID, models)
	if err != nil {
		return nil, err
	}
	return recordsFromModels(models), nil
}

// Get returns one project asset.
func (store *ProjectAssets) Get(projectID string, id string) (ProjectAsset, bool, error) {
	if store.initErr != nil {
		return ProjectAsset{}, false, store.initErr
	}
	projectID, err := cleanRequiredProjectID(projectID)
	if err != nil {
		return ProjectAsset{}, false, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return ProjectAsset{}, false, fmt.Errorf("asset id is required")
	}

	store.mu.RLock()
	model, err := store.repo.GetProjectAsset(projectID, id)
	store.mu.RUnlock()
	if repository.IsRecordNotFound(err) {
		return ProjectAsset{}, false, nil
	}
	if err != nil {
		return ProjectAsset{}, false, err
	}
	if projectAssetFileMissing(model.Path) {
		store.mu.Lock()
		_, deleteErr := store.repo.DeleteProjectAssets(projectID, []string{id})
		store.mu.Unlock()
		if deleteErr != nil {
			return ProjectAsset{}, false, deleteErr
		}
		return ProjectAsset{}, false, nil
	}
	return recordFromModel(model), true, nil
}

// SaveMultipartFile stores a multipart upload as a project asset.
func (store *ProjectAssets) SaveMultipartFile(projectID string, header *multipart.FileHeader, parentID string, sortOrder int, folderIDs ...string) (ProjectAsset, error) {
	if store.initErr != nil {
		return ProjectAsset{}, store.initErr
	}
	file, err := header.Open()
	if err != nil {
		return ProjectAsset{}, err
	}
	defer file.Close()

	return store.SaveReader(context.Background(), projectID, file, header.Filename, header.Header.Get("Content-Type"), parentID, sortOrder, folderIDs...)
}

// SaveReader stores reader bytes as a project asset.
func (store *ProjectAssets) SaveReader(
	ctx context.Context,
	projectID string,
	reader io.Reader,
	filename string,
	contentType string,
	parentID string,
	sortOrder int,
	folderIDs ...string,
) (ProjectAsset, error) {
	projectID, err := cleanRequiredProjectID(projectID)
	if err != nil {
		return ProjectAsset{}, err
	}
	dir := store.projectAssetDir(projectID)
	if dir == "" {
		return ProjectAsset{}, fmt.Errorf("project %s is not registered with projectDir", projectID)
	}
	return store.saveReaderToDir(ctx, projectID, reader, filename, contentType, parentID, sortOrder, dir, "", folderIDs...)
}

// SaveReaderInDir stores reader bytes as a project-scoped asset in a caller-owned directory.
func (store *ProjectAssets) SaveReaderInDir(
	ctx context.Context,
	projectID string,
	reader io.Reader,
	filename string,
	contentType string,
	parentID string,
	sortOrder int,
	dir string,
	storedBasename string,
	folderIDs ...string,
) (ProjectAsset, error) {
	projectID, err := cleanRequiredProjectID(projectID)
	if err != nil {
		return ProjectAsset{}, err
	}
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return ProjectAsset{}, fmt.Errorf("asset directory is required")
	}
	return store.saveReaderToDir(ctx, projectID, reader, filename, contentType, parentID, sortOrder, dir, storedBasename, folderIDs...)
}

func (store *ProjectAssets) saveReaderToDir(
	ctx context.Context,
	projectID string,
	reader io.Reader,
	filename string,
	contentType string,
	parentID string,
	sortOrder int,
	dir string,
	storedBasename string,
	folderIDs ...string,
) (ProjectAsset, error) {
	_ = ctx
	if store.initErr != nil {
		return ProjectAsset{}, store.initErr
	}
	data, err := shared.ReadLimited(reader, MaxProjectAssetUploadSize)
	if err != nil {
		return ProjectAsset{}, err
	}
	if len(data) == 0 {
		return ProjectAsset{}, fmt.Errorf("asset file is empty")
	}

	mimeType := shared.NormalizeMIMEType(contentType)
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(data)
	}
	mimeType = shared.NormalizeMIMEType(mimeType)
	kind := shared.KindFromMIMEType(mimeType)

	id, err := shared.RandomID("asset")
	if err != nil {
		return ProjectAsset{}, err
	}

	filename = shared.SafeFilename(filename)
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = shared.ExtensionForMIMEType(mimeType)
	}
	if filename == "" {
		filename = id + ext
	}
	if filepath.Ext(filename) == "" {
		filename += ext
	}

	if err := os.MkdirAll(dir, 0o700); err != nil {
		return ProjectAsset{}, fmt.Errorf("creating project asset directory: %w", err)
	}
	storedBasename = shared.SafeFilename(storedBasename)
	var filePath string
	if storedBasename == "" {
		filePath, err = writeProjectAssetFileWithUniqueBasename(dir, filename, data)
		if err != nil {
			return ProjectAsset{}, err
		}
	} else {
		if filepath.Ext(storedBasename) == "" {
			storedBasename += filepath.Ext(filename)
		}
		filePath = filepath.Join(dir, storedBasename)
		if err := os.WriteFile(filePath, data, 0o600); err != nil {
			return ProjectAsset{}, err
		}
	}

	now := timestamp.NowRFC3339Nano()
	folderID := ""
	if len(folderIDs) > 0 {
		folderID, err = store.cleanProjectAssetFolderID(projectID, folderIDs[0])
		if err != nil {
			return ProjectAsset{}, err
		}
	}
	asset := ProjectAsset{
		ID:        id,
		ProjectID: projectID,
		Kind:      kind,
		Filename:  filename,
		MIMEType:  mimeType,
		SizeBytes: int64(len(data)),
		URL:       projectAssetContentURL(projectID, id),
		ParentID:  strings.TrimSpace(parentID),
		FolderID:  folderID,
		SortOrder: sortOrder,
		CreatedAt: now,
		UpdatedAt: now,
		FilePath:  filePath,
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if err := store.repo.CreateProjectAsset(projectAssetModel{
		ProjectID: asset.ProjectID,
		ID:        asset.ID,
		Kind:      asset.Kind,
		Filename:  asset.Filename,
		MIMEType:  asset.MIMEType,
		SizeBytes: asset.SizeBytes,
		Path:      asset.FilePath,
		ParentID:  asset.ParentID,
		FolderID:  asset.FolderID,
		SortOrder: asset.SortOrder,
		CreatedAt: asset.CreatedAt,
		UpdatedAt: asset.UpdatedAt,
	}); err != nil {
		_ = os.Remove(filePath)
		return ProjectAsset{}, err
	}

	return asset, nil
}

func writeProjectAssetFileWithUniqueBasename(dir string, filename string, data []byte) (string, error) {
	basename := shared.SafeFilename(filename)
	if basename == "" {
		basename = "asset"
	}
	ext := filepath.Ext(basename)
	stem := strings.TrimSuffix(basename, ext)
	if stem == "" {
		stem = "asset"
	}

	for suffix := 1; ; suffix++ {
		candidate := basename
		if suffix > 1 {
			candidate = fmt.Sprintf("%s-%d%s", stem, suffix, ext)
		}
		filePath := filepath.Join(dir, candidate)
		file, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if os.IsExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}

		_, writeErr := file.Write(data)
		closeErr := file.Close()
		if writeErr != nil {
			_ = os.Remove(filePath)
			return "", writeErr
		}
		if closeErr != nil {
			_ = os.Remove(filePath)
			return "", closeErr
		}
		return filePath, nil
	}
}

// Update changes asset display metadata.
func (store *ProjectAssets) Update(projectID string, id string, request ProjectAssetUpdateRequest) (ProjectAsset, bool, error) {
	if store.initErr != nil {
		return ProjectAsset{}, false, store.initErr
	}

	asset, ok, err := store.Get(projectID, id)
	if err != nil || !ok {
		return asset, ok, err
	}

	updates := map[string]any{}
	if request.Filename != nil {
		filename := shared.SafeFilename(*request.Filename)
		if filename == "" {
			return ProjectAsset{}, false, fmt.Errorf("filename is required")
		}
		if filepath.Ext(filename) == "" {
			filename += filepath.Ext(asset.Filename)
		}
		asset.Filename = filename
		updates["filename"] = filename
	}
	if request.ParentID != nil {
		asset.ParentID = strings.TrimSpace(*request.ParentID)
		updates["parent_id"] = asset.ParentID
	}
	if request.FolderID != nil {
		folderID, err := store.cleanProjectAssetFolderID(asset.ProjectID, *request.FolderID)
		if err != nil {
			return ProjectAsset{}, false, err
		}
		asset.FolderID = folderID
		updates["folder_id"] = asset.FolderID
	}
	if request.Filename != nil || request.FolderID != nil {
		movedAsset, err := store.moveProjectAssetFile(asset)
		if err != nil {
			return ProjectAsset{}, false, err
		}
		asset = movedAsset
		updates["filename"] = asset.Filename
		updates["path"] = asset.FilePath
	}
	if request.SortOrder != nil {
		asset.SortOrder = *request.SortOrder
		updates["sort_order"] = asset.SortOrder
	}
	if len(updates) > 0 {
		asset.UpdatedAt = timestamp.NowRFC3339Nano()
		updates["updated_at"] = asset.UpdatedAt
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	updated, err := store.repo.UpdateProjectAsset(asset.ProjectID, asset.ID, updates)
	if err != nil {
		return ProjectAsset{}, false, err
	}
	return asset, updated, nil
}

func (store *ProjectAssets) moveProjectAssetFile(asset ProjectAsset) (ProjectAsset, error) {
	root := store.projectAssetDir(asset.ProjectID)
	if root == "" || strings.TrimSpace(asset.FilePath) == "" {
		return asset, nil
	}
	root = filepath.Clean(root)
	currentPath := filepath.Clean(asset.FilePath)
	if relative, err := filepath.Rel(root, currentPath); err != nil ||
		relative == ".." ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) ||
		filepath.IsAbs(relative) {
		return asset, nil
	}

	folderPathByID, err := store.projectAssetFolderPathByID(asset.ProjectID)
	if err != nil {
		return ProjectAsset{}, err
	}
	targetRelativeDir := ""
	if asset.FolderID != "" {
		path, ok := folderPathByID[asset.FolderID]
		if !ok {
			return ProjectAsset{}, fmt.Errorf("folder not found: %s", asset.FolderID)
		}
		targetRelativeDir = path
	}
	targetDir := root
	if targetRelativeDir != "" {
		targetDir = filepath.Join(root, filepath.FromSlash(targetRelativeDir))
	}
	filename := shared.SafeFilename(asset.Filename)
	if filename == "" {
		filename = filepath.Base(currentPath)
	}
	targetPath, err := moveProjectAssetFileWithUniqueBasename(currentPath, targetDir, filename)
	if err != nil {
		return ProjectAsset{}, err
	}
	asset.FilePath = targetPath
	asset.Filename = filepath.Base(targetPath)
	return asset, nil
}

func (store *ProjectAssets) projectAssetFolderPathByID(projectID string) (map[string]string, error) {
	return store.projectWorkFolderPathByID(projectID)
}

func moveProjectAssetFileWithUniqueBasename(currentPath string, targetDir string, filename string) (string, error) {
	currentPath = filepath.Clean(currentPath)
	targetDir = filepath.Clean(targetDir)
	filename = shared.SafeFilename(filename)
	if filename == "" {
		filename = "asset"
	}
	if err := os.MkdirAll(targetDir, 0o700); err != nil {
		return "", fmt.Errorf("creating project asset target directory: %w", err)
	}

	ext := filepath.Ext(filename)
	stem := strings.TrimSuffix(filename, ext)
	if stem == "" {
		stem = "asset"
	}
	for suffix := 1; ; suffix++ {
		candidate := filename
		if suffix > 1 {
			candidate = fmt.Sprintf("%s-%d%s", stem, suffix, ext)
		}
		targetPath := filepath.Join(targetDir, candidate)
		if filepath.Clean(targetPath) == currentPath {
			return currentPath, nil
		}
		if _, err := os.Stat(targetPath); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return "", err
		}
		if err := os.Rename(currentPath, targetPath); err != nil {
			return "", fmt.Errorf("moving project asset file: %w", err)
		}
		return targetPath, nil
	}
}

// Delete removes an asset and its asset descendants.
func (store *ProjectAssets) Delete(projectID string, id string) (bool, error) {
	if store.initErr != nil {
		return false, store.initErr
	}
	projectID, err := cleanRequiredProjectID(projectID)
	if err != nil {
		return false, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return false, fmt.Errorf("asset id is required")
	}

	assets, err := store.List(projectID)
	if err != nil {
		return false, err
	}
	if !assetIDExists(assets, id) {
		return false, nil
	}
	deleteIDs := collectDescendantAssetIDs(assets, id)
	paths := make([]string, 0, len(deleteIDs))
	for _, asset := range assets {
		if containsString(deleteIDs, asset.ID) {
			paths = append(paths, asset.FilePath)
		}
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	deleted, err := store.repo.DeleteProjectAssets(projectID, deleteIDs)
	if err != nil {
		return false, err
	}
	if deleted == 0 {
		return false, nil
	}
	for _, path := range paths {
		_ = os.Remove(path)
	}
	return true, nil
}

func recordsFromModels(models []projectAssetModel) []ProjectAsset {
	assets := make([]ProjectAsset, 0, len(models))
	for _, model := range models {
		assets = append(assets, recordFromModel(model))
	}
	return assets
}

func (store *ProjectAssets) pruneMissingProjectAssetModels(projectID string, models []projectAssetModel) ([]projectAssetModel, error) {
	missingIDs := []string{}
	kept := make([]projectAssetModel, 0, len(models))
	for _, model := range models {
		if projectAssetFileMissing(model.Path) {
			missingIDs = append(missingIDs, model.ID)
			continue
		}
		kept = append(kept, model)
	}
	if len(missingIDs) == 0 {
		return models, nil
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if _, err := store.repo.DeleteProjectAssets(projectID, missingIDs); err != nil {
		return nil, err
	}
	return kept, nil
}

func projectAssetFileMissing(path string) bool {
	path = strings.TrimSpace(path)
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return os.IsNotExist(err)
}

func recordFromModel(model projectAssetModel) ProjectAsset {
	return ProjectAsset{
		ID:        model.ID,
		ProjectID: model.ProjectID,
		Kind:      model.Kind,
		Filename:  model.Filename,
		MIMEType:  model.MIMEType,
		SizeBytes: model.SizeBytes,
		URL:       projectAssetContentURL(model.ProjectID, model.ID),
		ParentID:  model.ParentID,
		FolderID:  model.FolderID,
		SortOrder: model.SortOrder,
		CreatedAt: model.CreatedAt,
		UpdatedAt: model.UpdatedAt,
		FilePath:  model.Path,
	}
}

func cleanRequiredProjectID(projectID string) (string, error) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return "", fmt.Errorf("project id is required")
	}
	return projectID, nil
}

func (store *ProjectAssets) cleanProjectAssetFolderID(projectID string, folderID string) (string, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return folderID, nil
	}
	folderPathByID, err := store.projectWorkFolderPathByID(projectID)
	if err != nil {
		return "", err
	}
	if _, ok := folderPathByID[folderID]; ok {
		return folderID, nil
	}
	return "", fmt.Errorf("folder not found: %s", folderID)
}

func projectAssetContentURL(projectID string, id string) string {
	return "/api/v1/projects/" + url.PathEscape(projectID) + "/assets/" + url.PathEscape(id) + "/content"
}

func (store *ProjectAssets) projectAssetsRoot() string {
	return store.dir
}

func (store *ProjectAssets) projectAssetDir(projectID string) string {
	projectID = domain.CleanProjectID(projectID)
	if projectDir := store.projectDir(projectID); projectDir != "" {
		return filepath.Join(projectDir, "work")
	}
	return ""
}

func (store *ProjectAssets) projectDir(projectID string) string {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return ""
	}
	if store.workspaceRepo != nil {
		project, err := store.workspaceRepo.GetProject(projectID)
		if err == nil && strings.TrimSpace(project.ProjectDir) != "" {
			return shared.ResolveWorkspaceDir(project.ProjectDir)
		}
	}
	return ""
}

func defaultProjectAssetMediaDir() string {
	return filepath.Join(shared.DefaultUserDataDir(), "assets")
}

func assetIDExists(assets []ProjectAsset, id string) bool {
	for _, asset := range assets {
		if asset.ID == id {
			return true
		}
	}
	return false
}

func collectDescendantAssetIDs(assets []ProjectAsset, id string) []string {
	children := map[string][]ProjectAsset{}
	for _, asset := range assets {
		if asset.ParentID != "" {
			children[asset.ParentID] = append(children[asset.ParentID], asset)
		}
	}

	result := []string{}
	var visit func(string)
	visit = func(currentID string) {
		result = append(result, currentID)
		for _, child := range children[currentID] {
			visit(child.ID)
		}
	}
	visit(id)
	return result
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
