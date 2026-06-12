package app

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestAgentEventStreamReceivesChatAndDocumentEditEvents(t *testing.T) {
	dbPath := filepathForTestDB(t)
	handler := NewHandlerWithConfig(
		fstest.MapFS{"index.html": {Data: []byte("<html>workspace</html>")}},
		Config{
			SettingsDBPath:          dbPath,
			MediaDir:                filepath.Join(filepath.Dir(dbPath), "assets"),
			WorkspaceDir:            filepath.Join(filepath.Dir(dbPath), "workspace"),
			DisableGenerationWorker: true,
			agentRunner:             fakeStreamingDocumentAgentRunner{},
			documentOperationRunner: fakeDocumentOperationRunner{},
		},
	)
	project, _ := createExternalProjectForTest(t, handler, "Agent Stream")
	projectID := project.ID
	create := requestJSON(
		t,
		handler,
		http.MethodPost,
		"/api/v1/workspace/documents?projectId="+url.QueryEscape(projectID),
		`{"title":"第一幕","content":"# 第一幕\n\n旧正文","category":"screenplay"}`,
	)
	defer create.Body.Close()
	if create.StatusCode != http.StatusOK {
		t.Fatalf("create document status = %d: %s", create.StatusCode, readBody(t, create.Body))
	}
	var created struct {
		Data struct {
			Document struct {
				ID      string `json:"id"`
				Title   string `json:"title"`
				Content string `json:"content"`
				Version int    `json:"version"`
			} `json:"document"`
		} `json:"data"`
	}
	if err := json.NewDecoder(create.Body).Decode(&created); err != nil {
		t.Fatalf("decoding created document: %v", err)
	}
	document := created.Data.Document
	if document.ID == "" {
		t.Fatal("created document id is empty")
	}

	sessionID := createAgentSessionForProject(t, handler, projectID)
	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	streamRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		server.URL+"/api/v1/projects/"+url.PathEscape(projectID)+"/agent/sessions/"+url.PathEscape(sessionID)+"/events",
		nil,
	)
	if err != nil {
		t.Fatalf("creating event stream request: %v", err)
	}
	streamResponse, err := server.Client().Do(streamRequest)
	if err != nil {
		t.Fatalf("opening event stream: %v", err)
	}
	defer streamResponse.Body.Close()
	if streamResponse.StatusCode != http.StatusOK {
		t.Fatalf("event stream status = %d", streamResponse.StatusCode)
	}
	reader := bufio.NewReader(streamResponse.Body)
	connected := readAgentSSEEvent(t, reader, "agent.session.connected", 2*time.Second)
	if connected.SessionID != sessionID {
		t.Fatalf("connected event sessionID = %q, want %q", connected.SessionID, sessionID)
	}

	payload := fmt.Sprintf(
		`{"sessionId":%q,"projectId":%q,"prompt":"改写第一幕","document":{"id":%q,"title":%q,"content":%q,"category":"screenplay","version":%d}}`,
		sessionID,
		projectID,
		document.ID,
		document.Title,
		document.Content,
		document.Version,
	)
	message := requestJSON(t, handler, http.MethodPost, "/api/v1/agent/message", payload)
	defer message.Body.Close()
	if message.StatusCode != http.StatusOK {
		t.Fatalf("message status = %d: %s", message.StatusCode, readBody(t, message.Body))
	}

	seen := map[string]agentEvent{}
	deadline := time.After(3 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatalf("stream events = %#v, missing required chat/document edit events", seen)
		default:
		}
		event := readAgentSSEEvent(t, reader, "", 3*time.Second)
		seen[event.Type] = event
		if _, ok := seen["agent.message.delta"]; !ok {
			continue
		}
		edit, ok := seen["agent.document.edit.completed"]
		if !ok || edit.DocumentEdit == nil {
			continue
		}
		if _, ok := seen["agent.run.completed"]; ok {
			break
		}
	}

	if seen["agent.message.delta"].Content != "正在改写第一幕..." {
		t.Fatalf("message delta = %#v", seen["agent.message.delta"])
	}
	runID := seen["agent.run.completed"].RunID
	if runID == "" || runID == sessionID {
		t.Fatalf("runID = %q, want a per-message run id distinct from session %q", runID, sessionID)
	}
	for _, eventType := range []string{"agent.message.delta", "agent.document.edit.completed"} {
		if seen[eventType].RunID != runID {
			t.Fatalf("%s runID = %q, want %q", eventType, seen[eventType].RunID, runID)
		}
	}
	edit := seen["agent.document.edit.completed"].DocumentEdit
	if edit.DocumentID != document.ID || edit.Status != "completed" || !strings.Contains(edit.Content, "新正文") {
		t.Fatalf("document edit = %#v, want completed update for %s", edit, document.ID)
	}

	updated := requestJSON(t, handler, http.MethodGet, "/api/v1/workspace/documents/"+url.PathEscape(document.ID)+"?projectId="+url.QueryEscape(projectID), "")
	defer updated.Body.Close()
	body := readBody(t, updated.Body)
	if updated.StatusCode != http.StatusOK || !strings.Contains(body, "新正文") {
		t.Fatalf("updated document status = %d body = %s, want new content", updated.StatusCode, body)
	}
}

func readAgentSSEEvent(t *testing.T, reader *bufio.Reader, wantType string, timeout time.Duration) agentEvent {
	t.Helper()
	type result struct {
		event agentEvent
		err   error
	}
	events := make(chan result, 1)
	go func() {
		event, err := readAgentSSEEventBlock(reader)
		events <- result{event: event, err: err}
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case result := <-events:
		if result.err != nil {
			t.Fatalf("reading SSE event: %v", result.err)
		}
		if wantType != "" && result.event.Type != wantType {
			t.Fatalf("event type = %q, want %q; event=%#v", result.event.Type, wantType, result.event)
		}
		return result.event
	case <-timer.C:
		t.Fatalf("timed out waiting for SSE event %q", wantType)
	}
	return agentEvent{}
}

func readAgentSSEEventBlock(reader *bufio.Reader) (agentEvent, error) {
	var data strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return agentEvent{}, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if data.Len() == 0 {
				continue
			}
			var event agentEvent
			if err := json.Unmarshal([]byte(data.String()), &event); err != nil {
				return agentEvent{}, err
			}
			return event, nil
		}
		if strings.HasPrefix(line, "data: ") {
			data.WriteString(strings.TrimPrefix(line, "data: "))
		}
	}
}

type fakeStreamingDocumentAgentRunner struct{}

func (fakeStreamingDocumentAgentRunner) Run(_ context.Context, request agentRunRequest, publish func(agentEvent)) (agentRunResult, error) {
	publish(agentEvent{
		Type:    "agent.message.delta",
		Message: "正在改写第一幕...",
		Content: "正在改写第一幕...",
	})
	documentID := ""
	if request.Document != nil {
		documentID = request.Document.ID
	}
	return agentRunResult{
		ACPSessionID: "acp-stream-session",
		Message:      "第一幕已改写。",
		DocumentProposal: &agentDocumentProposal{
			DocumentID: documentID,
			Content:    "# 第一幕\n\n新正文",
			Summary:    "改写第一幕。",
		},
	}, nil
}
