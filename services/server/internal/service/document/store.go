package document

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func (store *Service) saveUnlocked(projectID string, request workspaceStateRequest) (workspaceStateResponse, error) {
	projectID = domain.CleanProjectID(projectID)
	rawDocuments := request.Documents
	documents := NormalizeWorkspaceDocuments(request.Documents)

	if projectID != "" {
		if err := store.ensureProjectRecordUnlocked(projectID); err != nil {
			return workspaceStateResponse{}, err
		}
	}
	folders, err := store.listDocumentFoldersUnlocked(projectID)
	if err != nil {
		return workspaceStateResponse{}, err
	}
	folderPaths := DocumentFolderPathByID(folders)
	documents = normalizeWorkspaceDocumentFolderIDs(documents, folderPaths)

	documentFiles := make([]workspaceDocumentFile, 0, len(documents))
	usedFilenamesByDir := map[string]map[string]bool{}
	for index, document := range documents {
		filenameDocument := document
		if index < len(rawDocuments) && strings.TrimSpace(rawDocuments[index].Title) == "" {
			filenameDocument.Title = ""
		}
		folderPath := folderPaths[document.FolderID]
		usedFilenames := usedFilenamesByDir[strings.ToLower(folderPath)]
		if usedFilenames == nil {
			usedFilenames = map[string]bool{}
			usedFilenamesByDir[strings.ToLower(folderPath)] = usedFilenames
		}
		filename := documentProjectionFilename(document, filenameDocument, usedFilenames)
		if folderPath != "" {
			filename = filepath.ToSlash(filepath.Join(folderPath, filename))
		}
		documentFiles = append(documentFiles, workspaceDocumentFile{Filename: filename})
	}

	operationLog, operationModels, err := DocumentOperationLogModelsFromRecords(projectID, request.OperationLog)
	if err != nil {
		return workspaceStateResponse{}, err
	}

	if err := store.workspace.ReplaceDocumentOperationLogs(projectID, operationModels); err != nil {
		return workspaceStateResponse{}, err
	}
	if err := store.writeDocumentMarkdownProjection(projectID, documents, documentFiles, folderPaths); err != nil {
		return workspaceStateResponse{}, err
	}
	store.recordDocumentHistory(projectID)
	savedDocuments, savedFolders, err := store.loadLocalMarkdownWorkspaceUnlocked(projectID)
	if err != nil {
		return workspaceStateResponse{}, err
	}

	return workspaceStateResponse{
		WorkspaceDir: store.projectDir(projectID),
		ProjectID:    projectID,
		Documents:    savedDocuments,
		Folders:      savedFolders,
		OperationLog: operationLog,
	}, nil
}

func documentMarkdownFilename(document mediamcp.WorkspaceDocument) string {
	stem := cleanDocumentEditLogFilenameStem(document.Title)
	if stem == "" {
		stem = cleanDocumentEditLogFilenameStem(document.ID)
	}
	if stem == "" {
		stem = "untitled"
	}
	return stem + ".md"
}

type workspaceDocumentFile struct {
	Filename string
}

func uniqueDocumentMarkdownFilename(filename string, used map[string]bool) string {
	stem := strings.TrimSuffix(filename, ".md")
	if stem == filename {
		stem = strings.TrimSuffix(filename, filepath.Ext(filename))
	}
	if stem == "" {
		stem = "untitled"
	}

	candidate := stem + ".md"
	for suffix := 2; used[strings.ToLower(candidate)]; suffix++ {
		candidate = fmt.Sprintf("%s-%d.md", stem, suffix)
	}
	used[strings.ToLower(candidate)] = true
	return candidate
}

func documentProjectionFilename(
	document mediamcp.WorkspaceDocument,
	filenameDocument mediamcp.WorkspaceDocument,
	used map[string]bool,
) string {
	if filename := reusableNonMarkdownDocumentFilename(document.Filename, used); filename != "" {
		return filename
	}
	return uniqueDocumentMarkdownFilename(documentMarkdownFilename(filenameDocument), used)
}

func reusableNonMarkdownDocumentFilename(filename string, used map[string]bool) string {
	filename = CleanRelativeFilename(filename)
	if filename == "" {
		return ""
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" || ext == ".md" || !isLocalDocumentFile(filename) {
		return ""
	}
	return uniqueDocumentFilenameWithExtension(filepath.Base(filename), used)
}

