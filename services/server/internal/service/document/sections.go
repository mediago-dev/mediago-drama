package document

import (
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
)

const (
	DocumentSectionStatusActive     = "active"
	DocumentSectionStatusMissing    = "missing"
	DocumentSectionStatusDetached   = "detached"
	DocumentSectionStatusDuplicated = "duplicated"
	DocumentSectionStatusDeleted    = "deleted"

	DocumentSectionTypeUnknown = "unknown"
)

var (
	documentSectionHeadingPattern  = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)
	documentSectionIDLinePattern   = regexp.MustCompile(`^\s*<!--\s*section-id:\s*([A-Za-z0-9_-]+)\s*-->\s*$`)
	documentSectionIDPattern       = regexp.MustCompile(`^section_[A-Za-z0-9_-]+$`)
	documentSectionLegacyIDPattern = regexp.MustCompile(`^section-[A-Za-z0-9]+$`)
)

// DocumentSectionRecord is the API-facing projection of a persisted section.
type DocumentSectionRecord struct {
	ProjectID     string `json:"projectId,omitempty"`
	SectionID     string `json:"sectionId"`
	DocumentID    string `json:"documentId,omitempty"`
	Type          string `json:"type"`
	Subtype       string `json:"subtype,omitempty"`
	Title         string `json:"title,omitempty"`
	MetadataJSON  string `json:"metadataJson,omitempty"`
	Status        string `json:"status"`
	ObservedTitle string `json:"observedTitle,omitempty"`
	HeadingLevel  int    `json:"headingLevel,omitempty"`
	HeadingPath   string `json:"headingPath,omitempty"`
	LineStart     int    `json:"lineStart,omitempty"`
	LineEnd       int    `json:"lineEnd,omitempty"`
	ContentHash   string `json:"contentHash,omitempty"`
	CreatedAt     string `json:"createdAt,omitempty"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
	LastSeenAt    string `json:"lastSeenAt,omitempty"`
}

// DocumentSectionsResponse contains section records for a project.
type DocumentSectionsResponse struct {
	ProjectID string                  `json:"projectId,omitempty"`
	Sections  []DocumentSectionRecord `json:"sections"`
}

type observedDocumentSection struct {
	model           domain.DocumentSectionModel
	anchorLineIndex int
}

type documentSectionFenceState struct {
	active bool
	marker byte
	length int
}

// ListProjectSections returns persisted section metadata for one project.
func (store *Service) ListProjectSections(projectID string) (DocumentSectionsResponse, error) {
	if err := store.requireReady(); err != nil {
		return DocumentSectionsResponse{}, err
	}
	if store.sections == nil {
		return DocumentSectionsResponse{ProjectID: domain.CleanProjectID(projectID)}, nil
	}
	projectID = domain.CleanProjectID(projectID)
	models, err := store.sections.ListProjectSections(projectID)
	if err != nil {
		return DocumentSectionsResponse{}, err
	}
	return DocumentSectionsResponse{ProjectID: projectID, Sections: documentSectionRecordsFromModels(models)}, nil
}

// ReconcileProjectSections synchronizes persisted section metadata with current Markdown content.
func (store *Service) ReconcileProjectSections(projectID string) (DocumentSectionsResponse, error) {
	if err := store.requireReady(); err != nil {
		return DocumentSectionsResponse{}, err
	}
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return DocumentSectionsResponse{}, fmt.Errorf("projectId is required")
	}
	if store.sections == nil {
		return DocumentSectionsResponse{ProjectID: projectID}, nil
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return DocumentSectionsResponse{}, err
	}
	return store.reconcileProjectSectionsUnlocked(projectID, state)
}

func (store *Service) reconcileProjectSectionsUnlocked(projectID string, state workspaceStateResponse) (DocumentSectionsResponse, error) {
	projectID = domain.CleanProjectID(projectID)
	if store.sections == nil || projectID == "" {
		return DocumentSectionsResponse{ProjectID: projectID}, nil
	}

	now := timestamp.NowRFC3339Nano()
	nextDocuments, changed := ensureWorkspaceSectionAnchors(state.Documents, now)
	if changed {
		state.Documents = nextDocuments
		savedState, err := store.saveUnlocked(projectID, workspaceStateRequest{
			Documents:    state.Documents,
			OperationLog: state.OperationLog,
		})
		if err != nil {
			return DocumentSectionsResponse{}, err
		}
		state = savedState
	}

	observed := observeWorkspaceDocumentSections(projectID, state.Documents, now)
	rows := make([]domain.DocumentSectionModel, 0, len(observed))
	seenSectionIDs := make([]string, 0, len(observed))
	for _, section := range observed {
		rows = append(rows, section.model)
		seenSectionIDs = append(seenSectionIDs, section.model.SectionID)
	}
	if err := store.sections.UpsertObservedSections(rows); err != nil {
		return DocumentSectionsResponse{}, err
	}
	if _, err := store.sections.MarkProjectSectionsMissing(projectID, seenSectionIDs, now); err != nil {
		return DocumentSectionsResponse{}, err
	}
	models, err := store.sections.ListProjectSections(projectID)
	if err != nil {
		return DocumentSectionsResponse{}, err
	}
	return DocumentSectionsResponse{ProjectID: projectID, Sections: documentSectionRecordsFromModels(models)}, nil
}

func ensureWorkspaceSectionAnchors(documents []mediamcp.WorkspaceDocument, now string) ([]mediamcp.WorkspaceDocument, bool) {
	used := collectWorkspaceSectionIDs(documents)
	next := append([]mediamcp.WorkspaceDocument(nil), documents...)
	changed := false
	for index := range next {
		content, documentChanged := ensureDocumentSectionAnchors(next[index].Content, used)
		if !documentChanged {
			continue
		}
		next[index].Content = content
		next[index].Comments = NormalizeCommentRecordsForDocument(next[index].ID, content, next[index].Comments)
		next[index].UpdatedAt = now
		next[index].Version = NormalizedDocumentVersion(next[index].Version) + 1
		next[index].IsDirty = true
		changed = true
	}
	return next, changed
}

func ensureDocumentSectionAnchors(content string, used map[string]bool) (string, bool) {
	lines := strings.Split(content, "\n")
	nextLines := make([]string, 0, len(lines))
	changed := false
	var fence documentSectionFenceState
	for index, line := range lines {
		if !fence.active {
			if rawSectionID := documentSectionRawIDFromLine(line); rawSectionID != "" {
				sectionID := documentSectionIDForWriteback(rawSectionID, used)
				if sectionID != "" {
					used[sectionID] = true
					if sectionID != rawSectionID {
						line = documentSectionIDCommentLine(sectionID)
						changed = true
					}
				}
			}
			if documentSectionHeadingPattern.MatchString(line) && documentSectionIDBeforeHeadingLine(lines, index) == "" {
				sectionID := newDocumentSectionID(used)
				used[sectionID] = true
				nextLines = append(nextLines, documentSectionIDCommentLine(sectionID))
				changed = true
			}
		}
		nextLines = append(nextLines, line)
		fence.update(line)
	}
	if !changed {
		return content, false
	}
	return strings.Join(nextLines, "\n"), true
}

func collectWorkspaceSectionIDs(documents []mediamcp.WorkspaceDocument) map[string]bool {
	ids := map[string]bool{}
	for _, document := range documents {
		var fence documentSectionFenceState
		for _, line := range strings.Split(document.Content, "\n") {
			if !fence.active {
				if sectionID := documentSectionCanonicalIDFromLine(line); sectionID != "" {
					ids[sectionID] = true
				}
			}
			fence.update(line)
		}
	}
	return ids
}

// update advances the fenced-code-block state after one Markdown line.
func (state *documentSectionFenceState) update(line string) {
	if state.active {
		if documentSectionFenceCloses(line, state.marker, state.length) {
			*state = documentSectionFenceState{}
		}
		return
	}
	marker, length, ok := documentSectionFenceOpener(line)
	if !ok {
		return
	}
	state.active = true
	state.marker = marker
	state.length = length
}

func documentSectionFenceOpener(line string) (byte, int, bool) {
	trimmed, ok := documentSectionFenceLinePrefix(line)
	if !ok || len(trimmed) < 3 {
		return 0, 0, false
	}
	marker := trimmed[0]
	if marker != '`' && marker != '~' {
		return 0, 0, false
	}
	length := documentSectionFenceMarkerLength(trimmed, marker)
	if length < 3 {
		return 0, 0, false
	}
	return marker, length, true
}

