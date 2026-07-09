package selection

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func newTestStore(t *testing.T) (*Service, *repository.AgentSelectionRepository, string) {
	t.Helper()
	db, err := repository.OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("opening workspace db: %v", err)
	}
	projectID := "project-selection"
	now := domain.TimeFromString("2026-06-01T00:00:00Z")
	if err := db.Create(&domain.WorkspaceProjectModel{
		ID:          projectID,
		Name:        "Project Selection",
		Category:    "drama",
		Status:      "active",
		RelativeDir: projectID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating project fixture: %v", err)
	}
	repo := repository.NewAgentSelectionRepository(db)
	return NewService(repo, nil), repo, projectID
}

func sampleCreate() CreateRequest {
	return CreateRequest{
		SessionID:   "session-1",
		RunID:       "run-1",
		Kind:        "image_style",
		Title:       "选择风格",
		Options:     []Option{{ID: "sweet", Label: "甜美粉彩", ImageURL: "https://x/1.png"}, {ID: "retro", Label: "复古线条"}},
		AllowCustom: true,
	}
}

func TestSelectionCreateAndSelect(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Status != StatusPending || created.ID == "" || len(created.Options) != 2 {
		t.Fatalf("created = %#v, want pending with 2 options and id", created)
	}

	decided, err := store.Decide(projectID, created.ID, DecisionRequest{OptionID: "sweet"})
	if err != nil {
		t.Fatalf("Decide() error = %v", err)
	}
	if decided.Status != StatusSelected || decided.Decision == nil || decided.Decision.OptionID != "sweet" {
		t.Fatalf("decided = %#v, want selected sweet", decided)
	}
	if decided.DecidedAt == "" {
		t.Fatalf("decided.DecidedAt is empty, want a timestamp")
	}
}

func TestSelectionCustomAndCancel(t *testing.T) {
	store, _, projectID := newTestStore(t)

	custom, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	decided, err := store.Decide(projectID, custom.ID, DecisionRequest{CustomText: "我想要水墨风"})
	if err != nil {
		t.Fatalf("Decide(custom) error = %v", err)
	}
	if decided.Status != StatusCustom || decided.Decision.CustomText != "我想要水墨风" {
		t.Fatalf("decided = %#v, want custom text", decided)
	}

	cancelled, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	decidedCancel, err := store.Decide(projectID, cancelled.ID, DecisionRequest{Cancelled: true})
	if err != nil {
		t.Fatalf("Decide(cancel) error = %v", err)
	}
	if decidedCancel.Status != StatusCancelled || decidedCancel.Decision == nil || !decidedCancel.Decision.Cancelled {
		t.Fatalf("decided = %#v, want cancelled", decidedCancel)
	}
}

func TestSelectionRejectsInvalidDecision(t *testing.T) {
	store, _, projectID := newTestStore(t)

	req := sampleCreate()
	req.AllowCustom = false
	created, err := store.Create(projectID, req)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := store.Decide(projectID, created.ID, DecisionRequest{OptionID: "missing"}); err == nil {
		t.Fatal("Decide(unknown option) returned nil error")
	}
	if _, err := store.Decide(projectID, created.ID, DecisionRequest{CustomText: "x"}); err == nil {
		t.Fatal("Decide(custom) returned nil error when custom disallowed")
	}
	if _, err := store.Decide(projectID, created.ID, DecisionRequest{}); err == nil {
		t.Fatal("Decide(empty) returned nil error")
	}

	// A rejected decision must leave the selection pending.
	current, ok, err := store.Get(projectID, created.ID)
	if err != nil || !ok {
		t.Fatalf("Get() = %v, ok=%v", err, ok)
	}
	if current.Status != StatusPending {
		t.Fatalf("status = %q, want pending after rejected decisions", current.Status)
	}
}

func TestSelectionDecideIsIdempotent(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	first, err := store.Decide(projectID, created.ID, DecisionRequest{OptionID: "sweet"})
	if err != nil {
		t.Fatalf("first Decide() error = %v", err)
	}
	second, err := store.Decide(projectID, created.ID, DecisionRequest{OptionID: "retro"})
	if err != nil {
		t.Fatalf("second Decide() error = %v", err)
	}
	if second.Status != first.Status || second.Decision.OptionID != "sweet" {
		t.Fatalf("second decide = %#v, want unchanged first decision sweet", second)
	}
}

func TestSelectionDecideNotFound(t *testing.T) {
	store, _, projectID := newTestStore(t)
	_, err := store.Decide(projectID, "selection-missing", DecisionRequest{Cancelled: true})
	if !errors.Is(err, repository.ErrRecordNotFound) {
		t.Fatalf("Decide(missing) error = %v, want ErrRecordNotFound", err)
	}
}

