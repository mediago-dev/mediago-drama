package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/document"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/model"
)

// WorkspaceStore supplies workspace state and document operations.
type WorkspaceStore interface {
	LoadWorkspaceState(projectID string) (service.WorkspaceStateResponse, error)
	SaveWorkspaceState(projectID string, request service.WorkspaceStateRequest) (service.WorkspaceStateResponse, error)
	ListWorkspaceDocuments(projectID string) (service.WorkspaceDocumentsResponse, error)
	ListDocumentFolders(projectID string) (service.DocumentFoldersResponse, error)
	CreateDocumentFolder(projectID string, request service.CreateDocumentFolderRequest) (service.DocumentFolderMutationResponse, error)
	UpdateDocumentFolder(projectID string, folderID string, request service.UpdateDocumentFolderRequest) (service.DocumentFolderMutationResponse, error)
	DeleteDocumentFolder(projectID string, folderID string) (service.DeleteDocumentFolderResponse, error)
	CreateWorkspaceDocument(projectID string, request service.CreateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, service.WorkspaceDocumentsResponse, error)
	GetWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, bool, error)
	UpdateWorkspaceDocument(projectID string, documentID string, request service.UpdateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, service.WorkspaceDocumentsResponse, error)
	DeleteWorkspaceDocument(projectID string, documentID string) (service.DeleteWorkspaceDocumentResponse, error)
	GetEpisodeTimelineState(projectID string, documentID string) (service.EpisodeTimelineStateResponse, bool, error)
	SaveEpisodeTimelineState(projectID string, documentID string, request service.SaveEpisodeTimelineStateRequest) (service.EpisodeTimelineStateResponse, error)
}

// WorkspaceProjectAssetStore supplies project asset records for workspace hydration.
type WorkspaceProjectAssetStore interface {
	List(projectID string) ([]model.ProjectAssetRecord, error)
}

// Workspace handles workspace state and document HTTP routes.
type Workspace struct {
	store             WorkspaceStore
	assets            WorkspaceProjectAssetStore
	isNotFound        func(error) bool
	isVersionConflict func(error) bool
}

// NewWorkspace returns a workspace route handler.
func NewWorkspace(store WorkspaceStore, isNotFound func(error) bool, isVersionConflict func(error) bool, assets ...WorkspaceProjectAssetStore) Workspace {
	var assetStore WorkspaceProjectAssetStore
	if len(assets) > 0 {
		assetStore = assets[0]
	}
	return Workspace{store: store, assets: assetStore, isNotFound: isNotFound, isVersionConflict: isVersionConflict}
}

type workspaceDocumentMutationResponse struct {
	Document mediamcp.WorkspaceDocument         `json:"document"`
	State    service.WorkspaceDocumentsResponse `json:"state"`
}

// HandleListDocumentFolders lists project folders.
func (handler Workspace) HandleListDocumentFolders(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	state, err := handler.store.ListDocumentFolders(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, state)
}