func documentSectionFenceCloses(line string, marker byte, length int) bool {
	trimmed, ok := documentSectionFenceLinePrefix(line)
	if !ok || len(trimmed) == 0 || trimmed[0] != marker {
		return false
	}
	return documentSectionFenceMarkerLength(trimmed, marker) >= length
}

func documentSectionFenceLinePrefix(line string) (string, bool) {
	spaceCount := 0
	for spaceCount < len(line) && line[spaceCount] == ' ' {
		spaceCount++
	}
	if spaceCount > 3 {
		return "", false
	}
	return line[spaceCount:], true
}

func documentSectionFenceMarkerLength(value string, marker byte) int {
	length := 0
	for length < len(value) && value[length] == marker {
		length++
	}
	return length
}

func observeWorkspaceDocumentSections(projectID string, documents []mediamcp.WorkspaceDocument, now string) []observedDocumentSection {
	observed := make([]observedDocumentSection, 0)
	seen := map[string]bool{}
	nowTime := domain.TimeFromString(now)
	for _, document := range documents {
		sections, consumedAnchors := observeDocumentHeadingSections(projectID, document, now, nowTime, seen)
		observed = append(observed, sections...)
		observed = append(observed, observeDocumentDetachedSections(projectID, document, now, nowTime, consumedAnchors, seen)...)
	}
	return observed
}

