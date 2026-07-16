package selection

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
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

func sampleGenerationIntent(prompt string) *GenerationPlanIntent {
	return sampleGenerationIntentFor("image", GenerationPlanOperationCreateSingle, prompt)
}

func sampleGenerationIntentFor(kind string, operation string, prompt string) *GenerationPlanIntent {
	return &GenerationPlanIntent{
		Version:   GenerationPlanIntentVersion,
		Operation: operation,
		Items: []GenerationPlanIntentItem{{
			ID:     "item-1",
			Kind:   kind,
			Prompt: prompt,
		}},
	}
}

func sampleGenerationSettingsField(kind string) FormField {
	return FormField{ID: "settings", Type: FieldTypeGenerationSettings, Kind: kind}
}

func sampleGenerationPlanRequest(kind string, operation string) CreateRequest {
	return CreateRequest{
		SessionID: "session-generation-plan",
		RunID:     "run-generation-plan",
		Kind:      KindGenerationPlan,
		Title:     "确认生成设置",
		Fields:    []FormField{sampleGenerationSettingsField(kind)},
		Intent:    sampleGenerationIntentFor(kind, operation, "生成一个画面"),
	}
}

func createSubmittedSelection(t *testing.T, store *Service, projectID string) Record {
	t.Helper()
	request := sampleGenerationPlanRequest("image", GenerationPlanOperationCreateSingle)
	request.SessionID = "session-generation"
	request.RunID = "run-generation"
	request.Intent.Items[0].Prompt = "一只猫"
	created, err := store.Create(projectID, request)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	decided, err := store.Decide(projectID, created.ID, DecisionRequest{
		Values: map[string]any{"settings": sampleImageGenerationSettingsValue()},
	})
	if err != nil {
		t.Fatalf("Decide() error = %v", err)
	}
	if decided.Status != StatusSubmitted {
		t.Fatalf("Decide() status = %q, want %q", decided.Status, StatusSubmitted)
	}
	return decided
}

func TestSelectionPersistsGenerationIntentAndValidatesVersion(t *testing.T) {
	store, repo, projectID := newTestStore(t)
	request := sampleCreate()
	request.Intent = sampleGenerationIntent(" 一只猫 ")
	created, err := store.Create(projectID, request)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Intent == nil || created.Intent.Version != GenerationPlanIntentVersion || created.Intent.Items[0].Prompt != "一只猫" {
		t.Fatalf("Create() intent = %#v, want normalized versioned intent", created.Intent)
	}
	model, err := repo.GetAgentSelection(projectID, created.ID)
	if err != nil {
		t.Fatalf("GetAgentSelection() error = %v", err)
	}
	if model.IntentJSON == "" {
		t.Fatal("persisted IntentJSON is empty")
	}
	reloaded, ok, err := store.Get(projectID, created.ID)
	if err != nil || !ok {
		t.Fatalf("Get() = %#v, ok=%v, error=%v", reloaded, ok, err)
	}
	if reloaded.Intent == nil || reloaded.Intent.Version != GenerationPlanIntentVersion || reloaded.Intent.Items[0].Prompt != "一只猫" {
		t.Fatalf("Get() intent = %#v, want normalized persisted intent", reloaded.Intent)
	}

	invalid := sampleCreate()
	invalid.Intent = &GenerationPlanIntent{Version: 2, Operation: "create_single"}
	if _, err := store.Create(projectID, invalid); !errors.Is(err, ErrInvalidGenerationPlanIntent) {
		t.Fatalf("Create(version=2) error = %v, want ErrInvalidGenerationPlanIntent", err)
	}
	now := time.Now().UTC()
	expiresAt := now.Add(time.Hour)
	if err := repo.CreateAgentSelection(domain.AgentSelectionModel{
		ProjectID:   projectID,
		ID:          "selection-invalid-intent-version",
		SessionID:   "session-invalid-intent",
		RunID:       "run-invalid-intent",
		Kind:        "form",
		Title:       "Invalid intent",
		OptionsJSON: "[]",
		IntentJSON:  `{"version":2,"operation":"create_single","items":[]}`,
		Status:      StatusPending,
		CreatedAt:   now,
		ExpiresAt:   &expiresAt,
	}); err != nil {
		t.Fatalf("CreateAgentSelection(invalid intent) error = %v", err)
	}
	if _, _, err := store.Get(projectID, "selection-invalid-intent-version"); !errors.Is(err, ErrInvalidGenerationPlanIntent) {
		t.Fatalf("Get(invalid intent version) error = %v, want ErrInvalidGenerationPlanIntent", err)
	}
	if err := repo.CreateAgentSelection(domain.AgentSelectionModel{
		ProjectID:   projectID,
		ID:          "selection-oversized-intent",
		SessionID:   "session-oversized-intent",
		RunID:       "run-oversized-intent",
		Kind:        "form",
		Title:       "Oversized intent",
		OptionsJSON: "[]",
		IntentJSON:  strings.Repeat("x", MaxGenerationPlanIntentJSONBytes+1),
		Status:      StatusPending,
		CreatedAt:   now,
		ExpiresAt:   &expiresAt,
	}); err != nil {
		t.Fatalf("CreateAgentSelection(oversized intent) error = %v", err)
	}
	if _, _, err := store.Get(projectID, "selection-oversized-intent"); !errors.Is(err, ErrInvalidGenerationPlanIntent) {
		t.Fatalf("Get(oversized intent) error = %v, want ErrInvalidGenerationPlanIntent", err)
	}
}

func TestSelectionGenerationPlanRequiresIntentInCreateAndReuse(t *testing.T) {
	store, _, projectID := newTestStore(t)
	request := sampleGenerationPlanRequest("image", GenerationPlanOperationCreateSingle)
	request.Intent = nil

	if _, err := store.Create(projectID, request); !errors.Is(err, ErrInvalidGenerationPlanIntent) {
		t.Fatalf("Create(missing intent) error = %v, want ErrInvalidGenerationPlanIntent", err)
	}
	if _, ok, err := store.FindReusable(projectID, ReuseRequest{
		RunID:  request.RunID,
		Kind:   request.Kind,
		Title:  request.Title,
		Fields: request.Fields,
	}); !errors.Is(err, ErrInvalidGenerationPlanIntent) || ok {
		t.Fatalf("FindReusable(missing intent) ok=%v, error=%v; want ErrInvalidGenerationPlanIntent", ok, err)
	}
	if _, ok, err := store.FindReusable(projectID, ReuseRequest{
		Kind:   request.Kind,
		Fields: request.Fields,
	}); !errors.Is(err, ErrInvalidGenerationPlanIntent) || ok {
		t.Fatalf("FindReusable(missing intent and metadata) ok=%v, error=%v; want ErrInvalidGenerationPlanIntent", ok, err)
	}
}

func TestSelectionGenerationPlanIntentValidation(t *testing.T) {
	makeBatchItems := func(count int) []GenerationPlanIntentItem {
		items := make([]GenerationPlanIntentItem, 0, count)
		for index := 0; index < count; index++ {
			items = append(items, GenerationPlanIntentItem{
				ID:     fmt.Sprintf("item-%d", index),
				Kind:   "image",
				Prompt: "生成画面",
			})
		}
		return items
	}
	tests := []struct {
		name   string
		mutate func(*CreateRequest)
	}{
		{name: "unsupported version", mutate: func(request *CreateRequest) { request.Intent.Version = 2 }},
		{name: "unknown operation", mutate: func(request *CreateRequest) { request.Intent.Operation = "create_many" }},
		{name: "single has no items", mutate: func(request *CreateRequest) { request.Intent.Items = nil }},
		{name: "single has two items", mutate: func(request *CreateRequest) { request.Intent.Items = makeBatchItems(2) }},
		{name: "batch has no items", mutate: func(request *CreateRequest) {
			request.Intent.Operation = GenerationPlanOperationCreateBatch
			request.Intent.Items = nil
		}},
		{name: "batch exceeds limit", mutate: func(request *CreateRequest) {
			request.Intent.Operation = GenerationPlanOperationCreateBatch
			request.Intent.Items = makeBatchItems(MaxGenerationPlanIntentItems + 1)
		}},
		{name: "blank item id", mutate: func(request *CreateRequest) { request.Intent.Items[0].ID = "  " }},
		{name: "duplicate normalized item id", mutate: func(request *CreateRequest) {
			request.Intent.Operation = GenerationPlanOperationCreateBatch
			request.Intent.Items = makeBatchItems(2)
			request.Intent.Items[0].ID = " same "
			request.Intent.Items[1].ID = "same"
		}},
		{name: "blank prompt", mutate: func(request *CreateRequest) { request.Intent.Items[0].Prompt = "  " }},
		{name: "unsupported item kind", mutate: func(request *CreateRequest) { request.Intent.Items[0].Kind = "audio" }},
		{name: "field kind mismatch", mutate: func(request *CreateRequest) { request.Intent.Items[0].Kind = "video" }},
		{name: "retired retry operation", mutate: func(request *CreateRequest) { request.Intent.Operation = "retry" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store, _, projectID := newTestStore(t)
			request := sampleGenerationPlanRequest("image", GenerationPlanOperationCreateSingle)
			tt.mutate(&request)
			if _, err := store.Create(projectID, request); !errors.Is(err, ErrInvalidGenerationPlanIntent) {
				t.Fatalf("Create() error = %v, want ErrInvalidGenerationPlanIntent", err)
			}
		})
	}
}