func uniqueDocumentFilenameWithExtension(filename string, used map[string]bool) string {
	ext := filepath.Ext(filename)
	stem := strings.TrimSuffix(filename, ext)
	stem = cleanDocumentEditLogFilenameStem(stem)
	if stem == "" {
		stem = "untitled"
	}
	ext = strings.ToLower(ext)
	candidate := stem + ext
	for suffix := 2; used[strings.ToLower(candidate)]; suffix++ {
		candidate = fmt.Sprintf("%s-%d%s", stem, suffix, ext)
	}
	used[strings.ToLower(candidate)] = true
	return candidate
}

func findWorkspaceDocumentByTitleAndContent(
	documents []mediamcp.WorkspaceDocument,
	title string,
	content string,
) mediamcp.WorkspaceDocument {
	for _, document := range documents {
		if document.Title == title && document.Content == content {
			return document
		}
	}
	return mediamcp.WorkspaceDocument{}
}

// normalizeDocumentTitleKey collapses a title into a slot comparison key by dropping
// whitespace and separator runes, so "第一集-分镜", "第一集 分镜" and "第一集分镜" all
// map to the same slot.
func normalizeDocumentTitleKey(title string) string {
	var builder strings.Builder
	for _, r := range strings.TrimSpace(title) {
		if unicode.IsSpace(r) {
			continue
		}
		switch r {
		case '-', '–', '—', '_', '·', '・':
			continue
		}
		builder.WriteRune(unicode.ToLower(r))
	}
	return builder.String()
}

// findWorkspaceDocumentSlotIndex returns the index of the first document occupying the
// same slot (matching category and normalized title), or -1 when none match.
func findWorkspaceDocumentSlotIndex(
	documents []mediamcp.WorkspaceDocument,
	category string,
	title string,
) int {
	titleKey := normalizeDocumentTitleKey(title)
	if titleKey == "" {
		return -1
	}
	for index := range documents {
		if documents[index].Category != category {
			continue
		}
		if normalizeDocumentTitleKey(documents[index].Title) == titleKey {
			return index
		}
	}
	return -1
}

func normalizeWorkspaceDocumentFolderIDs(
	documents []mediamcp.WorkspaceDocument,
	folderPaths map[string]string,
) []mediamcp.WorkspaceDocument {
	if len(folderPaths) == 0 {
		for index := range documents {
			documents[index].FolderID = ""
		}
		return documents
	}
	for index := range documents {
		if documents[index].FolderID == "" {
			continue
		}
		if _, ok := folderPaths[documents[index].FolderID]; !ok {
			documents[index].FolderID = ""
		}
	}
	return documents
}

func knownDocumentFolderPaths(folderPaths map[string]string) map[string]bool {
	known := map[string]bool{}
	for _, folderPath := range folderPaths {
		folderPath = strings.TrimSpace(folderPath)
		if folderPath == "" {
			continue
		}
		known[strings.ToLower(filepath.ToSlash(CleanRelativeFilename(folderPath)))] = true
	}
	return known
}

func (store *Service) writeDocumentMarkdownProjection(
	projectID string,
	documents []mediamcp.WorkspaceDocument,
	files []workspaceDocumentFile,
	folderPaths map[string]string,
) error {
	docsDir := store.documentsDir(projectID)
	if err := os.MkdirAll(docsDir, 0o755); err != nil {
		return fmt.Errorf("creating documents directory: %w", err)
	}
	if err := os.MkdirAll(store.metadataDir(projectID), 0o755); err != nil {
		return fmt.Errorf("creating metadata directory: %w", err)
	}
	for _, folderPath := range folderPaths {
		folderPath = CleanRelativeFilename(folderPath)
		if folderPath == "untitled.md" {
			continue
		}
		if err := os.MkdirAll(filepath.Join(docsDir, folderPath), 0o755); err != nil {
			return fmt.Errorf("creating document folder %s: %w", folderPath, err)
		}
	}

	usedFilenames := map[string]bool{}
	for index, document := range documents {
		if index >= len(files) {
			return fmt.Errorf("missing document file for %s", document.ID)
		}
		filename := CleanRelativeFilename(files[index].Filename)
		usedFilenames[strings.ToLower(filepath.ToSlash(filename))] = true
		path := filepath.Join(docsDir, filename)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return fmt.Errorf("creating document directory %s: %w", filename, err)
		}
		content := localMarkdownProjectionContent(document)
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			return fmt.Errorf("writing document %s: %w", document.ID, err)
		}
	}

	if err := reconcileDocumentMarkdownFiles(docsDir, usedFilenames, knownDocumentFolderPaths(folderPaths)); err != nil {
		return err
	}
	return nil
}