// HandleCreateDocumentFolder creates a project folder.
func (handler Workspace) HandleCreateDocumentFolder(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeJSON[service.CreateDocumentFolderRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	response, err := handler.store.CreateDocumentFolder(projectID, payload)
	if err != nil {
		handler.writeFolderMutationError(context, err)
		return
	}
	response.State, err = handler.withProjectAssetsForDocuments(response.State)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleUpdateDocumentFolder updates a project folder.
func (handler Workspace) HandleUpdateDocumentFolder(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	folderID, ok := requiredPathParam(context, "folderId", "folderId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.UpdateDocumentFolderRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	response, err := handler.store.UpdateDocumentFolder(projectID, folderID, payload)
	if err != nil {
		handler.writeFolderMutationError(context, err)
		return
	}
	response.State, err = handler.withProjectAssetsForDocuments(response.State)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleDeleteDocumentFolder deletes a project folder.
func (handler Workspace) HandleDeleteDocumentFolder(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	folderID, ok := requiredPathParam(context, "folderId", "folderId")
	if !ok {
		return
	}
	response, err := handler.store.DeleteDocumentFolder(projectID, folderID)
	if err != nil {
		handler.writeFolderMutationError(context, err)
		return
	}
	response.State, err = handler.withProjectAssetsForDocuments(response.State)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGetWorkspaceState returns complete workspace state.
func (handler Workspace) HandleGetWorkspaceState(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	state, err := handler.store.LoadWorkspaceState(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	state, err = handler.withProjectAssetsForState(state)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, state)
}

// HandlePutWorkspaceState replaces complete workspace state.
func (handler Workspace) HandlePutWorkspaceState(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeJSON[service.WorkspaceStateRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	state, err := handler.store.SaveWorkspaceState(projectID, payload)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	state, err = handler.withProjectAssetsForState(state)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, state)
}

// HandleListWorkspaceDocuments lists project documents.
func (handler Workspace) HandleListWorkspaceDocuments(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	state, err := handler.store.ListWorkspaceDocuments(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	state, err = handler.withProjectAssetsForDocuments(state)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, state)
}

// HandleCreateWorkspaceDocument creates a project document.
func (handler Workspace) HandleCreateWorkspaceDocument(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeJSON[service.CreateWorkspaceDocumentRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if err := service.ValidateRequiredDocumentCategory(payload.Category); err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	document, state, err := handler.store.CreateWorkspaceDocument(projectID, payload)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	state, err = handler.withProjectAssetsForDocuments(state)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, workspaceDocumentMutationResponse{
		Document: document,
		State:    state,
	})
}

// HandleGetWorkspaceDocument returns a project document.
func (handler Workspace) HandleGetWorkspaceDocument(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	document, ok, err := handler.store.GetWorkspaceDocument(projectID, documentID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "文档不存在")
		return
	}
	httpresponse.OK(context, document)
}

// HandleUpdateWorkspaceDocument updates a project document.
func (handler Workspace) HandleUpdateWorkspaceDocument(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.UpdateWorkspaceDocumentRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	document, state, err := handler.store.UpdateWorkspaceDocument(projectID, documentID, payload)
	if err != nil {
		handler.writeDocumentMutationError(context, err)
		return
	}
	state, err = handler.withProjectAssetsForDocuments(state)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, workspaceDocumentMutationResponse{
		Document: document,
		State:    state,
	})
}

// HandleDeleteWorkspaceDocument deletes a project document.
func (handler Workspace) HandleDeleteWorkspaceDocument(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	response, err := handler.store.DeleteWorkspaceDocument(projectID, documentID)
	if err != nil {
		if handler.matchesNotFound(err) {
			httpresponse.Error(context, http.StatusNotFound, "文档不存在")
			return
		}
		if handler.matchesVersionConflict(err) {
			httpresponse.ErrorFromStatus(context, http.StatusConflict, err)
			return
		}
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	response.State, err = handler.withProjectAssetsForDocuments(response.State)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGetEpisodeTimelineState returns the persisted episode timeline for a document.
func (handler Workspace) HandleGetEpisodeTimelineState(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	state, ok, err := handler.store.GetEpisodeTimelineState(projectID, documentID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "剪辑台状态不存在")
		return
	}
	httpresponse.OK(context, state)
}

// HandlePutEpisodeTimelineState saves the persisted episode timeline for a document.
func (handler Workspace) HandlePutEpisodeTimelineState(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.SaveEpisodeTimelineStateRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	state, err := handler.store.SaveEpisodeTimelineState(projectID, documentID, payload)
	if err != nil {
		if handler.matchesNotFound(err) {
			httpresponse.Error(context, http.StatusNotFound, "文档不存在")
			return
		}
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	httpresponse.OK(context, state)
}

func (handler Workspace) writeDocumentMutationError(context *gin.Context, err error) {
	if handler.matchesNotFound(err) {
		httpresponse.Error(context, http.StatusNotFound, "文档不存在")
		return
	}
	if handler.matchesVersionConflict(err) {
		httpresponse.ErrorFromStatus(context, http.StatusConflict, err)
		return
	}
	httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
}

func (handler Workspace) writeFolderMutationError(context *gin.Context, err error) {
	if handler.matchesNotFound(err) {
		httpresponse.Error(context, http.StatusNotFound, "文件夹不存在")
		return
	}
	httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
}

func (handler Workspace) matchesNotFound(err error) bool {
	return handler.isNotFound != nil && handler.isNotFound(err)
}

func (handler Workspace) matchesVersionConflict(err error) bool {
	return handler.isVersionConflict != nil && handler.isVersionConflict(err)
}

func (handler Workspace) withProjectAssetsForState(state service.WorkspaceStateResponse) (service.WorkspaceStateResponse, error) {
	if handler.assets == nil || state.ProjectID == "" {
		return state, nil
	}
	assets, err := handler.assets.List(state.ProjectID)
	if err != nil {
		return state, err
	}
	state.Assets = assets
	return state, nil
}

func (handler Workspace) withProjectAssetsForDocuments(state service.WorkspaceDocumentsResponse) (service.WorkspaceDocumentsResponse, error) {
	if handler.assets == nil || state.ProjectID == "" {
		return state, nil
	}
	assets, err := handler.assets.List(state.ProjectID)
	if err != nil {
		return state, err
	}
	state.Assets = assets
	return state, nil
}