func observeDocumentHeadingSections(
	projectID string,
	document mediamcp.WorkspaceDocument,
	now string,
	nowTime time.Time,
	seen map[string]bool,
) ([]observedDocumentSection, map[int]bool) {
	lines := strings.Split(document.Content, "\n")
	sections := make([]observedDocumentSection, 0)
	consumedAnchors := map[int]bool{}
	headingPath := []string{}
	var fence documentSectionFenceState
	for index, line := range lines {
		if fence.active {
			fence.update(line)
			continue
		}
		match := documentSectionHeadingPattern.FindStringSubmatch(line)
		if len(match) == 0 {
			fence.update(line)
			continue
		}
		level := len(match[1])
		title := normalizeDocumentSectionHeading(match[2])
		if title == "" {
			continue
		}
		if len(headingPath) >= level {
			headingPath = headingPath[:level-1]
		}
		for len(headingPath) < level-1 {
			headingPath = append(headingPath, "")
		}
		headingPath = append(headingPath, title)

		sectionID, anchorIndex := documentSectionIDBeforeHeadingLineWithIndex(lines, index)
		if sectionID == "" {
			continue
		}
		consumedAnchors[anchorIndex] = true
		status := DocumentSectionStatusActive
		if seen[sectionID] {
			status = DocumentSectionStatusDuplicated
		}
		seen[sectionID] = true
		endIndex := documentSectionEndLine(lines, index, level)
		sectionMarkdown := strings.Join(lines[index:endIndex], "\n")
		sectionType := documentSectionTypeFromDocument(document)
		sections = append(sections, observedDocumentSection{
			model: domain.DocumentSectionModel{
				ProjectID:     projectID,
				SectionID:     sectionID,
				DocumentID:    document.ID,
				Type:          sectionType,
				Title:         title,
				MetadataJSON:  "{}",
				Status:        status,
				ObservedTitle: title,
				HeadingLevel:  level,
				HeadingPath:   strings.Join(compactDocumentSectionPath(headingPath), " / "),
				LineStart:     index + 1,
				LineEnd:       endIndex,
				ContentHash:   documentSectionContentHash(sectionMarkdown),
				CreatedAt:     nowTime,
				UpdatedAt:     nowTime,
				LastSeenAt:    &nowTime,
			},
			anchorLineIndex: anchorIndex,
		})
	}
	return sections, consumedAnchors
}

func observeDocumentDetachedSections(
	projectID string,
	document mediamcp.WorkspaceDocument,
	now string,
	nowTime time.Time,
	consumedAnchors map[int]bool,
	seen map[string]bool,
) []observedDocumentSection {
	lines := strings.Split(document.Content, "\n")
	sections := make([]observedDocumentSection, 0)
	var fence documentSectionFenceState
	for index, line := range lines {
		if !fence.active {
			sectionID := documentSectionIDFromLine(line)
			if sectionID == "" || consumedAnchors[index] {
				fence.update(line)
				continue
			}
			status := DocumentSectionStatusDetached
			if seen[sectionID] {
				status = DocumentSectionStatusDuplicated
			}
			seen[sectionID] = true
			sections = append(sections, observedDocumentSection{
				model: domain.DocumentSectionModel{
					ProjectID:    projectID,
					SectionID:    sectionID,
					DocumentID:   document.ID,
					Type:         documentSectionTypeFromDocument(document),
					MetadataJSON: "{}",
					Status:       status,
					LineStart:    index + 1,
					LineEnd:      index + 1,
					ContentHash:  documentSectionContentHash(line),
					CreatedAt:    nowTime,
					UpdatedAt:    nowTime,
					LastSeenAt:   &nowTime,
				},
				anchorLineIndex: index,
			})
		}
		fence.update(line)
	}
	return sections
}

func documentSectionIDBeforeHeadingLine(lines []string, headingIndex int) string {
	sectionID, _ := documentSectionIDBeforeHeadingLineWithIndex(lines, headingIndex)
	return sectionID
}

