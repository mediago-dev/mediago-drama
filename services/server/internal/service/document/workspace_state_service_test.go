package document

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func TestWorkspaceStateServiceMoveDocumentAndMetadata(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-move"
	requireTestProject(t, store, projectID)
	_, err := store.save(projectID, workspaceStateRequest{
		Documents: []mediamcp.WorkspaceDocument{
			{
				ID:        "doc-a",
				Title:     "A",
				Content:   "# A\n",
				SortOrder: 0,
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
			{
				ID:        "doc-b",
				Title:     "B",
				Content:   "# B\n",
				SortOrder: 1,
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
			{
				ID:        "doc-c",
				Title:     "C",
				Content:   "# C\n",
				ParentID:  "doc-a",
				SortOrder: 0,
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
		},
		OperationLog: []documentOperationLogRecord{},
	})
	if err != nil {
		t.Fatalf("seeding workspace state: %v", err)
	}

	metadata, err := store.listDocumentMetadata(projectID)
	if err != nil {
		t.Fatalf("listing document metadata: %v", err)
	}
	if len(metadata.Documents) != 3 {
		t.Fatalf("expected 3 metadata records, got %d", len(metadata.Documents))
	}

	if _, _, err := store.moveDocument(projectID, "doc-b", "doc-a", "inside", 1); err != nil {
		t.Fatalf("moving doc-b inside doc-a: %v", err)
	}
	stateAfterFirstMove, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing after first move: %v", err)
	}
	docCVersion := findTestWorkspaceDocument(stateAfterFirstMove.Documents, "doc-c").Version
	if _, _, err := store.moveDocument(projectID, "doc-c", "doc-b", "after", docCVersion); err != nil {
		t.Fatalf("moving doc-c after doc-b: %v", err)
	}
	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	docB := findTestWorkspaceDocument(state.Documents, "doc-b")
	docC := findTestWorkspaceDocument(state.Documents, "doc-c")
	if docB.ParentID != "doc-a" {
		t.Fatalf("unexpected doc-b parent=%q, want doc-a", docB.ParentID)
	}
	if docC.ParentID != "doc-a" {
		t.Fatalf("unexpected doc-c parent=%q, want doc-a", docC.ParentID)
	}

	if _, _, err := store.moveDocument(projectID, "doc-a", "doc-c", "inside", 1); err == nil {
		t.Fatal("expected moving a document into its descendant to fail")
	}
}

func TestWorkspaceStateServicePersistsDocumentCategory(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-category"
	requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:    "原素材",
		Content:  "# 原素材\n\n一个漫剧创意。",
		Category: "reference",
	})
	if err != nil {
		t.Fatalf("creating categorized document: %v", err)
	}
	if document.Category != "reference" {
		t.Fatalf("created category = %q, want reference", document.Category)
	}
	projected, err := os.ReadFile(filepath.Join(store.documentsDir(projectID), "原素材.md"))
	if err != nil {
		t.Fatalf("reading created markdown file: %v", err)
	}
	if !strings.Contains(string(projected), "category: reference") {
		t.Fatalf("created markdown projection = %q, want reference frontmatter", string(projected))
	}
	if !strings.Contains(string(projected), "title: 原素材") {
		t.Fatalf("created markdown projection = %q, want title frontmatter", string(projected))
	}
	if strings.Contains(string(projected), "sortOrder:") {
		t.Fatalf("created markdown projection = %q, should not include sortOrder frontmatter", string(projected))
	}

	nextCategory := "screenplay"
	updated, _, err := store.updateDocument(projectID, document.ID, updateWorkspaceDocumentRequest{
		Category: &nextCategory,
	})
	if err != nil {
		t.Fatalf("updating document category: %v", err)
	}
	if updated.Category != "screenplay" {
		t.Fatalf("updated category = %q, want screenplay", updated.Category)
	}
	projected, err = os.ReadFile(filepath.Join(store.documentsDir(projectID), "原素材.md"))
	if err != nil {
		t.Fatalf("reading updated markdown file: %v", err)
	}
	if !strings.Contains(string(projected), "category: screenplay") {
		t.Fatalf("updated markdown projection = %q, want screenplay frontmatter", string(projected))
	}
	if !strings.Contains(string(projected), "title: 原素材") {
		t.Fatalf("updated markdown projection = %q, want title frontmatter", string(projected))
	}

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	persisted := findTestWorkspaceDocument(state.Documents, document.ID)
	if persisted.Category != "screenplay" {
		t.Fatalf("persisted category = %q, want screenplay", persisted.Category)
	}

	metadata, err := store.listDocumentMetadata(projectID)
	if err != nil {
		t.Fatalf("listing document metadata: %v", err)
	}
	if len(metadata.Documents) != 1 || metadata.Documents[0].Category != "screenplay" {
		t.Fatalf("metadata category = %#v, want screenplay", metadata.Documents)
	}
}

