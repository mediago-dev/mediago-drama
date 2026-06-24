package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

// WorkspaceStore supplies workspace state and document operations.
type WorkspaceStore interface {
	LoadWorkspaceState(projectID string) (service.WorkspaceStateResponse, error)
	SaveWorkspaceState(projectID string, request service.WorkspaceStateRequest) (service.WorkspaceStateResponse, error)
	ListWorkspaceDocuments(projectID string) (service.WorkspaceDocumentsResponse, error)
	ListWorkspaceDocumentResources(projectID string) (service.WorkspaceDocumentResourcesResponse, error)
	ListProjectSections(projectID string) (service.DocumentSectionsResponse, error)
	ReconcileProjectSections(projectID string) (service.DocumentSectionsResponse, error)
	ListDocumentFolders(projectID string) (service.DocumentFoldersResponse, error)
	CreateDocumentFolder(projectID string, request service.CreateDocumentFolderRequest) (service.DocumentFolderMutationResponse, error)
	UpdateDocumentFolder(projectID string, folderID string, request service.UpdateDocumentFolderRequest) (service.DocumentFolderMutationResponse, error)
	DeleteDocumentFolder(projectID string, folderID string) (service.DeleteDocumentFolderResponse, error)
	CreateWorkspaceDocument(projectID string, request service.CreateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, service.WorkspaceDocumentsResponse, error)
	GetWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, bool, error)
	UpdateWorkspaceDocument(projectID string, documentID string, request service.UpdateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, service.WorkspaceDocumentsResponse, error)
	UpdateWorkspaceDocumentSectionImage(projectID string, documentID string, request service.WorkspaceDocumentSectionImageRequest) (mediamcp.WorkspaceDocument, service.WorkspaceDocumentsResponse, error)
	UpdateWorkspaceDocumentSectionMedia(projectID string, documentID string, request service.WorkspaceDocumentSectionMediaRequest) (mediamcp.WorkspaceDocument, service.WorkspaceDocumentsResponse, error)
	UpdateWorkspaceDocumentSectionMention(projectID string, documentID string, request service.WorkspaceDocumentSectionMentionRequest) (mediamcp.WorkspaceDocument, service.WorkspaceDocumentsResponse, error)
	DeleteWorkspaceDocument(projectID string, documentID string) (service.DeleteWorkspaceDocumentResponse, error)
	ListDocumentHistory(projectID string, documentID string, limit int) (service.DocumentHistoryResponse, error)
	GetDocumentHistoryVersion(projectID string, documentID string, commitHash string) (service.DocumentHistoryVersionResponse, error)
	GetDocumentHistoryDiff(projectID string, documentID string, commitHash string, fromHash string) (service.DocumentHistoryDiffResponse, error)
	RestoreDocumentHistoryVersion(projectID string, documentID string, commitHash string) (service.DocumentHistoryRestoreResponse, error)
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

// HandleListDocumentFolders godoc
// @Summary 获取文档文件夹
// @Description 返回项目文档目录中的文件夹列表。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/folders [get]
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

// HandleCreateDocumentFolder godoc
// @Summary 创建文档文件夹
// @Description 在项目文档目录中创建文件夹。
// @Tags Workspace
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param payload body SwaggerObject true "Folder creation payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/folders [post]
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

// HandleUpdateDocumentFolder godoc
// @Summary 更新文档文件夹
// @Description 重命名或移动项目文档文件夹。
// @Tags Workspace
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param folderId path string true "Folder ID"
// @Param payload body SwaggerObject true "Folder patch payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/folders/{folderId} [patch]
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

// HandleDeleteDocumentFolder godoc
// @Summary 删除文档文件夹
// @Description 删除项目文档文件夹。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Param folderId path string true "Folder ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/folders/{folderId} [delete]
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

// HandleGetWorkspaceState godoc
// @Summary 获取工作区状态
// @Description 返回项目文档、目录、草稿和操作日志等完整工作区状态。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/state [get]
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

// HandlePutWorkspaceState godoc
// @Summary 保存工作区状态
// @Description 替换项目的完整工作区状态。
// @Tags Workspace
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param payload body SwaggerObject true "Workspace state payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/state [put]
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

// HandleListWorkspaceDocuments godoc
// @Summary 获取文档列表
// @Description 返回项目工作区文档列表。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Param category query string false "Document category"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents [get]
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