func reconcileDocumentMarkdownFiles(docsDir string, used map[string]bool, knownFolders map[string]bool) error {
	dirs := []string{}
	if err := filepath.WalkDir(docsDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("walking %s: %w", path, err)
		}
		if entry.IsDir() {
			if path != docsDir {
				dirs = append(dirs, path)
			}
			return nil
		}
		name := strings.ToLower(entry.Name())
		if !strings.HasSuffix(name, ".md") {
			return nil
		}
		relative, err := filepath.Rel(docsDir, path)
		if err != nil {
			return fmt.Errorf("checking document path %s: %w", path, err)
		}
		relative = strings.ToLower(filepath.ToSlash(CleanRelativeFilename(relative)))
		if used[relative] {
			return nil
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("removing stale document %s: %w", relative, err)
		}
		return nil
	}); err != nil {
		return err
	}

	sort.Slice(dirs, func(i, j int) bool {
		return len(dirs[i]) > len(dirs[j])
	})
	for _, dir := range dirs {
		relative, err := filepath.Rel(docsDir, dir)
		if err != nil {
			return fmt.Errorf("checking document folder %s: %w", dir, err)
		}
		relative = strings.ToLower(filepath.ToSlash(CleanRelativeFilename(relative)))
		if knownFolders[relative] {
			continue
		}
		if err := os.Remove(dir); err != nil && !os.IsNotExist(err) {
			if entries, readErr := os.ReadDir(dir); readErr != nil || len(entries) == 0 {
				return fmt.Errorf("removing stale document folder %s: %w", relative, err)
			}
		}
	}
	return nil
}

func (store *Service) loadDocumentsFromDBUnlocked(projectID string) ([]mediamcp.WorkspaceDocument, error) {
	documents, _, err := store.loadLocalMarkdownWorkspaceUnlocked(projectID)
	if err != nil {
		return nil, fmt.Errorf("reading local workspace documents: %w", err)
	}

	return documents, nil
}

func (store *Service) loadOperationLogFromDBUnlocked(projectID string) ([]documentOperationLogRecord, error) {
	models, err := store.workspace.ListDocumentOperationLogs(projectID)
	if err != nil {
		return nil, fmt.Errorf("reading operation log: %w", err)
	}

	return DocumentOperationLogRecordsFromModels(models)
}

func (store *Service) listDocuments(projectID string) (workspaceDocumentsResponse, error) {
	state, err := store.load(projectID)
	if err != nil {
		return workspaceDocumentsResponse{}, err
	}
	response := WorkspaceDocumentsFromState(state)
	response.Documents = RegularWorkspaceDocuments(response.Documents)
	return response, nil
}

// ListWorkspaceDocuments returns documents for HTTP handlers.
func (store *Service) ListWorkspaceDocuments(projectID string) (workspaceDocumentsResponse, error) {
	return store.listDocuments(projectID)
}

// ListWorkspaceDocumentsByIDs returns only the requested documents while keeping
// the same folders/assets envelope. The workspace is loaded once, so it stays a
// single disk scan regardless of how many ids are requested.
func (store *Service) ListWorkspaceDocumentsByIDs(projectID string, ids []string) (workspaceDocumentsResponse, error) {
	response, err := store.listDocuments(projectID)
	if err != nil {
		return workspaceDocumentsResponse{}, err
	}
	if len(ids) == 0 {
		response.Documents = nil
		return response, nil
	}
	wanted := make(map[string]bool, len(ids))
	for _, id := range ids {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			wanted[trimmed] = true
		}
	}
	filtered := make([]mediamcp.WorkspaceDocument, 0, len(wanted))
	for _, document := range response.Documents {
		if wanted[document.ID] {
			filtered = append(filtered, document)
		}
	}
	response.Documents = filtered
	return response, nil
}

func (store *Service) ListDocumentMetadata(projectID string) (workspaceDocumentMetadataResponse, error) {
	return store.listDocumentMetadata(projectID)
}

