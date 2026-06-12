package document

import (
	"testing"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

func TestAddCommentToDocumentUsesRangeQuote(t *testing.T) {
	document := mediamcp.WorkspaceDocument{ID: "doc-1", Content: "hello world"}
	block := mediamcp.DocumentBlockNode{ID: "block-1", Text: "hello world"}
	anchor := mediamcp.CommentAnchorInput{
		BlockID: "block-1",
		Range:   &mediamcp.DocumentTextRange{Start: 6, End: 11},
	}

	comments, focusID, err := AddCommentToDocument(document, block, anchor, " comment ", "writer", "comment-1", "now")
	if err != nil {
		t.Fatalf("AddCommentToDocument returned error: %v", err)
	}
	if focusID != "comment-1" || len(comments) != 1 {
		t.Fatalf("focusID=%q len=%d, want created comment", focusID, len(comments))
	}
	comment := comments[0]
	if comment.Body != "comment" || comment.AnchorText != "world" || comment.Anchor.Quote != "world" || comment.AuthorID != "writer" {
		t.Fatalf("comment = %#v, want normalized comment with selected quote", comment)
	}
}

func TestReplyToDocumentCommentUsesRootThread(t *testing.T) {
	root := mediamcp.DocumentComment{ID: "root", DocumentID: "doc-1", BlockID: "block-1", AnchorText: "quote"}
	child := mediamcp.DocumentComment{ID: "child", ParentCommentID: "root", DocumentID: "doc-1"}
	document := mediamcp.WorkspaceDocument{ID: "doc-1", Comments: []mediamcp.DocumentComment{root, child}}

	comments, rootID, err := ReplyToDocumentComment(document, child, " reply ", "writer", "reply-1", "now")
	if err != nil {
		t.Fatalf("ReplyToDocumentComment returned error: %v", err)
	}
	if rootID != "root" || len(comments) != 3 {
		t.Fatalf("rootID=%q len=%d, want reply under root", rootID, len(comments))
	}
	reply := comments[2]
	if reply.ParentCommentID != "root" || reply.BlockID != "block-1" || reply.AnchorText != "quote" || reply.Body != "reply" {
		t.Fatalf("reply = %#v, want root-anchored reply", reply)
	}
}

func TestSetAndDeleteDocumentCommentThread(t *testing.T) {
	root := mediamcp.DocumentComment{ID: "root"}
	reply := mediamcp.DocumentComment{ID: "reply", ParentCommentID: "root"}
	document := mediamcp.WorkspaceDocument{ID: "doc-1", Comments: []mediamcp.DocumentComment{root, reply}}

	resolved, rootID := SetDocumentCommentResolved(document, reply, true, "writer", "now")
	if rootID != "root" || !resolved[0].Resolved || resolved[0].ResolvedBy != "writer" || !resolved[1].Resolved {
		t.Fatalf("resolved = %#v rootID=%q, want resolved thread", resolved, rootID)
	}

	deleted, rootID := DeleteDocumentCommentThread(document, reply, "later")
	if rootID != "root" || deleted[0].DeletedAt != "later" || deleted[1].DeletedAt != "later" {
		t.Fatalf("deleted = %#v rootID=%q, want deleted thread", deleted, rootID)
	}
}

func TestWorkspaceStateServiceCommentLookupAndUpdate(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-comments"
	requireTestProject(t, store, projectID)
	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:    "评论文档",
		Content:  "# 评论文档\n\n正文。",
		Category: "screenplay",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	comments := []mediamcp.DocumentComment{{
		ID:         "comment-root",
		DocumentID: document.ID,
		BlockID:    "block-1",
		Body:       "需要强化。",
		CreatedAt:  "now",
		UpdatedAt:  "now",
	}}
	updated, thread, err := store.UpdateWorkspaceDocumentComments(projectID, document, comments, "comment-root")
	if err != nil {
		t.Fatalf("updating comments: %v", err)
	}
	if updated.ID != document.ID || thread.Root.ID != "comment-root" {
		t.Fatalf("updated=%#v thread=%#v, want persisted root thread", updated, thread)
	}

	foundDocument, foundComment, err := store.FindWorkspaceDocumentComment(projectID, "comment-root")
	if err != nil {
		t.Fatalf("finding comment: %v", err)
	}
	if foundDocument.ID != document.ID || foundComment.Body != "需要强化。" {
		t.Fatalf("found document=%#v comment=%#v, want created comment", foundDocument, foundComment)
	}
}
