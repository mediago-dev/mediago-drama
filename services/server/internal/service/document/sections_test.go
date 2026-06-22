package document

import (
	"regexp"
	"strings"
	"testing"
)

func TestReconcileProjectSectionsAddsStableAnchorsAndRecords(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-reconcile"
	requireTestProject(t, store, projectID)

	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		Title:    "角色册",
		Category: "character",
		Content: strings.Join([]string{
			"## 林书彤",
			"",
			"**形象定位**：年轻女性",
			"",
			"**面部特征**：清秀五官",
			"",
			"**身材气质**：挺拔冷静",
			"",
			"**着装造型**：白色外套",
			"",
			"**标志性细节**：银色发夹",
		}, "\n"),
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceDocument() error = %v", err)
	}

	response, err := store.ReconcileProjectSections(projectID)
	if err != nil {
		t.Fatalf("ReconcileProjectSections() error = %v", err)
	}
	if len(response.Sections) != 1 {
		t.Fatalf("sections len = %d, want child section", len(response.Sections))
	}

	saved, ok, err := store.GetWorkspaceDocument(projectID, document.ID)
	if err != nil || !ok {
		t.Fatalf("GetWorkspaceDocument() ok=%v err=%v", ok, err)
	}
	if !regexp.MustCompile(`<!-- section-id: section_[A-Za-z0-9_-]+ -->\n## 林书彤`).MatchString(saved.Content) {
		t.Fatalf("content = %q, want stable section-id before child heading", saved.Content)
	}

	role := findSectionByObservedTitle(response.Sections, "林书彤")
	if role == nil {
		t.Fatalf("sections = %#v, want role section", response.Sections)
	}
	if role.Type != "character" || role.Status != DocumentSectionStatusActive || role.LineStart <= 0 || role.ContentHash == "" {
		t.Fatalf("role section = %#v, want active character observation", role)
	}
}

func TestReconcileProjectSectionsKeepsIdentityAcrossMoveAndRename(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-move"
	requireTestProject(t, store, projectID)

	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		Title:    "场景册",
		Category: "scene",
		Content: strings.Join([]string{
			"# 场景册",
			"",
			"<!-- section-id: section_gate -->",
			"## 旧门口",
			"",
			"旧描述。",
		}, "\n"),
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceDocument() error = %v", err)
	}
	if _, err := store.ReconcileProjectSections(projectID); err != nil {
		t.Fatalf("initial ReconcileProjectSections() error = %v", err)
	}

	nextContent := strings.Join([]string{
		"# 场景册",
		"",
		"## 其他场景",
		"",
		"垫场。",
		"",
		"<!-- section-id: section_gate -->",
		"## 新门口",
		"",
		"新描述。",
	}, "\n")
	_, _, err = store.UpdateWorkspaceDocument(projectID, document.ID, UpdateWorkspaceDocumentRequest{
		Content: &nextContent,
	})
	if err != nil {
		t.Fatalf("UpdateWorkspaceDocument() error = %v", err)
	}
	response, err := store.ReconcileProjectSections(projectID)
	if err != nil {
		t.Fatalf("second ReconcileProjectSections() error = %v", err)
	}

	section := findSectionByID(response.Sections, "section_gate")
	if section == nil {
		t.Fatalf("sections = %#v, want section_gate", response.Sections)
	}
	if section.Status != DocumentSectionStatusActive || section.ObservedTitle != "新门口" {
		t.Fatalf("section = %#v, want active renamed section", section)
	}
	if section.LineStart <= 3 {
		t.Fatalf("lineStart = %d, want moved section after inserted scene", section.LineStart)
	}
	if section.Title != "旧门口" {
		t.Fatalf("title = %q, want metadata title preserved from first observation", section.Title)
	}
}

func TestReconcileProjectSectionsReanchorsLegacySectionID(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-legacy-anchor"
	requireTestProject(t, store, projectID)

	documentID := "legacy-section-doc"
	legacyBlockID := createWorkspaceSectionBlockID(documentID, 2, 1, "林书彤")
	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		ID:       documentID,
		Title:    "角色册",
		Category: "reference",
		Content: strings.Join([]string{
			"<!-- section-id: " + legacyBlockID + " -->",
			"## 林书彤",
			"",
			"角色描述。",
		}, "\n"),
	})
	if err != nil {
		t.Fatalf("createDocument() error = %v", err)
	}

	response, err := store.ReconcileProjectSections(projectID)
	if err != nil {
		t.Fatalf("ReconcileProjectSections() error = %v", err)
	}

	anchoredSectionID := strings.Replace(legacyBlockID, "section-", "section_", 1)
	saved, ok, err := store.GetWorkspaceDocument(projectID, document.ID)
	if err != nil || !ok {
		t.Fatalf("GetWorkspaceDocument() ok=%v err=%v", ok, err)
	}
	if strings.Contains(saved.Content, "<!-- section-id: "+legacyBlockID+" -->") {
		t.Fatalf("content = %q, want legacy section-id comment replaced", saved.Content)
	}
	if strings.Count(saved.Content, "<!-- section-id:") != 1 {
		t.Fatalf("content = %q, want only canonical section-id comment", saved.Content)
	}
	if !strings.Contains(saved.Content, "<!-- section-id: "+anchoredSectionID+" -->\n## 林书彤") {
		t.Fatalf("content = %q, want canonical section id %s before heading", saved.Content, anchoredSectionID)
	}

	section := findSectionByID(response.Sections, anchoredSectionID)
	if section == nil {
		t.Fatalf("sections = %#v, want canonical legacy section id %s", response.Sections, anchoredSectionID)
	}
	if section.Status != DocumentSectionStatusActive || section.ObservedTitle != "林书彤" {
		t.Fatalf("section = %#v, want active legacy section observation", section)
	}
}