func TestSelectionNormalizesGenerationPlanIntentAndUsesAuthoritativeProject(t *testing.T) {
	store, _, projectID := newTestStore(t)
	request := sampleGenerationPlanRequest("image", GenerationPlanOperationCreateBatch)
	request.Intent.ConversationTitle = " 批量角色图 "
	request.Intent.Items = []GenerationPlanIntentItem{
		{
			ID:                " second ",
			Kind:              " image ",
			Prompt:            " 第二张 ",
			AssetTitle:        " 角色乙 ",
			CapabilityID:      " capability-image ",
			ConversationID:    " session-batch ",
			ScopeID:           " scope-a ",
			DocumentID:        " doc-a ",
			SectionID:         " section-a ",
			ResourceType:      " character ",
			ReferenceAssetIDs: []string{" asset-a ", "asset-a", "", "asset-b"},
			DocumentContext: &GenerationDocumentContext{
				DocumentID: " doc-a ", SectionID: " section-a ",
			},
			NotificationTarget: &GenerationNotificationTarget{
				Kind: " document-section ", DocumentID: " doc-a ", DocumentTitle: " 第一集 ",
				Section: GenerationNotificationSectionTarget{
					BlockID: " section-a ", DocumentID: " doc-a ", HeadingText: " 角色乙 ",
					Markdown: " ## 角色乙 ", PlainText: " 角色乙 ", Prompt: " 第二张 ",
				},
			},
		},
		{ID: " first ", Kind: "image", Prompt: " 第一张 "},
	}
	created, err := store.Create(projectID, request)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	intent := created.Intent
	if intent == nil || intent.ConversationTitle != "批量角色图" || len(intent.Items) != 2 {
		t.Fatalf("normalized intent = %#v", intent)
	}
	if intent.Items[0].ID != "second" || intent.Items[1].ID != "first" {
		t.Fatalf("item order = %#v, want second then first", intent.Items)
	}
	first := intent.Items[0]
	if first.Kind != "image" || first.Prompt != "第二张" || first.AssetTitle != "角色乙" || first.ConversationID != "session-batch" || first.ResourceType != "character" {
		t.Fatalf("normalized item = %#v", first)
	}
	if got := first.ReferenceAssetIDs; len(got) != 2 || got[0] != "asset-a" || got[1] != "asset-b" {
		t.Fatalf("referenceAssetIds = %#v, want ordered unique ids", got)
	}
	if first.DocumentContext == nil || first.DocumentContext.ProjectID != projectID || first.DocumentContext.DocumentID != "doc-a" {
		t.Fatalf("documentContext = %#v, want authoritative project", first.DocumentContext)
	}
	if first.NotificationTarget == nil || first.NotificationTarget.ProjectID != projectID || first.NotificationTarget.Section.HeadingText != "角色乙" {
		t.Fatalf("notificationTarget = %#v, want normalized authoritative project", first.NotificationTarget)
	}
	request.Intent.Items[0].Prompt = "mutated after create"
	request.Intent.Items[0].ReferenceAssetIDs[0] = "mutated-asset"
	if created.Intent.Items[0].Prompt != "第二张" || created.Intent.Items[0].ReferenceAssetIDs[0] != "asset-a" {
		t.Fatalf("created intent aliases caller input: %#v", created.Intent.Items[0])
	}
}

func TestSelectionRejectsConflictingGenerationIntentProject(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*GenerationPlanIntentItem)
	}{
		{name: "document context", mutate: func(item *GenerationPlanIntentItem) {
			item.DocumentContext = &GenerationDocumentContext{ProjectID: "other-project", DocumentID: "doc-a"}
		}},
		{name: "notification target", mutate: func(item *GenerationPlanIntentItem) {
			item.NotificationTarget = &GenerationNotificationTarget{ProjectID: "other-project"}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store, _, projectID := newTestStore(t)
			request := sampleGenerationPlanRequest("image", GenerationPlanOperationCreateSingle)
			tt.mutate(&request.Intent.Items[0])
			if _, err := store.Create(projectID, request); !errors.Is(err, ErrInvalidGenerationPlanIntent) {
				t.Fatalf("Create() error = %v, want ErrInvalidGenerationPlanIntent", err)
			}
		})
	}
}

func TestSelectionGenerationPlanIntentRejectsOversizedPayload(t *testing.T) {
	store, _, projectID := newTestStore(t)
	request := sampleGenerationPlanRequest("image", GenerationPlanOperationCreateSingle)
	request.Intent.Items[0].Prompt = strings.Repeat("x", MaxGenerationPlanIntentJSONBytes)
	if _, err := store.Create(projectID, request); !errors.Is(err, ErrInvalidGenerationPlanIntent) {
		t.Fatalf("Create(oversized intent) error = %v, want ErrInvalidGenerationPlanIntent", err)
	}
}

func TestSelectionReadsHistoricalGenerationPlanWithoutIntent(t *testing.T) {
	store, repo, projectID := newTestStore(t)
	fieldsJSON, err := json.Marshal([]FormField{sampleGenerationSettingsField("image")})
	if err != nil {
		t.Fatalf("Marshal(fields) error = %v", err)
	}
	now := time.Now().UTC()
	expiresAt := now.Add(time.Hour)
	model := domain.AgentSelectionModel{
		ProjectID: projectID, ID: "selection-historical-generation-plan", SessionID: "session-old", RunID: "run-old",
		Kind: KindGenerationPlan, Title: "历史生成确认", OptionsJSON: "[]", FieldsJSON: string(fieldsJSON),
		Status: StatusPending, CreatedAt: now, ExpiresAt: &expiresAt,
	}
	if err := repo.CreateAgentSelection(model); err != nil {
		t.Fatalf("CreateAgentSelection() error = %v", err)
	}
	record, ok, err := store.Get(projectID, model.ID)
	if err != nil || !ok {
		t.Fatalf("Get() = %#v, ok=%v, error=%v", record, ok, err)
	}
	if record.Intent != nil {
		t.Fatalf("historical record intent = %#v, want nil", record.Intent)
	}
	if _, found, findErr := store.FindReusable(projectID, ReuseRequest{
		RunID: model.RunID, Kind: KindGenerationPlan, Title: model.Title, Fields: record.Fields,
	}); !errors.Is(findErr, ErrInvalidGenerationPlanIntent) || found {
		t.Fatalf("FindReusable(historical missing intent) found=%v, error=%v; want fail closed", found, findErr)
	}
}

func TestSelectionFindReusableIncludesIntentAndSkipsClaimed(t *testing.T) {
	store, _, projectID := newTestStore(t)
	request := sampleGenerationPlanRequest("image", GenerationPlanOperationCreateSingle)
	request.SessionID = "session-reuse-intent"
	request.RunID = "run-reuse-intent"
	request.Title = "确认生成"
	request.Prompt = "确认以下生成"
	request.Intent.Items[0].Prompt = "一只猫"
	request.Intent.Items[0].ReferenceAssetIDs = []string{" asset-a ", "asset-a", "asset-b"}
	request.Intent.Items[0].DocumentContext = &GenerationDocumentContext{DocumentID: " doc-a "}
	created, err := store.Create(projectID, request)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	reuseIntent := sampleGenerationIntent("一只猫")
	reuseIntent.Items[0].ReferenceAssetIDs = []string{"asset-a", "asset-b"}
	reuseIntent.Items[0].DocumentContext = &GenerationDocumentContext{
		ProjectID:  projectID,
		DocumentID: "doc-a",
	}
	reuse := ReuseRequest{
		SessionID: request.SessionID,
		RunID:     request.RunID,
		Kind:      request.Kind,
		Title:     request.Title,
		Prompt:    request.Prompt,
		Fields:    request.Fields,
		Intent:    reuseIntent,
	}
	if record, ok, findErr := store.FindReusable(projectID, reuse); findErr != nil || !ok || record.ID != created.ID {
		t.Fatalf("FindReusable(same intent) = %#v, ok=%v, error=%v; want %s", record, ok, findErr, created.ID)
	}
	equivalent := reuse
	equivalent.Intent = sampleGenerationIntent(" 一只猫 ")
	equivalent.Intent.Operation = " create_single "
	equivalent.Intent.Items[0].ID = " item-1 "
	equivalent.Intent.Items[0].Kind = " image "
	equivalent.Intent.Items[0].ReferenceAssetIDs = []string{" asset-a ", "asset-a", "", " asset-b "}
	equivalent.Intent.Items[0].DocumentContext = &GenerationDocumentContext{DocumentID: " doc-a "}
	if record, ok, findErr := store.FindReusable(projectID, equivalent); findErr != nil || !ok || record.ID != created.ID {
		t.Fatalf("FindReusable(equivalent normalized intent) = %#v, ok=%v, error=%v; want %s", record, ok, findErr, created.ID)
	}
	otherSession := reuse
	otherSession.SessionID = "session-other"
	if record, ok, findErr := store.FindReusable(projectID, otherSession); findErr != nil || ok {
		t.Fatalf("FindReusable(other session) = %#v, ok=%v, error=%v; want no reuse", record, ok, findErr)
	}
	different := reuse
	different.Intent = sampleGenerationIntent("一只狗")
	different.Intent.Items[0].ReferenceAssetIDs = []string{"asset-a", "asset-b"}
	different.Intent.Items[0].DocumentContext = &GenerationDocumentContext{
		ProjectID:  projectID,
		DocumentID: "doc-a",
	}
	if record, ok, findErr := store.FindReusable(projectID, different); findErr != nil || ok {
		t.Fatalf("FindReusable(different intent) = %#v, ok=%v, error=%v; want no reuse", record, ok, findErr)
	}

	decided, err := store.Decide(projectID, created.ID, DecisionRequest{Values: map[string]any{"settings": sampleImageGenerationSettingsValue()}})
	if err != nil {
		t.Fatalf("Decide() error = %v", err)
	}
	if record, ok, findErr := store.FindReusable(projectID, reuse); findErr != nil || !ok || record.ID != decided.ID {
		t.Fatalf("FindReusable(submitted unclaimed) = %#v, ok=%v, error=%v; want %s", record, ok, findErr, decided.ID)
	}
	claim, err := store.ClaimGenerationUse(projectID, request.SessionID, request.RunID, decided.ID, "fingerprint-reuse")
	if err != nil || claim.Status != GenerationUseClaimed {
		t.Fatalf("ClaimGenerationUse() = %#v, error=%v; want claimed", claim, err)
	}
	if record, ok, findErr := store.FindReusable(projectID, reuse); findErr != nil || ok {
		t.Fatalf("FindReusable(claimed) = %#v, ok=%v, error=%v; want no reuse", record, ok, findErr)
	}
}

