package approval

import (
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func TestStorePersistsDocumentToolApprovalPayload(t *testing.T) {
	db, err := repository.OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("opening workspace db: %v", err)
	}
	store := NewService(repository.NewDocumentToolApprovalRepository(db), nil)
	projectID := "project-approval"

	approval, err := store.createDocumentToolApproval(projectID, DocumentToolApprovalRequest{
		Name:    "delete_document",
		Summary: "确认删除文档",
	})
	if err != nil {
		t.Fatalf("creating approval: %v", err)
	}
	payload := &DocumentToolApprovalDecisionPayload{
		Config: &DocumentToolApprovalConfig{
			Prompt:             "生成漫剧",
			SaveSourceMaterial: true,
		},
	}
	decided, err := store.decideDocumentToolApproval(projectID, approval.ID, "approved", payload)
	if err != nil {
		t.Fatalf("deciding approval: %v", err)
	}
	if decided.Status != "approved" {
		t.Fatalf("status = %q, want approved", decided.Status)
	}
	config, ok := decided.DecisionPayload["config"].(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v, want nested config", decided.DecisionPayload)
	}
	if config["prompt"] != "生成漫剧" {
		t.Fatalf("config = %#v, want prompt", config)
	}
}