func TestWorkspaceStateServiceNormalizesLegacySourceMaterialCategory(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-legacy-source-material-category"
	requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:    "旧分类资料",
		Content:  "# 旧分类资料\n\n一个旧项目里的原始文本。",
		Category: "source-material",
	})
	if err != nil {
		t.Fatalf("creating legacy category document: %v", err)
	}
	if document.Category != referenceDocumentCategory {
		t.Fatalf("created category = %q, want %q", document.Category, referenceDocumentCategory)
	}

	projected, err := os.ReadFile(filepath.Join(store.documentsDir(projectID), "旧分类资料.md"))
	if err != nil {
		t.Fatalf("reading created markdown file: %v", err)
	}
	if strings.Contains(string(projected), "category: source-material") ||
		!strings.Contains(string(projected), "category: reference") {
		t.Fatalf("created markdown projection = %q, want normalized reference frontmatter", string(projected))
	}

	nextCategory := "source-material"
	updated, _, err := store.updateDocument(projectID, document.ID, updateWorkspaceDocumentRequest{
		Category: &nextCategory,
	})
	if err != nil {
		t.Fatalf("updating legacy category document: %v", err)
	}
	if updated.Category != referenceDocumentCategory {
		t.Fatalf("updated category = %q, want %q", updated.Category, referenceDocumentCategory)
	}
}

func TestWorkspaceStateServiceCreateProjectStartsWithoutOverviewDocument(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-without-overview"
	projectDir := requireTestProject(t, store, projectID)

	state, err := store.load(projectID)
	if err != nil {
		t.Fatalf("loading project state: %v", err)
	}
	if len(state.Documents) != 0 {
		t.Fatalf("documents = %+v, want empty project documents", state.Documents)
	}
	assertDocumentMarkdownMissing(t, store.documentsDir(projectID), "项目概览.md")
	if _, err := os.Stat(filepath.Join(projectDir, "project.media.json")); err != nil {
		t.Fatalf("project.media.json should exist: %v", err)
	}
}