func TestSelectionWaitResolvesOnDecision(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	type result struct {
		record Record
		err    error
	}
	done := make(chan result, 1)
	go func() {
		record, err := store.waitForSelection(context.Background(), projectID, created.ID, 5*time.Second, 10*time.Millisecond)
		done <- result{record, err}
	}()

	time.Sleep(30 * time.Millisecond)
	if _, err := store.Decide(projectID, created.ID, DecisionRequest{OptionID: "retro"}); err != nil {
		t.Fatalf("Decide() error = %v", err)
	}

	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("waitForSelection() error = %v", got.err)
		}
		if got.record.Status != StatusSelected || got.record.Decision.OptionID != "retro" {
			t.Fatalf("record = %#v, want selected retro", got.record)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("waitForSelection did not return after decision")
	}
}

func TestSelectionWaitTimesOutButStaysRetrievable(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	record, err := store.waitForSelection(context.Background(), projectID, created.ID, 80*time.Millisecond, 10*time.Millisecond)
	if !errors.Is(err, ErrWaitTimeout) {
		t.Fatalf("waitForSelection() error = %v, want ErrWaitTimeout", err)
	}
	if record.Status != StatusPending {
		t.Fatalf("record status = %q, want still pending after timeout", record.Status)
	}

	// A late decision after the block timed out must still be recorded and retrievable.
	if _, err := store.Decide(projectID, created.ID, DecisionRequest{OptionID: "sweet"}); err != nil {
		t.Fatalf("late Decide() error = %v", err)
	}
	retrieved, ok, err := store.Get(projectID, created.ID)
	if err != nil || !ok {
		t.Fatalf("Get() = %v ok=%v", err, ok)
	}
	if retrieved.Status != StatusSelected || retrieved.Decision.OptionID != "sweet" {
		t.Fatalf("retrieved = %#v, want selected sweet", retrieved)
	}
}

func TestSelectionWaitCancelledByContext(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = store.waitForSelection(ctx, projectID, created.ID, 5*time.Second, 10*time.Millisecond)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("waitForSelection() error = %v, want context.Canceled", err)
	}
}

func TestSelectionListSweepsExpired(t *testing.T) {
	store, repo, projectID := newTestStore(t)

	// A fresh pending selection stays; an already-expired one gets swept.
	fresh, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	past := domain.TimeFromString("2026-01-01T00:00:00Z")
	stale := domain.AgentSelectionModel{
		ProjectID:   projectID,
		ID:          "selection-stale",
		Title:       "过期选择",
		OptionsJSON: `[{"id":"a","label":"A"}]`,
		Status:      StatusPending,
		CreatedAt:   past,
		ExpiresAt:   &past,
	}
	if err := repo.CreateAgentSelection(stale); err != nil {
		t.Fatalf("creating stale selection: %v", err)
	}

	pending, err := store.ListPending(projectID)
	if err != nil {
		t.Fatalf("ListPending() error = %v", err)
	}
	if len(pending) != 1 || pending[0].ID != fresh.ID {
		t.Fatalf("pending = %#v, want only the fresh selection", pending)
	}

	swept, ok, err := store.Get(projectID, "selection-stale")
	if err != nil || !ok {
		t.Fatalf("Get(stale) = %v ok=%v", err, ok)
	}
	if swept.Status != StatusExpired {
		t.Fatalf("stale status = %q, want expired", swept.Status)
	}
}

