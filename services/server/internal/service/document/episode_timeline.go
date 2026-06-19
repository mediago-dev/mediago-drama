package document

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func (store *Service) getEpisodeTimelineState(projectID string, documentID string) (episodeTimelineStateResponse, bool, error) {
	if err := store.requireReady(); err != nil {
		return episodeTimelineStateResponse{}, false, err
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return episodeTimelineStateResponse{}, false, fmt.Errorf("documentId is required")
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	model, err := store.workspace.GetEpisodeTimeline(domain.CleanProjectID(projectID), documentID)
	if err != nil {
		if repository.IsRecordNotFound(err) {
			return episodeTimelineStateResponse{}, false, nil
		}
		return episodeTimelineStateResponse{}, false, err
	}
	return episodeTimelineStateFromModel(store.projectDir(model.ProjectID), model), true, nil
}

// GetEpisodeTimelineState returns persisted episode timeline state for a document.
func (store *Service) GetEpisodeTimelineState(projectID string, documentID string) (EpisodeTimelineStateResponse, bool, error) {
	return store.getEpisodeTimelineState(projectID, documentID)
}

func (store *Service) saveEpisodeTimelineState(
	projectID string,
	documentID string,
	request saveEpisodeTimelineStateRequest,
) (episodeTimelineStateResponse, error) {
	if err := store.requireReady(); err != nil {
		return episodeTimelineStateResponse{}, err
	}
	projectID = domain.CleanProjectID(projectID)
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return episodeTimelineStateResponse{}, fmt.Errorf("documentId is required")
	}

	episodeJSON := bytes.TrimSpace(request.Episode)
	if len(episodeJSON) == 0 {
		return episodeTimelineStateResponse{}, fmt.Errorf("episode is required")
	}
	if !json.Valid(episodeJSON) {
		return episodeTimelineStateResponse{}, fmt.Errorf("episode must be valid JSON")
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	if err := store.ensureProjectRecordUnlocked(projectID); err != nil {
		return episodeTimelineStateResponse{}, err
	}
	documents, err := store.loadDocumentsFromDBUnlocked(projectID)
	if err != nil {
		return episodeTimelineStateResponse{}, err
	}
	if !WorkspaceDocumentIDExists(documents, documentID) {
		return episodeTimelineStateResponse{}, repository.ErrRecordNotFound
	}

	now := timestamp.NowRFC3339Nano()
	model := domain.EpisodeTimelineModel{
		ProjectID:   projectID,
		DocumentID:  documentID,
		EpisodeJSON: string(episodeJSON),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := store.workspace.UpsertEpisodeTimeline(model); err != nil {
		return episodeTimelineStateResponse{}, err
	}

	saved, err := store.workspace.GetEpisodeTimeline(projectID, documentID)
	if err != nil {
		return episodeTimelineStateResponse{}, err
	}
	return episodeTimelineStateFromModel(store.projectDir(projectID), saved), nil
}

// SaveEpisodeTimelineState persists episode timeline state for a document.
func (store *Service) SaveEpisodeTimelineState(
	projectID string,
	documentID string,
	request SaveEpisodeTimelineStateRequest,
) (EpisodeTimelineStateResponse, error) {
	return store.saveEpisodeTimelineState(projectID, documentID, request)
}

func episodeTimelineStateFromModel(workspaceDir string, model domain.EpisodeTimelineModel) episodeTimelineStateResponse {
	return episodeTimelineStateResponse{
		WorkspaceDir: workspaceDir,
		ProjectID:    model.ProjectID,
		DocumentID:   model.DocumentID,
		Episode:      json.RawMessage(model.EpisodeJSON),
		CreatedAt:    model.CreatedAt,
		UpdatedAt:    model.UpdatedAt,
	}
}