func TestWorkspaceStateServiceRenamesProject(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-rename"
	projectDir := requireTestProject(t, store, projectID)

	renamed, ok, err := store.UpdateProject(projectID, UpdateWorkspaceProjectRequest{Name: "  新项目名  "})
	if err != nil || !ok {
		t.Fatalf("UpdateProject() project=%#v ok=%v err=%v, want ok", renamed, ok, err)
	}
	if renamed.Name != "新项目名" {
		t.Fatalf("renamed.Name = %q, want 新项目名", renamed.Name)
	}

	config, err := store.LoadProjectConfig(projectID)
	if err != nil {
		t.Fatalf("LoadProjectConfig() error = %v", err)
	}
	if config.Name != "新项目名" {
		t.Fatalf("config.Name = %q, want 新项目名", config.Name)
	}

	data, err := os.ReadFile(filepath.Join(projectDir, "project.media.json"))
	if err != nil {
		t.Fatalf("reading project manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("decoding project manifest: %v", err)
	}
	if manifest["name"] != "新项目名" {
		t.Fatalf("manifest name = %#v, want 新项目名", manifest["name"])
	}
}

func TestWorkspaceStateServiceArchivesTrashesRestoresAndPermanentlyDeletesProject(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-lifecycle"
	projectDir := requireTestProject(t, store, projectID)
	if err := os.WriteFile(filepath.Join(projectDir, "keep.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("writing project file: %v", err)
	}

	archivedProjectID := "project-archive"
	archivedProjectDir := requireTestProject(t, store, archivedProjectID)
	archived, ok, err := store.ArchiveProject(archivedProjectID)
	if err != nil || !ok {
		t.Fatalf("ArchiveProject() ok=%v err=%v, want ok", ok, err)
	}
	if archived.Status != "archived" || archived.ArchivedAt == "" {
		t.Fatalf("archived project = %#v, want archived status", archived)
	}
	if _, err := os.Stat(archivedProjectDir); err != nil {
		t.Fatalf("archived project dir moved or missing: %v", err)
	}
	active, err := store.ListProjects()
	if err != nil {
		t.Fatalf("ListProjects() error = %v", err)
	}
	if workspaceProjectIDs(active.Projects)[archivedProjectID] {
		t.Fatalf("archived project still appears in active list: %#v", active.Projects)
	}
	archivedList, err := store.ListProjectsByStatus("archived")
	if err != nil {
		t.Fatalf("ListProjectsByStatus(archived) error = %v", err)
	}
	if !workspaceProjectIDs(archivedList.Projects)[archivedProjectID] {
		t.Fatalf("archived project missing from archived list: %#v", archivedList.Projects)
	}
	restoredArchive, ok, err := store.RestoreProject(archivedProjectID)
	if err != nil || !ok {
		t.Fatalf("RestoreProject(archived) ok=%v err=%v, want ok", ok, err)
	}
	if restoredArchive.Status != "active" || restoredArchive.ArchivedAt != "" {
		t.Fatalf("restored archive = %#v, want active with cleared archive metadata", restoredArchive)
	}

	trashed, ok, err := store.DeleteProject(projectID)
	if err != nil || !ok {
		t.Fatalf("DeleteProject() ok=%v err=%v, want ok", ok, err)
	}
	if trashed.Status != "trashed" || trashed.OriginalProjectDir != projectDir || trashed.TrashProjectDir == "" {
		t.Fatalf("trashed project = %#v, want trash metadata", trashed)
	}
	if _, err := os.Stat(projectDir); !os.IsNotExist(err) {
		t.Fatalf("original project dir exists after trash, err=%v", err)
	}
	if got, err := os.ReadFile(filepath.Join(trashed.TrashProjectDir, "keep.txt")); err != nil || string(got) != "keep" {
		t.Fatalf("trashed file = %q err=%v, want keep", got, err)
	}
	active, err = store.ListProjects()
	if err != nil {
		t.Fatalf("ListProjects() after trash error = %v", err)
	}
	if workspaceProjectIDs(active.Projects)[projectID] {
		t.Fatalf("trashed project still appears in active list: %#v", active.Projects)
	}
	trashList, err := store.ListProjectsByStatus("trashed")
	if err != nil {
		t.Fatalf("ListProjectsByStatus(trashed) error = %v", err)
	}
	if !workspaceProjectIDs(trashList.Projects)[projectID] {
		t.Fatalf("trashed project missing from trash list: %#v", trashList.Projects)
	}

	restored, ok, err := store.RestoreProject(projectID)
	if err != nil || !ok {
		t.Fatalf("RestoreProject(trashed) ok=%v err=%v, want ok", ok, err)
	}
	if restored.Status != "active" || restored.ProjectDir != projectDir || restored.TrashProjectDir != "" {
		t.Fatalf("restored project = %#v, want original active project", restored)
	}
	if got, err := os.ReadFile(filepath.Join(projectDir, "keep.txt")); err != nil || string(got) != "keep" {
		t.Fatalf("restored file = %q err=%v, want keep", got, err)
	}

	trashedAgain, ok, err := store.DeleteProject(projectID)
	if err != nil || !ok {
		t.Fatalf("DeleteProject(second) ok=%v err=%v, want ok", ok, err)
	}
	permanent, ok, err := store.PermanentlyDeleteProject(projectID)
	if err != nil || !ok {
		t.Fatalf("PermanentlyDeleteProject() project=%#v ok=%v err=%v, want ok", permanent, ok, err)
	}
	if permanent.ID != projectID {
		t.Fatalf("permanent project ID = %q, want %q", permanent.ID, projectID)
	}
	if _, err := os.Stat(trashedAgain.TrashProjectDir); !os.IsNotExist(err) {
		t.Fatalf("trash dir exists after permanent delete, err=%v", err)
	}
	if _, err := store.workspace.GetProject(projectID); err == nil {
		t.Fatal("project still exists after permanent delete")
	}
}

func TestWorkspaceStateServiceWritesReadableFilenamesAndReconcilesMarkdownFiles(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-readable-filenames"
	requireTestProject(t, store, projectID)
	docsDir := store.documentsDir(projectID)

	_, err := store.save(projectID, workspaceStateRequest{
		Documents: []mediamcp.WorkspaceDocument{
			{
				ID:        "doc-a",
				Title:     "第一集-开场",
				Content:   "# A\n",
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
			{
				ID:        "doc-b",
				Title:     "第一集-开场",
				Content:   "# B\n",
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
			{
				ID:        "doc-empty",
				Title:     "",
				Content:   "# Empty\n",
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
		},
		OperationLog: []documentOperationLogRecord{},
	})
	if err != nil {
		t.Fatalf("saving duplicate-titled documents: %v", err)
	}
	assertDocumentMarkdownExists(t, docsDir, "第一集-开场.md")
	assertDocumentMarkdownExists(t, docsDir, "第一集-开场-2.md")
	assertDocumentMarkdownExists(t, docsDir, "doc-empty.md")

	_, err = store.save(projectID, workspaceStateRequest{
		Documents: []mediamcp.WorkspaceDocument{
			{
				ID:        "doc-a",
				Title:     "第一集-开场",
				Content:   "# A\n",
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
			{
				ID:        "doc-b",
				Title:     "角色-林夏",
				Content:   "# B\n",
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
		},
		OperationLog: []documentOperationLogRecord{},
	})
	if err != nil {
		t.Fatalf("saving renamed document: %v", err)
	}
	assertDocumentMarkdownExists(t, docsDir, "第一集-开场.md")
	assertDocumentMarkdownExists(t, docsDir, "角色-林夏.md")
	assertDocumentMarkdownMissing(t, docsDir, "第一集-开场-2.md")
	assertDocumentMarkdownMissing(t, docsDir, "doc-empty.md")

	_, err = store.save(projectID, workspaceStateRequest{
		Documents: []mediamcp.WorkspaceDocument{
			{
				ID:        "doc-a",
				Title:     "第一集-开场",
				Content:   "# A\n",
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
		},
		OperationLog: []documentOperationLogRecord{},
	})
	if err != nil {
		t.Fatalf("saving after document deletion: %v", err)
	}
	assertDocumentMarkdownExists(t, docsDir, "第一集-开场.md")
	assertDocumentMarkdownMissing(t, docsDir, "角色-林夏.md")
}

func TestWorkspaceStateServiceMirrorsDocumentFoldersToMarkdownProjection(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-folder-projection"
	requireTestProject(t, store, projectID)
	docsDir := store.documentsDir(projectID)

	chapter, err := store.CreateDocumentFolder(projectID, CreateDocumentFolderRequest{
		ID:   "folder-chapter",
		Name: "第一章",
	})
	if err != nil {
		t.Fatalf("creating chapter folder: %v", err)
	}
	empty, err := store.CreateDocumentFolder(projectID, CreateDocumentFolderRequest{
		ID:   "folder-empty",
		Name: "空文件夹",
	})
	if err != nil {
		t.Fatalf("creating empty folder: %v", err)
	}

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		ID:       "doc-scene",
		Title:    "开场",
		Content:  "# 开场\n",
		Category: "screenplay",
		FolderID: &chapter.Folder.ID,
	})
	if err != nil {
		t.Fatalf("creating folder document: %v", err)
	}
	assertDocumentMarkdownExists(t, docsDir, filepath.Join("第一章", "开场.md"))
	assertDocumentFolderExists(t, docsDir, "空文件夹")

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	persisted := findTestWorkspaceDocument(state.Documents, document.ID)
	if persisted.FolderID != chapter.Folder.ID {
		t.Fatalf("persisted folder id = %q, want %q", persisted.FolderID, chapter.Folder.ID)
	}
	if len(state.Folders) != 2 {
		t.Fatalf("state folders = %+v, want two folders", state.Folders)
	}

	renamed := "第二章"
	renamedChapter, err := store.UpdateDocumentFolder(projectID, chapter.Folder.ID, UpdateDocumentFolderRequest{Name: &renamed})
	if err != nil {
		t.Fatalf("renaming folder: %v", err)
	}
	assertDocumentMarkdownExists(t, docsDir, filepath.Join("第二章", "开场.md"))
	assertDocumentMarkdownMissing(t, docsDir, filepath.Join("第一章", "开场.md"))

	if _, err := store.DeleteDocumentFolder(projectID, renamedChapter.Folder.ID); err != nil {
		t.Fatalf("deleting folder: %v", err)
	}
	assertDocumentMarkdownExists(t, docsDir, "开场.md")
	assertDocumentMarkdownMissing(t, docsDir, filepath.Join("第二章", "开场.md"))
	assertDocumentFolderExists(t, docsDir, "空文件夹")

	if _, err := store.DeleteDocumentFolder(projectID, empty.Folder.ID); err != nil {
		t.Fatalf("deleting empty folder: %v", err)
	}
	assertDocumentFolderMissing(t, docsDir, "空文件夹")
}

func TestWorkspaceStateServiceRejectsDuplicateSiblingFolders(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-duplicate-folders"
	requireTestProject(t, store, projectID)

	first, err := store.CreateDocumentFolder(projectID, CreateDocumentFolderRequest{
		ID:   "folder-first",
		Name: "素材",
	})
	if err != nil {
		t.Fatalf("creating first folder: %v", err)
	}
	if _, err := store.CreateDocumentFolder(projectID, CreateDocumentFolderRequest{
		ID:   "folder-duplicate",
		Name: "素材",
	}); err == nil || !strings.Contains(err.Error(), "folder name already exists") {
		t.Fatalf("duplicate create error = %v, want duplicate name error", err)
	}

	childName := "素材"
	if _, err := store.CreateDocumentFolder(projectID, CreateDocumentFolderRequest{
		ID:       "folder-child",
		Name:     childName,
		ParentID: &first.Folder.ID,
	}); err != nil {
		t.Fatalf("creating same name under different parent: %v", err)
	}
	secondName := "第二组"
	second, err := store.CreateDocumentFolder(projectID, CreateDocumentFolderRequest{
		ID:   "folder-second",
		Name: secondName,
	})
	if err != nil {
		t.Fatalf("creating second folder: %v", err)
	}
	duplicateName := "素材"
	if _, err := store.UpdateDocumentFolder(projectID, second.Folder.ID, UpdateDocumentFolderRequest{Name: &duplicateName}); err == nil || !strings.Contains(err.Error(), "folder name already exists") {
		t.Fatalf("duplicate rename error = %v, want duplicate name error", err)
	}
}

func TestWorkspaceStateServiceLoadsDocumentContentFromLocalMarkdownBeforeDB(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-db-content"
	requireTestProject(t, store, projectID)

	_, err := store.save(projectID, workspaceStateRequest{
		Documents: []mediamcp.WorkspaceDocument{
			{
				ID:        "doc-db-content",
				Title:     "Draft",
				Content:   "# Draft\n\nDB content.",
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
			{
				ID:        "doc-empty-content",
				Title:     "Empty",
				Content:   "",
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
		},
		OperationLog: []documentOperationLogRecord{},
	})
	if err != nil {
		t.Fatalf("saving document: %v", err)
	}

	if err := os.WriteFile(filepath.Join(store.documentsDir(projectID), "Draft.md"), []byte("# Draft\n\nstale file content."), 0o644); err != nil {
		t.Fatalf("staling draft markdown: %v", err)
	}
	if err := os.WriteFile(filepath.Join(store.documentsDir(projectID), "Empty.md"), []byte("# Draft\n\nstale file content."), 0o644); err != nil {
		t.Fatalf("staling empty markdown: %v", err)
	}

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	loaded := findTestWorkspaceDocumentByTitle(state.Documents, "Draft")
	if loaded.Content != "# Draft\n\nstale file content." {
		t.Fatalf("loaded content = %q, want local markdown content", loaded.Content)
	}
	empty := findTestWorkspaceDocumentByTitle(state.Documents, "Empty")
	if empty.Content != "# Draft\n\nstale file content." {
		t.Fatalf("empty content = %q, want local markdown content", empty.Content)
	}
}

func TestWorkspaceStateServicePrunesDeletedProjectedMarkdownFiles(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-prune-projected-markdown"
	requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:    "新剧本",
		Content:  "# 新剧本\n\n正文。",
		Category: "screenplay",
	})
	if err != nil {
		t.Fatalf("creating projected document: %v", err)
	}
	deletedPath := filepath.Join(store.documentsDir(projectID), "新剧本.md")
	if err := os.Remove(deletedPath); err != nil {
		t.Fatalf("removing projected markdown: %v", err)
	}

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents after local delete: %v", err)
	}
	if deleted := findTestWorkspaceDocument(state.Documents, document.ID); deleted.ID != "" {
		t.Fatalf("deleted projected markdown still listed: %+v", deleted)
	}

	_, _, err = store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:    "新素材",
		Content:  "# 新素材\n\n正文。",
		Category: referenceDocumentCategory,
	})
	if err != nil {
		t.Fatalf("creating document after local delete: %v", err)
	}
	if _, err := os.Stat(deletedPath); !os.IsNotExist(err) {
		t.Fatalf("deleted projected markdown path error = %v, want still missing", err)
	}
}

func TestWorkspaceStateServiceSyncsExistingLocalMarkdownMetadata(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-sync-existing-local-markdown"
	requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:    "同步文档",
		Content:  "# 同步文档\n\n旧正文。",
		Category: referenceDocumentCategory,
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}
	nextContent := "---\ntitle: 本地标题\ncategory: screenplay\nsortOrder: 99\n---\n# 同步文档\n\n本地更新。\n"
	if err := os.WriteFile(filepath.Join(store.documentsDir(projectID), "同步文档.md"), []byte(nextContent), 0o644); err != nil {
		t.Fatalf("writing local markdown update: %v", err)
	}

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents after local update: %v", err)
	}
	updated := findTestWorkspaceDocument(state.Documents, document.ID)
	if updated.Title != "本地标题" || updated.Category != "screenplay" || updated.Content != "# 同步文档\n\n本地更新。\n" {
		t.Fatalf("updated document = %+v, want local frontmatter title, category, and content", updated)
	}
	if updated.SortOrder == 99 {
		t.Fatalf("updated sortOrder = %d, want local frontmatter sortOrder ignored", updated.SortOrder)
	}
	if updated.Version != 1 {
		t.Fatalf("updated version = %d, want unchanged version without frontmatter version", updated.Version)
	}
}

func TestWorkspaceStateServiceImportsLocalMarkdownFilesFromWorkDir(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-import-local-markdown"
	requireTestProject(t, store, projectID)

	workDir := store.documentsDir(projectID)
	if err := os.MkdirAll(filepath.Join(workDir, "大纲"), 0o755); err != nil {
		t.Fatalf("creating local markdown folder: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "大纲", "第一章.md"), []byte("# 第一章\n\n本地创建。"), 0o644); err != nil {
		t.Fatalf("writing local markdown: %v", err)
	}

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	imported := findTestWorkspaceDocumentByTitle(state.Documents, "第一章")
	if imported.ID == "" {
		t.Fatalf("documents = %+v, want imported local markdown", state.Documents)
	}
	if imported.Category != referenceDocumentCategory || imported.Content != "# 第一章\n\n本地创建。" {
		t.Fatalf("imported document = %+v, want reference with local content", imported)
	}
	if imported.FolderID == "" {
		t.Fatalf("imported folder id is empty, folders = %+v", state.Folders)
	}

	if err := os.Remove(filepath.Join(workDir, "大纲", "第一章.md")); err != nil {
		t.Fatalf("removing local markdown: %v", err)
	}
	state, err = store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents after local delete: %v", err)
	}
	if deleted := findTestWorkspaceDocumentByTitle(state.Documents, "第一章"); deleted.ID != "" {
		t.Fatalf("deleted local markdown still listed: %+v", deleted)
	}
}

func TestWorkspaceStateServiceSyncsLocalMarkdownFoldersFromWorkDir(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-sync-local-folders"
	requireTestProject(t, store, projectID)

	workDir := store.documentsDir(projectID)
	emptyDir := filepath.Join(workDir, "空目录")
	nestedDir := filepath.Join(workDir, "分组", "子目录")
	if err := os.MkdirAll(emptyDir, 0o755); err != nil {
		t.Fatalf("creating empty local folder: %v", err)
	}
	if err := os.MkdirAll(nestedDir, 0o755); err != nil {
		t.Fatalf("creating nested local folder: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nestedDir, "场景.md"), []byte("---\ncategory: scene\n---\n# 场景\n"), 0o644); err != nil {
		t.Fatalf("writing nested local markdown: %v", err)
	}

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents after local folders: %v", err)
	}
	if !testDocumentFolderPathExists(state.Folders, "空目录") {
		t.Fatalf("folders = %+v, want empty local folder", state.Folders)
	}
	if !testDocumentFolderPathExists(state.Folders, filepath.ToSlash(filepath.Join("分组", "子目录"))) {
		t.Fatalf("folders = %+v, want nested local folder", state.Folders)
	}
	imported := findTestWorkspaceDocumentByTitle(state.Documents, "场景")
	if imported.ID == "" || imported.FolderID == "" {
		t.Fatalf("imported document = %+v, folders = %+v, want document in nested folder", imported, state.Folders)
	}

	if err := os.RemoveAll(filepath.Join(workDir, "分组")); err != nil {
		t.Fatalf("removing nested local folder: %v", err)
	}
	if err := os.RemoveAll(emptyDir); err != nil {
		t.Fatalf("removing empty local folder: %v", err)
	}
	state, err = store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents after folder delete: %v", err)
	}
	if len(state.Folders) != 0 {
		t.Fatalf("folders = %+v, want local folders removed", state.Folders)
	}
	if deleted := findTestWorkspaceDocumentByTitle(state.Documents, "场景"); deleted.ID != "" {
		t.Fatalf("deleted local folder document still listed: %+v", deleted)
	}
}