func TestSelectionFindReusablePreservesGenerationIntentItemOrder(t *testing.T) {
	store, _, projectID := newTestStore(t)
	request := sampleGenerationPlanRequest("image", GenerationPlanOperationCreateBatch)
	request.Intent.Items = []GenerationPlanIntentItem{
		{ID: "first", Kind: "image", Prompt: "第一张"},
		{ID: "second", Kind: "image", Prompt: "第二张"},
	}
	created, err := store.Create(projectID, request)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	reuse := ReuseRequest{
		RunID:  request.RunID,
		Kind:   request.Kind,
		Title:  request.Title,
		Fields: request.Fields,
		Intent: &GenerationPlanIntent{
			Version:   GenerationPlanIntentVersion,
			Operation: GenerationPlanOperationCreateBatch,
			Items: []GenerationPlanIntentItem{
				{ID: "first", Kind: "image", Prompt: "第一张"},
				{ID: "second", Kind: "image", Prompt: "第二张"},
			},
		},
	}
	if record, ok, findErr := store.FindReusable(projectID, reuse); findErr != nil || !ok || record.ID != created.ID {
		t.Fatalf("FindReusable(same ordered batch) = %#v, ok=%v, error=%v; want %s", record, ok, findErr, created.ID)
	}
	swapped := reuse
	swapped.Intent = &GenerationPlanIntent{
		Version:   GenerationPlanIntentVersion,
		Operation: GenerationPlanOperationCreateBatch,
		Items: []GenerationPlanIntentItem{
			{ID: "second", Kind: "image", Prompt: "第二张"},
			{ID: "first", Kind: "image", Prompt: "第一张"},
		},
	}
	if record, ok, findErr := store.FindReusable(projectID, swapped); findErr != nil || ok {
		t.Fatalf("FindReusable(reordered batch) = %#v, ok=%v, error=%v; want no reuse", record, ok, findErr)
	}
}

func TestSelectionClaimGenerationUseLifecycle(t *testing.T) {
	store, _, projectID := newTestStore(t)
	selection := createSubmittedSelection(t, store, projectID)

	first, err := store.ClaimGenerationUse(projectID, selection.SessionID, selection.RunID, selection.ID, "fingerprint-a")
	if err != nil || first.Status != GenerationUseClaimed || len(first.Outcome) != 0 {
		t.Fatalf("first ClaimGenerationUse() = %#v, error=%v; want claimed", first, err)
	}
	second, err := store.ClaimGenerationUse(projectID, selection.SessionID, selection.RunID, selection.ID, "fingerprint-a")
	if err != nil || second.Status != GenerationUseInProgressOrUnknown {
		t.Fatalf("second ClaimGenerationUse() = %#v, error=%v; want in_progress_or_unknown", second, err)
	}
	conflict, err := store.ClaimGenerationUse(projectID, selection.SessionID, selection.RunID, selection.ID, "fingerprint-b")
	if err != nil || conflict.Status != GenerationUseConflict {
		t.Fatalf("conflicting ClaimGenerationUse() = %#v, error=%v; want conflict", conflict, err)
	}

	outcome := json.RawMessage(`{"version":1,"result":{"taskId":"task-1"}}`)
	if err := store.CompleteGenerationUse(projectID, selection.ID, "fingerprint-a", outcome); err != nil {
		t.Fatalf("CompleteGenerationUse() error = %v", err)
	}
	// Completing the same result is idempotent, but a different result cannot
	// overwrite the persisted replay value.
	if err := store.CompleteGenerationUse(projectID, selection.ID, "fingerprint-a", outcome); err != nil {
		t.Fatalf("second CompleteGenerationUse(same) error = %v", err)
	}
	if err := store.CompleteGenerationUse(projectID, selection.ID, "fingerprint-a", json.RawMessage(`{"version":1,"result":{"taskId":"task-2"}}`)); !errors.Is(err, ErrGenerationUseConflict) {
		t.Fatalf("CompleteGenerationUse(different) error = %v, want ErrGenerationUseConflict", err)
	}

	replay, err := store.ClaimGenerationUse(projectID, selection.SessionID, selection.RunID, selection.ID, "fingerprint-a")
	if err != nil || replay.Status != GenerationUseReplay || string(replay.Outcome) != string(outcome) {
		t.Fatalf("replay ClaimGenerationUse() = %#v, error=%v; want saved outcome", replay, err)
	}
	persisted, ok, err := store.Get(projectID, selection.ID)
	if err != nil || !ok {
		t.Fatalf("Get(completed selection) = %#v, ok=%v, error=%v", persisted, ok, err)
	}
	if persisted.GenerationClaimFingerprint != "fingerprint-a" || persisted.GenerationClaimedAt == "" || persisted.GenerationCompletedAt == "" || string(persisted.GenerationOutcome) != string(outcome) {
		t.Fatalf("completed record = %#v, want persisted claim metadata and outcome", persisted)
	}
}

func TestSelectionClaimGenerationUseReplaysClaimAfterSelectionExpiry(t *testing.T) {
	store, repo, projectID := newTestStore(t)
	now := time.Now().UTC()
	expiresAt := now.Add(-time.Minute)
	claimedAt := now.Add(-time.Hour)
	completedAt := now.Add(-30 * time.Minute)
	base := domain.AgentSelectionModel{
		ProjectID: projectID, SessionID: "session-expired-claim", RunID: "run-expired-claim",
		Kind: KindGenerationPlan, Title: "Expired claimed generation", OptionsJSON: "[]",
		FieldsJSON: `[{"id":"settings","type":"generation_settings","kind":"image","required":true}]`,
		IntentJSON: `{"version":1,"operation":"create_single","items":[{"id":"item-1","kind":"image","prompt":"一只猫"}]}`,
		Status:     StatusSubmitted, DecisionJSON: `{"values":{"settings":{"kind":"image","routeId":"route-image","params":{},"referenceAssetIds":[],"promptSupplements":[],"promptOptimization":{"enabled":false}}}}`,
		CreatedAt: now.Add(-2 * time.Hour), DecidedAt: &claimedAt, ExpiresAt: &expiresAt,
		GenerationClaimFingerprint: "fingerprint-expired", GenerationClaimedAt: &claimedAt,
	}
	unknown := base
	unknown.ID = "selection-expired-unknown"
	if err := repo.CreateAgentSelection(unknown); err != nil {
		t.Fatalf("CreateAgentSelection(unknown) error = %v", err)
	}
	result, err := store.ClaimGenerationUse(projectID, unknown.SessionID, unknown.RunID, unknown.ID, "fingerprint-expired")
	if err != nil || result.Status != GenerationUseInProgressOrUnknown {
		t.Fatalf("ClaimGenerationUse(expired unknown) = %#v, error=%v", result, err)
	}

	outcome := `{"version":1,"result":{"taskId":"task-expired"}}`
	completed := base
	completed.ID = "selection-expired-completed"
	completed.GenerationOutcomeJSON = outcome
	completed.GenerationCompletedAt = &completedAt
	if err := repo.CreateAgentSelection(completed); err != nil {
		t.Fatalf("CreateAgentSelection(completed) error = %v", err)
	}
	result, err = store.ClaimGenerationUse(projectID, completed.SessionID, completed.RunID, completed.ID, "fingerprint-expired")
	if err != nil || result.Status != GenerationUseReplay || string(result.Outcome) != outcome {
		t.Fatalf("ClaimGenerationUse(expired replay) = %#v, error=%v", result, err)
	}
}

