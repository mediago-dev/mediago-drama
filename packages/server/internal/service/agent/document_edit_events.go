package agent

import (
	"encoding/json"
	"regexp"
	"strings"

	docs "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/model"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/shared"
)

// AgentDocumentEditSnapshot captures the document fields used by edit events.
type AgentDocumentEditSnapshot struct {
	ID        string
	Title     string
	Content   string
	ParentID  string
	SortOrder int
	UpdatedAt string
	Comments  []mediamcp.DocumentComment
}

// AgentDocumentEditDelta describes an incremental document edit event.
type AgentDocumentEditDelta struct {
	StreamID   string
	Mode       string
	Delta      string
	Content    string
	Summary    string
	AnchorText string
	BlockID    string
	Op         string
	Range      *mediamcp.DocumentTextRange
	Status     string
	Completed  bool
}

// DocumentEditEventContext carries run identity for document edit events.
type DocumentEditEventContext struct {
	ProjectID string
	RunID     string
	AgentTag  string
}

// SnapshotDocument converts a workspace document to an edit snapshot.
func SnapshotDocument(document mediamcp.WorkspaceDocument) AgentDocumentEditSnapshot {
	return AgentDocumentEditSnapshot{
		ID:        document.ID,
		Title:     document.Title,
		Content:   document.Content,
		ParentID:  document.ParentID,
		SortOrder: document.SortOrder,
		UpdatedAt: document.UpdatedAt,
		Comments:  document.Comments,
	}
}

// EmptyDocumentEditSnapshot returns an empty snapshot for a new document.
func EmptyDocumentEditSnapshot(documentID string) AgentDocumentEditSnapshot {
	return AgentDocumentEditSnapshot{ID: documentID, Comments: []mediamcp.DocumentComment{}}
}

// SameDocumentEditSnapshot reports whether two edit snapshots have the same editable fields.
func SameDocumentEditSnapshot(first AgentDocumentEditSnapshot, second AgentDocumentEditSnapshot) bool {
	return first.Title == second.Title &&
		first.Content == second.Content &&
		first.ParentID == second.ParentID &&
		first.SortOrder == second.SortOrder
}

// DocumentSnapshotFromEditSnapshot converts an edit snapshot to an operation-log snapshot.
func DocumentSnapshotFromEditSnapshot(snapshot AgentDocumentEditSnapshot) model.DocumentSnapshotRecord {
	return model.DocumentSnapshotRecord{
		Title:    snapshot.Title,
		Content:  snapshot.Content,
		Comments: snapshot.Comments,
	}
}

// BuildDocumentEditEvent constructs one agent document edit event.
func BuildDocumentEditEvent(eventType string, document mediamcp.WorkspaceDocument, delta AgentDocumentEditDelta, context DocumentEditEventContext) AgentEvent {
	summary := strings.TrimSpace(delta.Summary)
	if summary == "" {
		switch eventType {
		case "agent.document.edit.started":
			summary = "开始流式编辑。"
		case "agent.document.edit.completed":
			summary = "流式编辑已完成。"
		default:
			summary = "正在写入《" + document.Title + "》。"
		}
	}
	message := summary
	if message == "" {
		message = "正在写入《" + document.Title + "》。"
	}
	return AgentEvent{
		ProjectID: context.ProjectID,
		Type:      eventType,
		Message:   message,
		DocumentEdit: &AgentDocumentEditEvent{
			DocumentID: document.ID,
			StreamID:   strings.TrimSpace(delta.StreamID),
			Title:      document.Title,
			ParentID:   document.ParentID,
			SortOrder:  document.SortOrder,
			Mode:       strings.TrimSpace(delta.Mode),
			Delta:      delta.Delta,
			Content:    delta.Content,
			AnchorText: strings.TrimSpace(delta.AnchorText),
			BlockID:    strings.TrimSpace(delta.BlockID),
			Op:         strings.TrimSpace(delta.Op),
			Range:      delta.Range,
			Summary:    summary,
			Status:     shared.FirstNonEmpty(delta.Status, "streaming"),
			UpdatedAt:  document.UpdatedAt,
			RunID:      context.RunID,
			AgentTag:   context.AgentTag,
		},
	}
}

// BuildDocumentEditFailedEvent constructs a failed document edit event.
func BuildDocumentEditFailedEvent(projectID string, documentID string, title string, summary string) AgentEvent {
	summary = shared.FirstNonEmpty(summary, "文档编辑失败。")
	return AgentEvent{
		ProjectID: projectID,
		Type:      "agent.document.edit.failed",
		Message:   summary,
		DocumentEdit: &AgentDocumentEditEvent{
			DocumentID: strings.TrimSpace(documentID),
			Title:      strings.TrimSpace(title),
			Status:     "failed",
			Summary:    summary,
		},
	}
}

