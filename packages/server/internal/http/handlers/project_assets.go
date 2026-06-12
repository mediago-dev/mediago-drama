package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/projectasset"
)

// ProjectAssets handles project-scoped asset HTTP routes.
type ProjectAssets struct {
	service *service.ProjectAssets
}

// NewProjectAssets returns a project assets route handler.
func NewProjectAssets(service *service.ProjectAssets) ProjectAssets {
	return ProjectAssets{service: service}
}

// HandleProjectAssets lists project assets.
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

// HandleUploadProjectAsset uploads a project asset.
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

// HandleProjectAssetContent serves project asset bytes.
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

// HandleUpdateProjectAsset updates project asset metadata.
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

// HandleDeleteProjectAsset deletes a project asset.
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
