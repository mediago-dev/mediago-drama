package document

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/repository"
)

func (store *Service) listDocumentFolders(projectID string) (documentFoldersResponse, error) {
	if store.initErr != nil {
		return documentFoldersResponse{}, store.initErr
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	projectID = domain.CleanProjectID(projectID)
	folders, err := store.listDocumentFoldersUnlocked(projectID)
	if err != nil {
		return documentFoldersResponse{}, err
	}
	return documentFoldersResponse{
		WorkspaceDir: store.projectDir(projectID),
		ProjectID:    projectID,
		Folders:      folders,
	}, nil
}

// ListDocumentFolders returns project document folders for HTTP handlers.
func (store *Service) ListDocumentFolders(projectID string) (documentFoldersResponse, error) {
	return store.listDocumentFolders(projectID)
}

func (store *Service) createDocumentFolder(projectID string, request createDocumentFolderRequest) (documentFolderMutationResponse, error) {
	if store.initErr != nil {
		return documentFolderMutationResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return documentFolderMutationResponse{}, fmt.Errorf("projectId is required")
	}
	if err := store.ensureProjectRecordUnlocked(projectID); err != nil {
		return documentFolderMutationResponse{}, err
	}

	folders, err := store.listDocumentFoldersUnlocked(projectID)
	if err != nil {
		return documentFolderMutationResponse{}, err
	}
	parentID := ValidDocumentFolderParentID(folders, request.ParentID, "")
	sortOrder := NextDocumentFolderSortOrder(folders, parentID)
	if request.SortOrder != nil && *request.SortOrder >= 0 {
		sortOrder = *request.SortOrder
	}
	name := normalizeDocumentFolderName(request.Name)
	if DocumentFolderNameExists(folders, parentID, name, "") {
		return documentFolderMutationResponse{}, fmt.Errorf("folder name already exists: %s", name)
	}
	parentPath := DocumentFolderPathByID(folders)[parentID]
	folderPath := name
	if parentPath != "" {
		folderPath = filepath.ToSlash(filepath.Join(parentPath, name))
	}
	now := timestamp.NowRFC3339Nano()
	folder := mediamcp.DocumentFolder{
		ID:        deterministicLocalFileID("folder-file-", projectID, folderPath),
		Name:      name,
		ParentID:  parentID,
		SortOrder: sortOrder,
		CreatedAt: now,
		UpdatedAt: now,
	}
	folderPaths := DocumentFolderPathByID(append(folders, folder))
	if err := os.MkdirAll(filepath.Join(store.documentsDir(projectID), CleanRelativeFilename(folderPaths[folder.ID])), 0o755); err != nil {
		return documentFolderMutationResponse{}, err
	}
	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return documentFolderMutationResponse{}, err
	}
	for _, saved := range state.Folders {
		if saved.ID == folder.ID {
			folder = saved
			break
		}
	}
	return documentFolderMutationResponse{Folder: folder, State: WorkspaceDocumentsFromState(state)}, nil
}

// CreateDocumentFolder creates a persisted project folder.
func (store *Service) CreateDocumentFolder(projectID string, request createDocumentFolderRequest) (documentFolderMutationResponse, error) {
	return store.createDocumentFolder(projectID, request)
}

