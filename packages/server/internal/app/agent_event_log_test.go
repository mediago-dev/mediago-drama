package app

import (
	"encoding/json"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestAgentEventLogProjectsSessionTranscript(t *testing.T) {
	handler := newTestHandler(t, filepathForTestDB(t))
	project, _ := createExternalProjectForTest(t, handler, "Event Log")
	projectID := project.ID
	sessionID := createAgentSessionForProject(t, handler, projectID)

	response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/message", `{"sessionId":"`+sessionID+`","projectId":"`+projectID+`","prompt":"写一个开场"}`)
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("message status = %d: %s", response.StatusCode, readBody(t, response.Body))
	}
	waitForAgentSessionStatus(t, handler, sessionID, "completed")

	chat := requestJSON(t, handler, http.MethodGet, "/api/v1/agent/chat?projectId="+url.QueryEscape(projectID), "")
	defer chat.Body.Close()
	body := readBody(t, chat.Body)
	for _, expected := range []string{
		`"sessionId":"` + sessionID + `"`,
		`"messages":`,
		`"role":"user"`,
		`写一个开场`,
		`fake response to 写一个开场`,
		`"lastEventId":"`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("chat body = %s, want %s", body, expected)
		}
	}
	for _, unexpected := range []string{`"rootRunId":`, `"conversations":`, `"runId":`} {
		if strings.Contains(body, unexpected) {
			t.Fatalf("chat body = %s, should not contain %s", body, unexpected)
		}
	}
}

func TestCreateAgentSessionReusesProjectSessionByDefault(t *testing.T) {
	handler := newTestHandler(t, filepathForTestDB(t))
	project, _ := createExternalProjectForTest(t, handler, "Stable Session")
	projectID := project.ID

	first := createAgentSessionForProject(t, handler, projectID)
	second := createAgentSessionForProject(t, handler, projectID)
	if second != first {
		t.Fatalf("second session = %q, want stable project session %q", second, first)
	}
}

func TestAgentSessionsEndpointListsProjectSessions(t *testing.T) {
	handler := newTestHandler(t, filepathForTestDB(t))
	project, _ := createExternalProjectForTest(t, handler, "Session List")
	projectID := project.ID

	first := createAgentSessionForProject(t, handler, projectID)
	payload, err := json.Marshal(sessionRequest{ProjectID: projectID, NewSession: true})
	if err != nil {
		t.Fatalf("encoding session request: %v", err)
	}
	response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/session", string(payload))
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("new session status = %d: %s", response.StatusCode, readBody(t, response.Body))
	}
	var created struct {
		Data sessionResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatalf("decoding new session response: %v", err)
	}
	second := created.Data.SessionID
	if second == "" || second == first {
		t.Fatalf("second session = %q, first = %q", second, first)
	}

	list := requestJSON(t, handler, http.MethodGet, "/api/v1/agent/sessions?projectId="+url.QueryEscape(projectID), "")
	defer list.Body.Close()
	if list.StatusCode != http.StatusOK {
		t.Fatalf("list sessions status = %d: %s", list.StatusCode, readBody(t, list.Body))
	}
	var envelope struct {
		Data agentSessionsResponse `json:"data"`
	}
	if err := json.NewDecoder(list.Body).Decode(&envelope); err != nil {
		t.Fatalf("decoding sessions response: %v", err)
	}
	seen := map[string]bool{}
	for _, session := range envelope.Data.Sessions {
		seen[session.SessionID] = true
		if session.ProjectID != projectID {
			t.Fatalf("session projectID = %q, want %q", session.ProjectID, projectID)
		}
	}
	if !seen[first] || !seen[second] {
		t.Fatalf("sessions = %#v, want %q and %q", envelope.Data.Sessions, first, second)
	}
}

