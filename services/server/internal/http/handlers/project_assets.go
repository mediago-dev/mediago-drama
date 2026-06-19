package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/projectasset"
)

// ProjectAssets handles project-scoped asset HTTP routes.
type ProjectAssets struct {
	service *service.ProjectAssets
}

// NewProjectAssets returns a project assets route handler.
func NewProjectAssets(service *service.ProjectAssets) ProjectAssets {
	return ProjectAssets{service: service}
}

// HandleProjectAssets godoc
// @Summary 获取项目资产列表
// @Description 返回项目内上传或整理的资产文件。
// @Tags Project Assets
// @Produce json
// @Param projectId path string true "Project ID"
// @Param kind query string false "Asset kind"
// @Param q query string false "Search text"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/assets [get]
func (handler ProjectAssets) HandleProjectAssets(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	assets, err := handler.service.List(projectID)
	if err != nil {
		httpresponse.ErrorFromStatus(context, projectAssetErrorStatus(err), err)
		return
	}

	httpresponse.OK(context, service.ProjectAssetsResponse{Assets: assets})
}

// HandleUploadProjectAsset godoc
// @Summary 上传项目资产
// @Description 上传一个项目范围内的资产文件。
// @Tags Project Assets
// @Accept multipart/form-data
// @Produce json
// @Param projectId path string true "Project ID"
// @Param file formData file true "Asset file"
// @Param kind formData string false "Asset kind"
// @Param name formData string false "Display name"
// @Param parentId formData string false "Parent asset ID"
// @Param folderId formData string false "Folder ID"
// @Param sortOrder formData int false "Sort order"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/assets [post]
func (handler ProjectAssets) HandleUploadProjectAsset(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	context.Request.Body = http.MaxBytesReader(context.Writer, context.Request.Body, service.MaxProjectAssetUploadSize)
	file, err := context.FormFile("file")
	if err != nil {
		httpresponse.Error(context, http.StatusBadRequest, "file is required")
		return
	}

	sortOrder := 0
	if value := strings.TrimSpace(context.PostForm("sortOrder")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			httpresponse.Error(context, http.StatusBadRequest, "sortOrder must be a number")
			return
		}
		sortOrder = parsed
	}

	asset, err := handler.service.SaveMultipartFile(
		projectID,
		file,
		context.PostForm("parentId"),
		sortOrder,
		context.PostForm("folderId"),
	)
	if err != nil {
		httpresponse.ErrorFromStatus(context, projectAssetErrorStatus(err), err)
		return
	}

	httpresponse.OK(context, asset)
}

// HandleProjectAssetContent godoc
// @Summary 下载项目资产内容
// @Description 返回项目资产的原始文件内容。
// @Tags Project Assets
// @Produce application/octet-stream
// @Param projectId path string true "Project ID"
// @Param assetId path string true "Asset ID"
// @Success 200 {file} file
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/assets/{assetId}/content [get]
func (handler ProjectAssets) HandleProjectAssetContent(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	assetID, ok := requiredPathParam(context, "assetId", "assetId")
	if !ok {
		return
	}
	asset, ok, err := handler.service.Get(projectID, assetID)
	if err != nil {
		httpresponse.ErrorFromStatus(context, projectAssetErrorStatus(err), err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "project asset not found")
		return
	}

	context.Header("Content-Type", asset.MIMEType)
	context.Header("Content-Disposition", fmt.Sprintf("inline; filename=%q", asset.Filename))
	http.ServeFile(context.Writer, context.Request, asset.FilePath)
}

// HandleUpdateProjectAsset godoc
// @Summary 更新项目资产
// @Description 更新项目资产的名称、层级或元数据。
// @Tags Project Assets
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param assetId path string true "Asset ID"
// @Param payload body SwaggerObject true "Project asset patch"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/assets/{assetId} [put]
func (handler ProjectAssets) HandleUpdateProjectAsset(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	assetID, ok := requiredPathParam(context, "assetId", "assetId")
	if !ok {
		return
	}
	payload, err := decodeJSON[service.ProjectAssetUpdateRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	asset, ok, err := handler.service.Update(projectID, assetID, payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, projectAssetErrorStatus(err), err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "project asset not found")
		return
	}

	httpresponse.OK(context, asset)
}

// HandleDeleteProjectAsset godoc
// @Summary 删除项目资产
// @Description 删除项目资产记录及相关文件引用。
// @Tags Project Assets
// @Produce json
// @Param projectId path string true "Project ID"
// @Param assetId path string true "Asset ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/assets/{assetId} [delete]
func (handler ProjectAssets) HandleDeleteProjectAsset(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	assetID, ok := requiredPathParam(context, "assetId", "assetId")
	if !ok {
		return
	}
	deleted, err := handler.service.Delete(projectID, assetID)
	if err != nil {
		httpresponse.ErrorFromStatus(context, projectAssetErrorStatus(err), err)
		return
	}
	if !deleted {
		httpresponse.Error(context, http.StatusNotFound, "project asset not found")
		return
	}

	handler.HandleProjectAssets(context)
}

func projectAssetErrorStatus(err error) int {
	if err == nil {
		return http.StatusInternalServerError
	}
	message := err.Error()
	if strings.Contains(message, "required") ||
		strings.Contains(message, "empty") ||
		strings.Contains(message, "larger than") ||
		strings.Contains(message, "filename") ||
		strings.Contains(message, "folder not found") {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}
