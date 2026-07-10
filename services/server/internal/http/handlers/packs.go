package handlers

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

// PromptPacks handles prompt pack management routes.
type PromptPacks struct {
	store *promptpack.Service
}

// NewPromptPacks returns a prompt pack route handler.
func NewPromptPacks(store *promptpack.Service) PromptPacks {
	return PromptPacks{store: store}
}

type promptPackListResponse struct {
	Packs []promptpack.Pack `json:"packs"`
}

type installPromptPackRequest struct {
	Path string `json:"path"`
}

type updatePromptPackRequest struct {
	Enabled *bool `json:"enabled"`
}

type deletePromptPackResponse struct {
	Deleted bool `json:"deleted"`
}

// HandleExportPack godoc
// @Summary 导出提示词包
// @Description 按 MediaGo .mgpack 格式导出一个完整提示词包。
// @Tags Prompt Packs
// @Produce octet-stream
// @Param id path string true "Pack ID"
// @Success 200 {file} file
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/export [get]
func (handler PromptPacks) HandleExportPack(context *gin.Context) {
	exported, err := handler.store.ExportPack(context.Request.Context(), context.Param("id"))
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	context.Header("Content-Type", "application/octet-stream")
	context.Header(
		"Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"`, strings.ReplaceAll(exported.FileName, `"`, "")),
	)
	context.Data(http.StatusOK, "application/octet-stream", exported.Data)
}

// HandleImportPack godoc
// @Summary 导入用户提示词包
// @Description 上传并安装一个 MediaGo .mgpack 或 .mgpackpro 提示词包。
// @Tags Prompt Packs
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "Prompt pack .mgpack or .mgpackpro file"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/import [post]
func (handler PromptPacks) HandleImportPack(context *gin.Context) {
	file, err := context.FormFile("file")
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, errors.New("file is required"))
		return
	}
	source, err := file.Open()
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	defer source.Close()
	data, err := io.ReadAll(io.LimitReader(source, promptpack.MaxUploadBytes()+1))
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	pack, err := handler.store.InstallData(context.Request.Context(), file.Filename, data)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

// HandleListPacks godoc
// @Summary 获取提示词包列表
// @Description 返回已安装的全局提示词包。
// @Tags Prompt Packs
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs [get]
func (handler PromptPacks) HandleListPacks(context *gin.Context) {
	packs, err := handler.store.ListPacks(context.Request.Context())
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, promptPackListResponse{Packs: packs})
}

// HandleInstallPack godoc
// @Summary 安装提示词包
// @Description 从本地目录或 .mgpack 文件安装提示词包。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Install payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/install [post]
func (handler PromptPacks) HandleInstallPack(context *gin.Context) {
	payload, err := decodeJSON[installPromptPackRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	pack, err := handler.store.InstallPath(context.Request.Context(), payload.Path)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

// HandlePatchPack godoc
// @Summary 更新提示词包
// @Description 启用或禁用一个提示词包。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param id path string true "Pack ID"
// @Param payload body SwaggerObject true "Patch payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id} [patch]
func (handler PromptPacks) HandlePatchPack(context *gin.Context) {
	payload, err := decodeJSON[updatePromptPackRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if payload.Enabled == nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, errors.New("enabled is required"))
		return
	}
	pack, err := handler.store.SetEnabled(context.Request.Context(), context.Param("id"), *payload.Enabled)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

// HandleDeletePack godoc
// @Summary 卸载提示词包
// @Description 删除一个导入的提示词包；默认包不可卸载。
// @Tags Prompt Packs
// @Produce json
// @Param id path string true "Pack ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id} [delete]
func (handler PromptPacks) HandleDeletePack(context *gin.Context) {
	if err := handler.store.Uninstall(context.Request.Context(), context.Param("id")); err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, deletePromptPackResponse{Deleted: true})
}

// HandleResetPack godoc
// @Summary 恢复提示词包默认内容
// @Description 将提示词包内的默认技能和提示词预设恢复为安装包内容；用户新增内容会保留。
// @Tags Prompt Packs
// @Produce json
// @Param id path string true "Pack ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/reset [post]
func (handler PromptPacks) HandleResetPack(context *gin.Context) {
	pack, err := handler.store.ResetPack(context.Request.Context(), context.Param("id"))
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

func writePromptPackError(context *gin.Context, err error) {
	switch {
	case errors.Is(err, promptpack.ErrInvalidPack):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, promptpack.ErrPackLicenseRequired):
		httpresponse.ErrorFromStatus(context, http.StatusForbidden, err)
	case errors.Is(err, promptpack.ErrPackExportRestricted):
		httpresponse.ErrorFromStatus(context, http.StatusForbidden, err)
	case errors.Is(err, promptpack.ErrPackReadonly):
		httpresponse.ErrorFromStatus(context, http.StatusForbidden, err)
	case errors.Is(err, promptpack.ErrPackNotFound), errors.Is(err, promptpack.ErrEntryNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	default:
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
	}
}