func TestReconcileProjectSectionsMarksDetachedAndMissing(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-detached"
	requireTestProject(t, store, projectID)

	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		Title:    "道具册",
		Category: "prop",
		Content:  "<!-- section-id: section_token -->\n## 玉佩\n\n旧描述。",
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceDocument() error = %v", err)
	}
	if _, err := store.ReconcileProjectSections(projectID); err != nil {
		t.Fatalf("initial ReconcileProjectSections() error = %v", err)
	}

	detachedContent := "<!-- section-id: section_token -->\n玉佩变成普通正文。"
	_, _, err = store.UpdateWorkspaceDocument(projectID, document.ID, UpdateWorkspaceDocumentRequest{
		Content: &detachedContent,
	})
	if err != nil {
		t.Fatalf("UpdateWorkspaceDocument(detached) error = %v", err)
	}
	response, err := store.ReconcileProjectSections(projectID)
	if err != nil {
		t.Fatalf("detached ReconcileProjectSections() error = %v", err)
	}
	section := findSectionByID(response.Sections, "section_token")
	if section == nil || section.Status != DocumentSectionStatusDetached {
		t.Fatalf("section = %#v, want detached", section)
	}

	missingContent := "玉佩正文，锚点被删除。"
	_, _, err = store.UpdateWorkspaceDocument(projectID, document.ID, UpdateWorkspaceDocumentRequest{
		Content: &missingContent,
	})
	if err != nil {
		t.Fatalf("UpdateWorkspaceDocument(missing) error = %v", err)
	}
	response, err = store.ReconcileProjectSections(projectID)
	if err != nil {
		t.Fatalf("missing ReconcileProjectSections() error = %v", err)
	}
	section = findSectionByID(response.Sections, "section_token")
	if section == nil || section.Status != DocumentSectionStatusMissing {
		t.Fatalf("section = %#v, want missing", section)
	}
}

func TestReconcileProjectSectionsIgnoresFencedCodeBlocks(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-code-fence"
	requireTestProject(t, store, projectID)

	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		Title:    "参考册",
		Category: "reference",
		Content: strings.Join([]string{
			"```markdown",
			"<!-- section-id: section_code_sample -->",
			"## 代码示例标题",
			"```",
			"",
			"## 真实标题",
			"",
			"正文。",
		}, "\n"),
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceDocument() error = %v", err)
	}

	response, err := store.ReconcileProjectSections(projectID)
	if err != nil {
		t.Fatalf("ReconcileProjectSections() error = %v", err)
	}
	if len(response.Sections) != 1 {
		t.Fatalf("sections len = %d, want only real heading section: %#v", len(response.Sections), response.Sections)
	}
	if findSectionByID(response.Sections, "section_code_sample") != nil {
		t.Fatalf("sections = %#v, want code-fence section-id ignored", response.Sections)
	}
	if findSectionByObservedTitle(response.Sections, "代码示例标题") != nil {
		t.Fatalf("sections = %#v, want code-fence heading ignored", response.Sections)
	}
	if findSectionByObservedTitle(response.Sections, "真实标题") == nil {
		t.Fatalf("sections = %#v, want real heading section", response.Sections)
	}

	saved, ok, err := store.GetWorkspaceDocument(projectID, document.ID)
	if err != nil || !ok {
		t.Fatalf("GetWorkspaceDocument() ok=%v err=%v", ok, err)
	}
	if strings.Count(saved.Content, "<!-- section-id:") != 2 {
		t.Fatalf("content = %q, want only existing code-fence id and real heading id", saved.Content)
	}
	if strings.Contains(saved.Content, "<!-- section-id: section_code_sample -->\n<!-- section-id:") {
		t.Fatalf("content = %q, want no inserted section-id inside fenced code", saved.Content)
	}
	if !regexp.MustCompile(`<!-- section-id: section_[A-Za-z0-9_-]+ -->\n## 真实标题`).MatchString(saved.Content) {
		t.Fatalf("content = %q, want inserted section-id before real heading", saved.Content)
	}
}

func findSectionByObservedTitle(sections []DocumentSectionRecord, title string) *DocumentSectionRecord {
	for index := range sections {
		if sections[index].ObservedTitle == title {
			return &sections[index]
		}
	}
	return nil
}

func findSectionByID(sections []DocumentSectionRecord, sectionID string) *DocumentSectionRecord {
	for index := range sections {
		if sections[index].SectionID == sectionID {
			return &sections[index]
		}
	}
	return nil
}
