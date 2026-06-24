package document

import (
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func documentsByCategory(t *testing.T, store *Service, projectID, category string) []mediamcp.WorkspaceDocument {
	t.Helper()
	state, err := store.ListWorkspaceDocuments(projectID)
	if err != nil {
		t.Fatalf("ListWorkspaceDocuments returned error: %v", err)
	}
	var matched []mediamcp.WorkspaceDocument
	for _, document := range state.Documents {
		if document.Category == category {
			matched = append(matched, document)
		}
	}
	return matched
}

func TestCreateWorkspaceDocumentFromInputOverwritesSameSlot(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "dedupe-same-slot"
	requireTestProject(t, store, projectID)

	first, err := store.CreateWorkspaceDocumentFromInput(projectID, CreateDocumentInput{
		Title:    "第一集剧本",
		Category: "screenplay",
		InitialBlocks: []mediamcp.DocumentBlockInput{
			{Kind: "paragraph", Text: "初版正文。"},
		},
	})
	if err != nil {
		t.Fatalf("first create returned error: %v", err)
	}

	// A separator/whitespace title variant with new content must overwrite the same
	// record (same slot = category + normalized title) instead of creating a duplicate.
	second, err := store.CreateWorkspaceDocumentFromInput(projectID, CreateDocumentInput{
		Title:    "第一集-剧本",
		Category: "screenplay",
		InitialBlocks: []mediamcp.DocumentBlockInput{
			{Kind: "paragraph", Text: "重生成的正文。"},
		},
	})
	if err != nil {
		t.Fatalf("second create returned error: %v", err)
	}

	if second.ID != first.ID {
		t.Fatalf("second.ID = %q, want overwrite of existing %q", second.ID, first.ID)
	}
	if second.Version <= first.Version {
		t.Fatalf("second.Version = %d, want greater than %d", second.Version, first.Version)
	}
	if second.Content != "重生成的正文。\n" {
		t.Fatalf("second.Content = %q, want overwritten content", second.Content)
	}
	if got := documentsByCategory(t, store, projectID, "screenplay"); len(got) != 1 {
		t.Fatalf("screenplay document count = %d, want 1 (overwrite, not duplicate)", len(got))
	}
}

func TestCreateWorkspaceDocumentFromInputKeepsDistinctSlots(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "dedupe-distinct-slot"
	requireTestProject(t, store, projectID)

	creates := []CreateDocumentInput{
		{Title: "第一集剧本", Category: "screenplay"},
		// Same title, different category -> different slot.
		{Title: "第一集剧本", Category: "character"},
		// Same category, different title -> different slot.
		{Title: "第二集剧本", Category: "screenplay"},
	}
	for _, input := range creates {
		if _, err := store.CreateWorkspaceDocumentFromInput(projectID, input); err != nil {
			t.Fatalf("create %q/%q returned error: %v", input.Category, input.Title, err)
		}
	}

	state, err := store.ListWorkspaceDocuments(projectID)
	if err != nil {
		t.Fatalf("ListWorkspaceDocuments returned error: %v", err)
	}
	if len(state.Documents) != 3 {
		t.Fatalf("document count = %d, want 3 distinct slots", len(state.Documents))
	}
}

func TestStreamDocumentCreateRequestReplaceSameSlotFlag(t *testing.T) {
	titled, err := StreamDocumentCreateRequest(StreamDocumentEditInput{
		Mode:     "create",
		Title:    "第一集分镜",
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("titled StreamDocumentCreateRequest returned error: %v", err)
	}
	if !titled.ReplaceSameSlot {
		t.Fatal("titled stream create should set ReplaceSameSlot")
	}

	// No agent title falls back to a placeholder; that placeholder must never overwrite.
	untitled, err := StreamDocumentCreateRequest(StreamDocumentEditInput{
		Mode:     "create",
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("untitled StreamDocumentCreateRequest returned error: %v", err)
	}
	if untitled.ReplaceSameSlot {
		t.Fatal("placeholder-title stream create must not set ReplaceSameSlot")
	}
}

func TestPrepareDocumentEditStreamCreateOverwritesSameSlot(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "stream-create-dedupe"
	requireTestProject(t, store, projectID)
	runtime := StreamDocumentEditRuntime{ProjectID: projectID, RunID: "run-1"}

	first, err := store.PrepareDocumentEditStream(runtime, StreamDocumentEditInput{
		StreamID: "stream-1",
		Mode:     "create",
		Title:    "第一集分镜",
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("first create stream returned error: %v", err)
	}

	// A regenerated stream with a separator title variant reuses the existing document.
	second, err := store.PrepareDocumentEditStream(runtime, StreamDocumentEditInput{
		StreamID: "stream-2",
		Mode:     "create",
		Title:    "第一集-分镜",
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("second create stream returned error: %v", err)
	}

	if second.Document.ID != first.Document.ID {
		t.Fatalf("second.Document.ID = %q, want reuse of %q", second.Document.ID, first.Document.ID)
	}
	if got := documentsByCategory(t, store, projectID, "storyboard"); len(got) != 1 {
		t.Fatalf("storyboard document count = %d, want 1 (streamed regenerate overwrites)", len(got))
	}
}

func TestCreateWorkspaceDocumentManualDoesNotOverwriteSlot(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "dedupe-manual-create"
	requireTestProject(t, store, projectID)

	// The HTTP/manual path leaves ReplaceSameSlot false, so creating the same titled
	// document twice still yields two fresh records (no surprise overwrite).
	for i := 0; i < 2; i++ {
		if _, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
			Title:    "第一集剧本",
			Category: "screenplay",
		}); err != nil {
			t.Fatalf("manual create %d returned error: %v", i, err)
		}
	}
	if got := documentsByCategory(t, store, projectID, "screenplay"); len(got) != 2 {
		t.Fatalf("screenplay document count = %d, want 2 (manual create never overwrites)", len(got))
	}
}
