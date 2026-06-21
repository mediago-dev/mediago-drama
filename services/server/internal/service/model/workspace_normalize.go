package model

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

// NormalizeProjectRecords normalizes project list records before persistence or output.
func NormalizeProjectRecords(projects []mediamcp.Project) []mediamcp.Project {
	normalized := make([]mediamcp.Project, 0, len(projects))
	seen := map[string]bool{}
	now := timestamp.NowRFC3339Nano()

	for _, project := range projects {
		project.ID = domain.CleanProjectID(project.ID)
		if project.ID == "" || seen[project.ID] {
			continue
		}
		project.Name = strings.TrimSpace(project.Name)
		if project.Name == "" {
			project.Name = FallbackProjectName(project.ID)
		}
		project.Description = strings.TrimSpace(project.Description)
		project.ProjectDir = strings.TrimSpace(project.ProjectDir)
		if project.ProjectDir != "" {
			project.ProjectDir = shared.ResolveWorkspaceDir(project.ProjectDir)
		}
		if strings.TrimSpace(project.RelativeDir) == "" {
			project.RelativeDir = strings.TrimSpace(filepath.ToSlash(project.ProjectDir))
		} else {
			project.RelativeDir = filepath.ToSlash(strings.TrimSpace(project.RelativeDir))
		}
		if project.CreatedAt == "" {
			project.CreatedAt = now
		}
		if project.UpdatedAt == "" {
			project.UpdatedAt = project.CreatedAt
		}
		if project.DocumentCount < 0 {
			project.DocumentCount = 0
		}

		seen[project.ID] = true
		normalized = append(normalized, project)
	}

	return normalized
}

// WorkspaceProjectRecordsFromModels maps project DB models to API records.
func WorkspaceProjectRecordsFromModels(models []domain.WorkspaceProjectModel) []mediamcp.Project {
	projects := make([]mediamcp.Project, 0, len(models))
	for _, model := range models {
		projects = append(projects, mediamcp.Project{
			ID:                 model.ID,
			Name:               model.Name,
			Description:        model.Description,
			Status:             workspaceProjectStatus(model.Status),
			ProjectDir:         model.ProjectDir,
			RelativeDir:        model.RelativeDir,
			OriginalProjectDir: model.OriginalProjectDir,
			TrashProjectDir:    model.TrashProjectDir,
			ArchivedAt:         domain.StringFromTime(timePtrValue(model.ArchivedAt)),
			TrashedAt:          domain.StringFromTime(timePtrValue(model.TrashedAt)),
			CreatedAt:          domain.StringFromTime(model.CreatedAt),
			UpdatedAt:          domain.StringFromTime(model.UpdatedAt),
		})
	}
	return projects
}

func timePtrValue(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}

func workspaceProjectStatus(status string) string {
	status = strings.TrimSpace(status)
	if status == "" {
		return "active"
	}
	return status
}

// NormalizeWorkspaceDocuments normalizes documents before persistence or output.
func NormalizeWorkspaceDocuments(documents []mediamcp.WorkspaceDocument) []mediamcp.WorkspaceDocument {
	normalized := make([]mediamcp.WorkspaceDocument, 0, len(documents))
	now := timestamp.NowRFC3339Nano()

	for index, document := range documents {
		document.ID = strings.TrimSpace(document.ID)
		if document.ID == "" {
			document.ID = fmt.Sprintf("doc-%d", index+1)
		}
		document.Title = strings.TrimSpace(document.Title)
		if document.Title == "" {
			document.Title = "未命名"
		}
		document.Category = NormalizeDocumentCategoryValue(document.Category)
		if document.UpdatedAt == "" {
			document.UpdatedAt = now
		}
		document.ParentID = strings.TrimSpace(document.ParentID)
		document.FolderID = strings.TrimSpace(document.FolderID)
		if document.SortOrder < 0 {
			document.SortOrder = index
		}
		document.Tags = NormalizeDocumentTags(document.Tags)
		document.Version = NormalizedDocumentVersion(document.Version)
		document.Comments = NormalizeCommentRecordsForDocument(document.ID, document.Content, document.Comments)
		document.WorkbenchDraft = NormalizeWorkbenchDraftRecord(
			document.WorkbenchDraft,
			document.ID,
			document.Title,
			document.UpdatedAt,
		)
		normalized = append(normalized, document)
	}

	ids := map[string]bool{}
	for _, document := range normalized {
		ids[document.ID] = true
	}
	for index := range normalized {
		if normalized[index].ParentID == normalized[index].ID || !ids[normalized[index].ParentID] {
			normalized[index].ParentID = ""
		}
	}

	return normalized
}