func (store *Service) updateDocumentFolder(projectID string, folderID string, request updateDocumentFolderRequest) (documentFolderMutationResponse, error) {
	if store.initErr != nil {
		return documentFolderMutationResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projectID = domain.CleanProjectID(projectID)
	folderID = strings.TrimSpace(folderID)
	if projectID == "" {
		return documentFolderMutationResponse{}, fmt.Errorf("projectId is required")
	}
	if folderID == "" {
		return documentFolderMutationResponse{}, fmt.Errorf("folderId is required")
	}

	folders, err := store.listDocumentFoldersUnlocked(projectID)
	if err != nil {
		return documentFolderMutationResponse{}, err
	}
	current, ok := FindDocumentFolderByID(folders, folderID)
	if !ok {
		return documentFolderMutationResponse{}, repository.ErrRecordNotFound
	}

	if request.Name != nil {
		current.Name = normalizeDocumentFolderName(*request.Name)
	}
	if request.ParentID != nil {
		current.ParentID = ValidDocumentFolderParentID(folders, request.ParentID, current.ID)
	}
	if (request.Name != nil || request.ParentID != nil) &&
		DocumentFolderNameExists(folders, current.ParentID, current.Name, current.ID) {
		return documentFolderMutationResponse{}, fmt.Errorf("folder name already exists: %s", current.Name)
	}
	if request.SortOrder != nil && *request.SortOrder >= 0 {
		current.SortOrder = *request.SortOrder
	}

	beforePaths := DocumentFolderPathByID(folders)
	nextFolders := make([]mediamcp.DocumentFolder, 0, len(folders))
	for _, folder := range folders {
		if folder.ID == current.ID {
			current.UpdatedAt = timestamp.NowRFC3339Nano()
			nextFolders = append(nextFolders, current)
			continue
		}
		nextFolders = append(nextFolders, folder)
	}
	afterPaths := DocumentFolderPathByID(nextFolders)
	beforePath := CleanRelativeFilename(beforePaths[current.ID])
	afterPath := CleanRelativeFilename(afterPaths[current.ID])
	if beforePath != afterPath {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(store.documentsDir(projectID), afterPath)), 0o755); err != nil {
			return documentFolderMutationResponse{}, err
		}
		if err := os.Rename(filepath.Join(store.documentsDir(projectID), beforePath), filepath.Join(store.documentsDir(projectID), afterPath)); err != nil {
			return documentFolderMutationResponse{}, err
		}
	}
	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return documentFolderMutationResponse{}, err
	}
	for _, folder := range state.Folders {
		if folder.ID == current.ID {
			current = folder
			break
		}
	}
	if current.ID == folderID {
		for savedID, savedPath := range DocumentFolderPathByID(state.Folders) {
			if savedPath != afterPath {
				continue
			}
			if saved, ok := FindDocumentFolderByID(state.Folders, savedID); ok {
				current = saved
				break
			}
		}
	}
	return documentFolderMutationResponse{Folder: current, State: WorkspaceDocumentsFromState(state)}, nil
}

// UpdateDocumentFolder updates a persisted project folder.
func (store *Service) UpdateDocumentFolder(projectID string, folderID string, request updateDocumentFolderRequest) (documentFolderMutationResponse, error) {
	return store.updateDocumentFolder(projectID, folderID, request)
}

func (store *Service) deleteDocumentFolder(projectID string, folderID string) (deleteDocumentFolderResponse, error) {
	if store.initErr != nil {
		return deleteDocumentFolderResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projectID = domain.CleanProjectID(projectID)
	folderID = strings.TrimSpace(folderID)
	if projectID == "" {
		return deleteDocumentFolderResponse{}, fmt.Errorf("projectId is required")
	}
	if folderID == "" {
		return deleteDocumentFolderResponse{}, fmt.Errorf("folderId is required")
	}

	folders, err := store.listDocumentFoldersUnlocked(projectID)
	if err != nil {
		return deleteDocumentFolderResponse{}, err
	}
	folder, ok := FindDocumentFolderByID(folders, folderID)
	if !ok {
		return deleteDocumentFolderResponse{}, repository.ErrRecordNotFound
	}

	folderPath := DocumentFolderPathByID(folders)[folder.ID]
	if err := moveDocumentFolderChildrenToParent(store.documentsDir(projectID), folderPath); err != nil {
		return deleteDocumentFolderResponse{}, err
	}
	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return deleteDocumentFolderResponse{}, err
	}
	return deleteDocumentFolderResponse{DeletedID: folder.ID, State: WorkspaceDocumentsFromState(state)}, nil
}

func moveDocumentFolderChildrenToParent(docsDir string, folderPath string) error {
	folderPath = CleanRelativeFilename(folderPath)
	if folderPath == "" {
		return nil
	}
	sourceDir := filepath.Join(docsDir, folderPath)
	parentDir := filepath.Dir(sourceDir)
	entries, err := os.ReadDir(sourceDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		from := filepath.Join(sourceDir, entry.Name())
		to := uniqueDocumentFolderChildPath(parentDir, entry.Name())
		if err := os.Rename(from, to); err != nil {
			return err
		}
	}
	return os.Remove(sourceDir)
}