func (store *Service) listDocumentMetadata(projectID string) (workspaceDocumentMetadataResponse, error) {
	state, err := store.load(projectID)
	if err != nil {
		return workspaceDocumentMetadataResponse{}, err
	}
	documents := make([]mediamcp.WorkspaceDocumentMetadata, 0, len(state.Documents))
	for _, document := range state.Documents {
		if IsOverviewDocumentID(document.ID) {
			continue
		}
		documents = append(documents, mediamcp.WorkspaceDocumentMetadata{
			ID:        document.ID,
			Title:     document.Title,
			Category:  document.Category,
			ParentID:  document.ParentID,
			FolderID:  document.FolderID,
			SortOrder: document.SortOrder,
			UpdatedAt: document.UpdatedAt,
			IsDirty:   document.IsDirty,
			Version:   NormalizedDocumentVersion(document.Version),
			Tags:      NormalizeDocumentTags(document.Tags),
		})
	}
	return workspaceDocumentMetadataResponse{
		WorkspaceDir: state.WorkspaceDir,
		ProjectID:    state.ProjectID,
		Documents:    documents,
		Folders:      state.Folders,
	}, nil
}

func (store *Service) getDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, bool, error) {
	state, err := store.load(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, false, err
	}
	documentID = strings.TrimSpace(documentID)
	for _, document := range state.Documents {
		if document.ID == documentID {
			return document, true, nil
		}
	}
	return mediamcp.WorkspaceDocument{}, false, nil
}

// GetWorkspaceDocument returns a document for HTTP handlers.
func (store *Service) GetWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, bool, error) {
	return store.getDocument(projectID, documentID)
}

// RequireWorkspaceDocument returns a document or a user-facing not-found error.
func (store *Service) RequireWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, error) {
	if store == nil {
		return mediamcp.WorkspaceDocument{}, fmt.Errorf("workspace store is not configured")
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return mediamcp.WorkspaceDocument{}, fmt.Errorf("documentId is required")
	}
	document, ok, err := store.GetWorkspaceDocument(projectID, documentID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, err
	}
	if !ok {
		return mediamcp.WorkspaceDocument{}, fmt.Errorf("文档不存在：%s", documentID)
	}
	return document, nil
}

// RequireWorkspaceDocumentBlock returns a document and one parsed block.
func (store *Service) RequireWorkspaceDocumentBlock(projectID string, documentID string, blockID string) (mediamcp.WorkspaceDocument, mediamcp.DocumentBlockNode, error) {
	document, err := store.RequireWorkspaceDocument(projectID, documentID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentBlockNode{}, err
	}
	block, err := DocumentBlockNode(document, blockID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentBlockNode{}, err
	}
	return document, block, nil
}

