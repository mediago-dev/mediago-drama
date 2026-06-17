package document

import (
	"log/slog"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/documenthistory"
)

func (store *Service) recordDocumentHistory(projectID string) {
	if store == nil || store.history == nil {
		return
	}
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return
	}
	projectDir := store.projectDir(projectID)
	workDir := store.documentsDir(projectID)
	if projectDir == "" || workDir == "" {
		return
	}
	hash, err := store.history.CommitProjectDocuments(documenthistory.CommitRequest{
		ProjectID:  projectID,
		ProjectDir: projectDir,
		WorkDir:    workDir,
	})
	if err != nil {
		slog.Warn("recording document history failed", "project_id", projectID, "error", err)
		return
	}
	if hash != "" {
		slog.Debug("document history recorded", "project_id", projectID, "commit", hash)
	}
}
