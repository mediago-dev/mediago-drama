package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
)

// MediaAssets handles media asset HTTP routes.
type MediaAssets struct {
	service *service.MediaAssets
}

// NewMediaAssets returns a media assets route handler.
func NewMediaAssets(service *service.MediaAssets) MediaAssets {
	return MediaAssets{service: service}
}

// HandleMediaAssets godoc
// @Summary 获取媒体资产列表
// @Description 返回全局媒体资产，可按类型或关键词筛选。
// @Tags Media Assets
// @Produce json
// @Param kind query string false "Media kind"
// @Param q query string false "Search text"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/media-assets [get]
func (handler MediaAssets) HandleMediaAssets(context *gin.Context) {
	assets, err := handler.service.List(optionalProjectID(context))
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	assets = service.FilterMediaAssets(assets, context.Query("kind"), context.Query("q"))
	httpresponse.OK(context, service.MediaAssetsResponse{Assets: assets})
}

// HandleProjectMediaAssets godoc
// @Summary 获取项目媒体资产列表
// @Description 返回项目范围内可用的媒体资产。
// @Tags Media Assets
// @Produce json
// @Param projectId path string true "Project ID"
// @Param kind query string false "Media kind"
// @Param q query string false "Search text"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/media-assets [get]
func (handler MediaAssets) HandleProjectMediaAssets(context *gin.Context) {
	handler.HandleMediaAssets(context)
}

// HandleUploadMediaAsset godoc
// @Summary 上传媒体资产
// @Description 上传图片、视频或其他媒体资产到全局媒体库。
// @Tags Media Assets
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "Media file"
// @Param kind formData string false "Media kind"
// @Param name formData string false "Display name"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/media-assets [post]
func (handler MediaAssets) HandleUploadMediaAsset(context *gin.Context) {
	context.Request.Body = http.MaxBytesReader(context.Writer, context.Request.Body, service.MaxMediaAssetUploadSize)
	file, err := context.FormFile("file")
	if err != nil {
		httpresponse.Error(context, http.StatusBadRequest, "file is required")
		return
	}

	asset, err := handler.service.SaveMultipartFile(file, optionalProjectID(context))
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	httpresponse.OK(context, asset)
}

// HandleUploadProjectMediaAsset godoc
// @Summary 上传项目媒体资产
// @Description 上传媒体资产并关联到指定项目。
// @Tags Media Assets
// @Accept multipart/form-data
// @Produce json
// @Param projectId path string true "Project ID"
// @Param file formData file true "Media file"
// @Param kind formData string false "Media kind"
// @Param name formData string false "Display name"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/media-assets [post]
func (handler MediaAssets) HandleUploadProjectMediaAsset(context *gin.Context) {
	handler.HandleUploadMediaAsset(context)
}

// HandleMediaAssetContent godoc
// @Summary 下载媒体资产内容
// @Description 返回媒体资产原始文件内容。
// @Tags Media Assets
// @Produce application/octet-stream
// @Param assetId path string true "Asset ID"
// @Success 200 {file} file
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/media-assets/{assetId}/content [get]
func (handler MediaAssets) HandleMediaAssetContent(context *gin.Context) {
	id := strings.TrimSpace(context.Param("assetId"))
	if id == "" {
		httpresponse.Error(context, http.StatusBadRequest, "asset id is required")
		return
	}

	asset, ok, err := handler.service.Get(id)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "media asset not found")
		return
	}
	filePath, err := handler.service.ServeFilePath(asset)
	if err != nil {
		httpresponse.Error(context, http.StatusNotFound, "media asset not found")
		return
	}

	context.Header("Content-Type", asset.MIMEType)
	context.Header("Content-Disposition", contentDispositionWithFilename("inline", asset.Filename))
	http.ServeFile(context.Writer, context.Request, filePath)
}

// HandleProjectMediaAssetContent godoc
// @Summary 下载项目媒体资产内容
// @Description 返回项目媒体资产原始文件内容。
// @Tags Media Assets
// @Produce application/octet-stream
// @Param projectId path string true "Project ID"
// @Param assetId path string true "Asset ID"
// @Success 200 {file} file
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/media-assets/{assetId}/content [get]
func (handler MediaAssets) HandleProjectMediaAssetContent(context *gin.Context) {
	handler.HandleMediaAssetContent(context)
}

