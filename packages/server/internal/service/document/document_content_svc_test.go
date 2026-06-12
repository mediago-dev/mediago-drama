package document

import (
	"strings"
	"testing"

	docs "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

func TestWorkspaceStateServiceSetDocumentMetadataFromInputs(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "metadata-inputs"
	requireTestProject(t, store, projectID)
	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		Title:    "旧标题",
		Content:  "# 旧标题\n",
		Category: "screenplay",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	titleResult, err := store.SetWorkspaceDocumentTitle(projectID, SetDocumentTitleInput{
		DocumentID:      document.ID,
		Title:           "  新标题  ",
		ExpectedVersion: document.Version,
	}, document.Version)
	if err != nil {
		t.Fatalf("SetWorkspaceDocumentTitle returned error: %v", err)
	}
	if titleResult.Before.Title != "旧标题" || titleResult.Document.Title != "新标题" {
		t.Fatalf("title result = %#v, want before/after titles", titleResult)
	}

	categoryResult, err := store.SetWorkspaceDocumentCategory(projectID, SetDocumentCategoryInput{
		DocumentID:      document.ID,
		Category:        " character ",
		ExpectedVersion: titleResult.Document.Version,
	}, titleResult.Document.Version)
	if err != nil {
		t.Fatalf("SetWorkspaceDocumentCategory returned error: %v", err)
	}
	if categoryResult.Document.Category != "character" {
		t.Fatalf("category = %q, want character", categoryResult.Document.Category)
	}

	tagsResult, err := store.SetWorkspaceDocumentTags(projectID, SetDocumentTagsInput{
		DocumentID:      document.ID,
		Tags:            []string{" hero ", "hero", " draft "},
		ExpectedVersion: categoryResult.Document.Version,
	}, categoryResult.Document.Version)
	if err != nil {
		t.Fatalf("SetWorkspaceDocumentTags returned error: %v", err)
	}
	if len(tagsResult.Document.Tags) != 2 || tagsResult.Document.Tags[0] != "hero" || tagsResult.Document.Tags[1] != "draft" {
		t.Fatalf("tags = %#v, want normalized tags", tagsResult.Document.Tags)
	}
	if tagsResult.Document.IsDirty {
		t.Fatal("metadata mutation marked document dirty")
	}
}

func TestCreateWorkspaceDocumentFromInputDoesNotInjectTemplateContent(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "template-create-input"
	requireTestProject(t, store, projectID)

	document, err := store.CreateWorkspaceDocumentFromInput(projectID, CreateDocumentInput{
		Title:    "动作分镜",
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceDocumentFromInput returned error: %v", err)
	}
	if document.Category != "storyboard" {
		t.Fatalf("document category = %q, want storyboard", document.Category)
	}
	if document.Content != "" {
		t.Fatalf("document content = %q, want empty content until agent supplies initialBlocks", document.Content)
	}

	withInitialBlocks, err := store.CreateWorkspaceDocumentFromInput(projectID, CreateDocumentInput{
		Title:    "剧本扩展",
		Category: "screenplay",
		InitialBlocks: []mediamcp.DocumentBlockInput{
			{Kind: "paragraph", Text: "新增正文。"},
		},
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceDocumentFromInput with blocks returned error: %v", err)
	}
	if withInitialBlocks.Content != "新增正文。\n" {
		t.Fatalf("document content = %q, want provided blocks without template append", withInitialBlocks.Content)
	}

	fullCharacter := "## 萧炎\n\n**形象定位**：十八岁左右少年，古装玄幻武者。\n\n**面部特征**：黑发，眉眼清俊，目光坚韧。\n\n**身材气质**：身形偏瘦但结实，体态利落。\n\n**着装造型**：乌色练功服，袖口磨旧。\n\n**标志性细节**：戒指常贴身携带。\n"
	character, err := store.CreateWorkspaceDocumentFromInput(projectID, CreateDocumentInput{
		Title:    "角色档案",
		Category: "character",
		InitialBlocks: []mediamcp.DocumentBlockInput{
			{Markdown: fullCharacter},
		},
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceDocumentFromInput with full character markdown returned error: %v", err)
	}
	if character.Category != "character" {
		t.Fatalf("character category = %q, want character", character.Category)
	}
	if character.Content != fullCharacter {
		t.Fatalf("character content = %q, want exact provided full markdown", character.Content)
	}

	_, err = store.CreateWorkspaceDocumentFromInput(projectID, CreateDocumentInput{
		Title:    "缺字段角色档案",
		Category: "character",
		InitialBlocks: []mediamcp.DocumentBlockInput{
			{Markdown: "## 萧炎\n\n**形象定位**：十八岁左右少年，古装玄幻武者。\n\n**面部特征**：黑发，眉眼清俊。\n\n**身材气质**：身形偏瘦但结实。\n\n**着装造型**：乌色练功服。\n"},
		},
	})
	if err == nil {
		t.Fatal("CreateWorkspaceDocumentFromInput with invalid character markdown returned nil, want error")
	}
	state, err := store.ListWorkspaceDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents after failed create: %v", err)
	}
	for _, document := range state.Documents {
		if document.Title == "缺字段角色档案" {
			t.Fatalf("invalid character document was saved: %#v", document)
		}
	}
}

func TestCreateWorkspaceDocumentDoesNotInjectTemplateBody(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "ui-create"
	requireTestProject(t, store, projectID)
	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		Title:    "新剧本",
		Category: "screenplay",
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceDocument returned error: %v", err)
	}
	if document.Content != "" {
		t.Fatalf("document content = %q, want empty content until caller supplies content", document.Content)
	}
}

func TestCreateWorkspaceDocumentFromInputWithoutTemplateFallsBackToSourceMaterial(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "template-fallback"
	requireTestProject(t, store, projectID)

	document, err := store.CreateWorkspaceDocumentFromInput(projectID, CreateDocumentInput{
		Title: "参考资料",
		InitialBlocks: []mediamcp.DocumentBlockInput{
			{Kind: "paragraph", Text: "一段原始材料。"},
		},
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceDocumentFromInput returned error: %v", err)
	}
	if document.Category != "source-material" {
		t.Fatalf("document category = %q, want source-material", document.Category)
	}
	if !strings.Contains(document.Content, "一段原始材料。") {
		t.Fatalf("document content = %q, want provided source material", document.Content)
	}
}

func TestBatchWorkspaceDocumentEditAppliesOperationsAsSingleVersion(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "batch-edit"
	requireTestProject(t, store, projectID)
	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		Title:   "Batch",
		Content: "# Batch\n\nAlpha\n\nBeta\n",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}
	alpha := testBlockByText(t, document.Content, "Alpha")
	beta := testBlockByText(t, document.Content, "Beta")
	expectedVersion := document.Version

	results, err := store.BatchWorkspaceDocumentEdit(projectID, BatchDocumentEditInput{
		DocumentID:      document.ID,
		ExpectedVersion: expectedVersion,
		Operations: []BatchDocumentEditOperationInput{
			{
				Type:              "update_block",
				BlockID:           beta.ID,
				ExpectedBlockHash: beta.Hash,
				Block:             mediamcp.DocumentBlockInput{Text: "Beta updated"},
			},
			{
				Type:              "insert_block",
				Anchor:            mediamcp.DocumentBlockAnchorInput{BlockID: alpha.ID, Position: "after"},
				ExpectedBlockHash: alpha.Hash,
				Block:             mediamcp.DocumentBlockInput{Text: "Inserted"},
			},
		},
	}, expectedVersion)
	if err != nil {
		t.Fatalf("BatchWorkspaceDocumentEdit returned error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("mutations = %d, want one", len(results))
	}
	result := results[0]
	if result.Before.Version != document.Version || result.Document.Version != document.Version+1 {
		t.Fatalf("versions before=%d after=%d, want %d -> %d", result.Before.Version, result.Document.Version, document.Version, document.Version+1)
	}
	if !strings.Contains(result.Document.Content, "Alpha\nInserted\n\nBeta updated") {
		t.Fatalf("content = %q, want batch updates in one document", result.Document.Content)
	}

	staleVersion := document.Version
	if _, err := store.BatchWorkspaceDocumentEdit(projectID, BatchDocumentEditInput{
		DocumentID:      document.ID,
		ExpectedVersion: staleVersion,
		Operations: []BatchDocumentEditOperationInput{
			{Type: "insert_block", Anchor: mediamcp.DocumentBlockAnchorInput{BlockID: alpha.ID, Position: "after"}, ExpectedBlockHash: alpha.Hash, Block: mediamcp.DocumentBlockInput{Text: "Should not apply"}},
		},
	}, staleVersion); err == nil {
		t.Fatal("BatchWorkspaceDocumentEdit with stale version returned nil, want conflict")
	}
	current, err := store.RequireWorkspaceDocument(projectID, document.ID)
	if err != nil {
		t.Fatalf("reloading document: %v", err)
	}
	if strings.Contains(current.Content, "Should not apply") {
		t.Fatalf("stale batch mutated content: %q", current.Content)
	}
}

func TestBatchWorkspaceDocumentEditMovesBlockAcrossDocumentsAtomically(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "batch-cross-doc"
	requireTestProject(t, store, projectID)
	source, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{Title: "Source", Content: "one\n\ntwo\n"})
	if err != nil {
		t.Fatalf("creating source: %v", err)
	}
	target, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{Title: "Target", Content: "# Target\n\nanchor\n"})
	if err != nil {
		t.Fatalf("creating target: %v", err)
	}
	one := testBlockByText(t, source.Content, "one")
	anchor := testBlockByText(t, target.Content, "anchor")
	sourceVersion := source.Version
	targetVersion := target.Version

	results, err := store.BatchWorkspaceDocumentEdit(projectID, BatchDocumentEditInput{
		DocumentID:      source.ID,
		ExpectedVersion: sourceVersion,
		Operations: []BatchDocumentEditOperationInput{
			{
				Type:                  "move_block",
				BlockID:               one.ID,
				ExpectedBlockHash:     one.Hash,
				Target:                &mediamcp.DocumentMoveBlockTargetInput{DocumentID: target.ID, Anchor: mediamcp.DocumentBlockAnchorInput{BlockID: anchor.ID, Position: "after"}},
				TargetExpectedVersion: &targetVersion,
			},
		},
	}, sourceVersion)
	if err != nil {
		t.Fatalf("BatchWorkspaceDocumentEdit cross-document returned error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("mutations = %d, want source and target", len(results))
	}
	updatedSource, err := store.RequireWorkspaceDocument(projectID, source.ID)
	if err != nil {
		t.Fatalf("loading source: %v", err)
	}
	updatedTarget, err := store.RequireWorkspaceDocument(projectID, target.ID)
	if err != nil {
		t.Fatalf("loading target: %v", err)
	}
	if strings.Contains(updatedSource.Content, "one") || !strings.Contains(updatedTarget.Content, "anchor\none") {
		t.Fatalf("source=%q target=%q, want moved block", updatedSource.Content, updatedTarget.Content)
	}
	if updatedSource.Version != source.Version+1 || updatedTarget.Version != target.Version+1 {
		t.Fatalf("versions source=%d target=%d, want both +1", updatedSource.Version, updatedTarget.Version)
	}
}

func TestPatchWorkspaceDocumentContentAppliesUTF16Ranges(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "patch-edit"
	requireTestProject(t, store, projectID)
	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{Title: "Patch", Content: "Alpha Beta 世界\n"})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}
	expectedVersion := document.Version
	start := docs.UTF16Length("Alpha Beta ")
	end := start + docs.UTF16Length("世界")
	result, err := store.PatchWorkspaceDocumentContent(projectID, DocumentPatchEditInput{
		DocumentID:      document.ID,
		ExpectedVersion: expectedVersion,
		Patches: []DocumentPatchEditPatchInput{
			{Op: "replace_range", Range: mediamcp.DocumentTextRange{Start: start, End: end}, Replacement: "world"},
		},
	}, expectedVersion)
	if err != nil {
		t.Fatalf("PatchWorkspaceDocumentContent returned error: %v", err)
	}
	if result.Document.Content != "Alpha Beta world\n" || result.Document.Version != document.Version+1 {
		t.Fatalf("document = %#v, want patched content and bumped version", result.Document)
	}
}
