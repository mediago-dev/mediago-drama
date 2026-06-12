package documents

import (
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func TestBuildCommentThreadsFiltersDeletedAndOptionalReplies(t *testing.T) {
	comments := []mediamcp.DocumentComment{
		{ID: "root-1", BlockID: "block-1"},
		{ID: "reply-1", ParentCommentID: "root-1", BlockID: "block-1"},
		{ID: "root-2", BlockID: "block-2", DeletedAt: "2026-01-01T00:00:00Z"},
		{ID: "reply-2", ParentCommentID: "root-2", BlockID: "block-2"},
	}

	threads := BuildCommentThreads(comments, true)
	if len(threads) != 1 || threads[0].Root.ID != "root-1" || len(threads[0].Replies) != 1 {
		t.Fatalf("threads = %#v, want live root with one reply", threads)
	}

	threads = BuildCommentThreads(comments, false)
	if len(threads) != 1 || len(threads[0].Replies) != 0 {
		t.Fatalf("threads = %#v, want replies omitted", threads)
	}
}

func TestCommentThreadForReply(t *testing.T) {
	comments := []mediamcp.DocumentComment{
		{ID: "root-1", BlockID: "block-1"},
		{ID: "reply-1", ParentCommentID: "root-1", BlockID: "block-1"},
	}

	thread, ok := CommentThreadFor(comments, "reply-1", true)
	if !ok || thread.Root.ID != "root-1" || len(thread.Replies) != 1 {
		t.Fatalf("thread = %#v, ok = %v, want root thread", thread, ok)
	}
}

func TestFilterCommentThreads(t *testing.T) {
	resolved := true
	comments := []mediamcp.DocumentComment{
		{ID: "root-1", BlockID: "block-1", Resolved: true},
		{ID: "root-2", BlockID: "block-1", Resolved: false},
		{ID: "root-3", BlockID: "block-2", Resolved: true},
	}

	threads := FilterCommentThreads(comments, "block-1", &resolved, true)
	if len(threads) != 1 || threads[0].Root.ID != "root-1" {
		t.Fatalf("threads = %#v, want block-1 resolved thread", threads)
	}
}

func TestCommentMutations(t *testing.T) {
	document := mediamcp.WorkspaceDocument{
		ID:      "doc-1",
		Content: "Alpha paragraph.",
	}
	block := mediamcp.DocumentBlockNode{ID: "block-1", Text: "Alpha paragraph.", Hash: "hash"}

	comments, commentID, err := AddCommentToDocument(
		document,
		block,
		mediamcp.CommentAnchorInput{BlockID: block.ID},
		"Needs work",
		"agent",
		"comment-1",
		"now",
	)
	if err != nil {
		t.Fatalf("AddCommentToDocument returned error: %v", err)
	}
	if commentID != "comment-1" || len(comments) != 1 || comments[0].Anchor.Quote != "Alpha paragraph." {
		t.Fatalf("comments = %#v, commentID = %q, want added anchored comment", comments, commentID)
	}

	document.Comments = comments
	comments, commentID, err = UpdateDocumentCommentBody(document, comments[0], "Resolved text", "later")
	if err != nil {
		t.Fatalf("UpdateDocumentCommentBody returned error: %v", err)
	}
	if commentID != "comment-1" || comments[0].Body != "Resolved text" || comments[0].UpdatedAt != "later" {
		t.Fatalf("comments = %#v, want updated body", comments)
	}

	document.Comments = comments
	comments, rootID, err := ReplyToDocumentComment(document, comments[0], "Reply", "agent", "reply-1", "reply-time")
	if err != nil {
		t.Fatalf("ReplyToDocumentComment returned error: %v", err)
	}
	if rootID != "comment-1" || len(comments) != 2 || comments[1].ParentCommentID != "comment-1" {
		t.Fatalf("comments = %#v, rootID = %q, want reply under root", comments, rootID)
	}

	document.Comments = comments
	comments, rootID = SetDocumentCommentResolved(document, comments[1], true, "agent", "resolved-time")
	if rootID != "comment-1" || !comments[0].Resolved || !comments[1].Resolved {
		t.Fatalf("comments = %#v, rootID = %q, want resolved thread", comments, rootID)
	}

	document.Comments = comments
	comments, rootID = DeleteDocumentCommentThread(document, comments[0], "deleted-time")
	if rootID != "comment-1" || comments[0].DeletedAt == "" || comments[1].DeletedAt == "" {
		t.Fatalf("comments = %#v, rootID = %q, want deleted thread", comments, rootID)
	}
}