func uniqueDocumentFolderChildPath(parentDir string, name string) string {
	candidate := filepath.Join(parentDir, name)
	if _, err := os.Stat(candidate); os.IsNotExist(err) {
		return candidate
	}
	extension := filepath.Ext(name)
	stem := strings.TrimSuffix(name, extension)
	if stem == "" {
		stem = name
		extension = ""
	}
	for suffix := 2; ; suffix++ {
		candidate = filepath.Join(parentDir, fmt.Sprintf("%s-%d%s", stem, suffix, extension))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
}

// DeleteDocumentFolder deletes a folder and moves its contents to its parent.
func (store *Service) DeleteDocumentFolder(projectID string, folderID string) (deleteDocumentFolderResponse, error) {
	return store.deleteDocumentFolder(projectID, folderID)
}

func (store *Service) listDocumentFoldersUnlocked(projectID string) ([]mediamcp.DocumentFolder, error) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return []mediamcp.DocumentFolder{}, nil
	}
	_, folders, err := store.loadLocalMarkdownWorkspaceUnlocked(projectID)
	if err != nil {
		return nil, err
	}
	return folders, nil
}

func (store *Service) syncDocumentMarkdownProjectionUnlocked(projectID string) error {
	documents, err := store.loadDocumentsFromDBUnlocked(projectID)
	if err != nil {
		return err
	}
	operationLog, err := store.loadOperationLogFromDBUnlocked(projectID)
	if err != nil {
		return err
	}
	_, err = store.saveUnlocked(projectID, workspaceStateRequest{
		Documents:    documents,
		OperationLog: operationLog,
	})
	return err
}

// UniqueDocumentFolderID returns a unique folder ID.
func UniqueDocumentFolderID(folders []mediamcp.DocumentFolder, requestedID string) string {
	requestedID = strings.TrimSpace(requestedID)
	if requestedID != "" && !DocumentFolderIDExists(folders, requestedID) {
		return requestedID
	}
	for {
		id := MustRandomID("folder")
		if !DocumentFolderIDExists(folders, id) {
			return id
		}
	}
}

// DocumentFolderIDExists reports whether a folder ID exists.
func DocumentFolderIDExists(folders []mediamcp.DocumentFolder, id string) bool {
	id = strings.TrimSpace(id)
	for _, folder := range folders {
		if folder.ID == id {
			return true
		}
	}
	return false
}

// FindDocumentFolderByID finds a folder by ID.
func FindDocumentFolderByID(folders []mediamcp.DocumentFolder, id string) (mediamcp.DocumentFolder, bool) {
	id = strings.TrimSpace(id)
	for _, folder := range folders {
		if folder.ID == id {
			return folder, true
		}
	}
	return mediamcp.DocumentFolder{}, false
}

// DocumentFolderNameExists reports whether a sibling folder already uses name.
func DocumentFolderNameExists(folders []mediamcp.DocumentFolder, parentID string, name string, excludeID string) bool {
	parentID = strings.TrimSpace(parentID)
	name = strings.TrimSpace(name)
	excludeID = strings.TrimSpace(excludeID)
	if name == "" {
		return false
	}
	for _, folder := range folders {
		if folder.ID == excludeID {
			continue
		}
		if folder.ParentID == parentID && strings.EqualFold(strings.TrimSpace(folder.Name), name) {
			return true
		}
	}
	return false
}

// ValidDocumentFolderID returns a safe folder ID for an item.
func ValidDocumentFolderID(folders []mediamcp.DocumentFolder, folderID *string) string {
	if folderID == nil {
		return ""
	}
	value := strings.TrimSpace(*folderID)
	if value == "" {
		return ""
	}
	if DocumentFolderIDExists(folders, value) {
		return value
	}
	return ""
}