// NormalizeDocumentFolders normalizes folders before persistence or output.
func NormalizeDocumentFolders(folders []mediamcp.DocumentFolder) []mediamcp.DocumentFolder {
	normalized := make([]mediamcp.DocumentFolder, 0, len(folders))
	seen := map[string]bool{}
	now := timestamp.NowRFC3339Nano()

	for index, folder := range folders {
		folder.ID = strings.TrimSpace(folder.ID)
		if folder.ID == "" {
			folder.ID = fmt.Sprintf("folder-%d", index+1)
		}
		if seen[folder.ID] {
			continue
		}
		folder.Name = strings.TrimSpace(folder.Name)
		if folder.Name == "" {
			folder.Name = "未命名文件夹"
		}
		folder.ParentID = strings.TrimSpace(folder.ParentID)
		if folder.SortOrder < 0 {
			folder.SortOrder = index
		}
		if folder.CreatedAt == "" {
			folder.CreatedAt = now
		}
		if folder.UpdatedAt == "" {
			folder.UpdatedAt = folder.CreatedAt
		}

		seen[folder.ID] = true
		normalized = append(normalized, folder)
	}

	parentByID := map[string]string{}
	for _, folder := range normalized {
		parentByID[folder.ID] = folder.ParentID
	}
	for index := range normalized {
		parentID := normalized[index].ParentID
		if parentID == "" {
			continue
		}
		if parentID == normalized[index].ID {
			normalized[index].ParentID = ""
			continue
		}
		if !seen[parentID] {
			normalized[index].ParentID = ""
			continue
		}
		visited := map[string]bool{normalized[index].ID: true}
		for parentID != "" {
			if visited[parentID] {
				normalized[index].ParentID = ""
				break
			}
			visited[parentID] = true
			parentID = parentByID[parentID]
		}
	}

	return normalized
}

// NormalizeWorkbenchDraftRecord normalizes a workbench draft reference.
func NormalizeWorkbenchDraftRecord(draft *mediamcp.DocumentWorkbenchDraft, documentID string, documentTitle string, now string) *mediamcp.DocumentWorkbenchDraft {
	if draft == nil {
		return nil
	}

	documentID = strings.TrimSpace(documentID)
	documentTitle = strings.TrimSpace(documentTitle)
	if documentTitle == "" {
		documentTitle = "未命名"
	}
	now = strings.TrimSpace(now)
	if now == "" {
		now = timestamp.NowRFC3339Nano()
	}

	id := strings.TrimSpace(draft.ID)
	if id == "" {
		id = "draft-" + documentID
	}
	title := strings.TrimSpace(draft.Title)
	if title == "" {
		title = documentTitle + " · 剪辑草稿"
	}
	createdAt := strings.TrimSpace(draft.CreatedAt)
	if createdAt == "" {
		createdAt = now
	}
	updatedAt := strings.TrimSpace(draft.UpdatedAt)
	if updatedAt == "" {
		updatedAt = now
	}

	return &mediamcp.DocumentWorkbenchDraft{
		ID:         id,
		DocumentID: documentID,
		Title:      title,
		Kind:       "episode",
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
	}
}

// NormalizedDocumentVersion returns a positive document version.
func NormalizedDocumentVersion(version int) int {
	if version <= 0 {
		return 1
	}
	return version
}

// UniqueWorkspaceDocumentID returns a unique document ID.
func UniqueWorkspaceDocumentID(documents []mediamcp.WorkspaceDocument, requestedID string) string {
	requestedID = strings.TrimSpace(requestedID)
	if requestedID != "" && !WorkspaceDocumentIDExists(documents, requestedID) {
		return requestedID
	}
	for {
		id := shared.MustRandomID("doc")
		if !WorkspaceDocumentIDExists(documents, id) {
			return id
		}
	}
}

// WorkspaceDocumentIDExists reports whether a document ID exists.
func WorkspaceDocumentIDExists(documents []mediamcp.WorkspaceDocument, id string) bool {
	id = strings.TrimSpace(id)
	for _, document := range documents {
		if document.ID == id {
			return true
		}
	}
	return false
}