func (store *Service) createDocument(projectID string, request createWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	if store.initErr != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, store.initErr
	}
	request, err := normalizeCreateDocumentRequest(request)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}

	now := timestamp.NowRFC3339Nano()
	title := strings.TrimSpace(request.Title)
	hasExplicitTitle := title != ""
	if title == "" {
		title = "新文档"
	}
	category := strings.TrimSpace(request.Category)

	// Overwrite an existing same-slot document instead of accumulating duplicates when an
	// agent/generation create lands on a slot (category + normalized title) that already
	// exists. Prior content stays recoverable through document history. Manual creation
	// never sets ReplaceSameSlot, so it always produces a fresh record.
	if request.ReplaceSameSlot && hasExplicitTitle {
		if index := findWorkspaceDocumentSlotIndex(state.Documents, category, title); index >= 0 {
			existing := state.Documents[index]
			existing.Title = title
			existing.Content = request.Content
			existing.Category = category
			existing.Tags = NormalizeDocumentTags(request.Tags)
			existing.Comments = NormalizeCommentRecordsForDocument(existing.ID, request.Content, request.Comments)
			existing.WorkbenchDraft = NormalizeWorkbenchDraftRecord(request.WorkbenchDraft, existing.ID, title, now)
			existing.IsDirty = false
			existing.UpdatedAt = now
			existing.Version = NormalizedDocumentVersion(existing.Version) + 1
			state.Documents[index] = existing

			savedState, err := store.saveUnlocked(projectID, workspaceStateRequest{
				Documents:    state.Documents,
				OperationLog: state.OperationLog,
			})
			if err != nil {
				return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
			}
			document := existing
			if saved, ok := FindWorkspaceDocumentByID(savedState.Documents, existing.ID); ok {
				document = saved
			}
			return document, WorkspaceDocumentsFromState(savedState), nil
		}
	}

	parentID := ValidWorkspaceParentID(state.Documents, request.ParentID, "")
	folderID := ValidDocumentFolderID(state.Folders, request.FolderID)
	sortOrder := NextWorkspaceSortOrder(state.Documents, parentID)
	if request.SortOrder != nil && *request.SortOrder >= 0 {
		sortOrder = *request.SortOrder
	}
	content := request.Content
	folderPaths := DocumentFolderPathByID(state.Folders)
	folderPath := folderPaths[folderID]
	usedFilenames := map[string]bool{}
	for _, existing := range state.Documents {
		if existing.FolderID != folderID {
			continue
		}
		usedFilenames[strings.ToLower(documentMarkdownFilename(existing))] = true
	}
	filename := uniqueDocumentMarkdownFilename(documentMarkdownFilename(mediamcp.WorkspaceDocument{
		ID:    strings.TrimSpace(request.ID),
		Title: title,
	}), usedFilenames)
	if folderPath != "" {
		filename = filepath.ToSlash(filepath.Join(folderPath, filename))
	}
	documentID := strings.TrimSpace(request.ID)
	if documentID == "" || WorkspaceDocumentIDExists(state.Documents, documentID) {
		documentID = deterministicLocalFileID("doc-file-", projectID, filename)
	}
	document := mediamcp.WorkspaceDocument{
		ID:             documentID,
		Title:          title,
		Content:        content,
		Category:       category,
		ParentID:       parentID,
		FolderID:       folderID,
		SortOrder:      sortOrder,
		Tags:           NormalizeDocumentTags(request.Tags),
		UpdatedAt:      now,
		IsDirty:        false,
		Version:        1,
		Comments:       NormalizeCommentRecordsForDocument(documentID, content, request.Comments),
		WorkbenchDraft: NormalizeWorkbenchDraftRecord(request.WorkbenchDraft, documentID, title, now),
	}
	state.Documents = append(state.Documents, document)

	savedState, err := store.saveUnlocked(projectID, workspaceStateRequest{
		Documents:    state.Documents,
		OperationLog: state.OperationLog,
	})
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	if saved, ok := FindWorkspaceDocumentByID(savedState.Documents, document.ID); ok {
		document = saved
	} else if saved := findWorkspaceDocumentByTitleAndContent(savedState.Documents, document.Title, document.Content); saved.ID != "" {
		document = saved
	}
	return document, WorkspaceDocumentsFromState(savedState), nil
}

// CreateWorkspaceDocument creates a document for HTTP handlers.
func (store *Service) CreateWorkspaceDocument(projectID string, request createWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	return store.createDocument(projectID, request)
}

func (store *Service) updateDocument(projectID string, documentID string, request updateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	if store.initErr != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	documentID = strings.TrimSpace(documentID)
	index := -1
	for i := range state.Documents {
		if state.Documents[i].ID == documentID {
			index = i
			break
		}
	}
	if index < 0 {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, repository.ErrRecordNotFound
	}

	document := state.Documents[index]
	document.Version = NormalizedDocumentVersion(document.Version)
	if request.ExpectedVersion != nil && *request.ExpectedVersion != document.Version {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, workspaceVersionConflictError{
			DocumentID: document.ID,
			Expected:   *request.ExpectedVersion,
			Current:    document.Version,
		}
	}
	if request.Title != nil {
		if title := strings.TrimSpace(*request.Title); title != "" {
			document.Title = title
		}
	}
	if request.Content != nil {
		document.Content = *request.Content
	}
	if request.Category != nil {
		document.Category = NormalizeDocumentCategoryValue(*request.Category)
	}
	if request.ParentID != nil {
		document.ParentID = ValidWorkspaceParentID(state.Documents, request.ParentID, document.ID)
	}
	if request.FolderID != nil {
		document.FolderID = ValidDocumentFolderID(state.Folders, request.FolderID)
	}
	if request.SortOrder != nil && *request.SortOrder >= 0 {
		document.SortOrder = *request.SortOrder
	}
	if request.Tags != nil {
		document.Tags = NormalizeDocumentTags(*request.Tags)
	}
	if request.IsDirty != nil {
		document.IsDirty = *request.IsDirty
	}
	if request.Comments != nil {
		document.Comments = NormalizeCommentRecordsForDocument(document.ID, document.Content, *request.Comments)
	} else {
		document.Comments = NormalizeCommentRecordsForDocument(document.ID, document.Content, document.Comments)
	}
	if request.WorkbenchDraft != nil {
		document.WorkbenchDraft = NormalizeWorkbenchDraftRecord(
			request.WorkbenchDraft,
			document.ID,
			document.Title,
			timestamp.NowRFC3339Nano(),
		)
	}
	document.UpdatedAt = timestamp.NowRFC3339Nano()
	document.Version++
	state.Documents[index] = document

	savedState, err := store.saveUnlocked(projectID, workspaceStateRequest{
		Documents:    state.Documents,
		OperationLog: state.OperationLog,
	})
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	if saved, ok := FindWorkspaceDocumentByID(savedState.Documents, document.ID); ok {
		document = saved
	} else if saved := findWorkspaceDocumentByTitleAndContent(savedState.Documents, document.Title, document.Content); saved.ID != "" {
		document = saved
	}
	return document, WorkspaceDocumentsFromState(savedState), nil
}