func TestWorkspaceStateServiceImportsLocalMarkdownCategoryMetadata(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-import-local-category-metadata"
	requireTestProject(t, store, projectID)

	workDir := store.documentsDir(projectID)
	content := "---\ntitle: 第一章 正式标题\ncategory: screenplay\n---\n# 第一章 抽到天级反派模板！（动漫剧本）\n\n## 1-1  未知 水下  绝望地狱·湖底\n\n人物：沈阎、系统\n\n沈阎缓缓沉到湖底。\n"
	if err := os.WriteFile(filepath.Join(workDir, "第一章 抽到天级反派模板！-动漫剧本.md"), []byte(content), 0o644); err != nil {
		t.Fatalf("writing local screenplay markdown: %v", err)
	}

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	imported := findTestWorkspaceDocumentByTitle(state.Documents, "第一章 正式标题")
	if imported.ID == "" {
		t.Fatalf("documents = %+v, want imported screenplay", state.Documents)
	}
	if imported.Category != "screenplay" {
		t.Fatalf("category = %q, want screenplay", imported.Category)
	}
	if strings.Contains(imported.Content, "category: screenplay") {
		t.Fatalf("content = %q, should strip frontmatter", imported.Content)
	}
	if strings.Contains(imported.Content, "title: 第一章 正式标题") {
		t.Fatalf("content = %q, should strip frontmatter title", imported.Content)
	}
}

