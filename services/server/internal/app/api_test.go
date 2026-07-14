package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	servicecodexskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/codexskill"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
	servicemedia "github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
)

var testSessionProjects sync.Map

func TestAPIHandler(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	handler := newTestHandler(t, dbPath)

	t.Run("health", func(t *testing.T) {
		response := requestJSON(t, handler, http.MethodGet, "/api/v1/health", "")
		defer response.Body.Close()

		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusOK)
		}

		body := readBody(t, response.Body)
		if !strings.Contains(body, `"status":"ok"`) {
			t.Fatalf("body = %s, want health status", body)
		}
	})

	t.Run("Codex skill inventory is read only and separate from prompt pack skills", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("HOME", home)
		t.Setenv("CODEX_HOME", filepath.Join(home, ".codex"))
		skillDir := filepath.Join(home, ".agents", "skills", "route-check")
		if err := os.MkdirAll(skillDir, 0o755); err != nil {
			t.Fatalf("creating Codex skill fixture: %v", err)
		}
		if err := os.WriteFile(
			filepath.Join(skillDir, "SKILL.md"),
			[]byte("---\nname: route-check\ndescription: Verify app routes.\n---\n"),
			0o600,
		); err != nil {
			t.Fatalf("writing Codex skill fixture: %v", err)
		}

		list := requestJSON(t, handler, http.MethodGet, "/api/v1/codex-skills", "")
		defer list.Body.Close()
		if list.StatusCode != http.StatusOK {
			t.Fatalf("list status = %d, want %d: %s", list.StatusCode, http.StatusOK, readBody(t, list.Body))
		}
		var listEnvelope struct {
			Data servicecodexskill.ListResponse `json:"data"`
		}
		if err := json.NewDecoder(list.Body).Decode(&listEnvelope); err != nil {
			t.Fatalf("decoding Codex skill list: %v", err)
		}
		var routeSkill *servicecodexskill.SkillSummary
		for index := range listEnvelope.Data.Skills {
			if listEnvelope.Data.Skills[index].Name == "route-check" {
				routeSkill = &listEnvelope.Data.Skills[index]
				break
			}
		}
		if routeSkill == nil {
			t.Fatalf("Codex skills = %#v, want route fixture", listEnvelope.Data.Skills)
		}

		detail := requestJSON(t, handler, http.MethodGet, "/api/v1/codex-skills/"+routeSkill.ID, "")
		defer detail.Body.Close()
		if detail.StatusCode != http.StatusOK {
			t.Fatalf("detail status = %d, want %d: %s", detail.StatusCode, http.StatusOK, readBody(t, detail.Body))
		}
		detailBody := readBody(t, detail.Body)
		if !strings.Contains(detailBody, `"name":"route-check"`) || !strings.Contains(detailBody, `"previewAvailable":true`) {
			t.Fatalf("detail body = %s, want bounded detail", detailBody)
		}

		legacy := requestJSON(t, handler, http.MethodGet, "/api/v1/skills", "")
		defer legacy.Body.Close()
		if legacy.StatusCode != http.StatusOK || !strings.Contains(readBody(t, legacy.Body), `"skills"`) {
			t.Fatalf("legacy /skills behavior changed: status=%d", legacy.StatusCode)
		}

		writeAttempt := requestJSON(t, handler, http.MethodPost, "/api/v1/codex-skills", `{}`)
		defer writeAttempt.Body.Close()
		if writeAttempt.StatusCode != http.StatusNotFound {
			t.Fatalf("POST /codex-skills status = %d, want no write route", writeAttempt.StatusCode)
		}
	})

	t.Run("prompt library can be listed", func(t *testing.T) {
		categories := requestJSON(t, handler, http.MethodGet, "/api/v1/prompt-categories", "")
		defer categories.Body.Close()
		if categories.StatusCode != http.StatusOK {
			t.Fatalf("categories status code = %d, want %d: %s", categories.StatusCode, http.StatusOK, readBody(t, categories.Body))
		}
		categoriesBody := readBody(t, categories.Body)
		if !strings.Contains(categoriesBody, `"categories"`) ||
			!strings.Contains(categoriesBody, `"id":"style"`) ||
			!strings.Contains(categoriesBody, `"label":"风格"`) {
			t.Fatalf("body = %s, want built-in prompt categories", categoriesBody)
		}

		createCategory := requestJSON(t, handler, http.MethodPost, "/api/v1/prompt-categories", `{"label":"镜头"}`)
		defer createCategory.Body.Close()
		if createCategory.StatusCode != http.StatusOK {
			t.Fatalf("create category status code = %d, want %d: %s", createCategory.StatusCode, http.StatusOK, readBody(t, createCategory.Body))
		}
		createCategoryBody := readBody(t, createCategory.Body)
		if !strings.Contains(createCategoryBody, `"id":"镜头"`) ||
			!strings.Contains(createCategoryBody, `"source":"user"`) {
			t.Fatalf("body = %s, want created user prompt category", createCategoryBody)
		}

		response := requestJSON(t, handler, http.MethodGet, "/api/v1/prompt-presets?category=extra", "")
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
		}

		body := readBody(t, response.Body)
		if !strings.Contains(body, `"prompts"`) ||
			!strings.Contains(body, `"id":"character-multi-view"`) ||
			!strings.Contains(body, `"category":"extra"`) ||
			!strings.Contains(body, `"type":"image"`) {
			t.Fatalf("body = %s, want filtered prompt library entries", body)
		}

		update := requestJSON(t, handler, http.MethodPut, "/api/v1/prompt-presets/character-multi-view", `{"id":"character-multi-view","name":"自定义多视图","category":"extra","type":"image","prompt":"用户覆盖提示词"}`)
		defer update.Body.Close()
		if update.StatusCode != http.StatusOK {
			t.Fatalf("update status code = %d, want %d: %s", update.StatusCode, http.StatusOK, readBody(t, update.Body))
		}
		updateBody := readBody(t, update.Body)
		if !strings.Contains(updateBody, `"source":"user"`) || !strings.Contains(updateBody, `"builtin":true`) {
			t.Fatalf("body = %s, want built-in prompt saved as user override", updateBody)
		}

		reset := requestJSON(t, handler, http.MethodPost, "/api/v1/prompt-presets/character-multi-view/reset", "")
		defer reset.Body.Close()
		if reset.StatusCode != http.StatusOK {
			t.Fatalf("reset status code = %d, want %d: %s", reset.StatusCode, http.StatusOK, readBody(t, reset.Body))
		}
		resetBody := readBody(t, reset.Body)
		if !strings.Contains(resetBody, `"source":"pack"`) ||
			!strings.Contains(resetBody, `"name":"多视图设定图"`) ||
			strings.Contains(resetBody, `用户覆盖提示词`) {
			t.Fatalf("body = %s, want reset to package default", resetBody)
		}
	})

	t.Run("agent backends can be listed from startup config", func(t *testing.T) {
		backendHandler := newTestHandler(t, filepath.Join(t.TempDir(), "settings.db"))

		list := requestJSON(t, backendHandler, http.MethodGet, "/api/v1/agent/backends", "")
		defer list.Body.Close()
		if list.StatusCode != http.StatusOK {
			t.Fatalf("list status code = %d, want %d: %s", list.StatusCode, http.StatusOK, readBody(t, list.Body))
		}
		listBody := readBody(t, list.Body)
		if !strings.Contains(listBody, `"activeId":"codex"`) ||
			!strings.Contains(listBody, `"id":"opencode"`) ||
			!strings.Contains(listBody, `"command":"opencode acp"`) ||
			strings.Contains(listBody, `"id":"claude-code"`) {
			t.Fatalf("body = %s, want builtin agent backends", listBody)
		}

		update := requestJSON(t, backendHandler, http.MethodPut, "/api/v1/agent/backends/active", `{"backendId":"opencode"}`)
		defer update.Body.Close()
		if update.StatusCode != http.StatusNotFound {
			t.Fatalf("update status code = %d, want %d: %s", update.StatusCode, http.StatusNotFound, readBody(t, update.Body))
		}
	})

	t.Run("workspace state persists documents and operation log", func(t *testing.T) {
		project, _ := createExternalProjectForTest(t, handler, "Workspace State")
		statePath := "/api/v1/workspace/state?projectId=" + url.QueryEscape(project.ID)
		payload := `{"documents":[{"id":"doc-test","title":"Episode Test","content":"# Episode Test\n\n## 场景\n\nFactory.","updatedAt":"2026-05-18T00:00:00Z","isDirty":false,"comments":[{"id":"comment-test","anchorText":"Factory","anchor":{"quote":"Factory","contextBefore":"","contextAfter":"."},"body":"Make it stranger.","createdAt":"2026-05-18T00:00:00Z","resolved":false}],"workbenchDraft":{"id":"draft-test","documentId":"doc-test","title":"Episode Test · 剪辑草稿","kind":"episode","createdAt":"2026-05-18T00:00:00Z","updatedAt":"2026-05-18T00:00:00Z"}}],"operationLog":[{"id":"oplog-test","documentId":"doc-test","operations":[{"id":"op-test","type":"insert_markdown","summary":"Inserted","target":{"position":"append"},"payload":{"markdown":"## Note\n\nDraft"},"createdAt":"2026-05-18T00:00:00Z"}],"summary":"Inserted","source":"agent","createdAt":"2026-05-18T00:00:00Z","before":{"title":"Episode Test","content":"before","comments":[]},"after":{"title":"Episode Test","content":"after","comments":[]}}]}`
		save := requestJSON(t, handler, http.MethodPut, statePath, payload)
		defer save.Body.Close()
		if save.StatusCode != http.StatusOK {
			t.Fatalf("save status code = %d, want %d: %s", save.StatusCode, http.StatusOK, readBody(t, save.Body))
		}

		get := requestJSON(t, handler, http.MethodGet, statePath, "")
		defer get.Body.Close()
		if get.StatusCode != http.StatusOK {
			t.Fatalf("get status code = %d, want %d", get.StatusCode, http.StatusOK)
		}
		body := readBody(t, get.Body)
		if !strings.Contains(body, `"id":"doc-test"`) ||
			!strings.Contains(body, `"content":"# Episode Test\n\n## 场景\n\nFactory."`) ||
			!strings.Contains(body, `"workbenchDraft":{"id":"draft-test"`) ||
			!strings.Contains(body, `"id":"oplog-test"`) {
			t.Fatalf("body = %s, want persisted workspace state", body)
		}
	})

	t.Run("workspace document crud persists hierarchy", func(t *testing.T) {
		project, _ := createExternalProjectForTest(t, handler, "Hierarchy")
		projectID := project.ID
		documentsPath := "/api/v1/workspace/documents?projectId=" + url.QueryEscape(projectID)

		parentCreate := requestJSON(t, handler, http.MethodPost, documentsPath, `{"title":"父文档","content":"# 父文档","category":"screenplay"}`)
		defer parentCreate.Body.Close()
		if parentCreate.StatusCode != http.StatusOK {
			t.Fatalf("parent create status code = %d, want %d: %s", parentCreate.StatusCode, http.StatusOK, readBody(t, parentCreate.Body))
		}
		var parentEnvelope struct {
			Data struct {
				Document mediamcp.WorkspaceDocument `json:"document"`
			} `json:"data"`
		}
		if err := json.NewDecoder(parentCreate.Body).Decode(&parentEnvelope); err != nil {
			t.Fatalf("decoding parent create response: %v", err)
		}
		parentID := parentEnvelope.Data.Document.ID
		if parentID == "" {
			t.Fatal("parent document id is empty")
		}

		childCreate := requestJSON(t, handler, http.MethodPost, documentsPath, `{"title":"子文档","content":"# 子文档","category":"screenplay","parentId":"`+parentID+`"}`)
		defer childCreate.Body.Close()
		if childCreate.StatusCode != http.StatusOK {
			t.Fatalf("child create status code = %d, want %d: %s", childCreate.StatusCode, http.StatusOK, readBody(t, childCreate.Body))
		}
		var childEnvelope struct {
			Data struct {
				Document mediamcp.WorkspaceDocument `json:"document"`
			} `json:"data"`
		}
		if err := json.NewDecoder(childCreate.Body).Decode(&childEnvelope); err != nil {
			t.Fatalf("decoding child create response: %v", err)
		}
		childID := childEnvelope.Data.Document.ID
		if childEnvelope.Data.Document.ParentID != parentID {
			t.Fatalf("child parent = %q, want %q", childEnvelope.Data.Document.ParentID, parentID)
		}

		childPath := "/api/v1/workspace/documents/" + url.PathEscape(childID) + "?projectId=" + url.QueryEscape(projectID)
		update := requestJSON(t, handler, http.MethodPatch, childPath, `{"title":"子文档已改名","content":"# 子文档已改名","workbenchDraft":{"id":"draft-child","documentId":"`+childID+`","title":"子文档已改名 · 剪辑草稿","kind":"episode","createdAt":"2026-05-18T00:00:00Z","updatedAt":"2026-05-18T00:00:00Z"}}`)
		defer update.Body.Close()
		if update.StatusCode != http.StatusOK {
			t.Fatalf("update status code = %d, want %d: %s", update.StatusCode, http.StatusOK, readBody(t, update.Body))
		}

		list := requestJSON(t, handler, http.MethodGet, documentsPath, "")
		defer list.Body.Close()
		listBody := readBody(t, list.Body)
		if !strings.Contains(listBody, `"parentId":"`+parentID+`"`) ||
			!strings.Contains(listBody, `"title":"子文档已改名"`) ||
			!strings.Contains(listBody, `"workbenchDraft":{"id":"draft-child"`) {
			t.Fatalf("body = %s, want nested updated document", listBody)
		}

		siblingCreate := requestJSON(t, handler, http.MethodPost, documentsPath, `{"title":"保留文档","content":"# 保留文档","category":"reference"}`)
		defer siblingCreate.Body.Close()
		if siblingCreate.StatusCode != http.StatusOK {
			t.Fatalf("sibling create status code = %d, want %d: %s", siblingCreate.StatusCode, http.StatusOK, readBody(t, siblingCreate.Body))
		}

		deleteParent := requestJSON(t, handler, http.MethodDelete, "/api/v1/workspace/documents/"+url.PathEscape(parentID)+"?projectId="+url.QueryEscape(projectID), "")
		defer deleteParent.Body.Close()
		if deleteParent.StatusCode != http.StatusOK {
			t.Fatalf("delete status code = %d, want %d: %s", deleteParent.StatusCode, http.StatusOK, readBody(t, deleteParent.Body))
		}
		deleteBody := readBody(t, deleteParent.Body)
		if !strings.Contains(deleteBody, parentID) || !strings.Contains(deleteBody, childID) {
			t.Fatalf("body = %s, want parent and child deleted ids", deleteBody)
		}
	})

	t.Run("workspace document history exposes diff and restore", func(t *testing.T) {
		project, _ := createExternalProjectForTest(t, handler, "Document History")
		projectID := project.ID
		documentsPath := "/api/v1/workspace/documents?projectId=" + url.QueryEscape(projectID)

		create := requestJSON(t, handler, http.MethodPost, documentsPath, `{"title":"道具设定","content":"# 道具设定\n\nfirst","category":"prop","tags":["key"]}`)
		defer create.Body.Close()
		if create.StatusCode != http.StatusOK {
			t.Fatalf("create status code = %d, want %d: %s", create.StatusCode, http.StatusOK, readBody(t, create.Body))
		}
		var createEnvelope struct {
			Data struct {
				Document mediamcp.WorkspaceDocument `json:"document"`
			} `json:"data"`
		}
		if err := json.NewDecoder(create.Body).Decode(&createEnvelope); err != nil {
			t.Fatalf("decoding create response: %v", err)
		}
		documentID := createEnvelope.Data.Document.ID
		if documentID == "" {
			t.Fatal("created document id is empty")
		}

		documentPath := "/api/v1/workspace/documents/" + url.PathEscape(documentID) + "?projectId=" + url.QueryEscape(projectID)
		update := requestJSON(t, handler, http.MethodPatch, documentPath, `{"content":"# 道具设定\n\nsecond","category":"prop"}`)
		defer update.Body.Close()
		if update.StatusCode != http.StatusOK {
			t.Fatalf("update status code = %d, want %d: %s", update.StatusCode, http.StatusOK, readBody(t, update.Body))
		}

		history := requestJSON(t, handler, http.MethodGet, "/api/v1/workspace/documents/"+url.PathEscape(documentID)+"/history?projectId="+url.QueryEscape(projectID)+"&limit=20", "")
		defer history.Body.Close()
		if history.StatusCode != http.StatusOK {
			t.Fatalf("history status code = %d, want %d: %s", history.StatusCode, http.StatusOK, readBody(t, history.Body))
		}
		var historyEnvelope struct {
			Data struct {
				Items []struct {
					Hash        string   `json:"hash"`
					DocumentIDs []string `json:"documentIds"`
				} `json:"items"`
			} `json:"data"`
		}
		if err := json.NewDecoder(history.Body).Decode(&historyEnvelope); err != nil {
			t.Fatalf("decoding history response: %v", err)
		}
		if len(historyEnvelope.Data.Items) < 2 {
			t.Fatalf("history item count = %d, want at least 2: %#v", len(historyEnvelope.Data.Items), historyEnvelope.Data.Items)
		}
		latestHash := historyEnvelope.Data.Items[0].Hash
		oldestHash := historyEnvelope.Data.Items[len(historyEnvelope.Data.Items)-1].Hash
		if latestHash == "" || oldestHash == "" {
			t.Fatalf("history hashes are empty: %#v", historyEnvelope.Data.Items)
		}

		version := requestJSON(t, handler, http.MethodGet, "/api/v1/workspace/documents/"+url.PathEscape(documentID)+"/history/"+url.PathEscape(latestHash)+"?projectId="+url.QueryEscape(projectID), "")
		defer version.Body.Close()
		if version.StatusCode != http.StatusOK {
			t.Fatalf("version status code = %d, want %d: %s", version.StatusCode, http.StatusOK, readBody(t, version.Body))
		}
		versionBody := readBody(t, version.Body)
		if !strings.Contains(versionBody, `"category":"prop"`) || !strings.Contains(versionBody, `second`) || strings.Contains(versionBody, `category: prop`) {
			t.Fatalf("version body = %s, want prop body without frontmatter", versionBody)
		}

		diff := requestJSON(t, handler, http.MethodGet, "/api/v1/workspace/documents/"+url.PathEscape(documentID)+"/history/"+url.PathEscape(latestHash)+"/diff?projectId="+url.QueryEscape(projectID), "")
		defer diff.Body.Close()
		if diff.StatusCode != http.StatusOK {
			t.Fatalf("diff status code = %d, want %d: %s", diff.StatusCode, http.StatusOK, readBody(t, diff.Body))
		}
		diffBody := readBody(t, diff.Body)
		if !strings.Contains(diffBody, `"type":"removed"`) || !strings.Contains(diffBody, `first`) ||
			!strings.Contains(diffBody, `"type":"added"`) || !strings.Contains(diffBody, `second`) {
			t.Fatalf("diff body = %s, want removed first and added second", diffBody)
		}

		restore := requestJSON(t, handler, http.MethodPost, "/api/v1/workspace/documents/"+url.PathEscape(documentID)+"/history/"+url.PathEscape(oldestHash)+"/restore?projectId="+url.QueryEscape(projectID), "")
		defer restore.Body.Close()
		if restore.StatusCode != http.StatusOK {
			t.Fatalf("restore status code = %d, want %d: %s", restore.StatusCode, http.StatusOK, readBody(t, restore.Body))
		}
		var restoreEnvelope struct {
			Data struct {
				Document mediamcp.WorkspaceDocument `json:"document"`
			} `json:"data"`
		}
		if err := json.NewDecoder(restore.Body).Decode(&restoreEnvelope); err != nil {
			t.Fatalf("decoding restore response: %v", err)
		}
		if restoreEnvelope.Data.Document.Category != "prop" || !strings.Contains(restoreEnvelope.Data.Document.Content, "first") {
			t.Fatalf("restored document = %#v, want prop category and first content", restoreEnvelope.Data.Document)
		}
	})

	t.Run("episode timeline state persists by document", func(t *testing.T) {
		project, _ := createExternalProjectForTest(t, handler, "Episode State")
		projectID := project.ID
		create := requestJSON(t, handler, http.MethodPost, "/api/v1/workspace/documents?projectId="+url.QueryEscape(projectID), `{"title":"第一集","content":"# 第一集","category":"storyboard"}`)
		defer create.Body.Close()
		if create.StatusCode != http.StatusOK {
			t.Fatalf("create status code = %d, want %d: %s", create.StatusCode, http.StatusOK, readBody(t, create.Body))
		}
		var envelope struct {
			Data struct {
				Document mediamcp.WorkspaceDocument `json:"document"`
			} `json:"data"`
		}
		if err := json.NewDecoder(create.Body).Decode(&envelope); err != nil {
			t.Fatalf("decoding create response: %v", err)
		}
		documentID := envelope.Data.Document.ID
		episodePath := "/api/v1/workspace/episodes/" + url.PathEscape(documentID) + "?projectId=" + url.QueryEscape(projectID)

		missing := requestJSON(t, handler, http.MethodGet, episodePath, "")
		defer missing.Body.Close()
		missingBody := readBody(t, missing.Body)
		if missing.StatusCode != http.StatusOK {
			t.Fatalf("missing status code = %d, want %d: %s", missing.StatusCode, http.StatusOK, missingBody)
		}
		if !strings.Contains(missingBody, `"data":null`) || !strings.Contains(missingBody, `"success":true`) {
			t.Fatalf("missing body = %s, want successful empty episode timeline state", missingBody)
		}

		payload := `{"episode":{"id":"episode-doc","title":"第一集","duration":12,"aspectRatio":"16:9","sections":[],"tracks":[{"id":"track-voiceover","type":"voiceover","label":"旁白","clips":[{"id":"voiceover-1","title":"旁白 01","start":0,"end":12,"content":"醒来的城市没有声音。","status":"draft"}]}]}}`
		save := requestJSON(t, handler, http.MethodPut, episodePath, payload)
		defer save.Body.Close()
		if save.StatusCode != http.StatusOK {
			t.Fatalf("save status code = %d, want %d: %s", save.StatusCode, http.StatusOK, readBody(t, save.Body))
		}

		get := requestJSON(t, handler, http.MethodGet, episodePath, "")
		defer get.Body.Close()
		if get.StatusCode != http.StatusOK {
			t.Fatalf("get status code = %d, want %d: %s", get.StatusCode, http.StatusOK, readBody(t, get.Body))
		}
		body := readBody(t, get.Body)
		if !strings.Contains(body, `"documentId":"`+documentID+`"`) ||
			!strings.Contains(body, `"id":"episode-doc"`) ||
			!strings.Contains(body, `"content":"醒来的城市没有声音。"`) {
			t.Fatalf("body = %s, want persisted episode timeline state", body)
		}
	})

	t.Run("episode preview serves generated timeline video", func(t *testing.T) {
		dbPath := filepath.Join(t.TempDir(), "settings.db")
		ffmpegPath := filepath.Join(t.TempDir(), "ffmpeg")
		writeFakeFFmpegForTest(t, ffmpegPath)
		previewHandler := NewHandlerWithConfig(
			fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
			Config{
				SettingsDBPath:          dbPath,
				MediaDir:                filepath.Join(filepath.Dir(dbPath), "assets"),
				WorkspaceDir:            filepath.Join(filepath.Dir(dbPath), "workspace"),
				FFmpegPath:              ffmpegPath,
				DisableGenerationWorker: true,
				agentRunner:             fakeAgentRunner{},
				documentOperationRunner: fakeDocumentOperationRunner{},
			},
		)
		closeTestHandler(t, previewHandler)
		project, _ := createExternalProjectForTest(t, previewHandler, "Episode Preview")
		projectID := project.ID
		create := requestJSON(t, previewHandler, http.MethodPost, "/api/v1/workspace/documents?projectId="+url.QueryEscape(projectID), `{"title":"第一集","content":"# 第一集","category":"storyboard"}`)
		defer create.Body.Close()
		if create.StatusCode != http.StatusOK {
			t.Fatalf("create status code = %d, want %d: %s", create.StatusCode, http.StatusOK, readBody(t, create.Body))
		}
		var documentEnvelope struct {
			Data struct {
				Document mediamcp.WorkspaceDocument `json:"document"`
			} `json:"data"`
		}
		if err := json.NewDecoder(create.Body).Decode(&documentEnvelope); err != nil {
			t.Fatalf("decoding create response: %v", err)
		}
		documentID := documentEnvelope.Data.Document.ID

		first := uploadVideoAssetForTest(t, previewHandler, projectID, "first.mp4")
		second := uploadVideoAssetForTest(t, previewHandler, projectID, "second.mp4")
		third := uploadVideoAssetForTest(t, previewHandler, projectID, "third.mp4")
		episodePath := "/api/v1/workspace/episodes/" + url.PathEscape(documentID) + "?projectId=" + url.QueryEscape(projectID)
		payload := fmt.Sprintf(`{"episode":{"id":"episode-doc","title":"第一集","duration":30,"aspectRatio":"16:9","sections":[],"tracks":[{"id":"track-video","type":"video","label":"视频","clips":[{"id":"clip-1","title":"第一段","start":0,"end":10,"content":"第一段","status":"ready","videoUrl":%q},{"id":"clip-2","title":"第二段","start":10,"end":20,"content":"第二段","status":"ready","videoUrl":%q},{"id":"clip-3","title":"第三段","start":20,"end":30,"content":"第三段","status":"draft","videoUrl":%q}]}]}}`, first.URL, second.URL, third.URL)
		save := requestJSON(t, previewHandler, http.MethodPut, episodePath, payload)
		defer save.Body.Close()
		if save.StatusCode != http.StatusOK {
			t.Fatalf("save status code = %d, want %d: %s", save.StatusCode, http.StatusOK, readBody(t, save.Body))
		}

		stream := requestJSON(t, previewHandler, http.MethodGet, "/api/v1/projects/"+url.PathEscape(projectID)+"/workspace/episodes/"+url.PathEscape(documentID)+"/preview.mp4", "")
		defer stream.Body.Close()
		if stream.StatusCode != http.StatusOK {
			t.Fatalf("stream status code = %d, want %d: %s", stream.StatusCode, http.StatusOK, readBody(t, stream.Body))
		}
		if contentType := stream.Header.Get("Content-Type"); contentType != "video/mp4" {
			t.Fatalf("Content-Type = %q, want video/mp4", contentType)
		}
		if body := readBody(t, stream.Body); body != "rendered-mp4" {
			t.Fatalf("body = %q, want fake rendered preview file", body)
		}

		rangeRequest := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+url.PathEscape(projectID)+"/workspace/episodes/"+url.PathEscape(documentID)+"/preview.mp4", nil)
		rangeRequest.Header.Set("Range", "bytes=0-7")
		rangeRecorder := httptest.NewRecorder()
		previewHandler.ServeHTTP(rangeRecorder, rangeRequest)
		rangeResponse := rangeRecorder.Result()
		defer rangeResponse.Body.Close()
		if rangeResponse.StatusCode != http.StatusPartialContent {
			t.Fatalf("range status code = %d, want %d: %s", rangeResponse.StatusCode, http.StatusPartialContent, readBody(t, rangeResponse.Body))
		}
		if body := readBody(t, rangeResponse.Body); body != "rendered" {
			t.Fatalf("range body = %q, want rendered preview prefix", body)
		}
	})

	t.Run("projects can be created and keep isolated workspace state", func(t *testing.T) {
		projectDBPath := filepath.Join(t.TempDir(), "settings.db")
		projectHandler := newTestHandler(t, projectDBPath)

		list := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/projects", "")
		defer list.Body.Close()
		if list.StatusCode != http.StatusOK {
			t.Fatalf("list status code = %d, want %d", list.StatusCode, http.StatusOK)
		}
		body := readBody(t, list.Body)
		if !strings.Contains(body, `"projects":[]`) {
			t.Fatalf("body = %s, want empty project list", body)
		}
		workspaceDir := filepath.Join(filepath.Dir(projectDBPath), "workspace")
		for _, path := range []string{
			filepath.Join(workspaceDir, "media.workspace.json"),
			filepath.Join(workspaceDir, ".mediago-drama", "config", "workspace.json"),
			filepath.Join(workspaceDir, ".mediago-drama", "db", "app.db"),
			filepath.Join(workspaceDir, ".mediago-drama", "toolbox"),
			filepath.Join(workspaceDir, "library"),
			filepath.Join(workspaceDir, "projects"),
		} {
			assertPathExists(t, path)
		}
		for _, path := range []string{
			filepath.Join(workspaceDir, "library", "assets", "images"),
			filepath.Join(workspaceDir, "library", "assets", "video"),
			filepath.Join(workspaceDir, "library", "assets", "audio"),
			filepath.Join(workspaceDir, "library", "assets", "text"),
			filepath.Join(workspaceDir, "toolbox"),
		} {
			assertPathMissing(t, path)
		}

		nameOnlyCreate := requestJSON(t, projectHandler, http.MethodPost, "/api/v1/projects", `{"name":"无目录项目"}`)
		defer nameOnlyCreate.Body.Close()
		if nameOnlyCreate.StatusCode != http.StatusOK {
			t.Fatalf("name-only create status code = %d, want %d: %s", nameOnlyCreate.StatusCode, http.StatusOK, readBody(t, nameOnlyCreate.Body))
		}
		var nameOnlyEnvelope struct {
			Data workspaceProjectRecord `json:"data"`
		}
		if err := json.NewDecoder(nameOnlyCreate.Body).Decode(&nameOnlyEnvelope); err != nil {
			t.Fatalf("decoding name-only project response: %v", err)
		}
		if nameOnlyEnvelope.Data.ID == "" || nameOnlyEnvelope.Data.Name != "无目录项目" {
			t.Fatalf("project = %+v, want name-only project", nameOnlyEnvelope.Data)
		}
		if !strings.Contains(nameOnlyEnvelope.Data.ProjectDir, filepath.Join(workspaceDir, "projects")) {
			t.Fatalf("projectDir = %q, want default projects dir under workspace", nameOnlyEnvelope.Data.ProjectDir)
		}
		for _, path := range []string{
			filepath.Join(nameOnlyEnvelope.Data.ProjectDir, "project.media.json"),
			filepath.Join(nameOnlyEnvelope.Data.ProjectDir, "work"),
		} {
			assertPathExists(t, path)
		}
		assertPathMissing(t, filepath.Join(nameOnlyEnvelope.Data.ProjectDir, "assets"))

		selectedDir := filepath.Join(t.TempDir(), "episode-two")
		if err := os.MkdirAll(selectedDir, 0o755); err != nil {
			t.Fatalf("creating selected project dir: %v", err)
		}
		createPayload, err := json.Marshal(map[string]string{
			"name":        "第二集：地下仓库",
			"description": "测试项目隔离",
			"projectDir":  selectedDir,
		})
		if err != nil {
			t.Fatalf("encoding create project payload: %v", err)
		}
		create := requestJSON(t, projectHandler, http.MethodPost, "/api/v1/projects", string(createPayload))
		defer create.Body.Close()
		if create.StatusCode != http.StatusOK {
			t.Fatalf("create status code = %d, want %d: %s", create.StatusCode, http.StatusOK, readBody(t, create.Body))
		}
		var createEnvelope struct {
			Data workspaceProjectRecord `json:"data"`
		}
		if err := json.NewDecoder(create.Body).Decode(&createEnvelope); err != nil {
			t.Fatalf("decoding create project response: %v", err)
		}
		if createEnvelope.Data.ID == "" || createEnvelope.Data.Name != "第二集：地下仓库" || createEnvelope.Data.DocumentCount != 0 {
			t.Fatalf("project = %+v, want created project", createEnvelope.Data)
		}
		for _, path := range []string{
			filepath.Join(selectedDir, "project.media.json"),
			filepath.Join(selectedDir, "work"),
		} {
			assertPathExists(t, path)
		}
		assertPathMissing(t, filepath.Join(selectedDir, "assets"))
		configResponse := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID)+"/config", "")
		defer configResponse.Body.Close()
		if configResponse.StatusCode != http.StatusOK {
			t.Fatalf("config status code = %d, want %d: %s", configResponse.StatusCode, http.StatusOK, readBody(t, configResponse.Body))
		}
		var configEnvelope struct {
			Data mediamcp.ProjectConfig `json:"data"`
		}
		if err := json.NewDecoder(configResponse.Body).Decode(&configEnvelope); err != nil {
			t.Fatalf("decoding project config response: %v", err)
		}
		if configEnvelope.Data.SchemaVersion != 1 ||
			configEnvelope.Data.ProjectID != createEnvelope.Data.ID ||
			configEnvelope.Data.Name != createEnvelope.Data.Name ||
			configEnvelope.Data.Description != createEnvelope.Data.Description ||
			len(configEnvelope.Data.Overview.CategoryDefaults) != 0 {
			t.Fatalf("project config = %+v, want minimal project.media.json config", configEnvelope.Data)
		}
		configPatch := requestJSON(t, projectHandler, http.MethodPatch, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID)+"/config", `{"overview":{"categoryDefaults":{"extra":"video-cinematic-shot","style":"realistic"}}}`)
		defer configPatch.Body.Close()
		if configPatch.StatusCode != http.StatusOK {
			t.Fatalf("config patch status code = %d, want %d: %s", configPatch.StatusCode, http.StatusOK, readBody(t, configPatch.Body))
		}
		var configPatchEnvelope struct {
			Data struct {
				Config  mediamcp.ProjectConfig `json:"config"`
				Changed bool                   `json:"changed"`
			} `json:"data"`
		}
		if err := json.NewDecoder(configPatch.Body).Decode(&configPatchEnvelope); err != nil {
			t.Fatalf("decoding project config patch response: %v", err)
		}
		if !configPatchEnvelope.Data.Changed ||
			configPatchEnvelope.Data.Config.Overview.CategoryDefaults["extra"] != "video-cinematic-shot" ||
			configPatchEnvelope.Data.Config.Overview.CategoryDefaults["style"] != "" {
			t.Fatalf("project config patch = %+v, want changed category defaults", configPatchEnvelope.Data)
		}
		renameProject := requestJSON(t, projectHandler, http.MethodPatch, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID), `{"name":"第二集：改名后"}`)
		defer renameProject.Body.Close()
		if renameProject.StatusCode != http.StatusOK {
			t.Fatalf("rename project status code = %d, want %d: %s", renameProject.StatusCode, http.StatusOK, readBody(t, renameProject.Body))
		}
		var renameEnvelope struct {
			Data workspaceProjectRecord `json:"data"`
		}
		if err := json.NewDecoder(renameProject.Body).Decode(&renameEnvelope); err != nil {
			t.Fatalf("decoding rename project response: %v", err)
		}
		if renameEnvelope.Data.Name != "第二集：改名后" {
			t.Fatalf("renamed project = %+v, want new name", renameEnvelope.Data)
		}
		configAfterRename := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID)+"/config", "")
		defer configAfterRename.Body.Close()
		if configAfterRename.StatusCode != http.StatusOK {
			t.Fatalf("config after rename status code = %d, want %d: %s", configAfterRename.StatusCode, http.StatusOK, readBody(t, configAfterRename.Body))
		}
		var renamedConfigEnvelope struct {
			Data mediamcp.ProjectConfig `json:"data"`
		}
		if err := json.NewDecoder(configAfterRename.Body).Decode(&renamedConfigEnvelope); err != nil {
			t.Fatalf("decoding renamed project config response: %v", err)
		}
		if renamedConfigEnvelope.Data.Name != "第二集：改名后" {
			t.Fatalf("renamed project config = %+v, want new name", renamedConfigEnvelope.Data)
		}
		if _, err := os.Stat(filepath.Join(workspaceDir, "local-projects")); !os.IsNotExist(err) {
			t.Fatalf("deprecated workspace projects dir exists, err=%v", err)
		}

		projectStatePath := "/api/v1/workspace/state?projectId=" + url.QueryEscape(createEnvelope.Data.ID)
		initialProjectGet := requestJSON(t, projectHandler, http.MethodGet, projectStatePath, "")
		defer initialProjectGet.Body.Close()
		if initialProjectGet.StatusCode != http.StatusOK {
			t.Fatalf("initial project get status code = %d, want %d", initialProjectGet.StatusCode, http.StatusOK)
		}
		initialProjectBody := readBody(t, initialProjectGet.Body)
		if !strings.Contains(initialProjectBody, `"documents":[]`) ||
			strings.Contains(initialProjectBody, `"id":"overview"`) ||
			strings.Contains(initialProjectBody, `"title":"项目概览"`) ||
			strings.Contains(initialProjectBody, `"id":"doc-episode-one"`) ||
			strings.Contains(initialProjectBody, "林雾") ||
			strings.Contains(initialProjectBody, "doc-character-bible") {
			t.Fatalf("body = %s, want blank project workspace", initialProjectBody)
		}
		initialProjectDocuments := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/workspace/documents?projectId="+url.QueryEscape(createEnvelope.Data.ID), "")
		defer initialProjectDocuments.Body.Close()
		if initialProjectDocuments.StatusCode != http.StatusOK {
			t.Fatalf("initial project documents status code = %d, want %d", initialProjectDocuments.StatusCode, http.StatusOK)
		}
		initialProjectDocumentsBody := readBody(t, initialProjectDocuments.Body)
		if !strings.Contains(initialProjectDocumentsBody, `"documents":[]`) {
			t.Fatalf("body = %s, want no default editable documents", initialProjectDocumentsBody)
		}

		payload := `{"documents":[{"id":"doc-project","title":"Project Only","content":"# Project Only","updatedAt":"2026-05-18T00:00:00Z","isDirty":false,"comments":[]}],"operationLog":[]}`
		save := requestJSON(t, projectHandler, http.MethodPut, projectStatePath, payload)
		defer save.Body.Close()
		if save.StatusCode != http.StatusOK {
			t.Fatalf("save status code = %d, want %d: %s", save.StatusCode, http.StatusOK, readBody(t, save.Body))
		}

		projectGet := requestJSON(t, projectHandler, http.MethodGet, projectStatePath, "")
		defer projectGet.Body.Close()
		if projectGet.StatusCode != http.StatusOK {
			t.Fatalf("project get status code = %d, want %d", projectGet.StatusCode, http.StatusOK)
		}
		projectBody := readBody(t, projectGet.Body)
		if !strings.Contains(projectBody, `"id":"doc-project"`) ||
			!strings.Contains(projectBody, `"projectId":"`+createEnvelope.Data.ID+`"`) {
			t.Fatalf("body = %s, want project state", projectBody)
		}

		rootGet := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/workspace/state", "")
		defer rootGet.Body.Close()
		if rootBody := readBody(t, rootGet.Body); strings.Contains(rootBody, `"id":"doc-project"`) {
			t.Fatalf("body = %s, project document leaked into root workspace state", rootBody)
		}

		archiveProject := requestJSON(t, projectHandler, http.MethodPost, "/api/v1/projects/"+url.PathEscape(nameOnlyEnvelope.Data.ID)+"/archive", "")
		defer archiveProject.Body.Close()
		if archiveProject.StatusCode != http.StatusOK {
			t.Fatalf("archive project status code = %d, want %d: %s", archiveProject.StatusCode, http.StatusOK, readBody(t, archiveProject.Body))
		}
		archiveBody := readBody(t, archiveProject.Body)
		if !strings.Contains(archiveBody, `"status":"archived"`) || !strings.Contains(archiveBody, `"archivedAt"`) {
			t.Fatalf("body = %s, want archived project", archiveBody)
		}
		archivedProjects := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/projects?status=archived", "")
		defer archivedProjects.Body.Close()
		archivedProjectsBody := readBody(t, archivedProjects.Body)
		if !strings.Contains(archivedProjectsBody, `"id":"`+nameOnlyEnvelope.Data.ID+`"`) {
			t.Fatalf("body = %s, want archived project listed", archivedProjectsBody)
		}
		restoreArchived := requestJSON(t, projectHandler, http.MethodPost, "/api/v1/projects/"+url.PathEscape(nameOnlyEnvelope.Data.ID)+"/restore", "")
		defer restoreArchived.Body.Close()
		if restoreArchived.StatusCode != http.StatusOK {
			t.Fatalf("restore archived status code = %d, want %d: %s", restoreArchived.StatusCode, http.StatusOK, readBody(t, restoreArchived.Body))
		}
		restoreArchivedBody := readBody(t, restoreArchived.Body)
		if !strings.Contains(restoreArchivedBody, `"status":"active"`) {
			t.Fatalf("body = %s, want restored archived project", restoreArchivedBody)
		}

		deleteProject := requestJSON(t, projectHandler, http.MethodDelete, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID), "")
		defer deleteProject.Body.Close()
		if deleteProject.StatusCode != http.StatusOK {
			t.Fatalf("delete project status code = %d, want %d: %s", deleteProject.StatusCode, http.StatusOK, readBody(t, deleteProject.Body))
		}
		var deleteEnvelope struct {
			Data workspaceProjectRecord `json:"data"`
		}
		if err := json.NewDecoder(deleteProject.Body).Decode(&deleteEnvelope); err != nil {
			t.Fatalf("decoding delete project response: %v", err)
		}
		if deleteEnvelope.Data.ID != createEnvelope.Data.ID ||
			deleteEnvelope.Data.Status != "trashed" ||
			deleteEnvelope.Data.OriginalProjectDir != selectedDir ||
			deleteEnvelope.Data.TrashProjectDir == "" {
			t.Fatalf("delete project = %+v, want trashed project metadata", deleteEnvelope.Data)
		}
		assertPathMissing(t, selectedDir)
		assertPathExists(t, deleteEnvelope.Data.TrashProjectDir)

		listAfterDelete := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/projects", "")
		defer listAfterDelete.Body.Close()
		listAfterDeleteBody := readBody(t, listAfterDelete.Body)
		if strings.Contains(listAfterDeleteBody, createEnvelope.Data.ID) {
			t.Fatalf("body = %s, deleted project is still listed", listAfterDeleteBody)
		}

		trashList := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/projects?status=trashed", "")
		defer trashList.Body.Close()
		if trashList.StatusCode != http.StatusOK {
			t.Fatalf("trash list status code = %d, want %d: %s", trashList.StatusCode, http.StatusOK, readBody(t, trashList.Body))
		}
		trashListBody := readBody(t, trashList.Body)
		if !strings.Contains(trashListBody, `"status":"trashed"`) ||
			!strings.Contains(trashListBody, `"id":"`+createEnvelope.Data.ID+`"`) {
			t.Fatalf("body = %s, want trashed project", trashListBody)
		}

		deleteMissing := requestJSON(t, projectHandler, http.MethodDelete, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID), "")
		defer deleteMissing.Body.Close()
		if deleteMissing.StatusCode != http.StatusNotFound {
			t.Fatalf("delete missing status code = %d, want %d: %s", deleteMissing.StatusCode, http.StatusNotFound, readBody(t, deleteMissing.Body))
		}

		restoreProject := requestJSON(t, projectHandler, http.MethodPost, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID)+"/restore", "")
		defer restoreProject.Body.Close()
		if restoreProject.StatusCode != http.StatusOK {
			t.Fatalf("restore project status code = %d, want %d: %s", restoreProject.StatusCode, http.StatusOK, readBody(t, restoreProject.Body))
		}
		var restoreEnvelope struct {
			Data workspaceProjectRecord `json:"data"`
		}
		if err := json.NewDecoder(restoreProject.Body).Decode(&restoreEnvelope); err != nil {
			t.Fatalf("decoding restore response: %v", err)
		}
		if restoreEnvelope.Data.Status != "active" || restoreEnvelope.Data.ProjectDir != selectedDir || restoreEnvelope.Data.TrashProjectDir != "" {
			t.Fatalf("restored project = %+v, want active project at original directory", restoreEnvelope.Data)
		}
		assertPathExists(t, selectedDir)
		assertPathMissing(t, deleteEnvelope.Data.TrashProjectDir)

		permanentActive := requestJSON(t, projectHandler, http.MethodDelete, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID)+"/permanent", "")
		defer permanentActive.Body.Close()
		if permanentActive.StatusCode != http.StatusConflict {
			t.Fatalf("permanent active status code = %d, want %d: %s", permanentActive.StatusCode, http.StatusConflict, readBody(t, permanentActive.Body))
		}

		deleteAgain := requestJSON(t, projectHandler, http.MethodDelete, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID), "")
		defer deleteAgain.Body.Close()
		if deleteAgain.StatusCode != http.StatusOK {
			t.Fatalf("delete again status code = %d, want %d: %s", deleteAgain.StatusCode, http.StatusOK, readBody(t, deleteAgain.Body))
		}
		var deleteAgainEnvelope struct {
			Data workspaceProjectRecord `json:"data"`
		}
		if err := json.NewDecoder(deleteAgain.Body).Decode(&deleteAgainEnvelope); err != nil {
			t.Fatalf("decoding delete again response: %v", err)
		}
		permanentDelete := requestJSON(t, projectHandler, http.MethodDelete, "/api/v1/projects/"+url.PathEscape(createEnvelope.Data.ID)+"/permanent", "")
		defer permanentDelete.Body.Close()
		if permanentDelete.StatusCode != http.StatusOK {
			t.Fatalf("permanent delete status code = %d, want %d: %s", permanentDelete.StatusCode, http.StatusOK, readBody(t, permanentDelete.Body))
		}
		assertPathMissing(t, deleteAgainEnvelope.Data.TrashProjectDir)
		trashAfterPermanent := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/projects?status=trashed", "")
		defer trashAfterPermanent.Body.Close()
		trashAfterPermanentBody := readBody(t, trashAfterPermanent.Body)
		if strings.Contains(trashAfterPermanentBody, createEnvelope.Data.ID) {
			t.Fatalf("body = %s, permanently deleted project still in trash", trashAfterPermanentBody)
		}
	})

	t.Run("project can use selected folder as project directory", func(t *testing.T) {
		projectDBPath := filepath.Join(t.TempDir(), "settings.db")
		projectHandler := newTestHandler(t, projectDBPath)
		selectedDir := filepath.Join(t.TempDir(), "Folder A")
		if err := os.MkdirAll(selectedDir, 0o755); err != nil {
			t.Fatalf("creating selected project dir: %v", err)
		}
		payload, err := json.Marshal(map[string]string{"projectDir": selectedDir})
		if err != nil {
			t.Fatalf("encoding create payload: %v", err)
		}

		create := requestJSON(t, projectHandler, http.MethodPost, "/api/v1/projects", string(payload))
		defer create.Body.Close()
		if create.StatusCode != http.StatusOK {
			t.Fatalf("create status code = %d, want %d: %s", create.StatusCode, http.StatusOK, readBody(t, create.Body))
		}
		var createEnvelope struct {
			Data workspaceProjectRecord `json:"data"`
		}
		if err := json.NewDecoder(create.Body).Decode(&createEnvelope); err != nil {
			t.Fatalf("decoding create project response: %v", err)
		}
		if createEnvelope.Data.Name != "Folder A" || createEnvelope.Data.ProjectDir != filepath.Clean(selectedDir) {
			t.Fatalf("project = %+v, want selected folder metadata", createEnvelope.Data)
		}
		for _, path := range []string{
			filepath.Join(selectedDir, "project.media.json"),
			filepath.Join(selectedDir, "work"),
		} {
			assertPathExists(t, path)
		}
		assertPathMissing(t, filepath.Join(selectedDir, "assets"))

		state := requestJSON(t, projectHandler, http.MethodGet, "/api/v1/workspace/state?projectId="+url.QueryEscape(createEnvelope.Data.ID), "")
		defer state.Body.Close()
		if state.StatusCode != http.StatusOK {
			t.Fatalf("state status code = %d, want %d: %s", state.StatusCode, http.StatusOK, readBody(t, state.Body))
		}
		var stateEnvelope struct {
			Data workspaceStateResponse `json:"data"`
		}
		if err := json.NewDecoder(state.Body).Decode(&stateEnvelope); err != nil {
			t.Fatalf("decoding state response: %v", err)
		}
		if stateEnvelope.Data.WorkspaceDir != filepath.Clean(selectedDir) {
			t.Fatalf("workspaceDir = %q, want %q", stateEnvelope.Data.WorkspaceDir, filepath.Clean(selectedDir))
		}
		save := requestJSON(t, projectHandler, http.MethodPut, "/api/v1/workspace/state?projectId="+url.QueryEscape(createEnvelope.Data.ID), `{"documents":[{"id":"doc-external","title":"External","content":"# External","updatedAt":"2026-05-18T00:00:00Z","isDirty":false,"comments":[]}],"operationLog":[]}`)
		defer save.Body.Close()
		if save.StatusCode != http.StatusOK {
			t.Fatalf("save status code = %d, want %d: %s", save.StatusCode, http.StatusOK, readBody(t, save.Body))
		}
		assertPathExists(t, filepath.Join(selectedDir, "work", "External.md"))
	})

	t.Run("document operations endpoint returns operation protocol", func(t *testing.T) {
		response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/document-operations", `{"prompt":"帮我生成角色","document":{"id":"doc-test","title":"Episode Test","content":"# Episode Test"}}`)
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusOK)
		}
		body := readBody(t, response.Body)
		if !strings.Contains(body, `"operations"`) ||
			!strings.Contains(body, `"type":"insert_markdown"`) ||
			!strings.Contains(body, `"payload"`) ||
			!strings.Contains(body, `"runtime":"mock"`) {
			t.Fatalf("body = %s, want document operation response", body)
		}
	})

	t.Run("document operations passes project id to runner", func(t *testing.T) {
		requests := make(chan documentOperationsRequest, 1)
		projectHandler := NewHandlerWithConfig(
			fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
			Config{
				SettingsDBPath:          filepath.Join(t.TempDir(), "settings.db"),
				WorkspaceDir:            filepath.Join(t.TempDir(), "workspace"),
				DisableGenerationWorker: true,
				agentRunner:             fakeAgentRunner{},
				documentOperationRunner: recordingDocumentOperationRunner{requests: requests},
			},
		)
		closeTestHandler(t, projectHandler)
		response := requestJSON(t, projectHandler, http.MethodPost, "/api/v1/agent/document-operations", `{"projectId":"project-doc-ops","prompt":"帮我生成角色","document":{"id":"doc-test","title":"Episode Test","content":"# Episode Test"}}`)
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
		}
		select {
		case request := <-requests:
			if request.ProjectID != "project-doc-ops" {
				t.Fatalf("projectID = %q, want project-doc-ops", request.ProjectID)
			}
		default:
			t.Fatal("document operation runner was not called")
		}
	})

	t.Run("document operations endpoint falls back after invalid runner response", func(t *testing.T) {
		fallbackHandler := NewHandlerWithConfig(
			fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
			Config{
				SettingsDBPath:          filepath.Join(t.TempDir(), "settings.db"),
				WorkspaceDir:            filepath.Join(t.TempDir(), "workspace"),
				DisableGenerationWorker: true,
				agentRunner:             fakeAgentRunner{},
				documentOperationRunner: invalidDocumentOperationRunner{},
			},
		)
		closeTestHandler(t, fallbackHandler)

		response := requestJSON(t, fallbackHandler, http.MethodPost, "/api/v1/agent/document-operations", `{"prompt":"帮我生成角色","document":{"id":"doc-test","title":"Episode Test","content":"# Episode Test"}}`)
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusOK)
		}
		body := readBody(t, response.Body)
		if !strings.Contains(body, "模拟备用") ||
			!strings.Contains(body, `"type":"insert_markdown"`) ||
			!strings.Contains(body, `"runtime":"mock"`) ||
			!strings.Contains(body, `"fallback":true`) {
			t.Fatalf("body = %s, want mock fallback operation response", body)
		}
	})

	t.Run("document operations runtime test returns metadata", func(t *testing.T) {
		response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/document-operations/test", "")
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusOK)
		}
		body := readBody(t, response.Body)
		if !strings.Contains(body, `"runtime":"mock"`) || !strings.Contains(body, `"validated":true`) {
			t.Fatalf("body = %s, want mock runtime metadata", body)
		}
	})

	t.Run("create session", func(t *testing.T) {
		response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/session", "")
		defer response.Body.Close()

		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusOK)
		}

		var envelope struct {
			Data sessionResponse `json:"data"`
		}
		if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
			t.Fatalf("decoding response: %v", err)
		}
		if envelope.Data.SessionID == "" {
			t.Fatal("sessionId is empty")
		}
	})

	t.Run("message requires session", func(t *testing.T) {
		response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/message", `{"prompt":"hello"}`)
		defer response.Body.Close()

		if response.StatusCode != http.StatusConflict {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusConflict)
		}
	})

	t.Run("message accepted", func(t *testing.T) {
		sessionID := createAgentSessionForProject(t, handler, "")
		response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/message", `{"sessionId":"`+sessionID+`","prompt":"hello"}`)
		defer response.Body.Close()

		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusOK)
		}

		body := readBody(t, response.Body)
		if !strings.Contains(body, `"accepted":true`) {
			t.Fatalf("body = %s, want accepted true", body)
		}
		waitForAgentSessionStatus(t, handler, sessionID, "completed")
	})

	t.Run("message passes runtime config selections to runner", func(t *testing.T) {
		requests := make(chan agentRunRequest, 1)
		agentHandler := NewHandlerWithConfig(
			fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
			Config{
				SettingsDBPath:          filepath.Join(t.TempDir(), "settings.db"),
				WorkspaceDir:            filepath.Join(t.TempDir(), "workspace"),
				DisableGenerationWorker: true,
				agentRunner:             recordingAgentRunner{requests: requests},
				documentOperationRunner: fakeDocumentOperationRunner{},
			},
		)
		closeTestHandler(t, agentHandler)
		sessionID := createAgentSessionForProject(t, agentHandler, "")
		payload := `{"sessionId":"` + sessionID + `","prompt":"hello","model":{"source":"model","value":"gpt-5"},"reasoning":{"source":"configOption","configId":"reasoning_effort","value":"high"},"permission":{"source":"mode","value":"ask"}}`
		response := requestJSON(t, agentHandler, http.MethodPost, "/api/v1/agent/message", payload)
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
		}
		select {
		case request := <-requests:
			if request.Model.Value != "gpt-5" || request.Reasoning.ConfigID != "reasoning_effort" || request.Permission.Value != "ask" {
				t.Fatalf("runtime config selections = %#v %#v %#v, want model/reasoning/permission", request.Model, request.Reasoning, request.Permission)
			}
		case <-time.After(time.Second):
			t.Fatal("agent runner was not called")
		}
		waitForAgentSessionStatus(t, agentHandler, sessionID, "completed")
	})

	t.Run("message accepts document category context", func(t *testing.T) {
		requests := make(chan agentRunRequest, 1)
		agentHandler := NewHandlerWithConfig(
			fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
			Config{
				SettingsDBPath:          filepath.Join(t.TempDir(), "settings.db"),
				WorkspaceDir:            filepath.Join(t.TempDir(), "workspace"),
				DisableGenerationWorker: true,
				agentRunner:             recordingAgentRunner{requests: requests},
				documentOperationRunner: fakeDocumentOperationRunner{},
			},
		)
		closeTestHandler(t, agentHandler)
		sessionID := createAgentSessionForProject(t, agentHandler, "")
		payload := `{"sessionId":"` + sessionID + `","prompt":"hello","document":{"id":"doc-1","title":"剧本","content":"# 剧本","category":"screenplay"},"documents":[{"id":"doc-1","title":"剧本","content":"# 剧本","category":"screenplay","version":1}]}`
		response := requestJSON(t, agentHandler, http.MethodPost, "/api/v1/agent/message", payload)
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
		}
		select {
		case request := <-requests:
			if request.Document == nil || request.Document.Category != "screenplay" {
				t.Fatalf("document category = %#v, want screenplay", request.Document)
			}
			if len(request.Documents) != 1 || request.Documents[0].Category != "screenplay" {
				t.Fatalf("documents = %#v, want screenplay category context", request.Documents)
			}
		case <-time.After(time.Second):
			t.Fatal("agent runner was not called")
		}
		waitForAgentSessionStatus(t, agentHandler, sessionID, "completed")
	})

	t.Run("message uses backend-owned fixed system prompt", func(t *testing.T) {
		requests := make(chan agentRunRequest, 1)
		workspaceDir := filepath.Join(t.TempDir(), "workspace")
		agentHandler := NewHandlerWithConfig(
			fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
			Config{
				SettingsDBPath:          filepath.Join(t.TempDir(), "settings.db"),
				WorkspaceDir:            workspaceDir,
				DisableGenerationWorker: true,
				agentRunner:             recordingAgentRunner{requests: requests},
				documentOperationRunner: fakeDocumentOperationRunner{},
			},
		)
		closeTestHandler(t, agentHandler)
		sessionID := createAgentSessionForProject(t, agentHandler, "")
		response := requestJSON(t, agentHandler, http.MethodPost, "/api/v1/agent/message", `{"sessionId":"`+sessionID+`","prompt":"hello"}`)
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
		}
		select {
		case request := <-requests:
			if request.Prompt != "hello" {
				t.Fatalf("prompt = %q, want plain task prompt", request.Prompt)
			}
			if request.SystemPrompt != "" {
				t.Fatalf("systemPrompt = %q, want backend-owned prompt path", request.SystemPrompt)
			}
			if request.WorkspaceDir != filepath.Clean(workspaceDir) {
				t.Fatalf("workspaceDir = %q, want %q", request.WorkspaceDir, filepath.Clean(workspaceDir))
			}
		case <-time.After(time.Second):
			t.Fatal("agent runner was not called")
		}
		waitForAgentSessionStatus(t, agentHandler, sessionID, "completed")
	})

	t.Run("message passes project directory to runner", func(t *testing.T) {
		requests := make(chan agentRunRequest, 1)
		workspaceDir := filepath.Join(t.TempDir(), "workspace")
		agentHandler := NewHandlerWithConfig(
			fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
			Config{
				SettingsDBPath:          filepath.Join(t.TempDir(), "settings.db"),
				WorkspaceDir:            workspaceDir,
				DisableGenerationWorker: true,
				agentRunner:             recordingAgentRunner{requests: requests},
				documentOperationRunner: fakeDocumentOperationRunner{},
			},
		)
		closeTestHandler(t, agentHandler)
		project, projectDir := createExternalProjectForTest(t, agentHandler, "Agent Cwd")
		sessionID := createAgentSessionForProject(t, agentHandler, project.ID)
		payload, err := json.Marshal(map[string]string{
			"sessionId": sessionID,
			"projectId": project.ID,
			"prompt":    "hello",
		})
		if err != nil {
			t.Fatalf("encoding agent payload: %v", err)
		}
		response := requestJSON(t, agentHandler, http.MethodPost, "/api/v1/agent/message", string(payload))
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
		}
		select {
		case request := <-requests:
			if request.WorkspaceDir != filepath.Clean(workspaceDir) {
				t.Fatalf("workspaceDir = %q, want %q", request.WorkspaceDir, filepath.Clean(workspaceDir))
			}
			if request.ProjectDir != filepath.Clean(projectDir) {
				t.Fatalf("projectDir = %q, want %q", request.ProjectDir, filepath.Clean(projectDir))
			}
			if request.WorkingDir != filepath.Join(filepath.Clean(projectDir), "work") {
				t.Fatalf("workingDir = %q, want %q", request.WorkingDir, filepath.Join(filepath.Clean(projectDir), "work"))
			}
		case <-time.After(time.Second):
			t.Fatal("agent runner was not called")
		}
		waitForAgentSessionStatus(t, agentHandler, sessionID, "completed")
	})

	t.Run("message rejects project mismatch", func(t *testing.T) {
		sessionID := createAgentSessionForProject(t, handler, "project-a")
		response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/message", `{"sessionId":"`+sessionID+`","projectId":"project-b","prompt":"hello"}`)
		defer response.Body.Close()

		if response.StatusCode != http.StatusConflict {
			t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusConflict, readBody(t, response.Body))
		}
	})

	t.Run("agent session status reports run completion", func(t *testing.T) {
		sessionID := createAgentSessionForProject(t, handler, "")
		response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/message", `{"sessionId":"`+sessionID+`","prompt":"hello"}`)
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusOK)
		}

		for range 20 {
			status := requestJSON(t, handler, http.MethodGet, "/api/v1/agent/session/"+sessionID+"/status", "")
			body := readBody(t, status.Body)
			status.Body.Close()
			if status.StatusCode != http.StatusOK {
				t.Fatalf("status code = %d, want %d: %s", status.StatusCode, http.StatusOK, body)
			}
			if strings.Contains(body, `"running":false`) && strings.Contains(body, `"lastStatus":"completed"`) {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}

		t.Fatal("agent session did not report completed status")
	})

	t.Run("agent chat persists by project", func(t *testing.T) {
		project, projectDir := createExternalProjectForTest(t, handler, "Agent Chat")
		projectID := project.ID
		payload := `{"messages":[{"id":"msg-user","role":"user","content":"写一个开场","kind":"message","createdAt":"2026-05-18T00:00:00Z","status":"complete"},{"id":"msg-agent","role":"assistant","content":"已读取文档。","kind":"tool","title":"读取文档","createdAt":"2026-05-18T00:00:01Z","status":"complete","metadata":{"toolName":"读取文档","outputResult":"已读取当前文档。"}}]}`
		appendResponse := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/chat/append?projectId="+url.QueryEscape(projectID), payload)
		defer appendResponse.Body.Close()
		if appendResponse.StatusCode != http.StatusOK {
			t.Fatalf("append status code = %d, want %d: %s", appendResponse.StatusCode, http.StatusOK, readBody(t, appendResponse.Body))
		}

		get := requestJSON(t, handler, http.MethodGet, "/api/v1/agent/chat?projectId="+url.QueryEscape(projectID), "")
		defer get.Body.Close()
		body := readBody(t, get.Body)
		if !strings.Contains(body, `"projectId":"`+projectID+`"`) ||
			!strings.Contains(body, `"id":"msg-user"`) ||
			!strings.Contains(body, `"kind":"tool"`) ||
			!strings.Contains(body, `"toolName":"读取文档"`) {
			t.Fatalf("body = %s, want persisted agent chat", body)
		}

		historyPath := filepath.Join(projectDir, "agent-history.jsonl")
		history, err := os.ReadFile(historyPath)
		if err != nil {
			t.Fatalf("reading agent history file: %v", err)
		}
		if lines := strings.Count(strings.TrimSpace(string(history)), "\n") + 1; lines != 2 {
			t.Fatalf("history file line count = %d, want 2: %s", lines, string(history))
		}

		other := requestJSON(t, handler, http.MethodGet, "/api/v1/agent/chat?projectId=other-project", "")
		defer other.Body.Close()
		if otherBody := readBody(t, other.Body); strings.Contains(otherBody, "msg-user") {
			t.Fatalf("body = %s, agent chat leaked into another project", otherBody)
		}

		clear := requestJSON(t, handler, http.MethodDelete, "/api/v1/agent/chat?projectId="+url.QueryEscape(projectID), "")
		defer clear.Body.Close()
		if clear.StatusCode != http.StatusOK {
			t.Fatalf("clear status code = %d, want %d: %s", clear.StatusCode, http.StatusOK, readBody(t, clear.Body))
		}
		clearedHistory, err := os.ReadFile(historyPath)
		if err != nil {
			t.Fatalf("reading cleared agent history file: %v", err)
		}
		if string(clearedHistory) != "" {
			t.Fatalf("cleared history = %q, want empty file", string(clearedHistory))
		}
	})

	t.Run("generation message reports missing provider", func(t *testing.T) {
		response := requestJSON(t, handler, http.MethodPost, "/api/v1/generation/sessions/studio/messages", `{"kind":"image","prompt":"make an image"}`)
		defer response.Body.Close()

		if response.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusServiceUnavailable)
		}

		body := readBody(t, response.Body)
		if !strings.Contains(body, `"message":"internal error"`) || strings.Contains(body, "DMX API Key 尚未配置") {
			t.Fatalf("body = %s, want sanitized missing api key error", body)
		}
	})

	t.Run("generation models returns catalog", func(t *testing.T) {
		response := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/models", "")
		defer response.Body.Close()

		if response.StatusCode != http.StatusOK {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusOK)
		}

		body := readBody(t, response.Body)
		if !strings.Contains(body, `"id":"seedream-5-lite"`) || !strings.Contains(body, `"id":"jimeng-seedance-2-fast"`) {
			t.Fatalf("body = %s, want generation model catalog", body)
		}
	})

	t.Run("media assets upload list content delete", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, err := writer.CreateFormFile("file", "reference.png")
		if err != nil {
			t.Fatalf("creating multipart file: %v", err)
		}
		if _, err := part.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}); err != nil {
			t.Fatalf("writing multipart file: %v", err)
		}
		if err := writer.Close(); err != nil {
			t.Fatalf("closing multipart writer: %v", err)
		}

		upload := httptest.NewRequest(http.MethodPost, "/api/v1/media-assets", body)
		upload.Header.Set("Content-Type", writer.FormDataContentType())
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, upload)
		response := recorder.Result()
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("upload status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
		}

		var envelope struct {
			Data servicemedia.MediaAsset `json:"data"`
		}
		if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
			t.Fatalf("decoding upload response: %v", err)
		}
		if envelope.Data.ID == "" || envelope.Data.Kind != "image" || envelope.Data.URL == "" {
			t.Fatalf("asset = %+v, want uploaded image asset", envelope.Data)
		}

		list := requestJSON(t, handler, http.MethodGet, "/api/v1/media-assets", "")
		defer list.Body.Close()
		if list.StatusCode != http.StatusOK {
			t.Fatalf("list status code = %d, want %d", list.StatusCode, http.StatusOK)
		}
		if listBody := readBody(t, list.Body); !strings.Contains(listBody, envelope.Data.ID) {
			t.Fatalf("body = %s, want uploaded asset", listBody)
		}

		update := requestJSON(t, handler, http.MethodPut, "/api/v1/media-assets/"+url.PathEscape(envelope.Data.ID), `{"filename":"renamed.png"}`)
		defer update.Body.Close()
		if update.StatusCode != http.StatusOK {
			t.Fatalf("update status code = %d, want %d", update.StatusCode, http.StatusOK)
		}
		if updateBody := readBody(t, update.Body); !strings.Contains(updateBody, `"filename":"renamed.png"`) {
			t.Fatalf("body = %s, want renamed asset", updateBody)
		}

		content := requestJSON(t, handler, http.MethodGet, envelope.Data.URL, "")
		defer content.Body.Close()
		if content.StatusCode != http.StatusOK || content.Header.Get("Content-Type") != "image/png" {
			t.Fatalf("content status = %d content-type = %q", content.StatusCode, content.Header.Get("Content-Type"))
		}

		remove := requestJSON(t, handler, http.MethodDelete, "/api/v1/media-assets/"+url.PathEscape(envelope.Data.ID), "")
		defer remove.Body.Close()
		if remove.StatusCode != http.StatusOK {
			t.Fatalf("delete status code = %d, want %d", remove.StatusCode, http.StatusOK)
		}
	})

	t.Run("project assets upload list state content update delete", func(t *testing.T) {
		project, _ := createExternalProjectForTest(t, handler, "Project Assets")
		projectID := project.ID
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, err := writer.CreateFormFile("file", "notes.txt")
		if err != nil {
			t.Fatalf("creating multipart file: %v", err)
		}
		if _, err := part.Write([]byte("reference notes")); err != nil {
			t.Fatalf("writing multipart file: %v", err)
		}
		if err := writer.Close(); err != nil {
			t.Fatalf("closing multipart writer: %v", err)
		}

		upload := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+url.PathEscape(projectID)+"/assets", body)
		upload.Header.Set("Content-Type", writer.FormDataContentType())
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, upload)
		response := recorder.Result()
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("upload status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
		}

		var envelope struct {
			Data struct {
				ID       string `json:"id"`
				Kind     string `json:"kind"`
				Filename string `json:"filename"`
				URL      string `json:"url"`
			} `json:"data"`
		}
		if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
			t.Fatalf("decoding project asset upload response: %v", err)
		}
		if envelope.Data.ID == "" || envelope.Data.Kind != "text" || envelope.Data.URL == "" {
			t.Fatalf("asset = %+v, want uploaded text project asset", envelope.Data)
		}

		list := requestJSON(t, handler, http.MethodGet, "/api/v1/projects/"+url.PathEscape(projectID)+"/assets", "")
		defer list.Body.Close()
		if list.StatusCode != http.StatusOK {
			t.Fatalf("list status code = %d, want %d: %s", list.StatusCode, http.StatusOK, readBody(t, list.Body))
		}
		if listBody := readBody(t, list.Body); !strings.Contains(listBody, envelope.Data.ID) || !strings.Contains(listBody, `"filename":"notes.txt"`) {
			t.Fatalf("body = %s, want uploaded project asset", listBody)
		}

		state := requestJSON(t, handler, http.MethodGet, "/api/v1/workspace/documents?projectId="+url.QueryEscape(projectID), "")
		defer state.Body.Close()
		if state.StatusCode != http.StatusOK {
			t.Fatalf("state status code = %d, want %d: %s", state.StatusCode, http.StatusOK, readBody(t, state.Body))
		}
		if stateBody := readBody(t, state.Body); !strings.Contains(stateBody, `"assets":[`) || !strings.Contains(stateBody, envelope.Data.ID) {
			t.Fatalf("body = %s, want project assets in workspace documents payload", stateBody)
		}

		otherProject, _ := createExternalProjectForTest(t, handler, "Other Project Assets")
		otherState := requestJSON(t, handler, http.MethodGet, "/api/v1/workspace/documents?projectId="+url.QueryEscape(otherProject.ID), "")
		defer otherState.Body.Close()
		if otherBody := readBody(t, otherState.Body); strings.Contains(otherBody, envelope.Data.ID) {
			t.Fatalf("body = %s, should not include another project's asset", otherBody)
		}

		content := requestJSON(t, handler, http.MethodGet, envelope.Data.URL, "")
		defer content.Body.Close()
		if content.StatusCode != http.StatusOK || content.Header.Get("Content-Type") != "text/plain" {
			t.Fatalf("content status = %d content-type = %q", content.StatusCode, content.Header.Get("Content-Type"))
		}

		update := requestJSON(t, handler, http.MethodPut, "/api/v1/projects/"+url.PathEscape(projectID)+"/assets/"+url.PathEscape(envelope.Data.ID), `{"filename":"renamed"}`)
		defer update.Body.Close()
		if update.StatusCode != http.StatusOK {
			t.Fatalf("update status code = %d, want %d: %s", update.StatusCode, http.StatusOK, readBody(t, update.Body))
		}
		if updateBody := readBody(t, update.Body); !strings.Contains(updateBody, `"filename":"renamed.txt"`) {
			t.Fatalf("body = %s, want renamed asset preserving extension", updateBody)
		}

		remove := requestJSON(t, handler, http.MethodDelete, "/api/v1/projects/"+url.PathEscape(projectID)+"/assets/"+url.PathEscape(envelope.Data.ID), "")
		defer remove.Body.Close()
		if remove.StatusCode != http.StatusOK {
			t.Fatalf("delete status code = %d, want %d: %s", remove.StatusCode, http.StatusOK, readBody(t, remove.Body))
		}
		if deleteBody := readBody(t, remove.Body); strings.Contains(deleteBody, envelope.Data.ID) {
			t.Fatalf("body = %s, want deleted asset removed from list", deleteBody)
		}
	})

	t.Run("generation tasks returns persisted tasks", func(t *testing.T) {
		taskID := "official.seedance-2.0-fast:task-api"
		store := servicegeneration.NewGenerationTaskService(testWorkspaceDBPathForSettings(dbPath), randomID)
		createConversation := requestJSON(t, handler, http.MethodPost, "/api/v1/generation/sessions", `{"kind":"video","title":"Video session"}`)
		defer createConversation.Body.Close()
		if createConversation.StatusCode != http.StatusOK {
			t.Fatalf("create conversation status code = %d, want %d", createConversation.StatusCode, http.StatusOK)
		}
		var conversationEnvelope struct {
			Data servicegeneration.GenerationConversationRecord `json:"data"`
		}
		if err := json.NewDecoder(createConversation.Body).Decode(&conversationEnvelope); err != nil {
			t.Fatalf("decoding conversation response: %v", err)
		}
		conversation := conversationEnvelope.Data
		if !strings.HasPrefix(conversation.ID, "session-") {
			t.Fatalf("conversation id = %q, want session prefix", conversation.ID)
		}
		if err := store.Upsert(generationTaskRecord{
			ID:             taskID,
			ConversationID: conversation.ID,
			Kind:           "video",
			RouteID:        "official.seedance-2.0-fast",
			FamilyID:       "seedance",
			VersionID:      "seedance-2.0-fast",
			Provider:       "volcengine",
			ModelID:        "jimeng-seedance-2-fast",
			Model:          "doubao-seedance-2-0-fast-260128",
			Prompt:         "make a video",
			Params:         map[string]any{"duration": float64(5)},
			Status:         "submitted",
			Message:        "Video generation task was submitted.",
		}); err != nil {
			t.Fatalf("seeding task: %v", err)
		}

		conversationList := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/sessions?kind=video", "")
		defer conversationList.Body.Close()
		if conversationList.StatusCode != http.StatusOK {
			t.Fatalf("conversation list status code = %d, want %d", conversationList.StatusCode, http.StatusOK)
		}
		conversationListBody := readBody(t, conversationList.Body)
		if !strings.Contains(conversationListBody, conversation.ID) ||
			!strings.Contains(conversationListBody, `"kind":"video"`) ||
			!strings.Contains(conversationListBody, `"scopeId":"studio"`) {
			t.Fatalf("body = %s, want persisted video conversation", conversationListBody)
		}

		list := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/tasks", "")
		defer list.Body.Close()
		if list.StatusCode != http.StatusOK {
			t.Fatalf("list status code = %d, want %d", list.StatusCode, http.StatusOK)
		}
		listBody := readBody(t, list.Body)
		if !strings.Contains(listBody, taskID) || !strings.Contains(listBody, `"prompt":"make a video"`) {
			t.Fatalf("body = %s, want persisted generation task", listBody)
		}
		filtered := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/sessions/"+url.PathEscape(conversation.ID)+"/tasks?kind=video", "")
		defer filtered.Body.Close()
		if filtered.StatusCode != http.StatusOK {
			t.Fatalf("filtered status code = %d, want %d", filtered.StatusCode, http.StatusOK)
		}
		filteredBody := readBody(t, filtered.Body)
		if !strings.Contains(filteredBody, taskID) || strings.Contains(filteredBody, "make an image") {
			t.Fatalf("body = %s, want generation task filtered by conversation", filteredBody)
		}

		project, _ := createExternalProjectForTest(t, handler, "Project Generation")
		projectSessionID := project.ID
		projectImageA := uploadImageAssetForTest(t, handler, projectSessionID, "project-a.png")
		projectImageB := uploadImageAssetForTest(t, handler, projectSessionID, "project-b.png")
		createProjectConversationPayload, err := json.Marshal(map[string]any{
			"sessionId": projectSessionID,
			"scopeId":   "agent",
			"kind":      "image",
			"title":     "Project image session",
		})
		if err != nil {
			t.Fatalf("encoding project conversation payload: %v", err)
		}
		createProjectConversation := requestJSON(t, handler, http.MethodPost, "/api/v1/generation/sessions", string(createProjectConversationPayload))
		defer createProjectConversation.Body.Close()
		if createProjectConversation.StatusCode != http.StatusOK {
			t.Fatalf("create project conversation status code = %d, want %d", createProjectConversation.StatusCode, http.StatusOK)
		}
		var projectConversationEnvelope struct {
			Data servicegeneration.GenerationConversationRecord `json:"data"`
		}
		if err := json.NewDecoder(createProjectConversation.Body).Decode(&projectConversationEnvelope); err != nil {
			t.Fatalf("decoding project conversation response: %v", err)
		}
		projectConversation := projectConversationEnvelope.Data
		if projectConversation.ID != projectSessionID {
			t.Fatalf("project conversation = %+v, want project session id", projectConversation)
		}
		if projectConversation.ScopeID != "agent" {
			t.Fatalf("project conversation scope = %q, want agent", projectConversation.ScopeID)
		}
		projectImageTaskID := "official.seedream-5-lite:project-image"
		if err := store.Upsert(generationTaskRecord{
			ID:             projectImageTaskID,
			ConversationID: projectConversation.ID,
			ProjectID:      projectSessionID,
			Kind:           "image",
			RouteID:        "official.seedream-5-lite",
			FamilyID:       "seedream",
			VersionID:      "seedream-5-lite",
			Provider:       "volcengine",
			ModelID:        "seedream-5-lite",
			Model:          "doubao-seedream-5-lite",
			Prompt:         "project image",
			Params:         map[string]any{},
			Status:         "completed",
			Message:        "Image generation completed.",
			Assets: []generationAsset{
				{Kind: "image", URL: projectImageA.URL},
				{Kind: "image", URL: projectImageB.URL},
			},
		}); err != nil {
			t.Fatalf("seeding project scoped task: %v", err)
		}

		projectConversations := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/sessions?kind=image", "")
		defer projectConversations.Body.Close()
		if projectConversations.StatusCode != http.StatusOK {
			t.Fatalf("project conversations status code = %d, want %d", projectConversations.StatusCode, http.StatusOK)
		}
		projectConversationsBody := readBody(t, projectConversations.Body)
		if !strings.Contains(projectConversationsBody, projectConversation.ID) ||
			!strings.Contains(projectConversationsBody, `"taskCount":1`) {
			t.Fatalf("body = %s, want project conversation summary", projectConversationsBody)
		}

		studioImageConversations := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/sessions?kind=image&scopeId=studio", "")
		defer studioImageConversations.Body.Close()
		if studioImageConversations.StatusCode != http.StatusOK {
			t.Fatalf("studio image conversations status code = %d, want %d", studioImageConversations.StatusCode, http.StatusOK)
		}
		studioImageConversationsBody := readBody(t, studioImageConversations.Body)
		if strings.Contains(studioImageConversationsBody, projectConversation.ID) {
			t.Fatalf("body = %s, want studio scope to exclude agent conversation", studioImageConversationsBody)
		}

		agentImageConversations := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/sessions?kind=image&scopeId=agent", "")
		defer agentImageConversations.Body.Close()
		if agentImageConversations.StatusCode != http.StatusOK {
			t.Fatalf("agent image conversations status code = %d, want %d", agentImageConversations.StatusCode, http.StatusOK)
		}
		agentImageConversationsBody := readBody(t, agentImageConversations.Body)
		if !strings.Contains(agentImageConversationsBody, projectConversation.ID) ||
			!strings.Contains(agentImageConversationsBody, `"scopeId":"agent"`) {
			t.Fatalf("body = %s, want agent scoped conversation", agentImageConversationsBody)
		}

		allImageConversations := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/sessions?kind=image", "")
		defer allImageConversations.Body.Close()
		if allImageConversations.StatusCode != http.StatusOK {
			t.Fatalf("all image conversations status code = %d, want %d", allImageConversations.StatusCode, http.StatusOK)
		}
		allImageConversationsBody := readBody(t, allImageConversations.Body)
		if !strings.Contains(allImageConversationsBody, projectConversation.ID) ||
			!strings.Contains(allImageConversationsBody, `"sessionId":"`+projectSessionID+`"`) ||
			!strings.Contains(allImageConversationsBody, `"scopeId":"agent"`) {
			t.Fatalf("body = %s, want public session conversations with scopeId", allImageConversationsBody)
		}

		projectTasks := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/sessions/"+url.PathEscape(projectConversation.ID)+"/tasks?kind=image", "")
		defer projectTasks.Body.Close()
		if projectTasks.StatusCode != http.StatusOK {
			t.Fatalf("project tasks status code = %d, want %d", projectTasks.StatusCode, http.StatusOK)
		}
		projectTasksBody := readBody(t, projectTasks.Body)
		if !strings.Contains(projectTasksBody, `"prompt":"project image"`) ||
			strings.Contains(projectTasksBody, `"prompt":"make a video"`) {
			t.Fatalf("body = %s, want project-scoped conversation tasks", projectTasksBody)
		}

		removeAsset := requestJSON(t, handler, http.MethodDelete, "/api/v1/generation/tasks/"+url.PathEscape(projectImageTaskID)+"/assets/0", "")
		defer removeAsset.Body.Close()
		if removeAsset.StatusCode != http.StatusOK {
			t.Fatalf("delete asset status code = %d, want %d: %s", removeAsset.StatusCode, http.StatusOK, readBody(t, removeAsset.Body))
		}
		removeAssetBody := readBody(t, removeAsset.Body)
		if strings.Contains(removeAssetBody, projectImageA.URL) ||
			!strings.Contains(removeAssetBody, projectImageB.URL) {
			t.Fatalf("body = %s, want only deleted asset removed", removeAssetBody)
		}

		detail := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/tasks/"+url.PathEscape(taskID), "")
		defer detail.Body.Close()
		if detail.StatusCode != http.StatusOK {
			t.Fatalf("detail status code = %d, want %d", detail.StatusCode, http.StatusOK)
		}
		detailBody := readBody(t, detail.Body)
		if !strings.Contains(detailBody, taskID) || !strings.Contains(detailBody, `"status":"submitted"`) {
			t.Fatalf("body = %s, want persisted generation task detail", detailBody)
		}

		retry := requestJSON(t, handler, http.MethodPost, "/api/v1/generation/tasks/"+url.PathEscape(taskID)+"/retry", "")
		defer retry.Body.Close()
		if retry.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("retry status code = %d, want %d", retry.StatusCode, http.StatusServiceUnavailable)
		}
		retryBody := readBody(t, retry.Body)
		if !strings.Contains(retryBody, `"message":"internal error"`) || strings.Contains(retryBody, "Volcengine API Key 尚未配置") {
			t.Fatalf("body = %s, want sanitized missing api key retry response", retryBody)
		}

		remove := requestJSON(t, handler, http.MethodDelete, "/api/v1/generation/tasks/"+url.PathEscape(taskID), "")
		defer remove.Body.Close()
		if remove.StatusCode != http.StatusOK {
			t.Fatalf("delete status code = %d, want %d", remove.StatusCode, http.StatusOK)
		}
		removeBody := readBody(t, remove.Body)
		if strings.Contains(removeBody, taskID) {
			t.Fatalf("body = %s, want deleted task omitted from task list", removeBody)
		}

		deleteSession := requestJSON(t, handler, http.MethodPost, "/api/v1/generation/sessions", `{"kind":"image","title":"Delete session"}`)
		defer deleteSession.Body.Close()
		if deleteSession.StatusCode != http.StatusOK {
			t.Fatalf("create delete session status code = %d, want %d", deleteSession.StatusCode, http.StatusOK)
		}
		var deleteSessionEnvelope struct {
			Data servicegeneration.GenerationConversationRecord `json:"data"`
		}
		if err := json.NewDecoder(deleteSession.Body).Decode(&deleteSessionEnvelope); err != nil {
			t.Fatalf("decoding delete session response: %v", err)
		}
		deleteTaskID := "official.seedream-5-lite:delete-session"
		if err := store.Upsert(generationTaskRecord{
			ID:             deleteTaskID,
			ConversationID: deleteSessionEnvelope.Data.ID,
			Kind:           "image",
			RouteID:        "official.seedream-5-lite",
			FamilyID:       "seedream",
			VersionID:      "seedream-5-lite",
			Provider:       "volcengine",
			ModelID:        "seedream-5-lite",
			Model:          "doubao-seedream-5-lite",
			Prompt:         "delete me",
			Params:         map[string]any{},
			Status:         "completed",
			Message:        "Image generation completed.",
		}); err != nil {
			t.Fatalf("seeding delete session task: %v", err)
		}
		deleteConversation := requestJSON(t, handler, http.MethodDelete, "/api/v1/generation/sessions/"+url.PathEscape(deleteSessionEnvelope.Data.ID), "")
		defer deleteConversation.Body.Close()
		if deleteConversation.StatusCode != http.StatusOK {
			t.Fatalf("delete conversation status code = %d, want %d", deleteConversation.StatusCode, http.StatusOK)
		}
		deletedTasks := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/tasks", "")
		defer deletedTasks.Body.Close()
		if deletedTasks.StatusCode != http.StatusOK {
			t.Fatalf("deleted conversation tasks status code = %d, want %d", deletedTasks.StatusCode, http.StatusOK)
		}
		if deletedTasksBody := readBody(t, deletedTasks.Body); strings.Contains(deletedTasksBody, deleteTaskID) {
			t.Fatalf("body = %s, want deleted conversation task omitted", deletedTasksBody)
		}
	})

	t.Run("generation import media assets creates reference history tasks", func(t *testing.T) {
		project, _ := createExternalProjectForTest(t, handler, "Generation Import")
		asset := uploadImageAssetForTest(t, handler, project.ID, "library.png")
		sessionID := project.ID + "-image"
		payload, err := json.Marshal(map[string]any{
			"kind":              "image",
			"scopeId":           "agent",
			"conversationTitle": "Project image session",
			"projectId":         project.ID,
			"sectionId":         "section-import",
			"capabilityId":      "character",
			"assetIds":          []string{asset.ID},
			"assetTitle":        "导入角色图",
		})
		if err != nil {
			t.Fatalf("encoding import payload: %v", err)
		}

		importResponse := requestJSON(
			t,
			handler,
			http.MethodPost,
			"/api/v1/generation/sessions/"+url.PathEscape(sessionID)+"/media-assets/import",
			string(payload),
		)
		defer importResponse.Body.Close()
		if importResponse.StatusCode != http.StatusOK {
			t.Fatalf("import status code = %d, want %d: %s", importResponse.StatusCode, http.StatusOK, readBody(t, importResponse.Body))
		}

		var envelope struct {
			Data servicegeneration.GenerationTasksResponse `json:"data"`
		}
		if err := json.NewDecoder(importResponse.Body).Decode(&envelope); err != nil {
			t.Fatalf("decoding import response: %v", err)
		}
		if len(envelope.Data.Tasks) != 1 {
			t.Fatalf("tasks = %+v, want one imported task", envelope.Data.Tasks)
		}
		importedTask := envelope.Data.Tasks[0]
		if importedTask.ConversationID != sessionID ||
			importedTask.ProjectID != project.ID ||
			importedTask.RouteID != "media-library" ||
			importedTask.Status != "completed" ||
			len(importedTask.Assets) != 1 ||
			importedTask.Assets[0].URL != asset.URL ||
			importedTask.Assets[0].Selected {
			t.Fatalf("imported task = %+v, want completed unselected media-library reference", importedTask)
		}
		if len(importedTask.ReferenceAssetIDs) != 1 || importedTask.ReferenceAssetIDs[0] != asset.ID {
			t.Fatalf("reference asset ids = %#v, want imported asset id", importedTask.ReferenceAssetIDs)
		}

		list := requestJSON(
			t,
			handler,
			http.MethodGet,
			"/api/v1/generation/sessions/"+url.PathEscape(sessionID)+"/tasks?kind=image",
			"",
		)
		defer list.Body.Close()
		if list.StatusCode != http.StatusOK {
			t.Fatalf("list status code = %d, want %d: %s", list.StatusCode, http.StatusOK, readBody(t, list.Body))
		}
		listBody := readBody(t, list.Body)
		if !strings.Contains(listBody, `"message":"已从素材库导入。"`) ||
			!strings.Contains(listBody, `"routeId":"media-library"`) ||
			!strings.Contains(listBody, asset.URL) {
			t.Fatalf("body = %s, want imported media task in generation history", listBody)
		}
	})

	t.Run("generation preferences round trip", func(t *testing.T) {
		sessionID := "project-preferences"
		empty := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/sessions/"+url.PathEscape(sessionID)+"/preferences", "")
		defer empty.Body.Close()
		if empty.StatusCode != http.StatusOK {
			t.Fatalf("empty status code = %d, want %d", empty.StatusCode, http.StatusOK)
		}
		emptyBody := readBody(t, empty.Body)
		if !strings.Contains(emptyBody, `"sessionId":"`+sessionID+`"`) ||
			strings.Contains(emptyBody, `"scopeId"`) ||
			!strings.Contains(emptyBody, `"familyIds":{}`) {
			t.Fatalf("body = %s, want empty session preferences", emptyBody)
		}

		save := requestJSON(t, handler, http.MethodPut, "/api/v1/generation/sessions/"+url.PathEscape(sessionID)+"/preferences", `{
			"familyIds":{"image":"seedream"},
			"routeIds":{"seedream-5-lite":"official.seedream-5-lite"},
			"versionIds":{"seedream":"seedream-5-lite"},
			"routeParams":{"official.seedream-5-lite":{"size":"2K"}},
			"stylePresetId":"preset-cinematic"
		}`)
		defer save.Body.Close()
		if save.StatusCode != http.StatusOK {
			t.Fatalf("save status code = %d, want %d: %s", save.StatusCode, http.StatusOK, readBody(t, save.Body))
		}

		get := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/sessions/"+url.PathEscape(sessionID)+"/preferences", "")
		defer get.Body.Close()
		if get.StatusCode != http.StatusOK {
			t.Fatalf("get status code = %d, want %d", get.StatusCode, http.StatusOK)
		}
		getBody := readBody(t, get.Body)
		if !strings.Contains(getBody, `"stylePresetId":"preset-cinematic"`) ||
			!strings.Contains(getBody, `"official.seedream-5-lite":{"aspectRatio":"adaptive","resolution":"2K"}`) {
			t.Fatalf("body = %s, want saved preferences", getBody)
		}
	})

	t.Run("api key settings configure generation routes", func(t *testing.T) {
		save := requestJSON(t, handler, http.MethodPut, "/api/v1/settings/api-keys/dmx", `{"apiKey":"sk-settings"}`)
		defer save.Body.Close()

		if save.StatusCode != http.StatusOK {
			t.Fatalf("save status code = %d, want %d", save.StatusCode, http.StatusOK)
		}
		saveBody := readBody(t, save.Body)
		if !strings.Contains(saveBody, `"source":"settings"`) || strings.Contains(saveBody, "sk-settings") {
			t.Fatalf("body = %s, want masked settings key", saveBody)
		}

		models := requestJSON(t, handler, http.MethodGet, "/api/v1/generation/models", "")
		defer models.Body.Close()

		modelsBody := readBody(t, models.Body)
		if !strings.Contains(modelsBody, `"id":"dmx.seedream-5-lite"`) || !strings.Contains(modelsBody, `"configured":true`) {
			t.Fatalf("body = %s, want configured dmx generation route", modelsBody)
		}
	})

	t.Run("unknown api route returns json not found", func(t *testing.T) {
		response := requestJSON(t, handler, http.MethodGet, "/api/v1/missing", "")
		defer response.Body.Close()

		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusNotFound)
		}

		body := readBody(t, response.Body)
		if !strings.Contains(body, `"message":"api route not found"`) {
			t.Fatalf("body = %s, want api not found message", body)
		}
	})
}

