package mcp

import (
	"context"
	"sync"
	"testing"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	serviceselection "github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
)

type capturePublisher struct {
	mu     sync.Mutex
	events []agentEvent
}

func (publisher *capturePublisher) PublishEvent(event agentEvent) {
	publisher.mu.Lock()
	defer publisher.mu.Unlock()
	publisher.events = append(publisher.events, event)
}

func (publisher *capturePublisher) a2uiEvents() []agentEvent {
	publisher.mu.Lock()
	defer publisher.mu.Unlock()
	found := []agentEvent{}
	for _, event := range publisher.events {
		if event.Type == serviceagent.AgentUIEventType && event.A2UI != nil {
			found = append(found, event)
		}
	}
	return found
}

func newSelectionAdapter(t *testing.T) (*Adapter, *capturePublisher, string) {
	t.Helper()
	store := newWorkspaceStateService(t.TempDir())
	projectID := "project-selection-mcp"
	requireMCPTestProject(t, store, projectID)
	publisher := &capturePublisher{}
	document := &DocumentServer{
		store:     store,
		projectID: projectID,
		config:    DocumentConfig{SessionID: "session-1", RunID: "run-1", Events: publisher},
	}
	adapter := &Adapter{store: store, events: publisher, document: document}
	return adapter, publisher, projectID
}

func sampleSelectionInput() mediamcp.AskUserSelectionInput {
	return mediamcp.AskUserSelectionInput{
		Title:       "选择一种插画风格",
		Kind:        "image_style",
		AllowCustom: true,
		Options: []mediamcp.SelectionOptionInput{
			{ID: "sweet", Label: "甜美粉彩", ImageURL: "https://x/1.png"},
			{ID: "retro", Label: "复古线条", ImageURL: "https://x/2.png"},
		},
	}
}

