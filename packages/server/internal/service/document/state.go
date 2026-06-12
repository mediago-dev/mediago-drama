package document

import (
	"fmt"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
)

func (store *Service) load(projectID string) (workspaceStateResponse, error) {
	if store.initErr != nil {
		return workspaceStateResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return workspaceStateResponse{}, err
	}
	return state, nil
}

// LoadWorkspaceState returns complete workspace state for HTTP handlers.
func (store *Service) LoadWorkspaceState(projectID string) (workspaceStateResponse, error) {
	return store.load(projectID)
}

func (store *Service) save(projectID string, request workspaceStateRequest) (workspaceStateResponse, error) {
	if store.initErr != nil {
		return workspaceStateResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	return store.saveUnlocked(projectID, request)
}

// SaveWorkspaceState replaces complete workspace state for HTTP handlers.
func (store *Service) SaveWorkspaceState(projectID string, request workspaceStateRequest) (workspaceStateResponse, error) {
	return store.save(projectID, request)
}

func (store *Service) loadUnlocked(projectID string) (workspaceStateResponse, error) {
	projectID = domain.CleanProjectID(projectID)

	documents, folders, err := store.loadLocalMarkdownWorkspaceUnlocked(projectID)
	if err != nil {
		return workspaceStateResponse{}, err
	}
	operationLog, err := store.loadOperationLogFromDBUnlocked(projectID)
	if err != nil {
		return workspaceStateResponse{}, err
	}

	return workspaceStateResponse{
		WorkspaceDir: store.projectDir(projectID),
		ProjectID:    projectID,
		Documents:    documents,
		Folders:      folders,
		OperationLog: operationLog,
	}, nil
}

func (store *Service) requireReady() error {
	if store == nil {
		return fmt.Errorf("document store is not configured")
	}
	return store.initErr
}