// FindWorkspaceDocumentByID finds a document by ID.
func FindWorkspaceDocumentByID(documents []mediamcp.WorkspaceDocument, id string) (mediamcp.WorkspaceDocument, bool) {
	id = strings.TrimSpace(id)
	for _, document := range documents {
		if document.ID == id {
			return document, true
		}
	}
	return mediamcp.WorkspaceDocument{}, false
}

// FindWorkspaceDocumentIndexByID returns the index of a document ID.
func FindWorkspaceDocumentIndexByID(documents []mediamcp.WorkspaceDocument, documentID string) int {
	documentID = strings.TrimSpace(documentID)
	for index := range documents {
		if documents[index].ID == documentID {
			return index
		}
	}
	return -1
}

// WorkspaceDocumentVersionConflictMessage returns an optimistic-lock conflict message.
func WorkspaceDocumentVersionConflictMessage(document mediamcp.WorkspaceDocument, expected *int) (string, bool) {
	document.Version = NormalizedDocumentVersion(document.Version)
	if expected == nil || *expected == document.Version {
		return "", false
	}
	return WorkspaceVersionConflictError{
		DocumentID: document.ID,
		Expected:   *expected,
		Current:    document.Version,
	}.Error(), true
}

// FindWorkspaceComment finds a non-deleted comment and its document index.
func FindWorkspaceComment(documents []mediamcp.WorkspaceDocument, commentID string) (int, mediamcp.DocumentComment, bool) {
	commentID = strings.TrimSpace(commentID)
	if commentID == "" {
		return -1, mediamcp.DocumentComment{}, false
	}
	for index, document := range documents {
		for _, comment := range document.Comments {
			if comment.ID == commentID && comment.DeletedAt == "" {
				return index, comment, true
			}
		}
	}
	return -1, mediamcp.DocumentComment{}, false
}

// WorkspaceDocumentsContainID reports whether the document set contains an ID.
func WorkspaceDocumentsContainID(documents []mediamcp.WorkspaceDocument, documentID string) bool {
	documentID = strings.TrimSpace(documentID)
	for _, document := range documents {
		if strings.TrimSpace(document.ID) == documentID {
			return true
		}
	}
	return false
}

// CountRegularWorkspaceDocuments counts non-overview documents.
func CountRegularWorkspaceDocuments(documents []mediamcp.WorkspaceDocument) int {
	count := 0
	for _, document := range documents {
		if !IsOverviewDocumentID(document.ID) {
			count++
		}
	}
	return count
}

// RegularWorkspaceDocuments filters out overview documents.
func RegularWorkspaceDocuments(documents []mediamcp.WorkspaceDocument) []mediamcp.WorkspaceDocument {
	filtered := make([]mediamcp.WorkspaceDocument, 0, len(documents))
	for _, document := range documents {
		if !IsOverviewDocumentID(document.ID) {
			filtered = append(filtered, document)
		}
	}
	return filtered
}

// WorkspaceDocumentsFromState projects full state into the document list response.
func WorkspaceDocumentsFromState(state WorkspaceStateResponse) WorkspaceDocumentsResponse {
	return WorkspaceDocumentsResponse{
		WorkspaceDir: state.WorkspaceDir,
		ProjectID:    state.ProjectID,
		Documents:    state.Documents,
		Folders:      state.Folders,
		Assets:       state.Assets,
	}
}

// ValidWorkspaceParentID returns a safe parent ID for a document.
func ValidWorkspaceParentID(documents []mediamcp.WorkspaceDocument, parentID *string, documentID string) string {
	if parentID == nil {
		return ""
	}
	value := strings.TrimSpace(*parentID)
	if value == "" || value == documentID {
		return ""
	}
	if documentID != "" {
		for _, descendantID := range CollectWorkspaceDocumentDescendantIDs(documents, documentID) {
			if descendantID == value {
				return ""
			}
		}
	}
	if WorkspaceDocumentIDExists(documents, value) {
		return value
	}
	return ""
}

// NextWorkspaceSortOrder returns the next sort order for a sibling group.
func NextWorkspaceSortOrder(documents []mediamcp.WorkspaceDocument, parentID string) int {
	maxOrder := -1
	for _, document := range documents {
		if IsOverviewDocumentID(document.ID) {
			continue
		}
		if document.ParentID == parentID && document.SortOrder > maxOrder {
			maxOrder = document.SortOrder
		}
	}
	return maxOrder + 1
}