func TestWorkspaceStateServiceDoesNotInferLocalMarkdownCategoryWithoutFrontmatter(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-import-local-category-no-inference"
	requireTestProject(t, store, projectID)

	workDir := store.documentsDir(projectID)
	content := "# 第一章 抽到天级反派模板！（动漫剧本）\n\n## 1-1  未知 水下  绝望地狱·湖底\n\n人物：沈阎、系统\n\n沈阎缓缓沉到湖底。\n"
	if err := os.WriteFile(filepath.Join(workDir, "第一章 抽到天级反派模板！-动漫剧本.md"), []byte(content), 0o644); err != nil {
		t.Fatalf("writing local screenplay-like markdown: %v", err)
	}

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	imported := findTestWorkspaceDocumentByTitle(state.Documents, "第一章 抽到天级反派模板！-动漫剧本")
	if imported.ID == "" {
		t.Fatalf("documents = %+v, want imported screenplay-like markdown", state.Documents)
	}
	if imported.Category != referenceDocumentCategory {
		t.Fatalf("category = %q, want reference without frontmatter", imported.Category)
	}
}

func TestWorkspaceStateServiceImportsProjectOverviewMarkdownAsRegularDocument(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-import-overview-markdown"
	requireTestProject(t, store, projectID)

	workDir := store.documentsDir(projectID)
	if err := os.WriteFile(filepath.Join(workDir, "项目概览.md"), []byte("# 项目概览\n\n本地创建。"), 0o644); err != nil {
		t.Fatalf("writing local overview markdown: %v", err)
	}

	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	imported := findTestWorkspaceDocumentByTitle(state.Documents, "项目概览")
	if imported.ID == "" {
		t.Fatalf("documents = %+v, want imported local markdown", state.Documents)
	}
	if IsOverviewDocumentID(imported.ID) || imported.Category != referenceDocumentCategory {
		t.Fatalf("imported document = %+v, want regular reference", imported)
	}
}