// HandleListWorkspaceDocumentResources godoc
// @Summary 获取文档资源
// @Description 返回从角色、场景、道具和分镜文档结构中解析出的可生成资源。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/resources [get]
func (handler Workspace) HandleListWorkspaceDocumentResources(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	response, err := handler.store.ListWorkspaceDocumentResources(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleListProjectSections godoc
// @Summary 获取文档 section 索引
// @Description 返回项目当前持久化 section metadata 和最近一次扫描观测结果。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/sections [get]
func (handler Workspace) HandleListProjectSections(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	response, err := handler.store.ListProjectSections(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleReconcileProjectSections godoc
// @Summary 同步文档 section 索引
// @Description 扫描当前项目 Markdown 文档，补齐缺失 section-id，并同步 section metadata 观测状态。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/sections/reconcile [post]
func (handler Workspace) HandleReconcileProjectSections(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	response, err := handler.store.ReconcileProjectSections(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleCreateWorkspaceDocument godoc
// @Summary 创建文档
// @Description 在项目工作区创建 Markdown 文档。
// @Tags Workspace
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param payload body SwaggerObject true "Document creation payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents [post]
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

// HandleGetWorkspaceDocument godoc
// @Summary 获取文档详情
// @Description 返回项目工作区中的一个文档。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId} [get]
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

// HandleUpdateWorkspaceDocument godoc
// @Summary 更新文档
// @Description 更新项目工作区文档的内容、标题、分类或草稿状态。
// @Tags Workspace
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param payload body SwaggerObject true "Document patch payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId} [patch]
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

// HandleUpdateWorkspaceDocumentSectionImage godoc
// @Summary 更新文档 section 图片
// @Description 按 sectionId 在项目工作区文档中选中或取消选中一张图片。
// @Tags Workspace
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param payload body SwaggerObject true "Section image payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId}/section-image [patch]
func (handler Workspace) HandleUpdateWorkspaceDocumentSectionImage(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.WorkspaceDocumentSectionImageRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	document, state, err := handler.store.UpdateWorkspaceDocumentSectionImage(projectID, documentID, payload)
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

// HandleUpdateWorkspaceDocumentSectionMedia godoc
// @Summary 更新文档 section 音视频
// @Description 按 sectionId 在项目工作区文档中选中或取消选中一条音视频。
// @Tags Workspace
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param payload body SwaggerObject true "Section media payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId}/section-media [patch]
func (handler Workspace) HandleUpdateWorkspaceDocumentSectionMedia(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.WorkspaceDocumentSectionMediaRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	document, state, err := handler.store.UpdateWorkspaceDocumentSectionMedia(projectID, documentID, payload)
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

// HandleUpdateWorkspaceDocumentSectionMention godoc
// @Summary 更新文档 section 引用
// @Description 按 sectionId 在项目工作区文档中选中或取消选中一个 @mention 引用。
// @Tags Workspace
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param payload body SwaggerObject true "Section mention payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId}/section-mention [patch]
func (handler Workspace) HandleUpdateWorkspaceDocumentSectionMention(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.WorkspaceDocumentSectionMentionRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	document, state, err := handler.store.UpdateWorkspaceDocumentSectionMention(projectID, documentID, payload)
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

// HandleDeleteWorkspaceDocument godoc
// @Summary 删除文档
// @Description 删除项目工作区文档。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId} [delete]
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

// HandleListDocumentHistory godoc
// @Summary 获取文档历史
// @Description 返回项目文档的版本历史记录。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param limit query int false "History item limit"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId}/history [get]
func (handler Workspace) HandleListDocumentHistory(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	limit, ok := documentHistoryLimit(context)
	if !ok {
		return
	}
	response, err := handler.store.ListDocumentHistory(projectID, documentID, limit)
	if err != nil {
		handler.writeDocumentHistoryError(context, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGetDocumentHistoryVersion godoc
// @Summary 获取文档历史版本
// @Description 返回指定提交中的文档历史版本。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param commitHash path string true "Commit hash"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId}/history/{commitHash} [get]
func (handler Workspace) HandleGetDocumentHistoryVersion(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	commitHash, ok := requiredPathParam(context, "commitHash", "commitHash")
	if !ok {
		return
	}
	response, err := handler.store.GetDocumentHistoryVersion(projectID, documentID, commitHash)
	if err != nil {
		handler.writeDocumentHistoryError(context, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGetDocumentHistoryDiff godoc
// @Summary 获取文档历史差异
// @Description 返回指定历史版本相对当前或指定版本的行级差异。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param commitHash path string true "Commit hash"
// @Param from query string false "Base commit hash"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId}/history/{commitHash}/diff [get]
func (handler Workspace) HandleGetDocumentHistoryDiff(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	commitHash, ok := requiredPathParam(context, "commitHash", "commitHash")
	if !ok {
		return
	}
	response, err := handler.store.GetDocumentHistoryDiff(projectID, documentID, commitHash, strings.TrimSpace(context.Query("from")))
	if err != nil {
		handler.writeDocumentHistoryError(context, err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleRestoreDocumentHistoryVersion godoc
// @Summary 恢复文档历史版本
// @Description 将文档恢复到指定提交中的历史版本。
// @Tags Workspace
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param commitHash path string true "Commit hash"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/documents/{documentId}/history/{commitHash}/restore [post]
func (handler Workspace) HandleRestoreDocumentHistoryVersion(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	commitHash, ok := requiredPathParam(context, "commitHash", "commitHash")
	if !ok {
		return
	}
	response, err := handler.store.RestoreDocumentHistoryVersion(projectID, documentID, commitHash)
	if err != nil {
		handler.writeDocumentHistoryError(context, err)
		return
	}
	response.State, err = handler.withProjectAssetsForDocuments(response.State)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, response)
}

// HandleGetEpisodeTimelineState godoc
// @Summary 获取剧集时间线
// @Description 返回文档关联的剧集时间线状态。
// @Tags Episodes
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/episodes/{documentId} [get]
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

// HandlePutEpisodeTimelineState godoc
// @Summary 保存剧集时间线
// @Description 保存文档关联的剧集时间线状态。
// @Tags Episodes
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Param payload body SwaggerObject true "Episode timeline payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/episodes/{documentId} [put]
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

func (handler Workspace) writeDocumentHistoryError(context *gin.Context, err error) {
	if handler.matchesNotFound(err) {
		httpresponse.Error(context, http.StatusNotFound, "历史版本不存在")
		return
	}
	httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
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

func documentHistoryLimit(context *gin.Context) (int, bool) {
	raw := strings.TrimSpace(context.Query("limit"))
	if raw == "" {
		return 50, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 200 {
		httpresponse.Error(context, http.StatusBadRequest, "limit 必须是 1 到 200 之间的整数")
		return 0, false
	}
	return limit, true
}