// ValidDocumentFolderParentID returns a safe parent folder ID.
func ValidDocumentFolderParentID(folders []mediamcp.DocumentFolder, parentID *string, folderID string) string {
	if parentID == nil {
		return ""
	}
	value := strings.TrimSpace(*parentID)
	if value == "" || value == folderID {
		return ""
	}
	if folderID != "" {
		for _, descendantID := range CollectDocumentFolderDescendantIDs(folders, folderID) {
			if descendantID == value {
				return ""
			}
		}
	}
	if DocumentFolderIDExists(folders, value) {
		return value
	}
	return ""
}

// NextDocumentFolderSortOrder returns the next sort order for a folder sibling group.
func NextDocumentFolderSortOrder(folders []mediamcp.DocumentFolder, parentID string) int {
	maxOrder := -1
	for _, folder := range folders {
		if folder.ParentID == parentID && folder.SortOrder > maxOrder {
			maxOrder = folder.SortOrder
		}
	}
	return maxOrder + 1
}

// CollectDocumentFolderDescendantIDs returns folderID and all descendant folder IDs.
func CollectDocumentFolderDescendantIDs(folders []mediamcp.DocumentFolder, folderID string) []string {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" || !DocumentFolderIDExists(folders, folderID) {
		return nil
	}
	childrenByParent := map[string][]mediamcp.DocumentFolder{}
	for _, folder := range folders {
		childrenByParent[folder.ParentID] = append(childrenByParent[folder.ParentID], folder)
	}
	collected := []string{}
	seen := map[string]bool{}
	var visit func(string)
	visit = func(id string) {
		if seen[id] {
			return
		}
		seen[id] = true
		collected = append(collected, id)
		for _, child := range childrenByParent[id] {
			visit(child.ID)
		}
	}
	visit(folderID)
	return collected
}

// DocumentFolderPathByID returns deterministic relative paths for folders.
func DocumentFolderPathByID(folders []mediamcp.DocumentFolder) map[string]string {
	folders = NormalizeDocumentFolders(folders)
	childrenByParent := map[string][]mediamcp.DocumentFolder{}
	for _, folder := range folders {
		childrenByParent[folder.ParentID] = append(childrenByParent[folder.ParentID], folder)
	}
	for parentID := range childrenByParent {
		sort.SliceStable(childrenByParent[parentID], func(i, j int) bool {
			first := childrenByParent[parentID][i]
			second := childrenByParent[parentID][j]
			if first.SortOrder != second.SortOrder {
				return first.SortOrder < second.SortOrder
			}
			if first.Name != second.Name {
				return strings.Compare(first.Name, second.Name) < 0
			}
			return strings.Compare(first.ID, second.ID) < 0
		})
	}

	paths := map[string]string{}
	var visit func(parentID string, parentPath string)
	visit = func(parentID string, parentPath string) {
		usedSegments := map[string]bool{}
		for _, folder := range childrenByParent[parentID] {
			segment := uniqueDocumentFolderPathSegment(documentFolderPathSegment(folder), usedSegments)
			relativePath := segment
			if parentPath != "" {
				relativePath = filepath.ToSlash(filepath.Join(parentPath, segment))
			}
			paths[folder.ID] = relativePath
			visit(folder.ID, relativePath)
		}
	}
	visit("", "")
	return paths
}

func normalizeDocumentFolderName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "未命名文件夹"
	}
	return name
}

func documentFolderPathSegment(folder mediamcp.DocumentFolder) string {
	segment := cleanDocumentEditLogFilenameStem(folder.Name)
	if segment == "" {
		segment = cleanDocumentEditLogFilenameStem(folder.ID)
	}
	if segment == "" {
		segment = "untitled-folder"
	}
	return segment
}

func uniqueDocumentFolderPathSegment(segment string, used map[string]bool) string {
	segment = strings.TrimSpace(segment)
	if segment == "" {
		segment = "untitled-folder"
	}
	candidate := segment
	for suffix := 2; used[strings.ToLower(candidate)]; suffix++ {
		candidate = fmt.Sprintf("%s-%d", segment, suffix)
	}
	used[strings.ToLower(candidate)] = true
	return candidate
}