// MoveWorkspaceDocumentInTree moves a document relative to another document.
func MoveWorkspaceDocumentInTree(
	documents []mediamcp.WorkspaceDocument,
	documentID string,
	targetDocumentID string,
	position string,
) ([]mediamcp.WorkspaceDocument, mediamcp.WorkspaceDocument, bool, error) {
	documentID = strings.TrimSpace(documentID)
	targetDocumentID = strings.TrimSpace(targetDocumentID)
	position = strings.TrimSpace(position)
	if position == "" {
		position = "inside"
	}
	if position != "before" && position != "after" && position != "inside" {
		return documents, mediamcp.WorkspaceDocument{}, false, fmt.Errorf("unsupported move position %q", position)
	}
	if documentID == "" || targetDocumentID == "" {
		return documents, mediamcp.WorkspaceDocument{}, false, fmt.Errorf("documentId and targetDocumentId are required")
	}
	if documentID == targetDocumentID {
		for _, document := range documents {
			if document.ID == documentID {
				return documents, document, false, nil
			}
		}
		return documents, mediamcp.WorkspaceDocument{}, false, repository.ErrRecordNotFound
	}

	sourceIndex := -1
	targetIndex := -1
	for index := range documents {
		if documents[index].ID == documentID {
			sourceIndex = index
		}
		if documents[index].ID == targetDocumentID {
			targetIndex = index
		}
	}
	if sourceIndex < 0 || targetIndex < 0 {
		return documents, mediamcp.WorkspaceDocument{}, false, repository.ErrRecordNotFound
	}
	source := documents[sourceIndex]
	target := documents[targetIndex]
	for _, descendantID := range CollectWorkspaceDocumentDescendantIDs(documents, source.ID) {
		if descendantID == target.ID {
			return documents, source, false, fmt.Errorf("cannot move a document into its own descendant")
		}
	}

	nextParentID := target.ParentID
	if position == "inside" {
		nextParentID = target.ID
	}
	for _, descendantID := range CollectWorkspaceDocumentDescendantIDs(documents, source.ID) {
		if descendantID == nextParentID {
			return documents, source, false, fmt.Errorf("cannot move a document under its own descendant")
		}
	}

	withoutSource := make([]mediamcp.WorkspaceDocument, 0, len(documents)-1)
	for _, document := range documents {
		if document.ID != source.ID {
			withoutSource = append(withoutSource, document)
		}
	}
	siblings := make([]mediamcp.WorkspaceDocument, 0)
	for _, document := range withoutSource {
		if document.ParentID == nextParentID {
			siblings = append(siblings, document)
		}
	}
	sort.SliceStable(siblings, func(i, j int) bool {
		if siblings[i].SortOrder != siblings[j].SortOrder {
			return siblings[i].SortOrder < siblings[j].SortOrder
		}
		return strings.Compare(siblings[i].Title, siblings[j].Title) < 0
	})
	targetSiblingIndex := len(siblings)
	for index, sibling := range siblings {
		if sibling.ID == target.ID {
			targetSiblingIndex = index
			break
		}
	}
	insertIndex := len(siblings)
	if position == "before" {
		insertIndex = targetSiblingIndex
	}
	if position == "after" {
		insertIndex = targetSiblingIndex + 1
		if insertIndex > len(siblings) {
			insertIndex = len(siblings)
		}
	}

	moved := source
	moved.ParentID = nextParentID
	moved.UpdatedAt = timestamp.NowRFC3339Nano()
	nextSiblings := make([]mediamcp.WorkspaceDocument, 0, len(siblings)+1)
	nextSiblings = append(nextSiblings, siblings[:insertIndex]...)
	nextSiblings = append(nextSiblings, moved)
	nextSiblings = append(nextSiblings, siblings[insertIndex:]...)
	updates := map[string]mediamcp.WorkspaceDocument{}
	for sortOrder, sibling := range nextSiblings {
		sibling.ParentID = nextParentID
		sibling.SortOrder = sortOrder
		if sibling.ID == moved.ID {
			moved = sibling
		}
		updates[sibling.ID] = sibling
	}

	nextDocuments := make([]mediamcp.WorkspaceDocument, 0, len(documents))
	changed := false
	for _, document := range documents {
		next := document
		if update, ok := updates[document.ID]; ok {
			next = update
		}
		if next.ParentID != document.ParentID || next.SortOrder != document.SortOrder {
			changed = true
			next.Version = NormalizedDocumentVersion(document.Version) + 1
		}
		nextDocuments = append(nextDocuments, next)
	}
	return nextDocuments, moved, changed, nil
}