func TestSelectionClaimGenerationUseIsAtomic(t *testing.T) {
	store, _, projectID := newTestStore(t)
	selection := createSubmittedSelection(t, store, projectID)

	const callers = 20
	results := make(chan GenerationUseClaimResult, callers)
	errorsCh := make(chan error, callers)
	start := make(chan struct{})
	var group sync.WaitGroup
	for index := 0; index < callers; index++ {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			result, err := store.ClaimGenerationUse(projectID, selection.SessionID, selection.RunID, selection.ID, "fingerprint-concurrent")
			results <- result
			errorsCh <- err
		}()
	}
	close(start)
	group.Wait()
	close(results)
	close(errorsCh)

	for err := range errorsCh {
		if err != nil {
			t.Fatalf("concurrent ClaimGenerationUse() error = %v", err)
		}
	}
	claimed := 0
	unknown := 0
	for result := range results {
		switch result.Status {
		case GenerationUseClaimed:
			claimed++
		case GenerationUseInProgressOrUnknown:
			unknown++
		default:
			t.Fatalf("concurrent ClaimGenerationUse() status = %q", result.Status)
		}
	}
	if claimed != 1 || unknown != callers-1 {
		t.Fatalf("concurrent claims: claimed=%d unknown=%d, want 1/%d", claimed, unknown, callers-1)
	}
}

func TestSelectionClaimGenerationUseRejectsInvalidAuthorization(t *testing.T) {
	store, repo, projectID := newTestStore(t)
	submitted := createSubmittedSelection(t, store, projectID)
	pending, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create(pending) error = %v", err)
	}
	now := time.Now().UTC()
	expiresAt := now.Add(-time.Minute)
	expired := domain.AgentSelectionModel{
		ProjectID:    projectID,
		ID:           "selection-expired-generation",
		SessionID:    submitted.SessionID,
		RunID:        submitted.RunID,
		Kind:         KindGenerationPlan,
		Title:        "Expired",
		OptionsJSON:  "[]",
		FieldsJSON:   `[{"id":"settings","type":"generation_settings","kind":"image","required":true}]`,
		IntentJSON:   `{"version":1,"operation":"create_single","items":[{"id":"item-1","kind":"image","prompt":"expired"}]}`,
		Status:       StatusSubmitted,
		DecisionJSON: `{"values":{"settings":{"kind":"image","routeId":"route-image","params":{},"referenceAssetIds":[],"promptSupplements":[],"promptOptimization":{"enabled":false}}}}`,
		CreatedAt:    now.Add(-time.Hour),
		ExpiresAt:    &expiresAt,
	}
	if err := repo.CreateAgentSelection(expired); err != nil {
		t.Fatalf("CreateAgentSelection(expired) error = %v", err)
	}
	ordinary, err := store.Create(projectID, CreateRequest{
		SessionID: "session-ordinary-form",
		RunID:     "run-ordinary-form",
		Kind:      "form",
		Title:     "普通表单",
		Fields:    []FormField{{ID: "confirm", Type: FieldTypeText, Required: true}},
	})
	if err != nil {
		t.Fatalf("Create(ordinary form) error = %v", err)
	}
	ordinary, err = store.Decide(projectID, ordinary.ID, DecisionRequest{Values: map[string]any{"confirm": "yes"}})
	if err != nil {
		t.Fatalf("Decide(ordinary form) error = %v", err)
	}
	validIntent := `{"version":1,"operation":"create_single","items":[{"id":"item-1","kind":"image","prompt":"test"}]}`
	validFields := `[{"id":"settings","type":"generation_settings","kind":"image","required":true}]`
	validDecision := `{"values":{"settings":{"kind":"image","routeId":"route-image","params":{},"referenceAssetIds":[],"promptSupplements":[],"promptOptimization":{"enabled":false}}}}`
	corruptExpiresAt := now.Add(time.Hour)
	corruptFixtures := []domain.AgentSelectionModel{
		{
			ProjectID: projectID, ID: "selection-corrupt-intent", SessionID: submitted.SessionID, RunID: submitted.RunID,
			Kind: KindGenerationPlan, Title: "Corrupt intent", OptionsJSON: "[]", FieldsJSON: validFields,
			IntentJSON: `{not-json`, Status: StatusSubmitted, DecisionJSON: validDecision, CreatedAt: now, ExpiresAt: &corruptExpiresAt,
		},
		{
			ProjectID: projectID, ID: "selection-unsupported-intent", SessionID: submitted.SessionID, RunID: submitted.RunID,
			Kind: KindGenerationPlan, Title: "Unsupported intent", OptionsJSON: "[]", FieldsJSON: validFields,
			IntentJSON: `{"version":2,"operation":"create_single","items":[{"id":"item-1","kind":"image","prompt":"test"}]}`, Status: StatusSubmitted, DecisionJSON: validDecision, CreatedAt: now, ExpiresAt: &corruptExpiresAt,
		},
		{
			ProjectID: projectID, ID: "selection-missing-decision", SessionID: submitted.SessionID, RunID: submitted.RunID,
			Kind: KindGenerationPlan, Title: "Missing decision", OptionsJSON: "[]", FieldsJSON: validFields,
			IntentJSON: validIntent, Status: StatusSubmitted, CreatedAt: now, ExpiresAt: &corruptExpiresAt,
		},
		{
			ProjectID: projectID, ID: "selection-invalid-decision", SessionID: submitted.SessionID, RunID: submitted.RunID,
			Kind: KindGenerationPlan, Title: "Invalid decision", OptionsJSON: "[]", FieldsJSON: validFields,
			IntentJSON: validIntent, Status: StatusSubmitted, DecisionJSON: `{"values":{"settings":{"kind":"video"}}}`, CreatedAt: now, ExpiresAt: &corruptExpiresAt,
		},
	}
	for _, fixture := range corruptFixtures {
		if err := repo.CreateAgentSelection(fixture); err != nil {
			t.Fatalf("CreateAgentSelection(%s) error = %v", fixture.ID, err)
		}
	}

	tests := []struct {
		name        string
		projectID   string
		sessionID   string
		runID       string
		selectionID string
		fingerprint string
	}{
		{name: "wrong project", projectID: "other-project", sessionID: submitted.SessionID, runID: submitted.RunID, selectionID: submitted.ID, fingerprint: "fp"},
		{name: "wrong session", projectID: projectID, sessionID: "other-session", runID: submitted.RunID, selectionID: submitted.ID, fingerprint: "fp"},
		{name: "wrong run", projectID: projectID, sessionID: submitted.SessionID, runID: "other-run", selectionID: submitted.ID, fingerprint: "fp"},
		{name: "pending", projectID: projectID, sessionID: pending.SessionID, runID: pending.RunID, selectionID: pending.ID, fingerprint: "fp"},
		{name: "expired", projectID: projectID, sessionID: expired.SessionID, runID: expired.RunID, selectionID: expired.ID, fingerprint: "fp"},
		{name: "ordinary submitted form", projectID: projectID, sessionID: ordinary.SessionID, runID: ordinary.RunID, selectionID: ordinary.ID, fingerprint: "fp"},
		{name: "corrupt intent", projectID: projectID, sessionID: submitted.SessionID, runID: submitted.RunID, selectionID: "selection-corrupt-intent", fingerprint: "fp"},
		{name: "unsupported intent", projectID: projectID, sessionID: submitted.SessionID, runID: submitted.RunID, selectionID: "selection-unsupported-intent", fingerprint: "fp"},
		{name: "missing decision", projectID: projectID, sessionID: submitted.SessionID, runID: submitted.RunID, selectionID: "selection-missing-decision", fingerprint: "fp"},
		{name: "invalid decision", projectID: projectID, sessionID: submitted.SessionID, runID: submitted.RunID, selectionID: "selection-invalid-decision", fingerprint: "fp"},
		{name: "empty fingerprint", projectID: projectID, sessionID: submitted.SessionID, runID: submitted.RunID, selectionID: submitted.ID},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, claimErr := store.ClaimGenerationUse(tt.projectID, tt.sessionID, tt.runID, tt.selectionID, tt.fingerprint)
			if !errors.Is(claimErr, ErrGenerationUseNotAuthorized) {
				t.Fatalf("ClaimGenerationUse() = %#v, error=%v; want ErrGenerationUseNotAuthorized", result, claimErr)
			}
		})
	}
}

func TestSelectionCompleteGenerationUseValidatesOutcomeEnvelope(t *testing.T) {
	store, _, projectID := newTestStore(t)
	selection := createSubmittedSelection(t, store, projectID)
	if _, err := store.ClaimGenerationUse(projectID, selection.SessionID, selection.RunID, selection.ID, "fingerprint-outcome"); err != nil {
		t.Fatalf("ClaimGenerationUse() error = %v", err)
	}
	for _, tt := range []struct {
		name    string
		outcome json.RawMessage
	}{
		{name: "malformed", outcome: json.RawMessage(`not-json`)},
		{name: "unsupported version", outcome: json.RawMessage(`{"version":2,"result":{}}`)},
		{name: "array", outcome: json.RawMessage(`[]`)},
		{name: "null", outcome: json.RawMessage(`null`)},
		{name: "oversized", outcome: json.RawMessage(`{"version":1,"result":"` + strings.Repeat("x", MaxGenerationOutcomeJSONBytes) + `"}`)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if err := store.CompleteGenerationUse(projectID, selection.ID, "fingerprint-outcome", tt.outcome); !errors.Is(err, ErrInvalidGenerationOutcome) {
				t.Fatalf("CompleteGenerationUse() error = %v, want ErrInvalidGenerationOutcome", err)
			}
		})
	}
}