func TestClampTimeout(t *testing.T) {
	tests := []struct {
		name string
		in   time.Duration
		want time.Duration
	}{
		{"zero uses default", 0, DefaultTimeout},
		{"below min", 5 * time.Second, MinTimeout},
		{"above max", time.Hour, MaxTimeout},
		{"within range", 2 * time.Minute, 2 * time.Minute},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClampTimeout(tt.in); got != tt.want {
				t.Fatalf("ClampTimeout(%v) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestSelectionGenerationParamsField(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, CreateRequest{
		SessionID: "session-1",
		RunID:     "run-1",
		Kind:      "generation_plan",
		Title:     "确认生成参数",
		Fields: []FormField{
			{ID: "generation", Label: "模型与参数", Type: FieldTypeGenerationParams},
			{ID: "optimizePrompt", Label: "优化提示词", Type: FieldTypeToggle, Default: true},
		},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	decided, err := store.Decide(projectID, created.ID, DecisionRequest{
		Values: map[string]any{
			"generation": map[string]any{
				"routeId": "mediago.gpt-image-2",
				"label":   "MediaGo · GPT Image 2",
				"params":  map[string]any{"aspectRatio": "16:9", "resolution": "4K", "n": float64(4)},
				"junk":    "dropped",
			},
			"optimizePrompt": true,
		},
	})
	if err != nil {
		t.Fatalf("Decide() error = %v", err)
	}
	if decided.Status != StatusSubmitted {
		t.Fatalf("decided.Status = %q, want submitted", decided.Status)
	}
	generation, ok := decided.Decision.Values["generation"].(map[string]any)
	if !ok {
		t.Fatalf("generation value = %#v, want an object", decided.Decision.Values["generation"])
	}
	if generation["routeId"] != "mediago.gpt-image-2" || generation["label"] != "MediaGo · GPT Image 2" {
		t.Fatalf("generation = %#v, want sanitized routeId and label", generation)
	}
	if _, hasJunk := generation["junk"]; hasJunk {
		t.Fatalf("generation kept unknown key junk: %#v", generation)
	}
	params, ok := generation["params"].(map[string]any)
	if !ok || params["aspectRatio"] != "16:9" {
		t.Fatalf("generation params = %#v, want the submitted params", generation["params"])
	}
}

func TestSelectionGenerationParamsFieldRejectsMissingRoute(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, CreateRequest{
		SessionID: "session-1",
		RunID:     "run-1",
		Kind:      "generation_plan",
		Title:     "确认生成参数",
		Fields:    []FormField{{ID: "generation", Label: "模型与参数", Type: FieldTypeGenerationParams}},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := store.Decide(projectID, created.ID, DecisionRequest{
		Values: map[string]any{"generation": map[string]any{"params": map[string]any{}}},
	}); err == nil {
		t.Fatalf("Decide() accepted a generation value without routeId")
	}
	if _, err := store.Decide(projectID, created.ID, DecisionRequest{
		Values: map[string]any{"generation": "mediago.gpt-image-2"},
	}); err == nil {
		t.Fatalf("Decide() accepted a non-object generation value")
	}
}

func TestValidateImagesFieldValues(t *testing.T) {
	max := 3.0
	field := FormField{ID: "refs", Type: FieldTypeImages, Max: &max}

	value, err := validateFormValue(field, []any{"asset-a", " asset-a ", "asset-b", ""})
	if err != nil {
		t.Fatalf("validateFormValue() error = %v", err)
	}
	ids, ok := value.([]any)
	if !ok || len(ids) != 2 || ids[0] != "asset-a" || ids[1] != "asset-b" {
		t.Fatalf("value = %#v, want deduplicated trimmed ids", value)
	}

	if _, err := validateFormValue(field, []any{"a", "b", "c", "d"}); err == nil {
		t.Fatal("want error when exceeding max image count")
	}
	if _, err := validateFormValue(field, "not-an-array"); err == nil {
		t.Fatal("want error for non-array value")
	}
	if _, err := validateFormValue(field, []any{42}); err == nil {
		t.Fatal("want error for non-string item")
	}

	required := FormField{ID: "refs", Type: FieldTypeImages, Required: true}
	if _, err := validateFormValue(required, []any{""}); err == nil {
		t.Fatal("want error when required field resolves to zero images")
	}
}

func TestValidatePromptOptimizationFieldValues(t *testing.T) {
	field := FormField{ID: "optimize", Type: FieldTypePromptOptimization}

	disabled, err := validateFormValue(field, map[string]any{"enabled": false, "routeId": "stale"})
	if err != nil {
		t.Fatalf("validateFormValue() error = %v", err)
	}
	if object, ok := disabled.(map[string]any); !ok || len(object) != 1 || object["enabled"] != false {
		t.Fatalf("disabled value = %#v, want collapsed {enabled: false}", disabled)
	}

	enabled, err := validateFormValue(field, map[string]any{
		"enabled":         true,
		"routeId":         " official.minimax-m3 ",
		"referenceName":   "2D动漫",
		"referencePrompt": "纯正2D日系动漫插画",
		"label":           "",
	})
	if err != nil {
		t.Fatalf("validateFormValue() error = %v", err)
	}
	object, ok := enabled.(map[string]any)
	if !ok ||
		object["enabled"] != true ||
		object["routeId"] != "official.minimax-m3" ||
		object["referenceName"] != "2D动漫" {
		t.Fatalf("enabled value = %#v, want trimmed known fields", enabled)
	}
	if _, present := object["label"]; present {
		t.Fatal("empty label should be dropped")
	}

	if _, err := validateFormValue(field, "on"); err == nil {
		t.Fatal("want error for non-object value")
	}
	if _, err := validateFormValue(field, map[string]any{"routeId": "x"}); err == nil {
		t.Fatal("want error when enabled flag is missing")
	}
	if _, err := validateFormValue(field, map[string]any{"enabled": true, "routeId": 42}); err == nil {
		t.Fatal("want error for non-string routeId")
	}
}