// CollectWorkspaceDocumentDescendantIDs returns documentID and all descendants.
func CollectWorkspaceDocumentDescendantIDs(documents []mediamcp.WorkspaceDocument, documentID string) []string {
	documentID = strings.TrimSpace(documentID)
	if documentID == "" || !WorkspaceDocumentIDExists(documents, documentID) {
		return nil
	}
	childrenByParent := map[string][]mediamcp.WorkspaceDocument{}
	for _, document := range documents {
		childrenByParent[document.ParentID] = append(childrenByParent[document.ParentID], document)
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
	visit(documentID)
	return collected
}

// NormalizeCommentRecords normalizes document comments without a known document ID.
func NormalizeCommentRecords(content string, comments []mediamcp.DocumentComment) []mediamcp.DocumentComment {
	return NormalizeCommentRecordsForDocument("", content, comments)
}

// NormalizeCommentRecordsForDocument normalizes document comments for storage.
func NormalizeCommentRecordsForDocument(documentID string, content string, comments []mediamcp.DocumentComment) []mediamcp.DocumentComment {
	normalized := make([]mediamcp.DocumentComment, 0, len(comments))
	now := timestamp.NowRFC3339Nano()

	for index, comment := range comments {
		comment.ID = strings.TrimSpace(comment.ID)
		if comment.ID == "" {
			comment.ID = fmt.Sprintf("comment-%d", index+1)
		}
		comment.DocumentID = shared.FirstNonEmpty(strings.TrimSpace(comment.DocumentID), strings.TrimSpace(documentID))
		comment.BlockID = strings.TrimSpace(comment.BlockID)
		comment.AuthorID = strings.TrimSpace(comment.AuthorID)
		comment.ParentCommentID = strings.TrimSpace(comment.ParentCommentID)
		if comment.AnchorText == "" {
			comment.AnchorText = comment.Anchor.Quote
		}
		if comment.Anchor.Quote == "" {
			comment.Anchor = MakeTextAnchor(content, comment.AnchorText)
		}
		if comment.CreatedAt == "" {
			comment.CreatedAt = now
		}
		if comment.UpdatedAt == "" {
			comment.UpdatedAt = comment.CreatedAt
		}
		comment.ResolvedBy = strings.TrimSpace(comment.ResolvedBy)
		comment.ResolvedAt = strings.TrimSpace(comment.ResolvedAt)
		comment.DeletedAt = strings.TrimSpace(comment.DeletedAt)
		normalized = append(normalized, comment)
	}

	return normalized
}

// NormalizeDocumentTags trims, deduplicates, and drops empty document tags.
func NormalizeDocumentTags(tags []string) []string {
	normalized := []string{}
	seen := map[string]bool{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		normalized = append(normalized, tag)
	}
	return normalized
}

// BlankWorkspaceDocumentsForProject returns the initial document set for a blank project.
func BlankWorkspaceDocumentsForProject(projectTitle string, projectDescription string) []mediamcp.WorkspaceDocument {
	return []mediamcp.WorkspaceDocument{}
}

// MakeTextAnchor creates a quote anchor with surrounding context.
func MakeTextAnchor(content string, quote string) mediamcp.TextAnchor {
	quote = strings.TrimSpace(quote)
	index := strings.Index(content, quote)
	if quote == "" || index < 0 {
		return mediamcp.TextAnchor{Quote: quote}
	}

	const contextLength = 72
	beforeStart := index - contextLength
	if beforeStart < 0 {
		beforeStart = 0
	}
	afterStart := index + len(quote)
	afterEnd := afterStart + contextLength
	if afterEnd > len(content) {
		afterEnd = len(content)
	}

	return mediamcp.TextAnchor{
		Quote:         quote,
		ContextBefore: content[beforeStart:index],
		ContextAfter:  content[afterStart:afterEnd],
	}
}

// FallbackProjectName returns a readable fallback project name from an ID.
func FallbackProjectName(projectID string) string {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return "未命名项目"
	}
	projectID = strings.TrimPrefix(projectID, "project-")
	projectID = strings.ReplaceAll(projectID, "-", " ")
	return strings.Title(projectID)
}