// UpdateWorkspaceDocument updates a document for HTTP handlers.
func (store *Service) UpdateWorkspaceDocument(projectID string, documentID string, request updateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	return store.updateDocument(projectID, documentID, request)
}

// UpdateWorkspaceDocumentMetadata updates document metadata with a clean dirty flag.
func (store *Service) UpdateWorkspaceDocumentMetadata(projectID string, documentID string, request UpdateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, mediamcp.WorkspaceDocument, error) {
	before, err := store.RequireWorkspaceDocument(projectID, documentID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.WorkspaceDocument{}, err
	}
	clean := false
	request.IsDirty = &clean
	updated, _, err := store.UpdateWorkspaceDocument(projectID, before.ID, request)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.WorkspaceDocument{}, err
	}
	return before, updated, nil
}

// UpdateWorkspaceDocumentContent replaces document content with a clean dirty flag.
func (store *Service) UpdateWorkspaceDocumentContent(projectID string, before mediamcp.WorkspaceDocument, nextContent string, expectedVersion int) (mediamcp.WorkspaceDocument, error) {
	if err := ValidateTemplateDocumentContent(before, nextContent); err != nil {
		return mediamcp.WorkspaceDocument{}, err
	}
	clean := false
	update := UpdateWorkspaceDocumentRequest{
		Content:         &nextContent,
		IsDirty:         &clean,
		ExpectedVersion: expectedVersionPtr(expectedVersion),
	}
	document, _, err := store.UpdateWorkspaceDocument(projectID, before.ID, update)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, err
	}
	return document, nil
}

func (store *Service) MoveWorkspaceDocument(projectID string, documentID string, targetDocumentID string, position string, expectedVersion int) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	return store.moveDocument(projectID, documentID, targetDocumentID, position, expectedVersion)
}

func (store *Service) moveDocument(projectID string, documentID string, targetDocumentID string, position string, expectedVersion int) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	if store.initErr != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	current, ok := FindWorkspaceDocumentByID(state.Documents, documentID)
	if !ok {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, repository.ErrRecordNotFound
	}
	current.Version = NormalizedDocumentVersion(current.Version)
	if expectedVersion != current.Version {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, workspaceVersionConflictError{
			DocumentID: current.ID,
			Expected:   expectedVersion,
			Current:    current.Version,
		}
	}
	nextDocuments, moved, changed, err := MoveWorkspaceDocumentInTree(state.Documents, documentID, targetDocumentID, position)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	if !changed {
		return moved, WorkspaceDocumentsFromState(state), nil
	}

	savedState, err := store.saveUnlocked(projectID, workspaceStateRequest{
		Documents:    nextDocuments,
		OperationLog: state.OperationLog,
	})
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	for _, document := range savedState.Documents {
		if document.ID == moved.ID {
			moved = document
			break
		}
	}
	return moved, WorkspaceDocumentsFromState(savedState), nil
}