// NewDocumentEditOperationLogRecord builds an operation-log entry for a document edit.
func NewDocumentEditOperationLogRecord(before AgentDocumentEditSnapshot, after AgentDocumentEditSnapshot, summary string, agentSource string) (model.DocumentOperationLogRecord, bool) {
	if after.ID == "" || SameDocumentEditSnapshot(before, after) {
		return model.DocumentOperationLogRecord{}, false
	}
	now := timestamp.NowRFC3339Nano()
	if strings.TrimSpace(summary) == "" {
		summary = "文档编辑已完成。"
	}
	operations := DocumentEditOperations(before, after, summary, now)
	if len(operations) == 0 {
		return model.DocumentOperationLogRecord{}, false
	}
	return model.DocumentOperationLogRecord{
		ID:         shared.MustRandomID("oplog"),
		DocumentID: after.ID,
		Operations: operations,
		Summary:    summary,
		Source:     AgentOperationSource(agentSource),
		CreatedAt:  now,
		Before:     DocumentSnapshotFromEditSnapshot(before),
		After:      DocumentSnapshotFromEditSnapshot(after),
	}, true
}

// DocumentEditOperations builds compact operation-log entries for a document edit.
func DocumentEditOperations(before AgentDocumentEditSnapshot, after AgentDocumentEditSnapshot, summary string, createdAt string) []map[string]any {
	operations := []map[string]any{}
	target := map[string]any{"documentId": after.ID}
	if before.Title != after.Title {
		operations = append(operations, documentEditOperation("document_title_edit", summary, target, map[string]any{
			"beforeTitle": before.Title,
			"afterTitle":  after.Title,
		}, createdAt))
	}
	if before.ParentID != after.ParentID {
		operations = append(operations, documentEditOperation("document_metadata_edit", summary, target, map[string]any{
			"field":          "parentId",
			"beforeParentId": before.ParentID,
			"afterParentId":  after.ParentID,
		}, createdAt))
	}
	if before.SortOrder != after.SortOrder {
		operations = append(operations, documentEditOperation("document_metadata_edit", summary, target, map[string]any{
			"field":           "sortOrder",
			"beforeSortOrder": before.SortOrder,
			"afterSortOrder":  after.SortOrder,
		}, createdAt))
	}
	if before.Content != after.Content {
		operations = append(operations, documentEditOperation("document_patch_edit", summary, target, DocumentPatchEditPayload(before.Content, after.Content), createdAt))
	}
	return operations
}

func documentEditOperation(operationType string, summary string, target map[string]any, payload map[string]any, createdAt string) map[string]any {
	return map[string]any{
		"id":        shared.MustRandomID("op"),
		"type":      operationType,
		"summary":   summary,
		"target":    target,
		"payload":   payload,
		"createdAt": createdAt,
	}
}

const maxLineDiffCells = 1000000

// DocumentPatchEditPayload builds compact text patches instead of storing full before/after content.
func DocumentPatchEditPayload(beforeContent string, afterContent string) map[string]any {
	single := singleRangeDocumentPatchPayload(beforeContent, afterContent)
	multi := multiHunkDocumentPatchPayload(beforeContent, afterContent)
	if patches, ok := multi["patches"].([]map[string]any); ok && len(patches) > 1 && encodedPayloadLength(multi) < encodedPayloadLength(single) {
		return multi
	}
	return single
}

func singleRangeDocumentPatchPayload(beforeContent string, afterContent string) map[string]any {
	beforeRunes := []rune(beforeContent)
	afterRunes := []rune(afterContent)
	prefix := 0
	for prefix < len(beforeRunes) && prefix < len(afterRunes) && beforeRunes[prefix] == afterRunes[prefix] {
		prefix++
	}
	suffix := 0
	for suffix < len(beforeRunes)-prefix && suffix < len(afterRunes)-prefix &&
		beforeRunes[len(beforeRunes)-1-suffix] == afterRunes[len(afterRunes)-1-suffix] {
		suffix++
	}
	beforeEnd := len(beforeRunes) - suffix
	afterEnd := len(afterRunes) - suffix
	rangeStart := docs.UTF16Length(string(beforeRunes[:prefix]))
	rangeEnd := docs.UTF16Length(string(beforeRunes[:beforeEnd]))
	replacement := string(afterRunes[prefix:afterEnd])
	return map[string]any{
		"patches": []map[string]any{
			{
				"op": "replace_range",
				"range": map[string]any{
					"start": rangeStart,
					"end":   rangeEnd,
				},
				"replacement": replacement,
			},
		},
		"beforeLength": docs.UTF16Length(beforeContent),
		"afterLength":  docs.UTF16Length(afterContent),
	}
}