// decideWhenPending waits for one pending selection to appear, then applies the decision.
func decideWhenPending(t *testing.T, adapter *Adapter, projectID string, request serviceselection.DecisionRequest) {
	t.Helper()
	service := adapter.document.store.Selections
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		pending, err := service.ListPending(projectID)
		if err != nil {
			t.Errorf("ListPending() error = %v", err)
			return
		}
		if len(pending) > 0 {
			if _, err := service.Decide(projectID, pending[0].ID, request); err != nil {
				t.Errorf("Decide() error = %v", err)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Error("no pending selection appeared to decide")
}

func TestAskUserSelectionReturnsSelected(t *testing.T) {
	adapter, publisher, projectID := newSelectionAdapter(t)

	go decideWhenPending(t, adapter, projectID, serviceselection.DecisionRequest{OptionID: "retro"})

	output, err := adapter.AskUserSelection(context.Background(), projectID, sampleSelectionInput())
	if err != nil {
		t.Fatalf("AskUserSelection() error = %v", err)
	}
	if output.Status != serviceselection.StatusSelected || output.OptionID != "retro" {
		t.Fatalf("output = %#v, want selected retro", output)
	}
	if output.SelectionID == "" {
		t.Fatal("output.SelectionID is empty")
	}

	cards := publisher.a2uiEvents()
	if len(cards) != 1 {
		t.Fatalf("published A2UI cards = %d, want 1", len(cards))
	}
	if cards[0].SessionID != "session-1" || cards[0].RunID != "run-1" {
		t.Fatalf("card event = %#v, want session/run context", cards[0])
	}
}

func TestAskUserSelectionReturnsCancelled(t *testing.T) {
	adapter, _, projectID := newSelectionAdapter(t)

	go decideWhenPending(t, adapter, projectID, serviceselection.DecisionRequest{Cancelled: true})

	output, err := adapter.AskUserSelection(context.Background(), projectID, sampleSelectionInput())
	if err != nil {
		t.Fatalf("AskUserSelection() error = %v", err)
	}
	if output.Status != serviceselection.StatusCancelled {
		t.Fatalf("output = %#v, want cancelled", output)
	}
}

func TestAskUserSelectionRejectsEmptyOptions(t *testing.T) {
	adapter, publisher, projectID := newSelectionAdapter(t)

	_, err := adapter.AskUserSelection(context.Background(), projectID, mediamcp.AskUserSelectionInput{
		Title:   "空选项",
		Options: nil,
	})
	if err == nil {
		t.Fatal("AskUserSelection() returned nil error for empty options")
	}
	if len(publisher.a2uiEvents()) != 0 {
		t.Fatal("A2UI card published for invalid selection")
	}
}

func TestAskUserSelectionReusesPendingDuplicate(t *testing.T) {
	adapter, publisher, projectID := newSelectionAdapter(t)
	service := adapter.document.store.Selections

	// First ask creates the card; a duplicate ask must attach to it instead of
	// popping a second card. Resolve both by deciding the single selection.
	firstDone := make(chan mediamcp.AskUserSelectionOutput, 1)
	go func() {
		output, err := adapter.AskUserSelection(context.Background(), projectID, sampleSelectionInput())
		if err != nil {
			t.Errorf("first AskUserSelection() error = %v", err)
		}
		firstDone <- output
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		pending, err := service.ListPending(projectID)
		if err != nil {
			t.Fatalf("ListPending() error = %v", err)
		}
		if len(pending) == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	secondDone := make(chan mediamcp.AskUserSelectionOutput, 1)
	go func() {
		output, err := adapter.AskUserSelection(context.Background(), projectID, sampleSelectionInput())
		if err != nil {
			t.Errorf("duplicate AskUserSelection() error = %v", err)
		}
		secondDone <- output
	}()

	time.Sleep(50 * time.Millisecond)
	pending, err := service.ListPending(projectID)
	if err != nil {
		t.Fatalf("ListPending() error = %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("pending selections = %d, want 1 (duplicate must reuse the card)", len(pending))
	}
	if cards := publisher.a2uiEvents(); len(cards) != 1 {
		t.Fatalf("published cards = %d, want 1", len(cards))
	}

	if _, err := service.Decide(projectID, pending[0].ID, serviceselection.DecisionRequest{OptionID: "sweet"}); err != nil {
		t.Fatalf("Decide() error = %v", err)
	}

	first := <-firstDone
	second := <-secondDone
	if first.Status != serviceselection.StatusSelected || second.Status != serviceselection.StatusSelected {
		t.Fatalf("outputs = %#v / %#v, want both selected", first, second)
	}
	if first.SelectionID != second.SelectionID {
		t.Fatalf("selection ids differ: %q vs %q", first.SelectionID, second.SelectionID)
	}
}

func TestAskUserSelectionReturnsRecentDecisionOnReask(t *testing.T) {
	adapter, publisher, projectID := newSelectionAdapter(t)
	service := adapter.document.store.Selections

	created, err := service.Create(projectID, serviceselection.CreateRequest{
		SessionID: "session-1",
		RunID:     "run-1",
		Kind:      "image_style",
		Title:     "选择一种插画风格",
		Options:   []serviceselection.Option{{ID: "sweet", Label: "甜美粉彩"}, {ID: "retro", Label: "复古线条"}},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := service.Decide(projectID, created.ID, serviceselection.DecisionRequest{OptionID: "retro"}); err != nil {
		t.Fatalf("Decide() error = %v", err)
	}

	// Model re-asks the same question right after the user answered: the
	// existing decision must come back immediately, without a new card.
	output, err := adapter.AskUserSelection(context.Background(), projectID, sampleSelectionInput())
	if err != nil {
		t.Fatalf("AskUserSelection() error = %v", err)
	}
	if output.Status != serviceselection.StatusSelected || output.OptionID != "retro" || output.SelectionID != created.ID {
		t.Fatalf("output = %#v, want reused decision retro from %s", output, created.ID)
	}
	if cards := publisher.a2uiEvents(); len(cards) != 0 {
		t.Fatalf("published cards = %d, want 0 for reused decision", len(cards))
	}
}

func TestAskUserFormReturnsSubmittedValues(t *testing.T) {
	adapter, publisher, projectID := newSelectionAdapter(t)

	go func() {
		service := adapter.document.store.Selections
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			pending, err := service.ListPending(projectID)
			if err != nil {
				t.Errorf("ListPending() error = %v", err)
				return
			}
			if len(pending) > 0 {
				if _, err := service.Decide(projectID, pending[0].ID, serviceselection.DecisionRequest{
					Values: map[string]any{"aspectRatio": "3:4", "optimizePrompt": true, "n": float64(4)},
				}); err != nil {
					t.Errorf("Decide() error = %v", err)
				}
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Error("no pending form appeared to submit")
	}()

	output, err := adapter.AskUserForm(context.Background(), projectID, mediamcp.AskUserFormInput{
		Title: "确认生成参数",
		Kind:  "generation_plan",
		Fields: []mediamcp.FormFieldInput{
			{ID: "aspectRatio", Label: "比例", Type: "select", Default: "3:4", Options: []mediamcp.FormFieldOptionInput{
				{Value: "3:4", Label: "3:4 竖版"}, {Value: "16:9", Label: "16:9 横版"},
			}},
			{ID: "optimizePrompt", Label: "优化提示词", Type: "toggle", Default: true},
			{ID: "n", Label: "张数", Type: "number", Default: 4},
		},
	})
	if err != nil {
		t.Fatalf("AskUserForm() error = %v", err)
	}
	if output.Status != serviceselection.StatusSubmitted {
		t.Fatalf("output = %#v, want submitted", output)
	}
	if output.Values["aspectRatio"] != "3:4" || output.Values["optimizePrompt"] != true {
		t.Fatalf("values = %#v, want submitted form values", output.Values)
	}

	cards := publisher.a2uiEvents()
	forms := 0
	for _, event := range publisher.events {
		if event.Form != nil {
			forms++
			if event.Form.SelectionID != output.SelectionID || len(event.Form.Fields) == 0 {
				t.Fatalf("form event = %#v, want selection id and fields", event.Form)
			}
		}
	}
	if forms != 1 {
		t.Fatalf("form events = %d, want 1", forms)
	}
	if len(cards) != 0 {
		t.Fatal("form must not publish an A2UI card")
	}
}

func TestSelectionFieldsFromMCPCarriesGenerationParamsKind(t *testing.T) {
	fields := selectionFieldsFromMCP([]mediamcp.FormFieldInput{
		{ID: "generation", Label: "模型与参数", Type: "generation_params", Kind: "video"},
		{ID: "scope", Label: "生成范围", Type: "text"},
	})
	if len(fields) != 2 {
		t.Fatalf("fields = %#v, want 2", fields)
	}
	if fields[0].Kind != "video" {
		t.Fatalf("generation_params kind = %q, want video", fields[0].Kind)
	}
	if fields[1].Kind != "" {
		t.Fatalf("text field kind = %q, want empty", fields[1].Kind)
	}
}

func TestAskUserFormRejectsInvalidFields(t *testing.T) {
	adapter, _, projectID := newSelectionAdapter(t)
	if _, err := adapter.AskUserForm(context.Background(), projectID, mediamcp.AskUserFormInput{
		Title:  "空字段",
		Fields: nil,
	}); err == nil {
		t.Fatal("AskUserForm() returned nil error for empty fields")
	}
	if _, err := adapter.AskUserForm(context.Background(), projectID, mediamcp.AskUserFormInput{
		Title:  "非法类型",
		Fields: []mediamcp.FormFieldInput{{ID: "x", Type: "dropdown"}},
	}); err == nil {
		t.Fatal("AskUserForm() returned nil error for unsupported field type")
	}
}

func TestAwaitUserSelectionResolvesExistingCard(t *testing.T) {
	adapter, publisher, projectID := newSelectionAdapter(t)
	created, err := adapter.document.store.Selections.Create(projectID, serviceselection.CreateRequest{
		Title:   "选择风格",
		Options: []serviceselection.Option{{ID: "sweet", Label: "甜美粉彩"}},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	go decideWhenPending(t, adapter, projectID, serviceselection.DecisionRequest{OptionID: "sweet"})

	output, err := adapter.AwaitUserSelection(context.Background(), projectID, mediamcp.AwaitUserSelectionInput{
		SelectionID: created.ID,
	})
	if err != nil {
		t.Fatalf("AwaitUserSelection() error = %v", err)
	}
	if output.Status != serviceselection.StatusSelected || output.OptionID != "sweet" {
		t.Fatalf("output = %#v, want selected sweet", output)
	}
	if len(publisher.a2uiEvents()) != 0 {
		t.Fatal("await must not publish a new A2UI card")
	}
}

func TestAwaitUserSelectionReturnsDecidedImmediately(t *testing.T) {
	adapter, _, projectID := newSelectionAdapter(t)
	service := adapter.document.store.Selections
	created, err := service.Create(projectID, serviceselection.CreateRequest{
		Title:   "选择风格",
		Options: []serviceselection.Option{{ID: "sweet", Label: "甜美粉彩"}},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := service.Decide(projectID, created.ID, serviceselection.DecisionRequest{Cancelled: true}); err != nil {
		t.Fatalf("Decide() error = %v", err)
	}

	output, err := adapter.AwaitUserSelection(context.Background(), projectID, mediamcp.AwaitUserSelectionInput{
		SelectionID: created.ID,
	})
	if err != nil {
		t.Fatalf("AwaitUserSelection() error = %v", err)
	}
	if output.Status != serviceselection.StatusCancelled {
		t.Fatalf("output = %#v, want cancelled without waiting", output)
	}
}

func TestAwaitUserSelectionRejectsUnknownSelection(t *testing.T) {
	adapter, _, projectID := newSelectionAdapter(t)
	if _, err := adapter.AwaitUserSelection(context.Background(), projectID, mediamcp.AwaitUserSelectionInput{
		SelectionID: "selection-missing",
	}); err == nil {
		t.Fatal("AwaitUserSelection() returned nil error for unknown selection")
	}
	if _, err := adapter.AwaitUserSelection(context.Background(), projectID, mediamcp.AwaitUserSelectionInput{}); err == nil {
		t.Fatal("AwaitUserSelection() returned nil error for empty selectionId")
	}
}

func TestAskUserSelectionCancelledByContext(t *testing.T) {
	adapter, _, projectID := newSelectionAdapter(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := adapter.AskUserSelection(ctx, projectID, sampleSelectionInput())
	if err == nil {
		t.Fatal("AskUserSelection() returned nil error for cancelled context")
	}
}