func TestWorkspaceStateServiceSaveFailsWhenWorkPathIsNotDirectory(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-projection-failure"
	requireTestProject(t, store, projectID)

	_, err := store.save(projectID, workspaceStateRequest{
		Documents: []mediamcp.WorkspaceDocument{
			{
				ID:        "doc-projection",
				Title:     "Projection",
				Content:   "# Projection\n\nOld content.",
				UpdatedAt: "2026-05-18T00:00:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
		},
		OperationLog: []documentOperationLogRecord{},
	})
	if err != nil {
		t.Fatalf("seeding document: %v", err)
	}

	docsDir := store.documentsDir(projectID)
	if err := os.RemoveAll(docsDir); err != nil {
		t.Fatalf("removing markdown projection directory: %v", err)
	}
	if err := os.WriteFile(docsDir, []byte("not a directory"), 0o644); err != nil {
		t.Fatalf("blocking markdown projection path: %v", err)
	}

	_, err = store.save(projectID, workspaceStateRequest{
		Documents: []mediamcp.WorkspaceDocument{
			{
				ID:        "doc-projection",
				Title:     "Projection",
				Content:   "# Projection\n\nUpdated DB content.",
				UpdatedAt: "2026-05-18T00:01:00Z",
				Comments:  []mediamcp.DocumentComment{},
			},
		},
		OperationLog: []documentOperationLogRecord{},
	})
	if err == nil || !strings.Contains(err.Error(), "creating work directory") {
		t.Fatalf("saving with blocked work path error = %v, want work directory error", err)
	}
}

func TestWorkspaceStateServiceRequireWorkspaceDocument(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-require-doc"
	requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:   "必需文档",
		Content: "# 必需文档\n\n正文。",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	loaded, err := store.RequireWorkspaceDocument(projectID, document.ID)
	if err != nil {
		t.Fatalf("requiring document: %v", err)
	}
	if loaded.ID != document.ID {
		t.Fatalf("loaded id = %q, want %q", loaded.ID, document.ID)
	}

	_, err = store.RequireWorkspaceDocument(projectID, "")
	if err == nil || !strings.Contains(err.Error(), "documentId is required") {
		t.Fatalf("empty document err = %v, want required error", err)
	}

	_, err = store.RequireWorkspaceDocument(projectID, "missing")
	if err == nil || !strings.Contains(err.Error(), "文档不存在") {
		t.Fatalf("missing document err = %v, want not-found error", err)
	}
}

func TestWorkspaceStateServiceCanDeleteLastDocument(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-delete-last"
	requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:   "唯一文档",
		Content: "# 唯一文档\n",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	expected := document.Version
	if _, err := store.deleteDocument(projectID, document.ID, &expected); err != nil {
		t.Fatalf("deleting last document: %v", err)
	}
	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing documents: %v", err)
	}
	if len(state.Documents) != 0 {
		t.Fatalf("documents = %+v, want empty project", state.Documents)
	}
}

