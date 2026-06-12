package agent

import (
	"strings"
	"testing"

	docs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func TestBuildDocumentEditEventDecoratesDocumentEdit(t *testing.T) {
	event := BuildDocumentEditEvent(
		"agent.document.edit.delta",
		mediamcp.WorkspaceDocument{ID: "doc-1", Title: "Scene", ParentID: "root", SortOrder: 3, UpdatedAt: "now"},
		AgentDocumentEditDelta{StreamID: "stream-1", Mode: "append", Delta: "text"},
		DocumentEditEventContext{ProjectID: "project-1", RunID: "run-1", AgentTag: "Writer"},
	)

	if event.ProjectID != "project-1" ||
		event.Type != "agent.document.edit.delta" ||
		event.DocumentEdit == nil ||
		event.DocumentEdit.DocumentID != "doc-1" ||
		event.DocumentEdit.RunID != "run-1" ||
		event.DocumentEdit.AgentTag != "Writer" {
		t.Fatalf("event = %#v, want decorated document edit", event)
	}
}

func TestNewDocumentEditOperationLogRecordSkipsUnchangedSnapshots(t *testing.T) {
	before := AgentDocumentEditSnapshot{ID: "doc-1", Title: "Title", Content: "same"}
	after := AgentDocumentEditSnapshot{ID: "doc-1", Title: "Title", Content: "same"}

	if _, ok := NewDocumentEditOperationLogRecord(before, after, "", "writer"); ok {
		t.Fatal("ok = true, want unchanged snapshots skipped")
	}

	record, ok := NewDocumentEditOperationLogRecord(before, AgentDocumentEditSnapshot{ID: "doc-1", Title: "Title", Content: "next"}, "updated", "writer")
	if !ok || record.DocumentID != "doc-1" || record.Summary != "updated" || record.Source != "agent:writer" || len(record.Operations) != 1 {
		t.Fatalf("record = %#v ok=%v, want operation log record", record, ok)
	}
	if got := record.Operations[0]["type"]; got != "document_patch_edit" {
		t.Fatalf("operation type = %v, want document_patch_edit", got)
	}
	payload, ok := record.Operations[0]["payload"].(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v, want map", record.Operations[0]["payload"])
	}
	if _, ok := payload["beforeContent"]; ok {
		t.Fatalf("payload contains beforeContent: %#v", payload)
	}
	if _, ok := payload["afterContent"]; ok {
		t.Fatalf("payload contains afterContent: %#v", payload)
	}
}

func TestNewDocumentEditOperationLogRecordUsesTitleEditForTitleOnly(t *testing.T) {
	before := AgentDocumentEditSnapshot{ID: "doc-1", Title: "Old", Content: "same"}
	after := AgentDocumentEditSnapshot{ID: "doc-1", Title: "New", Content: "same"}

	record, ok := NewDocumentEditOperationLogRecord(before, after, "renamed", "writer")
	if !ok {
		t.Fatal("ok = false, want title edit record")
	}
	if len(record.Operations) != 1 {
		t.Fatalf("operations = %#v, want one title operation", record.Operations)
	}
	if got := record.Operations[0]["type"]; got != "document_title_edit" {
		t.Fatalf("operation type = %v, want document_title_edit", got)
	}
	payload := record.Operations[0]["payload"].(map[string]any)
	if _, ok := payload["beforeContent"]; ok {
		t.Fatalf("title payload contains beforeContent: %#v", payload)
	}
	if payload["beforeTitle"] != "Old" || payload["afterTitle"] != "New" {
		t.Fatalf("payload = %#v, want title transition", payload)
	}
}

func TestDocumentPatchEditPayloadUsesMultipleHunksForSeparatedChanges(t *testing.T) {
	middle := strings.Repeat("unchanged middle line\n", 20)
	before := "## A\n\nold one\n\n" + middle + "\n## C\n\nold three\n"
	after := "## A\n\nnew one\n\n" + middle + "\n## C\n\nnew three\n"

	payload := DocumentPatchEditPayload(before, after)
	patches, ok := payload["patches"].([]map[string]any)
	if !ok {
		t.Fatalf("patches = %#v, want typed patch list", payload["patches"])
	}
	if len(patches) != 2 {
		t.Fatalf("patches = %#v, want two separated hunks", patches)
	}
	if patches[0]["replacement"] != "new one\n" || patches[1]["replacement"] != "new three\n" {
		t.Fatalf("patches = %#v, want replacements for separated lines", patches)
	}
	replayed, ok := replayPatchPayloadForTest(before, patches)
	if !ok {
		t.Fatalf("patches = %#v, failed to replay", patches)
	}
	if replayed != after {
		t.Fatalf("replayed = %q, want %q", replayed, after)
	}
}

func replayPatchPayloadForTest(content string, patches []map[string]any) (string, bool) {
	next := content
	for index := len(patches) - 1; index >= 0; index-- {
		rawRange, ok := patches[index]["range"].(map[string]any)
		if !ok {
			return "", false
		}
		start, ok := intFromPatchPayloadForTest(rawRange["start"])
		if !ok {
			return "", false
		}
		end, ok := intFromPatchPayloadForTest(rawRange["end"])
		if !ok {
			return "", false
		}
		replacement, ok := patches[index]["replacement"].(string)
		if !ok {
			return "", false
		}
		startByte, endByte, ok := docs.UTF16RangeToByteRange(next, mediamcp.DocumentTextRange{Start: start, End: end})
		if !ok {
			return "", false
		}
		next = next[:startByte] + replacement + next[endByte:]
	}
	return next, true
}

func intFromPatchPayloadForTest(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case float64:
		return int(typed), typed == float64(int(typed))
	default:
		return 0, false
	}
}