func documentSectionIDBeforeHeadingLineWithIndex(lines []string, headingIndex int) (string, int) {
	for index := headingIndex - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		return documentSectionIDFromLine(line), index
	}
	return "", -1
}

func documentSectionIDFromLine(line string) string {
	return normalizeDocumentSectionID(documentSectionRawIDFromLine(line))
}

func documentSectionRawIDFromLine(line string) string {
	match := documentSectionIDLinePattern.FindStringSubmatch(strings.TrimSpace(line))
	if len(match) != 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

func documentSectionCanonicalIDFromLine(line string) string {
	sectionID := documentSectionRawIDFromLine(line)
	if !documentSectionIDPattern.MatchString(sectionID) {
		return ""
	}
	return sectionID
}

func normalizeDocumentSectionID(value string) string {
	value = strings.TrimSpace(value)
	switch {
	case documentSectionIDPattern.MatchString(value):
		return value
	case documentSectionLegacyIDPattern.MatchString(value):
		return "section_" + strings.TrimPrefix(value, "section-")
	default:
		return ""
	}
}

func documentSectionIDForWriteback(value string, used map[string]bool) string {
	value = strings.TrimSpace(value)
	if documentSectionIDPattern.MatchString(value) {
		return value
	}
	base := normalizeDocumentSectionID(value)
	if base == "" {
		return ""
	}
	candidate := base
	for suffix := 2; used[candidate]; suffix++ {
		candidate = fmt.Sprintf("%s_%d", base, suffix)
	}
	return candidate
}

func documentSectionIDCommentLine(sectionID string) string {
	return fmt.Sprintf("<!-- section-id: %s -->", sectionID)
}

func documentSectionEndLine(lines []string, headingIndex int, headingLevel int) int {
	var fence documentSectionFenceState
	for index := headingIndex + 1; index < len(lines); index++ {
		if fence.active {
			fence.update(lines[index])
			continue
		}
		match := documentSectionHeadingPattern.FindStringSubmatch(lines[index])
		if len(match) > 0 && len(match[1]) <= headingLevel {
			return documentSectionBoundaryBeforeHeadingLine(lines, headingIndex, index)
		}
		fence.update(lines[index])
	}
	return len(lines)
}

func documentSectionBoundaryBeforeHeadingLine(lines []string, headingIndex int, nextHeadingIndex int) int {
	for index := nextHeadingIndex - 1; index > headingIndex; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		if documentSectionIDLinePattern.MatchString(line) {
			return index
		}
		break
	}
	return nextHeadingIndex
}

func documentSectionTypeFromDocument(document mediamcp.WorkspaceDocument) string {
	category := NormalizeDocumentCategoryValue(document.Category)
	if category == "" || ValidateDocumentCategory(category) != nil {
		return DocumentSectionTypeUnknown
	}
	return category
}

func normalizeDocumentSectionHeading(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func compactDocumentSectionPath(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

func documentSectionContentHash(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])
}

func newDocumentSectionID(used map[string]bool) string {
	for {
		var data [8]byte
		if _, err := rand.Read(data[:]); err == nil {
			id := "section_" + hex.EncodeToString(data[:])
			if !used[id] {
				return id
			}
		}
		id := "section_" + strconv.FormatInt(time.Now().UnixNano(), 36)
		if !used[id] {
			return id
		}
	}
}

func documentSectionRecordsFromModels(models []domain.DocumentSectionModel) []DocumentSectionRecord {
	records := make([]DocumentSectionRecord, 0, len(models))
	for _, model := range models {
		record := DocumentSectionRecord{
			ProjectID:     model.ProjectID,
			SectionID:     model.SectionID,
			DocumentID:    model.DocumentID,
			Type:          model.Type,
			Subtype:       model.Subtype,
			Title:         model.Title,
			MetadataJSON:  model.MetadataJSON,
			Status:        model.Status,
			ObservedTitle: model.ObservedTitle,
			HeadingLevel:  model.HeadingLevel,
			HeadingPath:   model.HeadingPath,
			LineStart:     model.LineStart,
			LineEnd:       model.LineEnd,
			ContentHash:   model.ContentHash,
			CreatedAt:     domain.StringFromTime(model.CreatedAt),
			UpdatedAt:     domain.StringFromTime(model.UpdatedAt),
			LastSeenAt:    domain.StringFromTime(documentSectionTimePtrValue(model.LastSeenAt)),
		}
		records = append(records, record)
	}
	return records
}

func documentSectionTimePtrValue(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}
