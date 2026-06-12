package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
	service "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/media"
)

// MediaAssets handles media asset HTTP routes.
type MediaAssets struct {
	service *service.MediaAssets
}

// NewMediaAssets returns a media assets route handler.
func NewMediaAssets(service *service.MediaAssets) MediaAssets {
	return MediaAssets{service: service}
}

// HandleMediaAssets lists media assets.
func (handler MediaAssets) HandleMediaAssets(context *gin.Context) {
	assets, err := handler.service.List(optionalProjectID(context))
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	assets = service.FilterMediaAssets(assets, context.Query("kind"), context.Query("q"))
	httpresponse.OK(context, service.MediaAssetsResponse{Assets: assets})
}

// HandleUploadMediaAsset uploads a media asset.
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

// HandleSaveGeneratedAssetFile saves a generated image or video to a user-selected local folder.
func (handler MediaAssets) HandleSaveGeneratedAssetFile(context *gin.Context) {
	context.Request.Body = http.MaxBytesReader(context.Writer, context.Request.Body, 1<<20)
	payload, err := decodeJSON[service.GeneratedAssetFileSaveRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	saved, err := handler.service.SaveGeneratedAssetFile(context.Request.Context(), payload)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	httpresponse.OK(context, saved)
}

// HandleMediaAssetContent serves media asset bytes.
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
	context.Header("Content-Disposition", fmt.Sprintf("inline; filename=%q", asset.Filename))
	http.ServeFile(context.Writer, context.Request, filePath)
}

// HandleMediaAssetPoster serves a generated media asset poster image.
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
	context.Header("Content-Disposition", fmt.Sprintf("inline; filename=%q", asset.ID+"-poster.jpg"))
	http.ServeFile(context.Writer, context.Request, filePath)
}

// HandleUpdateMediaAsset updates a media asset filename.
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

// HandleDeleteMediaAsset deletes a media asset.
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