func (store *Service) deleteDocument(projectID string, documentID string, expectedVersion ...*int) (deleteWorkspaceDocumentResponse, error) {
	if store.initErr != nil {
		return deleteWorkspaceDocumentResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return deleteWorkspaceDocumentResponse{}, err
	}
	documentID = strings.TrimSpace(documentID)
	if IsOverviewDocumentID(documentID) {
		return deleteWorkspaceDocumentResponse{}, fmt.Errorf("overview document cannot be deleted")
	}
	deletedIDs := CollectWorkspaceDocumentDescendantIDs(state.Documents, documentID)
	if len(deletedIDs) == 0 {
		return deleteWorkspaceDocumentResponse{}, repository.ErrRecordNotFound
	}
	if len(expectedVersion) > 0 && expectedVersion[0] != nil {
		current, ok := FindWorkspaceDocumentByID(state.Documents, documentID)
		if !ok {
			return deleteWorkspaceDocumentResponse{}, repository.ErrRecordNotFound
		}
		current.Version = NormalizedDocumentVersion(current.Version)
		if *expectedVersion[0] != current.Version {
			return deleteWorkspaceDocumentResponse{}, workspaceVersionConflictError{
				DocumentID: current.ID,
				Expected:   *expectedVersion[0],
				Current:    current.Version,
			}
		}
	}
	deleted := map[string]bool{}
	for _, id := range deletedIDs {
		deleted[id] = true
	}
	deletedDocuments := make([]mediamcp.WorkspaceDocument, 0, len(deletedIDs))
	documents := make([]mediamcp.WorkspaceDocument, 0, len(state.Documents)-len(deletedIDs))
	for _, document := range state.Documents {
		if !deleted[document.ID] {
			documents = append(documents, document)
		} else {
			deletedDocuments = append(deletedDocuments, document)
		}
	}
	operationLog := make([]documentOperationLogRecord, 0, len(state.OperationLog))
	for _, record := range state.OperationLog {
		if !deleted[record.DocumentID] {
			operationLog = append(operationLog, record)
		}
	}

	savedState, err := store.saveUnlocked(projectID, workspaceStateRequest{
		Documents:    documents,
		OperationLog: operationLog,
	})
	if err != nil {
		return deleteWorkspaceDocumentResponse{}, err
	}
	for _, document := range deletedDocuments {
		if err := store.appendDocumentDeleteFileLog(projectID, document); err != nil {
			return deleteWorkspaceDocumentResponse{}, err
		}
	}
	return deleteWorkspaceDocumentResponse{
		DeletedIDs: deletedIDs,
		State:      WorkspaceDocumentsFromState(savedState),
	}, nil
}

// DeleteWorkspaceDocument deletes a document for HTTP handlers.
func (store *Service) DeleteWorkspaceDocument(projectID string, documentID string) (deleteWorkspaceDocumentResponse, error) {
	return store.deleteDocument(projectID, documentID)
}

func (store *Service) DeleteWorkspaceDocumentWithExpectedVersion(projectID string, documentID string, expectedVersion int) (deleteWorkspaceDocumentResponse, error) {
	return store.deleteDocument(projectID, documentID, expectedVersionPtr(expectedVersion))
}

func (store *Service) appendDocumentOperationLog(projectID string, record documentOperationLogRecord) error {
	if store.initErr != nil {
		return store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return err
	}
	if record.ID == "" {
		record.ID = MustRandomID("oplog")
	}
	if record.CreatedAt == "" {
		record.CreatedAt = timestamp.NowRFC3339Nano()
	}
	record.DocumentID = strings.TrimSpace(record.DocumentID)
	if record.DocumentID == "" {
		return fmt.Errorf("operation log documentId is required")
	}
	exists := false
	title := ""
	for _, document := range state.Documents {
		if document.ID == record.DocumentID {
			exists = true
			title = document.Title
			break
		}
	}
	if !exists {
		return repository.ErrRecordNotFound
	}

	nextOperationLog := append([]documentOperationLogRecord{record}, state.OperationLog...)
	if len(nextOperationLog) > 80 {
		nextOperationLog = nextOperationLog[:80]
	}
	_, err = store.saveUnlocked(projectID, workspaceStateRequest{
		Documents:    state.Documents,
		OperationLog: nextOperationLog,
	})
	if err != nil {
		return err
	}
	return store.appendDocumentEditFileLog(projectID, record, title)
}

func (store *Service) AppendDocumentOperationLog(projectID string, record documentOperationLogRecord) error {
	return store.appendDocumentOperationLog(projectID, record)
}