// HandleMediaAssetPoster godoc
// @Summary 获取媒体资产封面
// @Description 返回视频或生成媒体资产的封面图片。
// @Tags Media Assets
// @Produce image/png
// @Param assetId path string true "Asset ID"
// @Success 200 {file} file
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/media-assets/{assetId}/poster [get]
func (handler MediaAssets) HandleMediaAssetPoster(context *gin.Context) {
	id := strings.TrimSpace(context.Param("assetId"))
	if id == "" {
		httpresponse.Error(context, http.StatusBadRequest, "asset id is required")
		return
	}

	asset, ok, err := handler.service.Get(id)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "media asset not found")
		return
	}
	filePath, err := handler.service.ServePosterFilePath(asset)
	if err != nil {
		httpresponse.Error(context, http.StatusNotFound, "media asset poster not found")
		return
	}

	context.Header("Content-Type", "image/jpeg")
	context.Header("Content-Disposition", contentDispositionWithFilename("inline", asset.ID+"-poster.jpg"))
	http.ServeFile(context.Writer, context.Request, filePath)
}

// HandleProjectMediaAssetPoster godoc
// @Summary 获取项目媒体资产封面
// @Description 返回项目媒体资产的视频封面或预览图。
// @Tags Media Assets
// @Produce image/png
// @Param projectId path string true "Project ID"
// @Param assetId path string true "Asset ID"
// @Success 200 {file} file
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/media-assets/{assetId}/poster [get]
func (handler MediaAssets) HandleProjectMediaAssetPoster(context *gin.Context) {
	handler.HandleMediaAssetPoster(context)
}

// HandleUpdateMediaAsset godoc
// @Summary 更新媒体资产
// @Description 更新媒体资产文件名或元数据。
// @Tags Media Assets
// @Accept json
// @Produce json
// @Param assetId path string true "Asset ID"
// @Param payload body SwaggerObject true "Media asset patch"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/media-assets/{assetId} [put]
func (handler MediaAssets) HandleUpdateMediaAsset(context *gin.Context) {
	id := strings.TrimSpace(context.Param("assetId"))
	if id == "" {
		httpresponse.Error(context, http.StatusBadRequest, "asset id is required")
		return
	}

	payload, err := decodeJSON[service.MediaAssetUpdateRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	asset, ok, err := handler.service.UpdateFilename(id, payload.Filename)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "media asset not found")
		return
	}

	httpresponse.OK(context, asset)
}

// HandleUpdateProjectMediaAsset godoc
// @Summary 更新项目媒体资产
// @Description 更新项目范围内媒体资产文件名或元数据。
// @Tags Media Assets
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID"
// @Param assetId path string true "Asset ID"
// @Param payload body SwaggerObject true "Media asset patch"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/media-assets/{assetId} [put]
func (handler MediaAssets) HandleUpdateProjectMediaAsset(context *gin.Context) {
	handler.HandleUpdateMediaAsset(context)
}

// HandleDeleteMediaAsset godoc
// @Summary 删除媒体资产
// @Description 删除全局媒体资产记录。
// @Tags Media Assets
// @Produce json
// @Param assetId path string true "Asset ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/media-assets/{assetId} [delete]
func (handler MediaAssets) HandleDeleteMediaAsset(context *gin.Context) {
	id := strings.TrimSpace(context.Param("assetId"))
	if id == "" {
		httpresponse.Error(context, http.StatusBadRequest, "asset id is required")
		return
	}

	deleted, err := handler.service.Delete(id)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !deleted {
		httpresponse.Error(context, http.StatusNotFound, "media asset not found")
		return
	}

	handler.HandleMediaAssets(context)
}

// HandleDeleteProjectMediaAsset godoc
// @Summary 删除项目媒体资产
// @Description 删除项目范围内的媒体资产记录。
// @Tags Media Assets
// @Produce json
// @Param projectId path string true "Project ID"
// @Param assetId path string true "Asset ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/media-assets/{assetId} [delete]
func (handler MediaAssets) HandleDeleteProjectMediaAsset(context *gin.Context) {
	handler.HandleDeleteMediaAsset(context)
}