func multiHunkDocumentPatchPayload(beforeContent string, afterContent string) map[string]any {
	beforeLines := splitLinesPreserveNewline(beforeContent)
	afterLines := splitLinesPreserveNewline(afterContent)
	if len(beforeLines)*len(afterLines) > maxLineDiffCells {
		return singleRangeDocumentPatchPayload(beforeContent, afterContent)
	}
	offsets := utf16LineOffsets(beforeLines)
	patches := lineDiffPatches(beforeLines, afterLines, offsets)
	return map[string]any{
		"patches":      patches,
		"beforeLength": docs.UTF16Length(beforeContent),
		"afterLength":  docs.UTF16Length(afterContent),
	}
}

func splitLinesPreserveNewline(content string) []string {
	if content == "" {
		return nil
	}
	return strings.SplitAfter(content, "\n")
}

func utf16LineOffsets(lines []string) []int {
	offsets := make([]int, len(lines)+1)
	for index, line := range lines {
		offsets[index+1] = offsets[index] + docs.UTF16Length(line)
	}
	return offsets
}

func lineDiffPatches(beforeLines []string, afterLines []string, beforeOffsets []int) []map[string]any {
	table := lineLCSTable(beforeLines, afterLines)
	patches := []map[string]any{}
	beforeIndex := 0
	afterIndex := 0
	changeBeforeStart := -1
	changeAfterStart := -1
	flush := func() {
		if changeBeforeStart < 0 {
			return
		}
		patches = append(patches, map[string]any{
			"op": "replace_range",
			"range": map[string]any{
				"start": beforeOffsets[changeBeforeStart],
				"end":   beforeOffsets[beforeIndex],
			},
			"replacement": strings.Join(afterLines[changeAfterStart:afterIndex], ""),
		})
		changeBeforeStart = -1
		changeAfterStart = -1
	}
	startChange := func() {
		if changeBeforeStart >= 0 {
			return
		}
		changeBeforeStart = beforeIndex
		changeAfterStart = afterIndex
	}
	for beforeIndex < len(beforeLines) || afterIndex < len(afterLines) {
		if beforeIndex < len(beforeLines) && afterIndex < len(afterLines) && beforeLines[beforeIndex] == afterLines[afterIndex] {
			flush()
			beforeIndex++
			afterIndex++
			continue
		}
		startChange()
		if afterIndex >= len(afterLines) || (beforeIndex < len(beforeLines) && table[beforeIndex+1][afterIndex] >= table[beforeIndex][afterIndex+1]) {
			beforeIndex++
			continue
		}
		afterIndex++
	}
	flush()
	if len(patches) == 0 {
		return []map[string]any{}
	}
	return patches
}

func lineLCSTable(beforeLines []string, afterLines []string) [][]int {
	table := make([][]int, len(beforeLines)+1)
	for index := range table {
		table[index] = make([]int, len(afterLines)+1)
	}
	for beforeIndex := len(beforeLines) - 1; beforeIndex >= 0; beforeIndex-- {
		for afterIndex := len(afterLines) - 1; afterIndex >= 0; afterIndex-- {
			if beforeLines[beforeIndex] == afterLines[afterIndex] {
				table[beforeIndex][afterIndex] = table[beforeIndex+1][afterIndex+1] + 1
				continue
			}
			if table[beforeIndex+1][afterIndex] >= table[beforeIndex][afterIndex+1] {
				table[beforeIndex][afterIndex] = table[beforeIndex+1][afterIndex]
			} else {
				table[beforeIndex][afterIndex] = table[beforeIndex][afterIndex+1]
			}
		}
	}
	return table
}

func encodedPayloadLength(payload map[string]any) int {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return 0
	}
	return len(encoded)
}

var agentSourceSanitizer = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

// AgentOperationSource returns the operation-log source label for an agent source.
func AgentOperationSource(agentSource string) string {
	source := strings.TrimSpace(agentSource)
	if source == "" {
		return "agent"
	}
	source = agentSourceSanitizer.ReplaceAllString(source, "-")
	source = strings.Trim(source, "-_")
	if source == "" {
		return "agent"
	}
	return "agent:" + source
}