func TestSelectionFindReusableSkipsExpiredDecidedSelection(t *testing.T) {
	store, repo, projectID := newTestStore(t)
	now := time.Now().UTC()
	expiresAt := now.Add(-time.Minute)
	model := domain.AgentSelectionModel{
		ProjectID: projectID, ID: "selection-expired-decided-reuse", SessionID: "session-expired-reuse", RunID: "run-expired-reuse",
		Kind: "image_style", Title: "选择风格", Prompt: "确认风格", OptionsJSON: `[{"id":"anime","label":"动漫"}]`,
		Status: StatusSelected, DecisionJSON: `{"optionId":"anime"}`, CreatedAt: now.Add(-time.Hour), DecidedAt: &now, ExpiresAt: &expiresAt,
	}
	if err := repo.CreateAgentSelection(model); err != nil {
		t.Fatalf("CreateAgentSelection() error = %v", err)
	}
	if record, ok, err := store.FindReusable(projectID, ReuseRequest{
		SessionID: model.SessionID,
		RunID:     model.RunID,
		Kind:      model.Kind,
		Title:     model.Title,
		Prompt:    model.Prompt,
		Options:   []Option{{ID: "anime", Label: "动漫"}},
	}); err != nil || ok {
		t.Fatalf("FindReusable(expired decided) = %#v, ok=%v, error=%v; want no reuse", record, ok, err)
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

func TestSelectionDecideRejectsTerminalRun(t *testing.T) {
	tests := []struct {
		name       string
		runStatus  string
		wantStatus string
		cancelled  bool
	}{
		{name: "cancelled run", runStatus: "cancelled", wantStatus: StatusCancelled, cancelled: true},
		{name: "completed run", runStatus: "completed", wantStatus: StatusExpired},
		{name: "failed run", runStatus: "failed", wantStatus: StatusExpired},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store, _, projectID := newTestStore(t)
			store.SetRunDecisionGuard(staticRunDecisionGuard{status: tt.runStatus, found: true})
			created, err := store.Create(projectID, sampleCreate())
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}

			decided, err := store.Decide(projectID, created.ID, DecisionRequest{OptionID: "sweet"})
			if err != nil {
				t.Fatalf("Decide() error = %v", err)
			}
			if decided.Status != tt.wantStatus {
				t.Fatalf("Decide() status = %q, want %q", decided.Status, tt.wantStatus)
			}
			if tt.cancelled {
				if decided.Decision == nil || !decided.Decision.Cancelled {
					t.Fatalf("Decide() record = %#v, want cancelled decision", decided)
				}
			} else if decided.Decision != nil {
				t.Fatalf("Decide() record = %#v, want no accepted decision", decided)
			}
		})
	}
}

func TestSelectionDecideAcceptsActiveRun(t *testing.T) {
	store, _, projectID := newTestStore(t)
	store.SetRunDecisionGuard(staticRunDecisionGuard{status: "running", found: true})
	created, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	decided, err := store.Decide(projectID, created.ID, DecisionRequest{OptionID: "sweet"})
	if err != nil {
		t.Fatalf("Decide() error = %v", err)
	}
	if decided.Status != StatusSelected || decided.Decision == nil || decided.Decision.OptionID != "sweet" {
		t.Fatalf("Decide() record = %#v, want selected", decided)
	}
}

