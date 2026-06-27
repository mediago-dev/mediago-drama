package document

import (
	"strings"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func TestNormalizeStreamDocumentEditInput(t *testing.T) {
	parentID := " parent "
	input := NormalizeStreamDocumentEditInput(StreamDocumentEditInput{
		StreamID:         " stream-1 ",
		DocumentID:       " doc-1 ",
		Mode:             " append ",
		AnchorText:       " quote ",
		Title:            " Title ",
		Category:         " screenplay ",
		ParentDocumentID: &parentID,
		Summary:          " summary ",
	})

	if input.StreamID != "stream-1" ||
		input.DocumentID != "doc-1" ||
		input.Mode != "append" ||
		input.AnchorText != "quote" ||
		input.Title != "Title" ||
		input.Category != "screenplay" ||
		input.Summary != "summary" ||
		input.ParentDocumentID == nil ||
		*input.ParentDocumentID != "parent" {
		t.Fatalf("input = %#v, want trimmed stream input", input)
	}
}

func TestStreamEditEventMode(t *testing.T) {
	tests := []struct {
		name string
		mode string
		want string
	}{
		{name: "replace block", mode: "replace_block", want: "replace"},
		{name: "replace document", mode: "replace_document", want: "replace"},
		{name: "create", mode: "create", want: "replace"},
		{name: "append", mode: "append", want: "append"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := StreamEditEventMode(test.mode); got != test.want {
				t.Fatalf("StreamEditEventMode(%q) = %q, want %q", test.mode, got, test.want)
			}
		})
	}
}

func TestValidateStreamDocumentEditInput(t *testing.T) {
	if err := ValidateStreamDocumentEditInput(StreamDocumentEditInput{}); err == nil {
		t.Fatal("ValidateStreamDocumentEditInput returned nil, want mode error")
	}
	if err := ValidateStreamDocumentEditInput(StreamDocumentEditInput{Mode: "append"}); err == nil {
		t.Fatal("ValidateStreamDocumentEditInput returned nil, want chunk error")
	}
	if err := ValidateStreamDocumentEditInput(StreamDocumentEditInput{Mode: "append", Finalize: true}); err != nil {
		t.Fatalf("ValidateStreamDocumentEditInput returned error: %v", err)
	}
}

func TestStreamDocumentCreateRequest(t *testing.T) {
	parentID := "parent"
	request, err := StreamDocumentCreateRequest(StreamDocumentEditInput{
		DocumentID:       "doc-1",
		Mode:             "create",
		Title:            "",
		Category:         "screenplay",
		ParentDocumentID: &parentID,
	})
	if err != nil {
		t.Fatalf("StreamDocumentCreateRequest returned error: %v", err)
	}
	if request.ID != "doc-1" || request.Title != "生成中文档" || request.Category != "screenplay" || request.ParentID == nil || *request.ParentID != "parent" {
		t.Fatalf("request = %#v, want create document request", request)
	}
}

func TestStreamDocumentCreateRequestInfersBusinessCategory(t *testing.T) {
	tests := []struct {
		title    string
		category string
	}{
		{title: "第一集 剧本", category: "screenplay"},
		{title: "第一集 角色设定", category: "character"},
		{title: "第一集角色文档", category: "character"},
		{title: "第一集 场景设定", category: "scene"},
		{title: "第一集场景文档", category: "scene"},
		{title: "第一集 道具设定", category: "prop"},
		{title: "第一集道具文档", category: "prop"},
		{title: "第一集 分镜脚本", category: "storyboard"},
		{title: "角色设定参考资料", category: referenceDocumentCategory},
	}

	for _, test := range tests {
		request, err := StreamDocumentCreateRequest(StreamDocumentEditInput{
			Mode:  "create",
			Title: test.title,
		})
		if err != nil {
			t.Fatalf("StreamDocumentCreateRequest(%q) returned error: %v", test.title, err)
		}
		if request.Category != test.category {
			t.Fatalf("%s category = %q, want %q", test.title, request.Category, test.category)
		}
	}
}

func TestValidateStreamDocumentVersion(t *testing.T) {
	expected := 2
	document := mediamcp.WorkspaceDocument{ID: "doc-1", Version: 3}
	err := ValidateStreamDocumentVersion(StreamDocumentEditInput{ExpectedVersion: &expected}, document)
	if err == nil {
		t.Fatal("ValidateStreamDocumentVersion returned nil, want conflict")
	}
	if !strings.Contains(err.Error(), "expected version 2, current 3") {
		t.Fatalf("error = %q, want version conflict", err)
	}
}

func TestDocumentEditStreamRecordAndUpdateRequest(t *testing.T) {
	document := mediamcp.WorkspaceDocument{
		ID:       "doc-1",
		Title:    "旧标题",
		ParentID: "parent",
		Version:  2,
		Content:  "before",
	}
	input := StreamDocumentEditInput{
		StreamID: "stream-1",
		Mode:     "append",
		Title:    "新标题",
	}
	before := SnapshotDocument(document)
	record := NewDocumentEditStreamRecord("project-1", "run-1", input, document, before)
	if record.ProjectID != "project-1" ||
		record.StreamID != "stream-1" ||
		record.Title != "新标题" ||
		record.BaseVersion != 2 ||
		record.Before.Content != "before" {
		t.Fatalf("record = %#v, want initialized stream record", record)
	}

	record.Buffer = "\nafter"
	update, err := StreamDocumentUpdateRequest(document.Content, record, input)
	if err != nil {
		t.Fatalf("StreamDocumentUpdateRequest returned error: %v", err)
	}
	if update.Content == nil || *update.Content != "before\nafter" {
		t.Fatalf("update content = %#v, want appended content", update.Content)
	}
	if update.Title == nil || *update.Title != "新标题" {
		t.Fatalf("update title = %#v, want title update", update.Title)
	}
	if update.IsDirty == nil || *update.IsDirty {
		t.Fatalf("update isDirty = %#v, want false", update.IsDirty)
	}

	document.Title = "新标题"
	record = UpdateDocumentEditStreamAfterChunk(record, document)
	if record.DocumentID != "doc-1" || record.Title != "新标题" || record.Status != "streaming" {
		t.Fatalf("chunk record = %#v, want streaming record", record)
	}
	record = CompleteDocumentEditStreamRecord(record)
	if record.Status != "completed" {
		t.Fatalf("status = %q, want completed", record.Status)
	}
}

func TestApplyDocumentEditStreamBuffer(t *testing.T) {
	before := AgentDocumentEditSnapshot{Content: "before\n\nanchor text\n"}
	tests := []struct {
		name    string
		current string
		mode    string
		anchor  string
		buffer  string
		want    string
	}{
		{name: "create", mode: "create", buffer: "new", want: "new"},
		{name: "replace document", mode: "replace_document", buffer: "new", want: "new"},
		{name: "append", mode: "append", buffer: "\nnext", want: "before\n\nanchor text\n\nnext"},
		{name: "replace block", mode: "replace_block", anchor: "anchor", buffer: "replacement", want: "before\n\nreplacement"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := ApplyDocumentEditStreamBuffer(test.current, before, test.mode, test.anchor, test.buffer)
			if err != nil {
				t.Fatalf("ApplyDocumentEditStreamBuffer returned error: %v", err)
			}
			if got != test.want {
				t.Fatalf("got = %q, want %q", got, test.want)
			}
		})
	}
}