func TestAPIKeySettingsPersistToSQLite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	handler := newTestHandler(t, dbPath)

	save := requestJSON(t, handler, http.MethodPut, "/api/v1/settings/api-keys/openrouter", `{"apiKey":"sk-persisted"}`)
	defer save.Body.Close()
	if save.StatusCode != http.StatusOK {
		t.Fatalf("save status code = %d, want %d", save.StatusCode, http.StatusOK)
	}

	restarted := newTestHandler(t, dbPath)
	response := requestJSON(t, restarted, http.MethodGet, "/api/v1/settings/api-keys", "")
	defer response.Body.Close()

	body := readBody(t, response.Body)
	if !strings.Contains(body, `"id":"openrouter"`) ||
		!strings.Contains(body, `"source":"settings"`) ||
		!strings.Contains(body, `"sk-p••••••••sted"`) ||
		strings.Contains(body, "sk-persisted") {
		t.Fatalf("body = %s, want persisted masked openrouter key", body)
	}
}

func newTestHandler(t *testing.T, dbPath string) http.Handler {
	t.Helper()

	handler := NewHandlerWithConfig(
		fstest.MapFS{
			"index.html": {
				Data: []byte("<html>workspace</html>"),
			},
		},
		Config{
			SettingsDBPath:          dbPath,
			MediaDir:                filepath.Join(filepath.Dir(dbPath), "assets"),
			WorkspaceDir:            filepath.Join(filepath.Dir(dbPath), "workspace"),
			DisableGenerationWorker: true,
			agentRunner:             fakeAgentRunner{},
			documentOperationRunner: fakeDocumentOperationRunner{},
		},
	)
	closeTestHandler(t, handler)
	return handler
}

