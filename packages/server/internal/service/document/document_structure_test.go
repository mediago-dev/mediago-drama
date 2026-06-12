package document

import (
	"strings"
	"testing"

	docs "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

func TestDocumentBlockContentMutations(t *testing.T) {
	document := mediamcp.WorkspaceDocument{ID: "doc-1", Content: "# Title\n\nAlpha\n\nBeta"}
	alpha := testBlockByText(t, document.Content, "Alpha")

	next, blockID, err := InsertDocumentBlockContent(document, alpha.ID, "after", alpha.Hash, mediamcp.DocumentBlockInput{Text: "Inserted"})
	if err != nil {
		t.Fatalf("InsertDocumentBlockContent returned error: %v", err)
	}
	if blockID != alpha.ID || !strings.Contains(next, "Alpha\nInserted\n\nBeta") {
		t.Fatalf("inserted content = %q, blockID = %q", next, blockID)
	}

	document.Content = next
	beta := testBlockByText(t, document.Content, "Beta")
	next, blockID, err = UpdateDocumentBlockContent(document, beta.ID, beta.Hash, mediamcp.DocumentBlockInput{Text: "Updated"})
	if err != nil {
		t.Fatalf("UpdateDocumentBlockContent returned error: %v", err)
	}
	if blockID != beta.ID || !strings.Contains(next, "Updated") || strings.Contains(next, "Beta") {
		t.Fatalf("updated content = %q, blockID = %q", next, blockID)
	}

	document.Content = next
	updated := testBlockByText(t, document.Content, "Updated")
	next, blockID, err = DeleteDocumentBlockContent(document, updated.ID, updated.Hash)
	if err != nil {
		t.Fatalf("DeleteDocumentBlockContent returned error: %v", err)
	}
	if blockID != updated.ID || strings.Contains(next, "Updated") {
		t.Fatalf("deleted content = %q, blockID = %q", next, blockID)
	}
}

func TestDocumentSectionAndInlineContentMutations(t *testing.T) {
	document := mediamcp.WorkspaceDocument{ID: "doc-1", Content: "# 第一幕\n\nhello world\n\n# 第二幕\n\nnext"}
	heading := testBlockByText(t, document.Content, "第一幕")

	next, blockID, err := ReplaceDocumentSectionContent(document, heading.ID, "", []mediamcp.DocumentBlockInput{{Text: "new body"}})
	if err != nil {
		t.Fatalf("ReplaceDocumentSectionContent returned error: %v", err)
	}
	if blockID != heading.ID || !strings.Contains(next, "# 第一幕\nnew body\n# 第二幕") {
		t.Fatalf("section content = %q, blockID = %q", next, blockID)
	}

	document.Content = next
	heading = testBlockByText(t, document.Content, "第一幕")
	next, blockID, err = ReplaceDocumentSectionContent(document, heading.ID, "序幕", []mediamcp.DocumentBlockInput{{Text: "renamed body"}})
	if err != nil {
		t.Fatalf("ReplaceDocumentSectionContent with new heading returned error: %v", err)
	}
	if blockID != heading.ID || !strings.Contains(next, "# 序幕\nrenamed body\n# 第二幕") || strings.Contains(next, "# 第一幕") {
		t.Fatalf("renamed section content = %q, blockID = %q", next, blockID)
	}

	document.Content = next
	body := testBlockByText(t, document.Content, "renamed body")
	next, blockID, err = InsertDocumentInlineContent(document, mediamcp.DocumentOffsetPosition{
		BlockID: body.ID,
		Offset:  3,
	}, []mediamcp.DocumentInlineContentInput{{Type: "text", Text: " inline"}}, body.Hash)
	if err != nil {
		t.Fatalf("InsertDocumentInlineContent returned error: %v", err)
	}
	if blockID != body.ID || !strings.Contains(next, "ren inlineamed body") {
		t.Fatalf("inline content = %q, blockID = %q", next, blockID)
	}

	document.Content = next
	body = testBlockByText(t, document.Content, "ren inlineamed body")
	next, blockID, err = AnnotateDocumentSelectionContent(document, mediamcp.DocumentRangeSelection{
		BlockID: body.ID,
		Range:   mediamcp.DocumentTextRange{Start: 0, End: 3},
	}, mediamcp.DocumentInlineMarkInput{Kind: "bold"}, "add", body.Hash)
	if err != nil {
		t.Fatalf("AnnotateDocumentSelectionContent returned error: %v", err)
	}
	if blockID != body.ID || !strings.Contains(next, "**ren** inlineamed body") {
		t.Fatalf("annotated content = %q, blockID = %q", next, blockID)
	}
}

func TestMoveDocumentBlockContentSameAndCrossDocument(t *testing.T) {
	source := mediamcp.WorkspaceDocument{ID: "source", Content: "one\n\ntwo\n\nthree"}
	one := testBlockByText(t, source.Content, "one")
	three := testBlockByText(t, source.Content, "three")

	move, err := MoveDocumentBlockContent(source, source, three.ID, three.Hash, mediamcp.DocumentBlockAnchorInput{BlockID: one.ID, Position: "after"})
	if err != nil {
		t.Fatalf("MoveDocumentBlockContent same document returned error: %v", err)
	}
	if !move.SameDocument || move.SourceContent != move.TargetContent {
		t.Fatalf("move = %#v, want same-document result", move)
	}
	if !(strings.Index(move.SourceContent, "one") < strings.Index(move.SourceContent, "three") &&
		strings.Index(move.SourceContent, "three") < strings.Index(move.SourceContent, "two")) {
		t.Fatalf("same-document content = %q, want three after one", move.SourceContent)
	}

	source = mediamcp.WorkspaceDocument{ID: "source", Content: "one\n\ntwo"}
	target := mediamcp.WorkspaceDocument{ID: "target", Content: "# Target\n\nanchor"}
	one = testBlockByText(t, source.Content, "one")
	anchor := testBlockByText(t, target.Content, "anchor")
	move, err = MoveDocumentBlockContent(source, target, one.ID, one.Hash, mediamcp.DocumentBlockAnchorInput{BlockID: anchor.ID, Position: "after"})
	if err != nil {
		t.Fatalf("MoveDocumentBlockContent cross document returned error: %v", err)
	}
	if move.SameDocument || strings.Contains(move.SourceContent, "one") || !strings.Contains(move.TargetContent, "anchor\none") {
		t.Fatalf("cross-document move = %#v", move)
	}
}

func TestValidateTemplateDocumentContentRejectsMalformedCharacterFields(t *testing.T) {
	document := mediamcp.WorkspaceDocument{ID: "doc-character", Category: "character"}
	characterSection := func(name, positioning, face, body, outfit, detail string) string {
		return strings.Join([]string{
			"## " + name,
			"",
			"**形象定位**：" + positioning,
			"",
			"**面部特征**：" + face,
			"",
			"**身材气质**：" + body,
			"",
			"**着装造型**：" + outfit,
			"",
			"**标志性细节**：" + detail,
		}, "\n") + "\n"
	}
	valid := characterSection(
		"萧薰儿",
		"十六七岁少女，古装玄幻形象。",
		"眉眼清冷，肤色白皙，黑色长发。",
		"身形纤细，体态端正。",
		"紫色衣裙，材质轻薄。",
		"淡金色发饰。",
	)
	if err := ValidateTemplateDocumentContent(document, valid); err != nil {
		t.Fatalf("ValidateTemplateDocumentContent(valid) returned error: %v", err)
	}

	missingBold := "## 萧薰儿\n\n**形象定位**：十六七岁少女，古装玄幻形象。\n\n**面部特征**：眉眼清冷，肤色白皙。\n\n**身材气质**：身形纤细，体态端正。\n\n**着装造型**：紫色衣裙。\n\n标志性细节：淡金色发饰。\n\n---\n"
	if err := ValidateTemplateDocumentContent(document, missingBold); err == nil {
		t.Fatal("ValidateTemplateDocumentContent(missingBold) returned nil, want error")
	}

	titleOnly := "## 萧家族长（萧炎之父）\n\n---\n"
	if err := ValidateTemplateDocumentContent(document, titleOnly); err == nil {
		t.Fatal("ValidateTemplateDocumentContent(titleOnly) returned nil, want error")
	}

	repeatedSeparator := characterSection(
		"萧媚",
		"十六岁少女，古装玄幻形象。",
		"圆润脸型，黑色长发。",
		"身形轻盈，站姿活泼。",
		"族人常服，浅色布料。",
		"银色发簪。",
	) + "\n---\n\n---\n"
	if err := ValidateTemplateDocumentContent(document, repeatedSeparator); err == nil {
		t.Fatal("ValidateTemplateDocumentContent(repeatedSeparator) returned nil, want error")
	}

	duplicateHeading := characterSection(
		"萧炎",
		"十八岁左右少年，古装玄幻武者。",
		"黑发，眉眼清俊。",
		"身形偏瘦但结实。",
		"族人常服，深色布料。",
		"贴身戒指。",
	) + "\n" + characterSection(
		"萧炎",
		"十八岁左右少年，古装玄幻武者。",
		"黑发，眉眼清俊。",
		"身形偏瘦但结实。",
		"族人常服，深色布料。",
		"贴身戒指。",
	)
	if err := ValidateTemplateDocumentContent(document, duplicateHeading); err == nil {
		t.Fatal("ValidateTemplateDocumentContent(duplicateHeading) returned nil, want error")
	}

	misplacedAppend := characterSection(
		"萧薰儿",
		"十六七岁少女，古装玄幻形象。",
		"眉眼清冷，黑色长发。",
		"身形纤细，体态端正。",
		"紫色衣裙。",
		"淡金色发饰。",
	) + "\n" + characterSection(
		"萧炎",
		"十八岁左右少年，古装玄幻武者。",
		"黑发，眉眼清俊。",
		"身形偏瘦但结实。",
		"族人常服，深色布料。",
		"贴身戒指。",
	) + "\n" + characterSection(
		"萧媚",
		"十六岁少女，古装玄幻形象。",
		"圆润脸型，黑色长发。",
		"身形轻盈，站姿活泼。",
		"族人常服，浅色布料。",
		"银色发簪。",
	) + "\n" + characterSection(
		"萧炎",
		"十八岁左右少年，古装玄幻武者。",
		"黑发，眉眼清俊。",
		"身形偏瘦但结实。",
		"族人常服，深色布料。",
		"贴身戒指。",
	)
	if err := ValidateTemplateDocumentContent(document, misplacedAppend); err == nil {
		t.Fatal("ValidateTemplateDocumentContent(misplacedAppend) returned nil, want duplicate heading error")
	}
}

func TestValidateMarkdownDocumentStructureRejectsRepairProneShapes(t *testing.T) {
	valid := "# 第一章\n\n## 角色\n\n正文\n\n---\n\n## 场景\n\n正文\n"
	if err := ValidateMarkdownDocumentStructure(valid); err != nil {
		t.Fatalf("ValidateMarkdownDocumentStructure(valid) returned error: %v", err)
	}

	repeatedSeparator := "# 第一章\n\n正文\n\n---\n\n---\n"
	if err := ValidateMarkdownDocumentStructure(repeatedSeparator); err == nil {
		t.Fatal("ValidateMarkdownDocumentStructure(repeatedSeparator) returned nil, want error")
	}

	levelJump := "# 第一章\n\n### 跳级标题\n\n正文\n"
	if err := ValidateMarkdownDocumentStructure(levelJump); err == nil {
		t.Fatal("ValidateMarkdownDocumentStructure(levelJump) returned nil, want error")
	}

	codeFence := "```markdown\n---\n---\n# ignored\n### ignored\n```\n\n# 正文\n\n## 不重复\n"
	if err := ValidateMarkdownDocumentStructure(codeFence); err != nil {
		t.Fatalf("ValidateMarkdownDocumentStructure(codeFence) returned error: %v", err)
	}
}

func testBlockByText(t *testing.T, content string, text string) mediamcp.DocumentBlockNode {
	t.Helper()
	structure, err := docs.ParseStructure(content)
	if err != nil {
		t.Fatalf("parsing content: %v", err)
	}
	for _, block := range docs.FlattenBlocks(structure.Blocks) {
		if block.Text == text {
			return block
		}
	}
	t.Fatalf("content = %q, want block text %q", content, text)
	return mediamcp.DocumentBlockNode{}
}