func TestSelectionDecideExpiresOrphanedRun(t *testing.T) {
	store, _, projectID := newTestStore(t)
	store.SetRunDecisionGuard(staticRunDecisionGuard{found: false})
	created, err := store.Create(projectID, sampleCreate())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	decided, err := store.Decide(projectID, created.ID, DecisionRequest{OptionID: "sweet"})
	if err != nil {
		t.Fatalf("Decide() error = %v", err)
	}
	if decided.Status != StatusExpired || decided.Decision != nil {
		t.Fatalf("Decide() record = %#v, want orphaned selection expired", decided)
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

func TestSelectionGetExpiresDuePending(t *testing.T) {
	store, repo, projectID := newTestStore(t)
	stale := createDueSelectionFixture(t, repo, projectID, "selection-get-due", "run-due", "image_style", "选择风格", "", nil)

	record, ok, err := store.Get(projectID, stale.ID)
	if err != nil || !ok {
		t.Fatalf("Get() = %#v, ok=%v, error=%v", record, ok, err)
	}
	if record.Status != StatusExpired || record.DecidedAt == "" {
		t.Fatalf("Get() record = %#v, want atomically expired", record)
	}
}

func TestSelectionDecideExpiresDuePendingInsteadOfSubmitting(t *testing.T) {
	store, repo, projectID := newTestStore(t)
	stale := createDueSelectionFixture(t, repo, projectID, "selection-decide-due", "run-due", "image_style", "选择风格", "", nil)

	record, err := store.Decide(projectID, stale.ID, DecisionRequest{OptionID: "a"})
	if err != nil {
		t.Fatalf("Decide() error = %v", err)
	}
	if record.Status != StatusExpired || record.Decision != nil {
		t.Fatalf("Decide() record = %#v, want expired without accepting decision", record)
	}
}

func TestSelectionWaitReturnsExpiredForDuePending(t *testing.T) {
	store, repo, projectID := newTestStore(t)
	stale := createDueSelectionFixture(t, repo, projectID, "selection-wait-due", "run-due", "image_style", "选择风格", "", nil)

	record, err := store.waitForSelection(context.Background(), projectID, stale.ID, time.Second, 10*time.Millisecond)
	if err != nil {
		t.Fatalf("waitForSelection() error = %v", err)
	}
	if record.Status != StatusExpired {
		t.Fatalf("waitForSelection() record = %#v, want expired", record)
	}
}

func TestSelectionFindReusableSkipsAndExpiresDuePending(t *testing.T) {
	store, repo, projectID := newTestStore(t)
	stale := createDueSelectionFixture(t, repo, projectID, "selection-reuse-due", "run-due", "image_style", "选择风格", "", nil)

	if record, ok, err := store.FindReusable(projectID, ReuseRequest{
		RunID:   "run-due",
		Kind:    "image_style",
		Title:   "选择风格",
		Options: []Option{{ID: "a", Label: "A"}},
	}); err != nil || ok {
		t.Fatalf("FindReusable() = %#v, ok=%v, error=%v; want no due reuse", record, ok, err)
	}
	record, ok, err := store.Get(projectID, stale.ID)
	if err != nil || !ok || record.Status != StatusExpired {
		t.Fatalf("Get() = %#v, ok=%v, error=%v; want expired", record, ok, err)
	}
}

func TestSelectionFindReusableSelectionMatchesPromptOptionsAndAllowCustom(t *testing.T) {
	store, _, projectID := newTestStore(t)
	options := []Option{
		{ID: "anime", Label: "动漫", ImageURL: "https://example.test/anime.png"},
		{ID: "real", Label: "写实", Description: "真实摄影质感"},
	}
	created, err := store.Create(projectID, CreateRequest{
		RunID:       "run-selection-reuse",
		Kind:        "image_style",
		Title:       "选择风格",
		Prompt:      "请选择画面风格",
		Options:     options,
		AllowCustom: true,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	reused, ok, err := store.FindReusable(projectID, ReuseRequest{
		RunID:       "run-selection-reuse",
		Kind:        "image_style",
		Title:       "选择风格",
		Prompt:      " 请选择画面风格 ",
		Options:     options,
		AllowCustom: true,
	})
	if err != nil || !ok || reused.ID != created.ID {
		t.Fatalf("FindReusable(same) = %#v, ok=%v, error=%v; want %s", reused, ok, err, created.ID)
	}

	requests := []ReuseRequest{
		{
			RunID:       "run-selection-reuse",
			Kind:        "image_style",
			Title:       "选择风格",
			Prompt:      "请选择另一种画面风格",
			Options:     options,
			AllowCustom: true,
		},
		{
			RunID:  "run-selection-reuse",
			Kind:   "image_style",
			Title:  "选择风格",
			Prompt: "请选择画面风格",
			Options: []Option{
				{ID: "comic", Label: "漫画"},
				{ID: "real", Label: "写实", Description: "真实摄影质感"},
			},
			AllowCustom: true,
		},
		{
			RunID:       "run-selection-reuse",
			Kind:        "image_style",
			Title:       "选择风格",
			Prompt:      "请选择画面风格",
			Options:     options,
			AllowCustom: false,
		},
	}
	for _, request := range requests {
		if record, found, findErr := store.FindReusable(projectID, request); findErr != nil || found {
			t.Fatalf("FindReusable(different selection) = %#v, ok=%v, error=%v; want no reuse", record, found, findErr)
		}
	}
}

func TestSelectionFindReusableFormMatchesPromptAndNormalizedFields(t *testing.T) {
	store, _, projectID := newTestStore(t)
	fields := []FormField{{
		ID:      "style",
		Label:   "风格",
		Type:    FieldTypeSelect,
		Default: "anime",
		Options: []FormFieldOption{{Value: "anime", Label: "动漫"}, {Value: "real", Label: "写实"}},
	}}
	created, err := store.Create(projectID, CreateRequest{
		RunID:  "run-form-reuse",
		Kind:   "scope_form",
		Title:  "生成范围",
		Prompt: "请选择生成风格",
		Fields: fields,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	reused, ok, err := store.FindReusable(projectID, ReuseRequest{
		RunID:  "run-form-reuse",
		Kind:   "scope_form",
		Title:  "生成范围",
		Prompt: " 请选择生成风格 ",
		Fields: []FormField{{
			ID:      "style",
			Label:   "风格",
			Type:    FieldTypeSelect,
			Default: "anime",
			Options: []FormFieldOption{{Value: " anime ", Label: " 动漫 "}, {Value: "real", Label: "写实"}},
		}},
	})
	if err != nil || !ok || reused.ID != created.ID {
		t.Fatalf("FindReusable(same) = %#v, ok=%v, error=%v; want %s", reused, ok, err, created.ID)
	}

	for _, request := range []ReuseRequest{
		{
			RunID:  "run-form-reuse",
			Kind:   "scope_form",
			Title:  "生成范围",
			Prompt: "另一个问题",
			Fields: fields,
		},
		{
			RunID:  "run-form-reuse",
			Kind:   "scope_form",
			Title:  "生成范围",
			Prompt: "请选择生成风格",
			Fields: []FormField{{
				ID:      "style",
				Label:   "风格",
				Type:    FieldTypeSelect,
				Default: "real",
				Options: fields[0].Options,
			}},
		},
	} {
		if record, found, findErr := store.FindReusable(projectID, request); findErr != nil || found {
			t.Fatalf("FindReusable(different plan) = %#v, ok=%v, error=%v; want no reuse", record, found, findErr)
		}
	}
}

func TestSelectionFindReusableGenerationPlanComparesDefaults(t *testing.T) {
	store, _, projectID := newTestStore(t)
	createdFields := []FormField{{
		ID:   "generation",
		Type: FieldTypeGenerationParams,
		Kind: "video",
		Default: map[string]any{
			"routeId": "route-a",
			"params":  map[string]any{"aspectRatio": "3:4", "n": float64(1)},
		},
	}}
	created, err := store.Create(projectID, CreateRequest{
		RunID:  "run-generation-reuse",
		Kind:   KindGenerationPlan,
		Title:  "生成参数",
		Prompt: "确认参数",
		Fields: createdFields,
		Intent: sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Fields[0].Required != true {
		t.Fatalf("created generation field = %#v, want server-derived required", created.Fields[0])
	}
	if reused, ok, findErr := store.FindReusable(projectID, ReuseRequest{
		RunID:  "run-generation-reuse",
		Kind:   KindGenerationPlan,
		Title:  "生成参数",
		Prompt: "确认参数",
		Fields: createdFields,
		Intent: sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
	}); findErr != nil || !ok || reused.ID != created.ID {
		t.Fatalf("FindReusable(same generation plan) = %#v, ok=%v, error=%v; want %s", reused, ok, findErr, created.ID)
	}

	requestFields := []FormField{{
		ID:   "generation",
		Type: FieldTypeGenerationParams,
		Kind: "video",
		Default: map[string]any{
			"routeId": "route-b",
			"params":  map[string]any{"aspectRatio": "16:9", "n": float64(4)},
		},
	}}
	if record, ok, err := store.FindReusable(projectID, ReuseRequest{
		RunID:  "run-generation-reuse",
		Kind:   KindGenerationPlan,
		Title:  "生成参数",
		Prompt: "确认参数",
		Fields: requestFields,
		Intent: sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
	}); err != nil || ok {
		t.Fatalf("FindReusable() = %#v, ok=%v, error=%v; want different generation plan", record, ok, err)
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
		Kind:      KindGenerationPlan,
		Title:     "确认生成参数",
		Fields: []FormField{
			{ID: "generation", Label: "模型与参数", Type: FieldTypeGenerationParams, Kind: "video"},
			{ID: "optimizePrompt", Label: "优化提示词", Type: FieldTypePromptOptimization, Default: true},
		},
		Intent: sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
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

func TestSelectionGenerationPlanEnforcesCompositeFieldContract(t *testing.T) {
	store, _, projectID := newTestStore(t)
	tests := []struct {
		name   string
		fields []FormField
	}{
		{
			name:   "missing generation params",
			fields: []FormField{{ID: "refs", Type: FieldTypeImages}},
		},
		{
			name: "duplicate generation params",
			fields: []FormField{
				{ID: "generation", Type: FieldTypeGenerationParams},
				{ID: "generationAgain", Type: FieldTypeGenerationParams},
			},
		},
		{
			name: "duplicate images",
			fields: []FormField{
				{ID: "generation", Type: FieldTypeGenerationParams},
				{ID: "refs", Type: FieldTypeImages},
				{ID: "moreRefs", Type: FieldTypeImages},
			},
		},
		{
			name: "duplicate prompt optimization",
			fields: []FormField{
				{ID: "generation", Type: FieldTypeGenerationParams},
				{ID: "optimize", Type: FieldTypePromptOptimization},
				{ID: "optimizeAgain", Type: FieldTypePromptOptimization},
			},
		},
		{
			name: "generic select",
			fields: []FormField{
				{ID: "generation", Type: FieldTypeGenerationParams},
				{ID: "style", Type: FieldTypeSelect, Options: []FormFieldOption{{Value: "anime", Label: "动漫"}}},
			},
		},
		{
			name: "generic toggle",
			fields: []FormField{
				{ID: "generation", Type: FieldTypeGenerationParams},
				{ID: "optimize", Type: FieldTypeToggle},
			},
		},
		{
			name: "generic number",
			fields: []FormField{
				{ID: "generation", Type: FieldTypeGenerationParams},
				{ID: "count", Type: FieldTypeNumber},
			},
		},
		{
			name: "generic text",
			fields: []FormField{
				{ID: "generation", Type: FieldTypeGenerationParams},
				{ID: "composition", Type: FieldTypeText},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := store.Create(projectID, CreateRequest{
				Kind:   KindGenerationPlan,
				Title:  "确认生成参数",
				Fields: tt.fields,
				Intent: sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
			})
			if !errors.Is(err, ErrInvalidGenerationPlan) {
				t.Fatalf("Create() error = %v, want ErrInvalidGenerationPlan", err)
			}
		})
	}
}

func TestSelectionGenerationPlanAcceptsCanonicalFields(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, CreateRequest{
		Kind:  KindGenerationPlan,
		Title: "确认生成参数",
		Fields: []FormField{
			{ID: "generation", Type: FieldTypeGenerationParams, Kind: "video"},
			{ID: "refs", Type: FieldTypeImages},
			{ID: "optimize", Type: FieldTypePromptOptimization},
		},
		Intent: sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(created.Fields) != 3 {
		t.Fatalf("created.Fields = %#v, want the three canonical fields", created.Fields)
	}
	if !created.Fields[0].Required {
		t.Fatalf("created.Fields[0].Required = false, want generation_params to be required")
	}
}

func TestSelectionGenerationPlanAcceptsSingleImageGenerationSettings(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, CreateRequest{
		Kind:  KindGenerationPlan,
		Title: "确认图片生成设置",
		Fields: []FormField{{
			ID:      "settings",
			Type:    FieldTypeGenerationSettings,
			Kind:    "image",
			Default: sampleImageGenerationSettingsValue(),
		}},
		Intent: sampleGenerationIntent("生成图片"),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(created.Fields) != 1 || !created.Fields[0].Required {
		t.Fatalf("created.Fields = %#v, want one required generation_settings", created.Fields)
	}
	defaultValue, ok := created.Fields[0].Default.(map[string]any)
	if !ok || defaultValue["kind"] != "image" || defaultValue["routeId"] != "route-image" {
		t.Fatalf("created default = %#v, want validated complete image settings", created.Fields[0].Default)
	}
	for _, key := range []string{"params", "referenceAssetIds", "promptSupplements", "promptOptimization"} {
		if _, exists := defaultValue[key]; !exists {
			t.Fatalf("created default = %#v, missing %s", defaultValue, key)
		}
	}

	decided, err := store.Decide(projectID, created.ID, DecisionRequest{Values: map[string]any{
		"settings": map[string]any{
			"kind":              "image",
			"routeId":           " route-image ",
			"label":             " Seedream 5 ",
			"params":            map[string]any{"ratio": "3:4", "n": float64(2)},
			"referenceAssetIds": []any{" asset-a ", "asset-a", "", "asset-b"},
			"promptSupplements": []any{
				map[string]any{"referenceId": " pack-style ", "referenceName": " 二维动画 ", "referencePrompt": " 干净的二维动画线条 "},
			},
			"promptOptimization": map[string]any{
				"enabled":         true,
				"routeId":         " route-text ",
				"referenceName":   " 电影感优化 ",
				"referencePrompt": " 增强镜头语言与光影层次 ",
			},
			"unknown": "drop me",
		},
	}})
	if err != nil {
		t.Fatalf("Decide() error = %v", err)
	}
	settings, ok := decided.Decision.Values["settings"].(map[string]any)
	if !ok {
		t.Fatalf("settings = %#v, want object", decided.Decision.Values["settings"])
	}
	if settings["kind"] != "image" || settings["routeId"] != "route-image" || settings["label"] != "Seedream 5" {
		t.Fatalf("settings identity = %#v, want normalized image route", settings)
	}
	if _, exists := settings["unknown"]; exists {
		t.Fatalf("settings kept unknown property: %#v", settings)
	}
	refs, ok := settings["referenceAssetIds"].([]any)
	if !ok || len(refs) != 2 || refs[0] != "asset-a" || refs[1] != "asset-b" {
		t.Fatalf("referenceAssetIds = %#v, want trimmed ordered unique ids", settings["referenceAssetIds"])
	}
	supplements, ok := settings["promptSupplements"].([]any)
	if !ok || len(supplements) != 1 {
		t.Fatalf("promptSupplements = %#v, want one normalized snapshot", settings["promptSupplements"])
	}
	supplement, ok := supplements[0].(map[string]any)
	if !ok || supplement["referenceId"] != "pack-style" || supplement["referencePrompt"] != "干净的二维动画线条" {
		t.Fatalf("prompt supplement = %#v, want trimmed known fields", supplements[0])
	}
	optimization, ok := settings["promptOptimization"].(map[string]any)
	if !ok || optimization["enabled"] != true || optimization["routeId"] != "route-text" || optimization["referencePrompt"] != "增强镜头语言与光影层次" {
		t.Fatalf("promptOptimization = %#v, want complete normalized enabled value", settings["promptOptimization"])
	}
}

func TestSelectionGenerationPlanKeepsLegacyVideoContract(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, CreateRequest{
		Kind:  KindGenerationPlan,
		Title: "确认视频生成参数",
		Fields: []FormField{
			{ID: "generation", Type: FieldTypeGenerationParams, Kind: "video"},
			{ID: "refs", Type: FieldTypeImages},
			{ID: "optimization", Type: FieldTypePromptOptimization},
		},
		Intent: sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(created.Fields) != 3 || !created.Fields[0].Required {
		t.Fatalf("created.Fields = %#v, want required legacy video fields", created.Fields)
	}
}

func TestSelectionGenerationPlanRejectsNonVideoLegacyGenerationParams(t *testing.T) {
	store, _, projectID := newTestStore(t)
	for _, kind := range []string{"", "image", "audio"} {
		t.Run("kind="+kind, func(t *testing.T) {
			_, err := store.Create(projectID, CreateRequest{
				Kind:   KindGenerationPlan,
				Title:  "确认生成参数",
				Fields: []FormField{{ID: "generation", Type: FieldTypeGenerationParams, Kind: kind}},
				Intent: sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
			})
			if !errors.Is(err, ErrInvalidGenerationPlan) {
				t.Fatalf("Create() error = %v, want ErrInvalidGenerationPlan", err)
			}
		})
	}
}

func TestSelectionGenerationPlanRejectsMixedGenerationContracts(t *testing.T) {
	store, _, projectID := newTestStore(t)
	tests := []struct {
		name   string
		fields []FormField
	}{
		{
			name: "new and legacy composite",
			fields: []FormField{
				{ID: "settings", Type: FieldTypeGenerationSettings, Kind: "image"},
				{ID: "generation", Type: FieldTypeGenerationParams, Kind: "video"},
			},
		},
		{
			name: "new and legacy images",
			fields: []FormField{
				{ID: "settings", Type: FieldTypeGenerationSettings, Kind: "image"},
				{ID: "refs", Type: FieldTypeImages},
			},
		},
		{
			name: "duplicate new composite",
			fields: []FormField{
				{ID: "settings", Type: FieldTypeGenerationSettings, Kind: "image"},
				{ID: "settings-again", Type: FieldTypeGenerationSettings, Kind: "image"},
			},
		},
		{
			name: "generic field",
			fields: []FormField{
				{ID: "settings", Type: FieldTypeGenerationSettings, Kind: "image"},
				{ID: "style", Type: FieldTypeText},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := store.Create(projectID, CreateRequest{
				Kind: KindGenerationPlan, Title: "生成设置", Fields: tt.fields,
				Intent: sampleGenerationIntent("生成图片"),
			})
			if !errors.Is(err, ErrInvalidGenerationPlan) {
				t.Fatalf("Create() error = %v, want ErrInvalidGenerationPlan", err)
			}
		})
	}
}

func TestSelectionGenerationPlanAcceptsVideoGenerationSettings(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, CreateRequest{
		Kind:   KindGenerationPlan,
		Title:  "生成设置",
		Fields: []FormField{{ID: "settings", Type: FieldTypeGenerationSettings, Kind: "video"}},
		Intent: sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(created.Fields) != 1 || !created.Fields[0].Required {
		t.Fatalf("created.Fields = %#v, want one required video generation_settings", created.Fields)
	}

	value := sampleImageGenerationSettingsValue()
	value["kind"] = "video"
	value["routeId"] = "route-video"
	decided, err := store.Decide(projectID, created.ID, DecisionRequest{Values: map[string]any{"settings": value}})
	if err != nil {
		t.Fatalf("Decide() error = %v", err)
	}
	settings := decided.Decision.Values["settings"].(map[string]any)
	if settings["kind"] != "video" || settings["routeId"] != "route-video" {
		t.Fatalf("settings = %#v, want normalized video settings", settings)
	}
}

func TestSelectionGenerationPlanRejectsUnsupportedGenerationSettingsKind(t *testing.T) {
	store, _, projectID := newTestStore(t)
	for _, kind := range []string{"", "audio"} {
		t.Run("kind="+kind, func(t *testing.T) {
			_, err := store.Create(projectID, CreateRequest{
				Kind:   KindGenerationPlan,
				Title:  "生成设置",
				Fields: []FormField{{ID: "settings", Type: FieldTypeGenerationSettings, Kind: kind}},
				Intent: sampleGenerationIntent("生成图片"),
			})
			if !errors.Is(err, ErrInvalidGenerationPlan) {
				t.Fatalf("Create() error = %v, want ErrInvalidGenerationPlan", err)
			}
		})
	}
}

func TestSelectionGenerationSettingsValidatesNestedValue(t *testing.T) {
	store, _, projectID := newTestStore(t)
	invalidValues := []struct {
		name  string
		value any
	}{
		{name: "not object", value: "route-image"},
		{name: "missing kind", value: map[string]any{"routeId": "route-image", "params": map[string]any{}, "referenceAssetIds": []any{}, "promptSupplements": []any{}, "promptOptimization": map[string]any{"enabled": false}}},
		{name: "mismatched video value", value: generationSettingsValueWith("kind", "video")},
		{name: "audio value", value: generationSettingsValueWith("kind", "audio")},
		{name: "missing route", value: generationSettingsValueWith("routeId", "")},
		{name: "params not object", value: generationSettingsValueWith("params", []any{})},
		{name: "references not array", value: generationSettingsValueWith("referenceAssetIds", "asset-a")},
		{name: "reference item not string", value: generationSettingsValueWith("referenceAssetIds", []any{float64(1)})},
		{name: "supplements not array", value: generationSettingsValueWith("promptSupplements", "pack")},
		{name: "supplement not object", value: generationSettingsValueWith("promptSupplements", []any{"pack"})},
		{name: "supplement missing name", value: generationSettingsValueWith("promptSupplements", []any{map[string]any{"referencePrompt": "风格内容"}})},
		{name: "supplement missing prompt", value: generationSettingsValueWith("promptSupplements", []any{map[string]any{"referenceName": "风格"}})},
		{name: "optimization not object", value: generationSettingsValueWith("promptOptimization", true)},
		{name: "optimization missing enabled", value: generationSettingsValueWith("promptOptimization", map[string]any{})},
		{name: "enabled optimization missing route", value: generationSettingsValueWith("promptOptimization", map[string]any{"enabled": true, "referencePrompt": "优化"})},
		{name: "enabled optimization missing prompt", value: generationSettingsValueWith("promptOptimization", map[string]any{"enabled": true, "routeId": "route-text"})},
	}
	for _, tt := range invalidValues {
		t.Run(tt.name+" default", func(t *testing.T) {
			_, err := store.Create(projectID, CreateRequest{
				Kind:  KindGenerationPlan,
				Title: "生成设置",
				Fields: []FormField{{
					ID:      "settings",
					Type:    FieldTypeGenerationSettings,
					Kind:    "image",
					Default: tt.value,
				}},
				Intent: sampleGenerationIntent("生成图片"),
			})
			if err == nil {
				t.Fatal("Create() accepted an invalid generation_settings default")
			}
		})

		t.Run(tt.name+" submit", func(t *testing.T) {
			created, err := store.Create(projectID, CreateRequest{
				Kind:   KindGenerationPlan,
				Title:  "生成设置",
				Fields: []FormField{{ID: "settings", Type: FieldTypeGenerationSettings, Kind: "image"}},
				Intent: sampleGenerationIntent("生成图片"),
			})
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			if _, err := store.Decide(projectID, created.ID, DecisionRequest{Values: map[string]any{"settings": tt.value}}); err == nil {
				t.Fatal("Decide() accepted an invalid generation_settings submission")
			}
		})
	}
}

func sampleImageGenerationSettingsValue() map[string]any {
	return map[string]any{
		"kind":              "image",
		"routeId":           "route-image",
		"label":             "Seedream 5",
		"params":            map[string]any{"ratio": "3:4", "n": float64(1)},
		"referenceAssetIds": []any{},
		"promptSupplements": []any{},
		"promptOptimization": map[string]any{
			"enabled": false,
		},
	}
}

func generationSettingsValueWith(key string, value any) map[string]any {
	settings := sampleImageGenerationSettingsValue()
	settings[key] = value
	return settings
}

func TestSelectionGenericFormStillAcceptsGenericFields(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, CreateRequest{
		Kind:  "form",
		Title: "填写信息",
		Fields: []FormField{
			{ID: "choice", Type: FieldTypeSelect, Options: []FormFieldOption{{Value: "a", Label: "A"}}},
			{ID: "enabled", Type: FieldTypeToggle},
			{ID: "count", Type: FieldTypeNumber},
			{ID: "note", Type: FieldTypeText},
		},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(created.Fields) != 4 {
		t.Fatalf("created.Fields = %#v, want all generic fields", created.Fields)
	}
}

func TestSelectionGenerationParamsFieldRejectsMissingRoute(t *testing.T) {
	store, _, projectID := newTestStore(t)
	created, err := store.Create(projectID, CreateRequest{
		SessionID: "session-1",
		RunID:     "run-1",
		Kind:      KindGenerationPlan,
		Title:     "确认生成参数",
		Fields:    []FormField{{ID: "generation", Label: "模型与参数", Type: FieldTypeGenerationParams, Kind: "video"}},
		Intent:    sampleGenerationIntentFor("video", GenerationPlanOperationCreateSingle, "生成视频"),
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
	ids, ok := value.([]string)
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

func TestValidatePromptOptimizationAcceptsBooleanValue(t *testing.T) {
	field := FormField{ID: "optimize", Type: FieldTypePromptOptimization}
	value, err := validateFormValue(field, false)
	if err != nil {
		t.Fatalf("validateFormValue(bool) error = %v", err)
	}
	if object, ok := value.(map[string]any); !ok || object["enabled"] != false {
		t.Fatalf("value = %#v, want normalized {enabled:false}", value)
	}
}

func TestValidateFormValuesValidatesDefaults(t *testing.T) {
	max := 3.0
	fields := []FormField{
		// 坏的可选 default（重复+超限）应按缺省丢弃，而不是原样落库。
		{ID: "refs", Type: FieldTypeImages, Max: &max, Default: []any{"a", "a", "b", "c", "d"}},
		// 好的 default 要经过归一化（去重/trim）。
		{ID: "extra", Type: FieldTypeImages, Max: &max, Default: []any{" x ", "x"}},
	}
	values, err := validateFormValues(fields, map[string]any{"refs": nil})
	if err != nil {
		t.Fatalf("validateFormValues() error = %v", err)
	}
	if _, present := values["refs"]; present {
		t.Fatalf("values = %#v, invalid optional default should be dropped", values)
	}
	extra, ok := values["extra"].([]string)
	if !ok || len(extra) != 1 || extra[0] != "x" {
		t.Fatalf("values[extra] = %#v, want normalized default", values["extra"])
	}

	required := []FormField{{ID: "refs", Type: FieldTypeImages, Required: true, Default: "not-an-array"}}
	if _, err := validateFormValues(required, map[string]any{}); err == nil {
		t.Fatal("want error for invalid required default")
	}
}

func TestNormalizeFieldsClampsImagesMax(t *testing.T) {
	big := 50.0
	fields, err := normalizeFields([]FormField{
		{ID: "a", Type: FieldTypeImages},
		{ID: "b", Type: FieldTypeImages, Max: &big},
	})
	if err != nil {
		t.Fatalf("normalizeFields() error = %v", err)
	}
	if fields[0].Max == nil || *fields[0].Max != defaultImagesMax {
		t.Fatalf("nil max = %#v, want default %d", fields[0].Max, defaultImagesMax)
	}
	if fields[1].Max == nil || *fields[1].Max != ceilingImagesMax {
		t.Fatalf("oversize max = %#v, want ceiling %d", fields[1].Max, ceilingImagesMax)
	}
}

func TestSelectionCancelPendingByRun(t *testing.T) {
	store, _, projectID := newTestStore(t)
	createForRun := func(runID string, title string) Record {
		t.Helper()
		record, err := store.Create(projectID, CreateRequest{
			RunID:   runID,
			Title:   title,
			Options: []Option{{ID: "a", Label: "A"}},
		})
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		return record
	}

	pendingFirst := createForRun("run-cancel", "first")
	pendingSecond := createForRun("run-cancel", "second")
	alreadyDecided := createForRun("run-cancel", "decided")
	otherRun := createForRun("run-other", "other")
	if _, err := store.Decide(projectID, alreadyDecided.ID, DecisionRequest{OptionID: "a"}); err != nil {
		t.Fatalf("Decide() error = %v", err)
	}

	count, err := store.CancelPendingByRun(projectID, " run-cancel ")
	if err != nil {
		t.Fatalf("CancelPendingByRun() error = %v", err)
	}
	if count != 2 {
		t.Fatalf("CancelPendingByRun() count = %d, want 2", count)
	}
	for _, id := range []string{pendingFirst.ID, pendingSecond.ID} {
		record, ok, getErr := store.Get(projectID, id)
		if getErr != nil || !ok {
			t.Fatalf("Get(%s) = %#v, ok=%v, error=%v", id, record, ok, getErr)
		}
		if record.Status != StatusCancelled || record.Decision == nil || !record.Decision.Cancelled {
			t.Fatalf("record = %#v, want cancelled decision", record)
		}
	}
	decidedRecord, _, err := store.Get(projectID, alreadyDecided.ID)
	if err != nil || decidedRecord.Status != StatusSelected {
		t.Fatalf("decided record = %#v, error=%v; want selected unchanged", decidedRecord, err)
	}
	otherRecord, _, err := store.Get(projectID, otherRun.ID)
	if err != nil || otherRecord.Status != StatusPending {
		t.Fatalf("other run record = %#v, error=%v; want pending unchanged", otherRecord, err)
	}
	if _, err := store.CancelPendingByRun(projectID, " "); err == nil {
		t.Fatal("CancelPendingByRun() accepted an empty run id")
	}
}

func TestSelectionExpirePendingByRun(t *testing.T) {
	store, _, projectID := newTestStore(t)
	createForRun := func(runID string, title string) Record {
		t.Helper()
		record, err := store.Create(projectID, CreateRequest{
			RunID:   runID,
			Title:   title,
			Options: []Option{{ID: "a", Label: "A"}},
		})
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		return record
	}

	pending := createForRun("run-finished", "pending")
	alreadyDecided := createForRun("run-finished", "decided")
	otherRun := createForRun("run-still-active", "other")
	if _, err := store.Decide(projectID, alreadyDecided.ID, DecisionRequest{OptionID: "a"}); err != nil {
		t.Fatalf("Decide() error = %v", err)
	}

	count, err := store.ExpirePendingByRun(projectID, " run-finished ")
	if err != nil {
		t.Fatalf("ExpirePendingByRun() error = %v", err)
	}
	if count != 1 {
		t.Fatalf("ExpirePendingByRun() count = %d, want 1", count)
	}
	expired, _, err := store.Get(projectID, pending.ID)
	if err != nil || expired.Status != StatusExpired || expired.DecidedAt == "" {
		t.Fatalf("expired record = %#v, error=%v; want expired with timestamp", expired, err)
	}
	decidedRecord, _, err := store.Get(projectID, alreadyDecided.ID)
	if err != nil || decidedRecord.Status != StatusSelected {
		t.Fatalf("decided record = %#v, error=%v; want selected unchanged", decidedRecord, err)
	}
	otherRecord, _, err := store.Get(projectID, otherRun.ID)
	if err != nil || otherRecord.Status != StatusPending {
		t.Fatalf("other run record = %#v, error=%v; want pending unchanged", otherRecord, err)
	}
	if _, err := store.ExpirePendingByRun(projectID, " "); err == nil {
		t.Fatal("ExpirePendingByRun() accepted an empty run id")
	}
}

func createDueSelectionFixture(
	t *testing.T,
	repo *repository.AgentSelectionRepository,
	projectID string,
	selectionID string,
	runID string,
	kind string,
	title string,
	prompt string,
	fields []FormField,
) domain.AgentSelectionModel {
	t.Helper()
	fieldsJSON := ""
	if len(fields) > 0 {
		raw, err := json.Marshal(fields)
		if err != nil {
			t.Fatalf("encoding fields fixture: %v", err)
		}
		fieldsJSON = string(raw)
	}
	past := time.Now().UTC().Add(-time.Minute)
	model := domain.AgentSelectionModel{
		ProjectID:   projectID,
		ID:          selectionID,
		SessionID:   "session-due",
		RunID:       runID,
		Kind:        kind,
		Title:       title,
		Prompt:      prompt,
		OptionsJSON: `[{"id":"a","label":"A"}]`,
		FieldsJSON:  fieldsJSON,
		Status:      StatusPending,
		CreatedAt:   past.Add(-time.Minute),
		ExpiresAt:   &past,
	}
	if err := repo.CreateAgentSelection(model); err != nil {
		t.Fatalf("creating due selection fixture: %v", err)
	}
	return model
}

type staticRunDecisionGuard struct {
	status string
	found  bool
}

func (guard staticRunDecisionGuard) WithRunStatus(
	_ string,
	_ string,
	callback func(status string, found bool) error,
) error {
	return callback(guard.status, guard.found)
}