func TestWorkspaceStateServiceWritesDocumentEditFileLog(t *testing.T) {
	workspaceDir := t.TempDir()
	store := newWorkspaceStateService(workspaceDir)
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-edit-log"
	requireTestProject(t, store, projectID)
	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		ID:      "doc-edit-log",
		Title:   "第一集",
		Content: "# 第一集\n\n旧内容。",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	record := documentOperationLogRecord{
		ID:         "oplog-test",
		DocumentID: document.ID,
		Operations: []map[string]any{
			{
				"id":      "op-test",
				"type":    "insert_block",
				"summary": "插入动作段落",
			},
		},
		Summary:   "插入动作段落",
		Source:    "agent:test",
		CreatedAt: "2026-05-18T00:00:00Z",
		Before: DocumentSnapshotRecord{
			Title:    document.Title,
			Content:  document.Content,
			Comments: []mediamcp.DocumentComment{},
		},
		After: DocumentSnapshotRecord{
			Title:    document.Title,
			Content:  "# 第一集\n\n旧内容。\n\n新内容。",
			Comments: []mediamcp.DocumentComment{},
		},
	}
	if err := store.AppendDocumentOperationLog(projectID, record); err != nil {
		t.Fatalf("appending operation log: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(store.projectDir(projectID), "logs", "第一集-edit.txt"))
	if err != nil {
		t.Fatalf("reading edit file log: %v", err)
	}
	if _, err := os.Stat(filepath.Join(store.metadataDir(projectID), "logs")); !os.IsNotExist(err) {
		t.Fatalf("metadata logs dir stat error = %v, want not exist", err)
	}
	logText := string(content)
	for _, want := range []string{"summary: 插入动作段落", `"type": "insert_block"`, "--- before ---", "旧内容。", "--- after ---", "新内容。"} {
		if !strings.Contains(logText, want) {
			t.Fatalf("edit file log missing %q:\n%s", want, logText)
		}
	}
}

func TestWorkspaceStateServiceUpdateDocumentHelpersKeepCleanFlag(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-update-helpers"
	requireTestProject(t, store, projectID)
	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title:   "旧标题",
		Content: "# 旧标题\n",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	title := "新标题"
	before, updated, err := store.UpdateWorkspaceDocumentMetadata(projectID, document.ID, UpdateWorkspaceDocumentRequest{Title: &title})
	if err != nil {
		t.Fatalf("updating metadata: %v", err)
	}
	if before.Title != "旧标题" || updated.Title != "新标题" || updated.IsDirty {
		t.Fatalf("before=%#v updated=%#v, want clean metadata update", before, updated)
	}
	projected, err := os.ReadFile(filepath.Join(store.documentsDir(projectID), "新标题.md"))
	if err != nil {
		t.Fatalf("reading renamed markdown projection: %v", err)
	}
	if !strings.Contains(string(projected), "title: 新标题") {
		t.Fatalf("renamed markdown projection = %q, want title frontmatter", string(projected))
	}

	nextContent := "# 新标题\n\n正文。"
	replaced, err := store.UpdateWorkspaceDocumentContent(projectID, updated, nextContent, updated.Version)
	if err != nil {
		t.Fatalf("updating content: %v", err)
	}
	if replaced.Content != nextContent || replaced.IsDirty {
		t.Fatalf("replaced=%#v, want clean content update", replaced)
	}
}

func TestWorkspaceStateServiceOptimisticLockVersions(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "project-version"
	requireTestProject(t, store, projectID)

	docA, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		ID:      "doc-version-a",
		Title:   "A",
		Content: "# A\n\nfirst",
	})
	if err != nil {
		t.Fatalf("creating doc-a: %v", err)
	}
	if docA.Version != 1 {
		t.Fatalf("created version = %d, want 1", docA.Version)
	}

	content := "# A2\n\nfirst"
	expected := docA.Version
	updated, _, err := store.updateDocument(projectID, docA.ID, updateWorkspaceDocumentRequest{
		Content:         &content,
		ExpectedVersion: &expected,
	})
	if err != nil {
		t.Fatalf("updating with expected version: %v", err)
	}
	if updated.Version != 2 {
		t.Fatalf("updated version = %d, want 2", updated.Version)
	}
	if _, _, err := store.updateDocument(projectID, docA.ID, updateWorkspaceDocumentRequest{
		Content:         &content,
		ExpectedVersion: &expected,
	}); !IsWorkspaceVersionConflict(err) {
		t.Fatalf("stale update error = %v, want version conflict", err)
	}

	docB, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		ID:      "doc-version-b",
		Title:   "B",
		Content: "# B\n",
	})
	if err != nil {
		t.Fatalf("creating doc-b: %v", err)
	}
	moveExpected := docB.Version
	if _, _, err := store.moveDocument(projectID, docB.ID, docA.ID, "inside", moveExpected); err != nil {
		t.Fatalf("moving with expected version: %v", err)
	}
	state, err := store.listDocuments(projectID)
	if err != nil {
		t.Fatalf("listing after move: %v", err)
	}
	docB = findTestWorkspaceDocument(state.Documents, docB.ID)
	if docB.Version != 2 {
		t.Fatalf("moved version = %d, want 2", docB.Version)
	}
	if _, _, err := store.moveDocument(projectID, docB.ID, docA.ID, "inside", moveExpected); !IsWorkspaceVersionConflict(err) {
		t.Fatalf("stale move error = %v, want version conflict", err)
	}

	deleteExpected := docB.Version
	if _, err := store.deleteDocument(projectID, docB.ID, &deleteExpected); err != nil {
		t.Fatalf("deleting with expected version: %v", err)
	}
	if _, err := store.deleteDocument(projectID, docA.ID, &expected); !IsWorkspaceVersionConflict(err) {
		t.Fatalf("stale delete error = %v, want version conflict", err)
	}
}