func TestAgentMessageUsesFixedPromptWithoutSpawnRules(t *testing.T) {
	requests := make(chan agentRunRequest, 1)
	dbPath := filepathForTestDB(t)
	handler := NewHandlerWithConfig(
		fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
		Config{
			SettingsDBPath:          dbPath,
			MediaDir:                filepath.Join(filepath.Dir(dbPath), "assets"),
			WorkspaceDir:            filepath.Join(filepath.Dir(dbPath), "workspace"),
			DisableGenerationWorker: true,
			agentRunner:             recordingAgentRunner{requests: requests},
			documentOperationRunner: fakeDocumentOperationRunner{},
		},
	)
	project, _ := createExternalProjectForTest(t, handler, "Auto Agents")
	projectID := project.ID
	create := requestJSON(t, handler, http.MethodPost, "/api/v1/workspace/documents?projectId="+url.QueryEscape(projectID), `{"title":"第一集","content":"# 第一集\n\n素材","category":"screenplay"}`)
	defer create.Body.Close()
	if create.StatusCode != http.StatusOK {
		t.Fatalf("create document status = %d: %s", create.StatusCode, readBody(t, create.Body))
	}
	createBody := readBody(t, create.Body)
	documentID := extractJSONID(createBody, `"id":"`)
	if documentID == "" {
		t.Fatalf("create body = %s, want document id", createBody)
	}

	sessionID := createAgentSessionForProject(t, handler, projectID)
	payload := `{"sessionId":"` + sessionID + `","projectId":"` + projectID + `","prompt":"生成漫剧交付物","document":{"id":"` + documentID + `","title":"第一集","content":"# 第一集\n\n素材","version":1},"documents":[{"id":"` + documentID + `","title":"第一集","content":"# 第一集\n\n素材","version":1}]}`
	response := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/message", payload)
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("message status = %d: %s", response.StatusCode, readBody(t, response.Body))
	}
	select {
	case request := <-requests:
		prompt := buildACPPrompt(request)
		if strings.Contains(prompt, "本次会话建议产出") ||
			strings.Contains(prompt, mediaGoDramaMCPToolName("spawn"+"_agents")) ||
			strings.Contains(prompt, "已安装 Skill") ||
			strings.Contains(prompt, "角色职责") {
			t.Fatalf("prompt = %q, should not contain spawn, skill, or role rules", prompt)
		}
		if !strings.Contains(prompt, "当前工作目录已经是当前项目的文档根目录") ||
			!strings.Contains(prompt, "需要文档正文状态时，直接读取当前工作目录 `.` 下的本地 Markdown 文件") ||
			!strings.Contains(prompt, "需要项目配置或视觉风格时，优先使用 MCP `get_project_config`") {
			t.Fatalf("prompt = %q, want file-native agent prompt", prompt)
		}
		if strings.Contains(prompt, "读取 `work/` 下") {
			t.Fatalf("prompt = %q, should not steer agents toward nested work directory", prompt)
		}
	case <-time.After(time.Second):
		t.Fatal("agent runner was not called")
	}
	waitForAgentSessionStatus(t, handler, sessionID, "completed")

	list := requestJSON(t, handler, http.MethodGet, "/api/v1/workspace/documents?projectId="+url.QueryEscape(projectID), "")
	defer list.Body.Close()
	listBody := readBody(t, list.Body)
	for _, expectedTitle := range []string{"剧本", "角色设定", "场景设定"} {
		if strings.Contains(listBody, `"title":"`+expectedTitle+`"`) {
			t.Fatalf("documents = %s, should not auto-create %s before explicit tool work", listBody, expectedTitle)
		}
	}

	chat := requestJSON(t, handler, http.MethodGet, "/api/v1/agent/chat?projectId="+url.QueryEscape(projectID), "")
	defer chat.Body.Close()
	chatBody := readBody(t, chat.Body)
	if strings.Contains(chatBody, `"parentRunId":"`) {
		t.Fatalf("chat body = %s, should not contain parent run ids", chatBody)
	}
}

func filepathForTestDB(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "settings.db")
}

func waitForAgentSessionStatus(t *testing.T, handler http.Handler, sessionID string, want string) {
	t.Helper()
	for range 100 {
		status := requestJSON(t, handler, http.MethodGet, "/api/v1/agent/session/"+sessionID+"/status", "")
		body := readBody(t, status.Body)
		status.Body.Close()
		if strings.Contains(body, `"lastStatus":"`+want+`"`) && strings.Contains(body, `"running":false`) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("agent session %s did not reach %s", sessionID, want)
}

func extractJSONID(body string, marker string) string {
	index := strings.Index(body, marker)
	if index < 0 {
		return ""
	}
	start := index + len(marker)
	end := strings.Index(body[start:], `"`)
	if end < 0 {
		return ""
	}
	return body[start : start+end]
}
