package document

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
)

func (store *EditStreamService) getDocumentEditStream(projectID string, streamID string) (documentEditStreamRecord, bool, error) {
	if store.initErr != nil {
		return documentEditStreamRecord{}, false, store.initErr
	}
	if store.repo == nil {
		return documentEditStreamRecord{}, false, fmt.Errorf("document edit stream repository is not initialized")
	}
	projectID = domain.CleanProjectID(projectID)
	streamID = strings.TrimSpace(streamID)
	if streamID == "" {
		return documentEditStreamRecord{}, false, nil
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	model, err := store.repo.GetDocumentEditStream(projectID, streamID)
	if err != nil {
		if repository.IsRecordNotFound(err) {
			return documentEditStreamRecord{}, false, nil
		}
		return documentEditStreamRecord{}, false, fmt.Errorf("reading document edit stream %s: %w", streamID, err)
	}
	record, err := DocumentEditStreamRecordFromModel(model)
	if err != nil {
		return documentEditStreamRecord{}, false, err
	}
	return record, true, nil
}

func (store *EditStreamService) GetDocumentEditStream(projectID string, streamID string) (documentEditStreamRecord, bool, error) {
	return store.getDocumentEditStream(projectID, streamID)
}

func (store *EditStreamService) saveDocumentEditStream(record documentEditStreamRecord) (documentEditStreamRecord, error) {
	if store.initErr != nil {
		return record, store.initErr
	}
	if store.repo == nil {
		return record, fmt.Errorf("document edit stream repository is not initialized")
	}
	record.ProjectID = domain.CleanProjectID(record.ProjectID)
	record.StreamID = strings.TrimSpace(record.StreamID)
	if record.StreamID == "" {
		return record, fmt.Errorf("streamId is required")
	}
	record, model, err := PrepareDocumentEditStreamModel(record)
	if err != nil {
		return record, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if err := store.repo.UpsertDocumentEditStream(model); err != nil {
		return record, fmt.Errorf("saving document edit stream %s: %w", record.StreamID, err)
	}
	return record, nil
}

func (store *EditStreamService) SaveDocumentEditStream(record documentEditStreamRecord) (documentEditStreamRecord, error) {
	return store.saveDocumentEditStream(record)
}