func findTestWorkspaceDocument(documents []mediamcp.WorkspaceDocument, id string) mediamcp.WorkspaceDocument {
	for _, document := range documents {
		if document.ID == id {
			return document
		}
	}
	return mediamcp.WorkspaceDocument{}
}

func findTestWorkspaceDocumentByTitle(documents []mediamcp.WorkspaceDocument, title string) mediamcp.WorkspaceDocument {
	for _, document := range documents {
		if document.Title == title {
			return document
		}
	}
	return mediamcp.WorkspaceDocument{}
}

func workspaceProjectIDs(projects []mediamcp.Project) map[string]bool {
	ids := map[string]bool{}
	for _, project := range projects {
		ids[project.ID] = true
	}
	return ids
}

func testDocumentFolderPathExists(folders []mediamcp.DocumentFolder, path string) bool {
	path = filepath.ToSlash(path)
	for _, folderPath := range DocumentFolderPathByID(folders) {
		if folderPath == path {
			return true
		}
	}
	return false
}

func assertDocumentMarkdownExists(t *testing.T, docsDir string, filename string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(docsDir, filename)); err != nil {
		t.Fatalf("document markdown %s should exist: %v", filename, err)
	}
}

func assertDocumentMarkdownMissing(t *testing.T, docsDir string, filename string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(docsDir, filename)); !os.IsNotExist(err) {
		t.Fatalf("document markdown %s should not exist, err=%v", filename, err)
	}
}

func assertDocumentFolderExists(t *testing.T, docsDir string, folder string) {
	t.Helper()
	info, err := os.Stat(filepath.Join(docsDir, folder))
	if err != nil {
		t.Fatalf("document folder %s should exist: %v", folder, err)
	}
	if !info.IsDir() {
		t.Fatalf("document folder %s is not a directory", folder)
	}
}

func assertDocumentFolderMissing(t *testing.T, docsDir string, folder string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(docsDir, folder)); !os.IsNotExist(err) {
		t.Fatalf("document folder %s should not exist, err=%v", folder, err)
	}
}