func closeTestHandler(t *testing.T, handler http.Handler) {
	t.Helper()

	closer, ok := handler.(interface{ Close() error })
	if !ok {
		return
	}
	t.Cleanup(func() {
		if err := closer.Close(); err != nil {
			t.Errorf("closing test handler: %v", err)
		}
	})
}

func testWorkspaceDBPathForSettings(dbPath string) string {
	return filepath.Join(filepath.Dir(dbPath), "workspace", ".mediago-drama", "db", "app.db")
}

func createExternalProjectForTest(t *testing.T, handler http.Handler, name string) (workspaceProjectRecord, string) {
	t.Helper()

	projectDir := filepath.Join(t.TempDir(), "external-project")
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating external project dir: %v", err)
	}
	payload, err := json.Marshal(map[string]string{
		"name":       name,
		"projectDir": projectDir,
	})
	if err != nil {
		t.Fatalf("encoding create project payload: %v", err)
	}
	response := requestJSON(t, handler, http.MethodPost, "/api/v1/projects", string(payload))
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("create project status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
	}
	var envelope struct {
		Data workspaceProjectRecord `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decoding create project response: %v", err)
	}
	if envelope.Data.ID == "" {
		t.Fatal("created project ID is empty")
	}
	return envelope.Data, projectDir
}

func uploadVideoAssetForTest(t *testing.T, handler http.Handler, projectID string, filename string) servicemedia.MediaAsset {
	t.Helper()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	header.Set("Content-Type", "video/mp4")
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("creating multipart video file: %v", err)
	}
	if _, err := part.Write([]byte("fake video bytes")); err != nil {
		t.Fatalf("writing multipart video file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("closing multipart writer: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+url.PathEscape(projectID)+"/media-assets", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	response := recorder.Result()
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("upload video status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
	}

	var envelope struct {
		Data servicemedia.MediaAsset `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decoding upload video response: %v", err)
	}
	if envelope.Data.ID == "" || envelope.Data.Kind != servicemedia.MediaKindVideo || envelope.Data.URL == "" {
		t.Fatalf("asset = %+v, want uploaded video asset", envelope.Data)
	}
	return envelope.Data
}

