package documents

import (
	"testing"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

func TestWorkspaceSnapshotOutputIncludesActiveDocument(t *testing.T) {
	metadata := mediamcp.ListDocumentsOutput{
		ProjectID: "project-1",
		Documents: []mediamcp.WorkspaceDocumentMetadata{{
			ID:    "doc-1",
			Title: "文档",
		}},
	}
	selection := &mediamcp.DocumentRangeSelection{BlockID: "block-1"}

	output := WorkspaceSnapshotOutput(metadata, " doc-1 ", selection)

	if output.ProjectID != "project-1" || output.ActiveDocumentID != "doc-1" || output.Selection != selection {
		t.Fatalf("output = %#v, want snapshot metadata", output)
	}
	if len(output.OpenDocumentIDs) != 1 || output.OpenDocumentIDs[0] != "doc-1" {
		t.Fatalf("open document ids = %#v, want active document", output.OpenDocumentIDs)
	}
}

func TestDocumentOutlineBlockAndSectionOutputs(t *testing.T) {
	document := mediamcp.WorkspaceDocument{
		ID:      "doc-1",
		Version: 3,
		Content: "# 第一幕\n\n开场。\n\n## 镜头\n\n动作。",
	}

	outline, err := DocumentOutlineOutput(document, 1)
	if err != nil {
		t.Fatalf("DocumentOutlineOutput returned error: %v", err)
	}
	if len(outline.Outline) != 1 || outline.Outline[0].Text != "第一幕" || outline.Version != 3 {
		t.Fatalf("outline = %#v, want top-level heading", outline)
	}

	blockID := outline.Outline[0].ID
	block, err := DocumentBlockOutput(document, blockID, false)
	if err != nil {
		t.Fatalf("DocumentBlockOutput returned error: %v", err)
	}
	if block.Block.ID != blockID || len(block.Block.Children) != 0 {
		t.Fatalf("block = %#v, want heading without children", block.Block)
	}

	section, err := DocumentSectionOutput(document, blockID)
	if err != nil {
		t.Fatalf("DocumentSectionOutput returned error: %v", err)
	}
	if section.Heading.ID != blockID || len(section.Blocks) == 0 {
		t.Fatalf("section = %#v, want heading section blocks", section)
	}
}

func TestValidateDocumentSelectionRejectsOutOfRange(t *testing.T) {
	document := mediamcp.WorkspaceDocument{ID: "doc-1", Content: "# 标题\n\n正文。"}
	outline, err := DocumentOutlineOutput(document, 1)
	if err != nil {
		t.Fatalf("DocumentOutlineOutput returned error: %v", err)
	}
	section, err := DocumentSectionOutput(document, outline.Outline[0].ID)
	if err != nil {
		t.Fatalf("DocumentSectionOutput returned error: %v", err)
	}
	if len(section.Blocks) == 0 {
		t.Fatal("section has no blocks, want paragraph block")
	}

	err = ValidateDocumentSelection(document, mediamcp.DocumentRangeSelection{
		BlockID: section.Blocks[0].ID,
		Range:   mediamcp.DocumentTextRange{Start: 99, End: 100},
	})
	if err == nil {
		t.Fatal("ValidateDocumentSelection returned nil, want out-of-range error")
	}
}