func uploadImageAssetForTest(t *testing.T, handler http.Handler, projectID string, filename string) servicemedia.MediaAsset {
	t.Helper()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	header.Set("Content-Type", "image/png")
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("creating multipart image file: %v", err)
	}
	if _, err := part.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}); err != nil {
		t.Fatalf("writing multipart image file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("closing multipart writer: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+url.PathEscape(projectID)+"/media-assets", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	response := recorder.Result()
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("upload image status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
	}

	var envelope struct {
		Data servicemedia.MediaAsset `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decoding upload image response: %v", err)
	}
	if envelope.Data.ID == "" || envelope.Data.Kind != servicemedia.MediaKindImage || envelope.Data.URL == "" {
		t.Fatalf("asset = %+v, want uploaded image asset", envelope.Data)
	}
	return envelope.Data
}

func writeFakeFFmpegForTest(t *testing.T, path string) {
	t.Helper()
	script := `#!/bin/sh
last=""
for arg in "$@"; do
	last="$arg"
done
if [ "$last" = "pipe:1" ]; then
	printf fragmented-mp4
else
	printf rendered-mp4 > "$last"
fi
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("writing fake ffmpeg: %v", err)
	}
}

func listProjectCountForTest(t *testing.T, handler http.Handler) int {
	t.Helper()

	response := requestJSON(t, handler, http.MethodGet, "/api/v1/projects", "")
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("project list status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
	}
	var envelope struct {
		Data mediamcp.ProjectList `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decoding project list response: %v", err)
	}
	return len(envelope.Data.Projects)
}

type fakeAgentRunner struct{}

func (fakeAgentRunner) Run(_ context.Context, request agentRunRequest, publish func(agentEvent)) (agentRunResult, error) {
	publish(agentEvent{
		Type:    "agent.activity",
		Message: "fake agent run",
	})

	return agentRunResult{
		ACPSessionID: "acp-test-session",
		Message:      "fake response to " + request.Prompt,
	}, nil
}

type recordingAgentRunner struct {
	requests chan agentRunRequest
}

func (runner recordingAgentRunner) Run(ctx context.Context, request agentRunRequest, publish func(agentEvent)) (agentRunResult, error) {
	runner.requests <- request
	return fakeAgentRunner{}.Run(ctx, request, publish)
}

type fakeDocumentOperationRunner struct{}

func (fakeDocumentOperationRunner) RunDocumentOperations(_ context.Context, request documentOperationsRequest) (documentOperationsResponse, error) {
	return documentOperationsResponse{
		Message: "fake document operations response",
		Summary: "fake operation summary",
		Runtime: documentOperationRuntime{
			Runtime:   "mock",
			Validated: true,
		},
		Operations: []documentOperationRecord{
			{
				ID:      "op-fake",
				Type:    "insert_markdown",
				Summary: "fake insert",
				Target: documentOperationTarget{
					Position: "append",
				},
				Payload: map[string]any{
					"markdown": "## Fake\n\n" + request.Prompt,
				},
				CreatedAt: "2026-05-18T00:00:00Z",
			},
		},
	}, nil
}

type recordingDocumentOperationRunner struct {
	requests chan documentOperationsRequest
}

func (runner recordingDocumentOperationRunner) RunDocumentOperations(_ context.Context, request documentOperationsRequest) (documentOperationsResponse, error) {
	runner.requests <- request
	return fakeDocumentOperationRunner{}.RunDocumentOperations(context.Background(), request)
}

type invalidDocumentOperationRunner struct{}

func (invalidDocumentOperationRunner) RunDocumentOperations(context.Context, documentOperationsRequest) (documentOperationsResponse, error) {
	return documentOperationsResponse{
		Message: "invalid",
		Summary: "invalid",
		Operations: []documentOperationRecord{
			{
				ID:      "op-invalid",
				Type:    "replace_text",
				Summary: "invalid replace",
				Payload: map[string]any{},
			},
		},
	}, nil
}

func requestJSON(t *testing.T, handler http.Handler, method string, target string, body string) *http.Response {
	t.Helper()

	var reader io.Reader
	if body != "" {
		reader = bytes.NewBufferString(body)
	}

	target = rewriteLegacyAPITestTarget(method, target, body)
	request := httptest.NewRequest(method, target, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	return recorder.Result()
}

func rewriteLegacyAPITestTarget(method string, target string, body string) string {
	parsed, err := url.Parse(target)
	if err != nil {
		return target
	}
	path := parsed.Path
	query := parsed.Query()
	projectID := strings.TrimSpace(query.Get("projectId"))
	if projectID == "" {
		projectID = requestBodyString(body, "projectId")
	}
	if projectID == "" {
		projectID = "project-test"
	}

	switch {
	case strings.HasPrefix(path, "/api/v1/workspace/"):
		return projectScopedTestTarget(parsed, projectID, strings.TrimPrefix(path, "/api/v1"), query)
	case path == "/api/v1/agent/document-operations" || path == "/api/v1/agent/document-operations/test":
		return projectScopedTestTarget(parsed, projectID, strings.TrimPrefix(path, "/api/v1"), query)
	case path == "/api/v1/agent/session":
		return projectScopedTestTarget(parsed, projectID, "/agent/sessions", query)
	case path == "/api/v1/agent/sessions":
		return projectScopedTestTarget(parsed, projectID, "/agent/sessions", query)
	case strings.HasPrefix(path, "/api/v1/agent/session/") && strings.HasSuffix(path, "/status"):
		sessionID := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v1/agent/session/"), "/status")
		if storedProjectID, ok := testSessionProjects.Load(sessionID); ok {
			projectID, _ = storedProjectID.(string)
		}
		return projectScopedTestTarget(parsed, projectID, "/agent/sessions/"+sessionID+"/status", query)
	case path == "/api/v1/agent/message":
		sessionID := requestBodyString(body, "sessionId")
		if storedProjectID, ok := testSessionProjects.Load(sessionID); ok && requestBodyString(body, "projectId") == "" {
			projectID, _ = storedProjectID.(string)
		}
		if sessionID == "" {
			sessionID = "%20"
		} else {
			sessionID = url.PathEscape(sessionID)
		}
		return projectScopedTestTarget(parsed, projectID, "/agent/sessions/"+sessionID+"/messages", query)
	case path == "/api/v1/agent/chat/append":
		return projectScopedTestTarget(parsed, projectID, "/agent/chat/messages", query)
	case path == "/api/v1/agent/chat":
		return projectScopedTestTarget(parsed, projectID, "/agent/chat", query)
	case path == "/api/v1/agent/events":
		sessionID := query.Get("sessionId")
		query.Del("sessionId")
		return projectScopedTestTarget(parsed, projectID, "/agent/sessions/"+url.PathEscape(sessionID)+"/events", query)
	case strings.HasPrefix(path, "/api/v1/media-assets"):
		parsed.Path = "/api/v1/media-assets" + strings.TrimPrefix(path, "/api/v1/media-assets")
		return parsed.String()
	}
	return target
}

func projectScopedTestTarget(parsed *url.URL, projectID string, suffix string, query url.Values) string {
	query.Del("projectId")
	parsed.Path = "/api/v1/projects/" + url.PathEscape(projectID) + suffix
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func requestBodyString(body string, key string) string {
	if strings.TrimSpace(body) == "" {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return ""
	}
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
}

func createAgentSessionForProject(t *testing.T, handler http.Handler, projectID string) string {
	t.Helper()

	if projectID == "" {
		project, _ := createExternalProjectForTest(t, handler, "Agent Test Project")
		projectID = project.ID
	}
	body := ""
	if projectID != "" {
		payload, err := json.Marshal(sessionRequest{ProjectID: projectID})
		if err != nil {
			t.Fatalf("encoding session request: %v", err)
		}
		body = string(payload)
	}

	response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/session", body)
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("create session status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
	}

	var envelope struct {
		Data sessionResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decoding create session response: %v", err)
	}
	if envelope.Data.SessionID == "" {
		t.Fatal("created sessionId is empty")
	}
	testSessionProjects.Store(envelope.Data.SessionID, projectID)
	return envelope.Data.SessionID
}

func readBody(t *testing.T, reader io.Reader) string {
	t.Helper()

	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}

	return string(body)
}

func assertPathExists(t *testing.T, path string) {
	t.Helper()

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("path %s should exist: %v", path, err)
	}
}

func assertPathMissing(t *testing.T, path string) {
	t.Helper()

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("path %s should not exist, err=%v", path, err)
	}
}
